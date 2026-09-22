import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  clearProviderAuthFailure,
  isProviderAuthKnownBad,
  noteProviderAuthFailure,
  resetProviderAuthHealth,
} from './health.js';

const PROVIDER = 'test-health-provider-xyz';
let testHome = '';

describe('provider auth health', () => {
  // infiniteHome() caches on first call — point it at one temp dir for the
  // whole file, not per test.
  beforeAll(() => {
    testHome = mkdtempSync(join(tmpdir(), 'infinite-health-test-'));
    process.env.INFINITE_TEST_HOME = testHome;
  });

  afterEach(() => {
    resetProviderAuthHealth();
  });

  afterAll(() => {
    delete process.env.INFINITE_TEST_HOME;
    try {
      rmSync(testHome, { recursive: true, force: true });
    } catch { /* best-effort */ }
  });

  it('starts clean for unknown providers', () => {
    expect(isProviderAuthKnownBad(PROVIDER)).toBe(false);
  });

  it('remembers a failure and forgets it on clear', () => {
    noteProviderAuthFailure(PROVIDER);
    expect(isProviderAuthKnownBad(PROVIDER)).toBe(true);
    clearProviderAuthFailure(PROVIDER);
    expect(isProviderAuthKnownBad(PROVIDER)).toBe(false);
  });

  it('expires entries after the TTL', () => {
    noteProviderAuthFailure(PROVIDER, 1_000);
    expect(isProviderAuthKnownBad(PROVIDER, 2_000, 5_000)).toBe(true);
    expect(isProviderAuthKnownBad(PROVIDER, 7_000, 5_000)).toBe(false);
  });

  it('survives a cache reset (file persistence)', () => {
    noteProviderAuthFailure(PROVIDER);
    // Simulate a fresh process: drop the in-memory cache, keep the file.
    resetProviderAuthHealth();
    expect(isProviderAuthKnownBad(PROVIDER)).toBe(true);
    clearProviderAuthFailure(PROVIDER);
    expect(isProviderAuthKnownBad(PROVIDER)).toBe(false);
  });
});
