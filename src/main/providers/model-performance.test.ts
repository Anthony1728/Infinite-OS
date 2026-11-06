import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Never write into the real profile: infiniteHome() caches on first call, so
// point it at one temp dir before the first store access.
let testHome = '';
beforeAll(() => {
  testHome = mkdtempSync(join(tmpdir(), 'infinite-model-perf-test-'));
  process.env.INFINITE_TEST_HOME = testHome;
});
afterAll(() => {
  delete process.env.INFINITE_TEST_HOME;
  try {
    rmSync(testHome, { recursive: true, force: true });
  } catch { /* best-effort */ }
});

import {
  flushModelPerformance,
  getModelPerformance,
  getModelPerformanceStats,
  getModelReliability,
  recordModelOutcome,
  resetModelPerformance,
} from './model-performance.js';

const PROVIDER = 'test-perf-provider';
const MODEL = 'test-model-v1';

beforeEach(() => {
  // Full isolation: drop the cache AND the temp file so each test starts with
  // an empty memory (reset alone reloads the file, by design).
  resetModelPerformance();
  try {
    rmSync(join(testHome, 'model-performance.json'), { force: true });
  } catch { /* best-effort */ }
});

describe('model performance memory', () => {
  it('starts untested with zero reliability', () => {
    expect(getModelPerformance(PROVIDER, MODEL)).toBeNull();
    expect(getModelReliability(PROVIDER, MODEL)).toBe(0);
  });

  it('stays unranked until a model has enough attempts', () => {
    recordModelOutcome(PROVIDER, MODEL, true);
    recordModelOutcome(PROVIDER, MODEL, true);
    expect(getModelPerformance(PROVIDER, MODEL)?.successes).toBe(2);
    // 2/2 is not proof — small samples stay humble.
    expect(getModelReliability(PROVIDER, MODEL)).toBe(0);
    recordModelOutcome(PROVIDER, MODEL, true);
    expect(getModelReliability(PROVIDER, MODEL)).toBeGreaterThan(0);
  });

  it('ranks a proven model above a failing one', () => {
    for (let i = 0; i < 6; i++) recordModelOutcome(PROVIDER, 'reliable', true);
    for (let i = 0; i < 6; i++) recordModelOutcome(PROVIDER, 'flaky', false, 'HTTP 401 Unauthorized');
    expect(getModelReliability(PROVIDER, 'reliable')).toBeGreaterThan(0.6);
    expect(getModelReliability(PROVIDER, 'flaky')).toBe(0);
  });

  it('remembers the last outcome and its error for status reporting', () => {
    recordModelOutcome(PROVIDER, MODEL, false, 'HTTP 429 rate limit exceeded');
    const rec = getModelPerformance(PROVIDER, MODEL);
    expect(rec?.lastResult).toBe('fail');
    expect(rec?.lastError).toBe('HTTP 429 rate limit exceeded');
    expect(rec?.failures).toBe(1);

    recordModelOutcome(PROVIDER, MODEL, true);
    const after = getModelPerformance(PROVIDER, MODEL);
    expect(after?.lastResult).toBe('ok');
    expect(after?.lastError).toBeUndefined();
  });

  it('survives a cache reset (file persistence)', () => {
    recordModelOutcome(PROVIDER, MODEL, true);
    recordModelOutcome(PROVIDER, MODEL, true);
    recordModelOutcome(PROVIDER, MODEL, true);
    flushModelPerformance();
    // Simulate a fresh process: drop the in-memory cache, keep the file.
    resetModelPerformance();
    const rec = getModelPerformance(PROVIDER, MODEL);
    expect(rec?.successes).toBe(3);
    expect(getModelReliability(PROVIDER, MODEL)).toBeGreaterThan(0);
  });

  it('does not record outcomes from synthetic evaluation runs', () => {
    process.env.INFINITE_EVAL = '1';
    try {
      recordModelOutcome(PROVIDER, 'bench-model', true);
      recordModelOutcome(PROVIDER, 'bench-model', false, 'benchmark failure');
      expect(getModelPerformance(PROVIDER, 'bench-model')).toBeNull();
    } finally {
      delete process.env.INFINITE_EVAL;
    }
    recordModelOutcome(PROVIDER, 'bench-model', true);
    expect(getModelPerformance(PROVIDER, 'bench-model')?.successes).toBe(1);
  });

  it('exposes stats snapshot sorted by recency', () => {
    recordModelOutcome(PROVIDER, MODEL, true);
    const stats = getModelPerformanceStats().filter((s) => s.provider === PROVIDER);
    expect(stats).toHaveLength(1);
    expect(stats[0]).toMatchObject({ provider: PROVIDER, model: MODEL, attempts: 1, reliability: 0 });
  });
});
