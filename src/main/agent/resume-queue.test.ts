// Resume-queue tests: the survive-the-reload contract. Snapshot before
// relaunch, consume exactly once after, drop entries for dead sessions.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// The queue writes under infiniteHome() — redirect the profile home to a
// temp path so tests never touch the user's real resume state. The path is
// PURE STRING MATH in hoisted scope (imports are not initialized when the
// mock factory runs); the queue module's ensureDir creates it on first write.
const tempHome = vi.hoisted(() => {
  const base = process.env.TEMP || process.env.TMP || '/tmp';
  return base.replace(/[\\/]+$/, '') + '/infinite-resume-' + Math.random().toString(36).slice(2);
});
vi.mock('../profiles/home.js', () => ({ infiniteHome: () => tempHome }));

import { consumeResumeQueue, writeResumeQueue, type ResumeEntry } from './resume-queue.js';

function entry(overrides: Partial<ResumeEntry> = {}): ResumeEntry {
  return {
    sessionId: 'session-a',
    request: 'Build the login page',
    provider: 'prov',
    model: 'model-x',
    cwd: tempHome,
    background: true,
    savedAt: Date.now(),
    ...overrides,
  };
}

beforeEach(() => {
  // Fresh queue file per test.
  try { rmSync(join(tempHome, 'resume-queue.json'), { force: true }); } catch { /* absent */ }
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('resume queue', () => {
  it('writes then consumes exactly once — the second consume is empty', async () => {
    writeResumeQueue([entry(), entry({ sessionId: 'session-b' })]);
    const first = await consumeResumeQueue(async () => true);
    expect(first.map((e) => e.sessionId)).toEqual(['session-a', 'session-b']);
    const second = await consumeResumeQueue(async () => true);
    expect(second).toEqual([]);
  });

  it('drops entries whose session no longer exists', async () => {
    writeResumeQueue([entry(), entry({ sessionId: 'deleted-session' })]);
    const kept = await consumeResumeQueue(async (id) => id === 'session-a');
    expect(kept.map((e) => e.sessionId)).toEqual(['session-a']);
  });

  it('tolerates a missing or corrupt queue file', async () => {
    expect(await consumeResumeQueue(async () => true)).toEqual([]);
    writeResumeQueue([entry()]);
    // Corrupt the file.
    const q = join(tempHome, 'resume-queue.json');
    writeFileSync(q, 'not json at all{', 'utf8');
    expect(await consumeResumeQueue(async () => true)).toEqual([]);
  });

  it('preserves full entry payloads through a write/read round-trip', async () => {
    const full = entry({ request: 'Fix the flaky export in src/app.ts', background: false });
    writeResumeQueue([full]);
    const [read] = await consumeResumeQueue(async () => true);
    expect(read).toMatchObject({
      sessionId: 'session-a',
      request: 'Fix the flaky export in src/app.ts',
      provider: 'prov',
      model: 'model-x',
      background: false,
    });
  });

  it('creates the home directory on first write', async () => {
    // The queue module must tolerate a missing
    // home subdir without throwing.
    expect(() => writeResumeQueue([entry()])).not.toThrow();
    expect((await consumeResumeQueue(async () => true)).length).toBe(1);
  });
});
