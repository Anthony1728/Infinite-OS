import { afterAll, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

vi.mock('../settings/secrets.js', () => ({
  getAllApiKeys: async () => [] as string[],
}));

// Provider-health writes must never touch the real profile: a leftover
// timestamp would make the running app skip a provider for minutes.
process.env.INFINITE_TEST_HOME ??= mkdtempSync(join(tmpdir(), 'infinite-failover-test-'));
afterAll(() => {
  try {
    rmSync(process.env.INFINITE_TEST_HOME as string, { recursive: true, force: true });
  } catch { /* best-effort */ }
});

import {
  buildProviderFailoverPlan,
  classifyError,
  isFreeTierExhausted,
  isProviderWideFailure,
  isRecoverableProviderError,
  isTransientStreamFailure,
  prioritizeProviderCandidates,
  recordProviderFailure,
  recordProviderSuccess,
  selectNextProviderCandidate,
  type ProviderCandidate,
} from './failover.js';

describe('provider recovery classification', () => {
  it.each([
    'OpenCode: token expired or incorrect',
    'Forbidden: authorization failed (403)',
    'HTTP 429 rate limit exceeded',
    'model is not found',
    'network connection timed out',
    'provider overloaded with no capacity',
    'OpenCode: fetch failed: http://127.0.0.1:4096 connect ECONNREFUSED 127.0.0.1:4096. Is the OpenCode runtime running?',
    'OpenCode runtime stopped responding (no activity for 10 minutes). Infinite OS will retry the run with a fresh session; if the runtime is hung, restart it.',
    'This operation was aborted',
    'Task cancelled before completion',
    'OpenCode 1.18.0 or newer is required to use the free tier',
    'OpenCode message failed (HTTP 426): UpgradeRequired',
    'Upstream request failed: Invalid credential',
    'Freebuff free tier is rate-limited right now',
    'Freebuff needs a consent confirmation in the CLI first',
    'model_locked',
  ])('recovers from transient provider failure: %s', (failure) => {
    expect(isRecoverableProviderError(failure)).toBe(true);
  });

  it.each([
    'OpenCode 1.18.0 or newer is required to use the free tier',
    'HTTP 426 Upgrade Required',
    'HTTP 429 rate limit exceeded',
  ])('treats version-gated and quota failures as provider-wide: %s', (failure) => {
    expect(isProviderWideFailure(failure)).toBe(true);
  });

  it.each([
    'The request was rejected by the content policy',
    'Invalid tool arguments',
    'Permission denied by user',
  ])('does not hide non-provider failures: %s', (failure) => {
    expect(isRecoverableProviderError(failure)).toBe(false);
  });

  it.each([
    'Freebuff is not signed in. Run `freebuff login` in a terminal and complete the sign-in, then try again.',
    'OpenCode: the installed CLI login was just rejected upstream. Refresh it with `opencode auth login`, then retry.',
    'HTTP 401 Unauthorized',
    'Invalid credential',
  ])('never retries credential/setup failures on the same model: %s', (failure) => {
    expect(isTransientStreamFailure(failure)).toBe(false);
  });
});

describe('provider recovery selection', () => {
  const candidate = (provider: string, model: string): ProviderCandidate => ({
    provider,
    model,
    apiKey: 'configured',
    label: `${provider}/${model}`,
  });
  const plan = [candidate('nvidia', 'large'), candidate('nvidia', 'small'), candidate('groq', 'fast')];

  it('keeps the run inside the selected provider on transient failures', () => {
    expect(selectNextProviderCandidate(plan, 0, plan[0], 'HTTP 429 rate limit exceeded')).toEqual(plan[1]);
  });

  it('does not wander to unrelated providers when the selected model is unavailable', () => {
    expect(selectNextProviderCandidate(plan, 0, plan[0], 'The selected OpenCode model is not currently available: opencode::big-pickle')).toEqual(plan[1]);
  });

  it('tries another model on model-specific failures', () => {
    expect(selectNextProviderCandidate(plan, 0, plan[0], 'model not found')).toEqual(plan[1]);
  });

  it('may leave the selected provider only on credential-level failures', () => {
    expect(selectNextProviderCandidate(plan, 0, plan[0], 'OpenCode Zen rejected this API key.')).toEqual(plan[2]);
  });

  it('leaves the provider immediately on login/setup failures', () => {
    const fbPlan = [candidate('freebuff', 'z-ai/glm-5.3-flash'), candidate('freebuff', 'mimo/mimo-v2.5'), candidate('nvidia', 'large')];
    expect(selectNextProviderCandidate(fbPlan, 0, fbPlan[0], 'Freebuff is not signed in. Run `freebuff login` in a terminal and complete the sign-in, then try again.')).toEqual(fbPlan[2]);
  });

  it('returns no candidate after the recovery chain is exhausted', () => {
    expect(selectNextProviderCandidate(plan, 2, plan[2], 'network timeout')).toBeUndefined();
  });

  it('still hops providers when a fallback candidate fails provider-wide', () => {
    const fallbackPlan = [candidate('opencode', 'opencode::mimo-v2.5-free'), candidate('nvidia', 'large'), candidate('groq', 'fast')];
    expect(selectNextProviderCandidate(fallbackPlan, 1, fallbackPlan[1], 'HTTP 429 rate limit exceeded')).toEqual(fallbackPlan[2]);
  });

  it('keeps a healthy user-selected model ahead of a previously successful fallback', () => {
    const selected = candidate('opencode', 'opencode::mimo-v2.5-free');
    const fallback = candidate('nvidia', 'meta/llama-3.3-70b-instruct');
    recordProviderSuccess(fallback);
    expect(prioritizeProviderCandidates([selected, fallback])[0]).toEqual(selected);
  });

  it('never lets a cooldown replace the user-selected model', () => {
    const selected = candidate('opencode', 'opencode::failed-test-model');
    const fallback = candidate('nvidia', 'fallback-test-model');
    recordProviderFailure(selected, 'network timeout');
    expect(prioritizeProviderCandidates([selected, fallback])[0]).toEqual(selected);
  });

  it('still deprioritizes unhealthy fallback candidates', () => {
    const fallback = candidate('opencode', 'opencode::mimo-v2.5-free');
    const unhealthy = candidate('nvidia', 'fallback-test-model');
    const healthy = candidate('groq', 'healthy-model');
    recordProviderFailure(unhealthy, 'network timeout');
    expect(prioritizeProviderCandidates([fallback, unhealthy, healthy]).slice(1)).toEqual([healthy, unhealthy]);
  });

  it('includes a keyless installed-CLI candidate for opencode with no saved key', async () => {
    const plan = await buildProviderFailoverPlan({ provider: 'opencode', model: 'opencode::mimo-v2.5-free' });
    expect(plan[0]).toMatchObject({ provider: 'opencode', model: 'opencode::mimo-v2.5-free', apiKey: '' });
  });

  it('skips keyless providers with fresh auth failures as automatic fallback', async () => {
    const { noteProviderAuthFailure, resetProviderAuthHealth } = await import('./health.js');
    try {
      noteProviderAuthFailure('freebuff');
      const plan = await buildProviderFailoverPlan({ provider: 'nvidia', model: 'mistralai/mistral-large' });
      expect(plan.find((c) => c.provider === 'freebuff')).toBeUndefined();
    } finally {
      resetProviderAuthHealth();
    }
  });

  it('still tries an explicitly selected provider despite a fresh auth failure', async () => {
    const { noteProviderAuthFailure, resetProviderAuthHealth } = await import('./health.js');
    try {
      noteProviderAuthFailure('freebuff');
      const plan = await buildProviderFailoverPlan({ provider: 'freebuff', model: 'z-ai/glm-5.3-flash' });
      expect(plan[0]).toMatchObject({ provider: 'freebuff', model: 'z-ai/glm-5.3-flash' });
    } finally {
      resetProviderAuthHealth();
    }
  });

  it('keeps providers requiring a key out of the plan when no key is saved', async () => {
    const plan = await buildProviderFailoverPlan({ provider: 'nvidia', model: 'mistralai/mistral-large' });
    expect(plan.find((c) => c.provider === 'nvidia')).toBeUndefined();
  });

  it('leaves the selected provider when its free-tier quota is exhausted account-wide', () => {
    const exhausted = 'OpenCode: OpenCode free tier limit reached — resets in ~180 min. Free usage exceeded, subscribe to Go Pick another free model, wait for the reset, use a free provider (nvidia / groq / apinex), or subscribe at opencode.ai/go.';
    expect(isFreeTierExhausted(exhausted)).toBe(true);
    expect(isFreeTierExhausted('all good')).toBe(false);
    expect(classifyError(exhausted)).toBe('billing');
    expect(isTransientStreamFailure(exhausted)).toBe(false);
    expect(isProviderWideFailure(exhausted)).toBe(true);
    const plan = [
      { provider: 'opencode', model: 'opencode::big-pickle', apiKey: '', label: 'OpenCode / Big Pickle' },
      { provider: 'opencode', model: 'opencode::mimo-v2.5-free', apiKey: '', label: 'OpenCode / Mimo' },
      { provider: 'nvidia', model: 'mistralai/mistral-large', apiKey: 'k', label: 'NVIDIA NIM / Mistral Large' },
    ];
    const next = selectNextProviderCandidate(plan, 0, plan[0], exhausted);
    expect(next?.provider).toBe('nvidia');
  });
});
