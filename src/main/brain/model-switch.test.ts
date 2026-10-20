import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// secrets.ts calls infiniteHome() at module top — loading the real one would
// pin the profile path before the temp home below is set.
vi.mock('../settings/secrets.js', () => ({
  getAllApiKeys: async () => [] as string[],
}));

// Probes record outcomes into model-performance.json — keep that inside a
// temp profile, never the real one.
let testHome = '';
beforeAll(() => {
  testHome = mkdtempSync(join(tmpdir(), 'infinite-model-switch-test-'));
  process.env.INFINITE_TEST_HOME = testHome;
});
afterAll(() => {
  delete process.env.INFINITE_TEST_HOME;
  try {
    rmSync(testHome, { recursive: true, force: true });
  } catch { /* best-effort */ }
});

import {
  answerModelCommand,
  describeActiveModel,
  switchToTarget,
  switchToWorkingModel,
  type ProbeResult,
  type SwitchDeps,
} from './model-switch.js';
import { resetModelPerformance } from '../providers/model-performance.js';
import type { ProviderCandidate } from '../providers/failover.js';

const candidate = (provider: string, model: string): ProviderCandidate => ({
  provider,
  model,
  apiKey: 'k',
  label: `${provider} / ${model}`,
});

interface Harness {
  deps: SwitchDeps;
  persisted: Array<{ provider: string; model: string }>;
  probed: string[];
}

function harness(
  settings: Record<string, string>,
  probes: Record<string, ProbeResult>,
): Harness {
  const persisted: Harness['persisted'] = [];
  const probed: string[] = [];
  const deps: SwitchDeps = {
    getSetting: ((key: string) => settings[key]) as never,
    persist: async (provider, model) => { persisted.push({ provider, model }); },
    probe: async (c) => {
      const key = `${c.provider}:${c.model}`;
      probed.push(key);
      return probes[key] ?? { ok: true, ms: 5 };
    },
    buildPlan: async () => [],
  };
  return { deps, persisted, probed };
}

beforeEach(() => {
  resetModelPerformance();
});

describe('switchToWorkingModel', () => {
  it('probes down the plan, skips dead models, persists the first that answers', async () => {
    const h = harness(
      { provider: 'opencode', model: 'dead', cwd: 'C:/work' },
      {
        'opencode:dead': { ok: false, ms: 3, error: 'HTTP 401 Unauthorized' },
        'groq:alive': { ok: true, ms: 12 },
      },
    );
    h.deps.buildPlan = async () => [candidate('opencode', 'dead'), candidate('groq', 'alive')];

    const result = await switchToWorkingModel(h.deps);

    expect(result.ok).toBe(true);
    expect(result.provider).toBe('groq');
    expect(result.model).toBe('alive');
    expect(h.probed).toEqual(['opencode:dead', 'groq:alive']);
    expect(h.persisted).toEqual([{ provider: 'groq', model: 'alive' }]);
    expect(result.tried).toHaveLength(2);
    expect(result.tried[0].error).toBe('HTTP 401 Unauthorized');
  });

  it('does not persist anything when every candidate is dead', async () => {
    const h = harness(
      { provider: 'opencode', model: 'dead', cwd: 'C:/work' },
      { 'opencode:dead': { ok: false, ms: 3, error: 'ECONNREFUSED' } },
    );
    h.deps.buildPlan = async () => [candidate('opencode', 'dead')];

    const result = await switchToWorkingModel(h.deps);

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/ECONNREFUSED/);
    expect(result.error).toMatch(/API keys|Ollama/);
    expect(h.persisted).toHaveLength(0);
  });

  it('stops after the probe budget so a phone command never hangs', async () => {
    const h = harness({ provider: 'a', model: 'm' }, {});
    h.deps.buildPlan = async () => [
      candidate('a', 'm1'), candidate('a', 'm2'), candidate('a', 'm3'),
      candidate('a', 'm4'), candidate('a', 'm5'), candidate('a', 'm6'),
    ];
    h.deps.probe = async (c) => { h.probed.push(`${c.provider}:${c.model}`); return { ok: false, ms: 1, error: 'down' }; };

    const result = await switchToWorkingModel(h.deps);

    expect(result.ok).toBe(false);
    expect(h.probed).toHaveLength(4); // MAX_PROBE_CANDIDATES
  });
});

