import { describe, expect, it, vi } from 'vitest';

vi.mock('../settings/secrets.js', () => ({
  getAllApiKeys: async () => [] as string[],
}));

import {
  buildProviderFailoverPlan,
  isRecoverableProviderError,
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
  ])('recovers from transient provider failure: %s', (failure) => {
    expect(isRecoverableProviderError(failure)).toBe(true);
  });

  it.each([
    'The request was rejected by the content policy',
    'Invalid tool arguments',
    'Permission denied by user',
  ])('does not hide non-provider failures: %s', (failure) => {
    expect(isRecoverableProviderError(failure)).toBe(false);
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

  it('keeps a keyless installed-CLI candidate for opencode with no saved key', async () => {
    const plan = await buildProviderFailoverPlan({ provider: 'opencode', model: 'opencode::mimo-v2.5-free' });
    expect(plan[0]).toMatchObject({ provider: 'opencode', model: 'opencode::mimo-v2.5-free', apiKey: '' });
  });

  it('keeps providers requiring a key out of the plan when no key is saved', async () => {
    const plan = await buildProviderFailoverPlan({ provider: 'nvidia', model: 'mistralai/mistral-large' });
    expect(plan.find((c) => c.provider === 'nvidia')).toBeUndefined();
  });
});
