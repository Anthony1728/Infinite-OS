import { describe, expect, it, beforeEach, vi, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// The guard persists its runaway-loop window to the profile directory. Without
// this override the tests would write to the developer's real Infinite OS
// profile â€” the same hazard that left a stale provider-health timestamp
// skipping a provider for minutes.
process.env.INFINITE_TEST_HOME ??= mkdtempSync(join(tmpdir(), 'infinite-guard-test-'));
afterAll(() => {
  try {
    rmSync(process.env.INFINITE_TEST_HOME as string, { recursive: true, force: true });
  } catch { /* best-effort */ }
});

// settings is read on every guard call, so the tests control it rather than
// depending on whatever the developer's machine happens to have.
const settingsValues = new Map<string, unknown>();
vi.mock('../settings/store.js', () => ({
  settings: {
    get: (key: string) => settingsValues.get(key),
  },
}));

const {
  guardSelfModification,
  isProtectedPath,
  toRepoRelative,
  resetSelfModificationGuard,
  listProtectedPaths,
} = await import('./self-modification.js');

const ROOT = 'C:\\repo';

/**
 * The user's ability to give the agent total autonomy depends on being able to
 * see what it changed and put it back. Infinite OS already versions every agent
 * edit and logs every action. These tests cover the one hole in that: the agent
 * rewriting the machinery that does the versioning and the logging.
 */
describe('the agent cannot quietly dismantle its own undo', () => {
  beforeEach(() => {
    settingsValues.clear();
    resetSelfModificationGuard();
  });

  it('refuses to modify the snapshot store', () => {
    const result = guardSelfModification(ROOT, 'src/main/tools/snapshots.ts', 'modify');
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('protected');
  });

  it('refuses to modify the permission engine, which decides what the agent may do', () => {
    expect(guardSelfModification(ROOT, 'src/main/agent/permissions.ts', 'modify').allowed).toBe(false);
  });

  it('refuses to modify the audit log', () => {
    expect(guardSelfModification(ROOT, 'src/main/audit/action-log.ts', 'modify').allowed).toBe(false);
  });

  it('refuses to delete the guard itself, which a guard that can be edited away is not', () => {
    const result = guardSelfModification(ROOT, 'src/main/agent/self-modification.ts', 'delete');
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('delete');
  });

  it('protects a whole directory, not just named files', () => {
    // A new file added inside audit/ is just as capable of breaking it as an
    // edit to an existing one.
    expect(guardSelfModification(ROOT, 'src/main/audit/anything-new.ts', 'modify').allowed).toBe(false);
    expect(guardSelfModification(ROOT, 'src/main/checkpoint/manager.ts', 'modify').allowed).toBe(false);
  });

  it('matches the same file however the path is written', () => {
    // Windows accepts all of these. A guard that only caught one spelling
    // would be one `.\` away from being bypassed.
    for (const p of [
      'src/main/audit/action-log.ts',
      'src\\main\\audit\\action-log.ts',
      'src/main/audit/../audit/action-log.ts',
      `${ROOT}\\src\\main\\audit\\action-log.ts`,
    ]) {
      expect(isProtectedPath(ROOT, p), p).toBe(true);
    }
  });

  it('says plainly what to do about it', () => {
    const result = guardSelfModification(ROOT, 'src/main/agent/permissions.ts', 'modify');
    // An unexplained refusal reads as the app being broken, and the agent will
    // try a different tool instead of telling the user.
    expect(result.reason).toMatch(/Settings/i);
    expect(result.reason).toMatch(/undo|reverse/i);
  });
});

describe('the agent is otherwise left alone', () => {
  beforeEach(() => {
    settingsValues.clear();
    resetSelfModificationGuard();
  });

  it('does not protect ordinary source, including its own features', () => {
    // The point is that this guards the user's undo, not the agent's freedom.
    for (const p of [
      'src/main/tools/browser.ts',
      'src/main/agent/context.ts',
      'src/renderer/components/views/BusinessOSView.tsx',
      'src/main/tools/cli-hub.ts',
      'src/main/skills/hub.ts',
    ]) {
      expect(guardSelfModification(ROOT, p, 'modify').allowed, p).toBe(true);
    }
  });

  it('does not touch the user\'s own files outside the repo', () => {
    for (const p of ['C:\\Users\\example\\Documents\\notes.md', 'D:\\photos\\cat.png', '..\\..\\anything']) {
      expect(guardSelfModification(ROOT, p, 'delete').allowed, p).toBe(true);
    }
  });

  it('does not confuse a similarly named file outside the protected directories', () => {
    // `my-audit/` is not `audit/`.
    expect(guardSelfModification(ROOT, 'src/main/my-audit/thing.ts', 'modify').allowed).toBe(true);
    expect(guardSelfModification(ROOT, 'src/main/audit-notes.ts', 'modify').allowed).toBe(true);
  });
});

describe('the user can turn it off', () => {
  beforeEach(() => {
    resetSelfModificationGuard();
  });

  it('is on by default, because a broken settings read must not disable it', () => {
    settingsValues.clear();
    expect(guardSelfModification(ROOT, 'src/main/agent/permissions.ts', 'modify').allowed).toBe(false);
  });

  it('allows the edit when the user has explicitly turned it off', () => {
    settingsValues.set('selfProtectionEnabled', false);
    expect(guardSelfModification(ROOT, 'src/main/agent/permissions.ts', 'modify').allowed).toBe(true);
  });

  it('leaves the runaway limit in force even when protection is off', () => {
    settingsValues.set('selfProtectionEnabled', false);
    // Turning off protection is a statement about capability, not permission to
    // burn the machine. A loop is stopped either way.
    let blocked = false;
    for (let i = 0; i < 40; i++) {
      if (!guardSelfModification(ROOT, 'src/main/tools/browser.ts', 'modify').allowed) { blocked = true; break; }
    }
    expect(blocked).toBe(true);
  });
});

describe('a runaway edit loop is stopped', () => {
  beforeEach(() => {
    settingsValues.clear();
    resetSelfModificationGuard();
  });

  it('lets a real fix through â€” iterating on one file many times is normal', () => {
    for (let i = 0; i < 10; i++) {
      expect(guardSelfModification(ROOT, 'src/main/tools/browser.ts', 'modify').allowed).toBe(true);
    }
  });

  it('stops a loop that rewrites the same file without progress', () => {
    // The failure this prevents: the agent edits, sees the same error, edits
    // again, forever. On this machine that burns the user's time and fills the
    // snapshot store with hundreds of versions of the same file.
    let allowed = 0;
    let lastReason = '';
    for (let i = 0; i < 60; i++) {
      const r = guardSelfModification(ROOT, 'src/main/tools/browser.ts', 'modify');
      if (r.allowed) allowed++;
      else { lastReason = r.reason ?? ''; break; }
    }
    expect(allowed).toBeLessThan(60);
    expect(lastReason).toMatch(/loop|progress/i);
  });

  it('counts per file, so working on two files is not mistaken for a loop', () => {
    for (let i = 0; i < 20; i++) {
      expect(guardSelfModification(ROOT, 'src/main/tools/browser.ts', 'modify').allowed).toBe(true);
      expect(guardSelfModification(ROOT, 'src/main/skills/hub.ts', 'modify').allowed).toBe(true);
    }
  });

  it('never reports a protected path as simply looping', () => {
    // The two guards must not be confused for one another in the message the
    // user reads.
    const result = guardSelfModification(ROOT, 'src/main/audit/action-log.ts', 'modify');
    expect(result.reason).not.toMatch(/loop/i);
  });
});

describe('path handling', () => {
  beforeEach(() => {
    settingsValues.clear();
    resetSelfModificationGuard();
  });

  it('normalises a path to repo-relative forward-slash form', () => {
    expect(toRepoRelative(ROOT, 'src/main/audit/action-log.ts')).toBe('src/main/audit/action-log.ts');
    expect(toRepoRelative(ROOT, `${ROOT}/src/main/audit/action-log.ts`)).toBe('src/main/audit/action-log.ts');
  });

  it('reports a path outside the repo as outside, not as protected', () => {
    expect(toRepoRelative(ROOT, 'C:\\elsewhere\\audit\\action-log.ts')).toMatch(/^\.\./);
    expect(isProtectedPath(ROOT, 'C:\\elsewhere\\audit\\action-log.ts')).toBe(false);
  });

  it('publishes the list so the user can be shown exactly what is guarded', () => {
    const list = listProtectedPaths();
    expect(list.length).toBeGreaterThan(0);
    expect(list).toContain('src/main/agent/permissions.ts');
    // Every entry must be a real repository path, not a comment or a blank.
    for (const p of list) expect(p.trim()).toBe(p);
  });
});