describe('switchToTarget', () => {
  it('probes and persists the requested target', async () => {
    const h = harness({ provider: 'old', model: 'old', cwd: 'C:/work' }, { 'nvidia:large': { ok: true, ms: 9 } });
    h.deps.buildPlan = async () => [candidate('nvidia', 'large')];

    const result = await switchToTarget('nvidia', h.deps);

    expect(result.ok).toBe(true);
    expect(h.persisted).toEqual([{ provider: 'nvidia', model: 'large' }]);
  });

  it('reports an unresolvable target with the available providers', async () => {
    const h = harness({ provider: 'old', model: 'old' }, {});
    h.deps.buildPlan = async () => [];

    const result = await switchToTarget('totally-not-a-provider', h.deps);

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/totally-not-a-provider/);
    expect(result.error).toMatch(/Available:/);
    expect(h.persisted).toHaveLength(0);
  });

  it('surfaces the probe error when the requested target is down', async () => {
    const h = harness({ provider: 'old', model: 'old' }, { 'groq:fast': { ok: false, ms: 4, error: 'HTTP 429 rate limit exceeded' } });
    h.deps.buildPlan = async () => [candidate('groq', 'fast')];

    const result = await switchToTarget('groq', h.deps);

    expect(result.ok).toBe(false);
    expect(result.tried[0].error).toMatch(/429/);
    expect(h.persisted).toHaveLength(0);
  });
});

describe('answerModelCommand', () => {
  it('answers status with the active model', async () => {
    const h = harness({ provider: 'groq', model: 'llama-3.3-70b' }, {});
    const reply = await answerModelCommand({ kind: 'status' }, h.deps);
    expect(reply).toMatch(/Active model: .*llama-3\.3-70b/i);
    expect(reply).toMatch(/switch to a working model/);
  });

  it('answers status for an empty selection with setup guidance', async () => {
    const h = harness({}, {});
    const reply = await answerModelCommand({ kind: 'status' }, h.deps);
    expect(reply).toMatch(/No model selected/);
    expect(reply).toMatch(/switch to a working model/);
  });

  it('switch_working returns a confirmation naming the new model', async () => {
    const h = harness(
      { provider: 'dead', model: 'x', cwd: 'C:/work' },
      {
        'dead:x': { ok: false, ms: 4, error: 'HTTP 401 Unauthorized' },
        'groq:alive': { ok: true, ms: 7 },
      },
    );
    h.deps.buildPlan = async () => [candidate('dead', 'x'), candidate('groq', 'alive')];

    const reply = await answerModelCommand({ kind: 'switch_working' }, h.deps);

    expect(reply).toMatch(/✅ Switched to groq \/ alive/);
    expect(reply).toMatch(/probe answered/);
    expect(reply).toMatch(/Previous: dead\/x/);
    expect(h.persisted).toEqual([{ provider: 'groq', model: 'alive' }]);
  });

  it('switch_target failure lists every attempt instead of a bare error', async () => {
    const h = harness({ provider: 'old', model: 'm' }, { 'nvidia:large': { ok: false, ms: 2, error: 'boom' } });
    h.deps.buildPlan = async () => [candidate('nvidia', 'large')];

    const reply = await answerModelCommand({ kind: 'switch_target', target: 'nvidia' }, h.deps);

    expect(reply).toMatch(/⚠️ Could not switch models/);
    expect(reply).toMatch(/nvidia \/ large: ❌ boom/);
  });
});

describe('describeActiveModel', () => {
  it('includes learned reliability once enough runs are recorded', async () => {
    const { recordModelOutcome } = await import('../providers/model-performance.js');
    for (let i = 0; i < 5; i++) recordModelOutcome('groq', 'llama-3.3-70b', true);
    const h = harness({ provider: 'groq', model: 'llama-3.3-70b' }, {});
    const reply = await describeActiveModel(h.deps);
    expect(reply).toContain('over 5 runs');
    expect(reply).toMatch(/Learned reliability: \d+%/);
  });
});
