import { describe, expect, it, afterAll, vi } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// The guard persists its runaway-loop window to the profile directory. Without
// this override the tests would write to the developer's real Infinite OS
// profile — the same hazard that left a stale provider-health timestamp
// skipping a provider for minutes.
process.env.INFINITE_TEST_HOME ??= mkdtempSync(join(tmpdir(), 'infinite-guard-test-'));
afterAll(() => {
  try {
    rmSync(process.env.INFINITE_TEST_HOME as string, { recursive: true, force: true });
  } catch { /* best-effort */ }
});
import { guardOutputDirectory, outputDirectoryDenial } from './write-guard.js';
import { listProtectedPaths, resetSelfModificationGuard } from '../agent/self-modification.js';

/**
 * Generated output used to be a way around the self-modification guard.
 *
 * `Write`, `Edit` and `Delete` route through the guard, which refuses to touch
 * the files implementing the user's ability to see and undo agent changes. Every
 * generator, though, takes an agent-chosen `outputDir` and wrote to it directly
 * — so asking for a chart could drop a file over `self-modification.ts` and
 * switch the guard off. The design explicitly requires that to be impossible
 * ("a guard that can be edited away is not a guard"), so this closed a real
 * bypass rather than adding belt-and-braces.
 */

const REPO = process.cwd();

describe('generated output respects the self-modification guard', () => {
  it('refuses every path the guard protects', () => {
    // Driven from the real list so the test cannot drift from the policy: if a
    // new file joins PROTECTED_PATHS, generated output is refused for it too.
    for (const rel of listProtectedPaths()) {
      const denied = outputDirectoryDenial(join(REPO, rel), REPO);
      expect(denied, `generated output was allowed over protected path ${rel}`).not.toBeNull();
    }
  });

  it('refuses a protected file when it is the exact output path', () => {
    const guarded = listProtectedPaths().find((p) => p.endsWith('.ts'));
    expect(guarded).toBeDefined();
    expect(outputDirectoryDenial(join(REPO, guarded!), REPO)).not.toBeNull();
  });

  it('refuses a directory containing protected files', () => {
    // The audit directory is protected as a prefix, so writing into its parent
    // tool folder is not itself refused — only the protected subtree is.
    expect(outputDirectoryDenial(join(REPO, 'src', 'main', 'audit'), REPO)).not.toBeNull();
    expect(outputDirectoryDenial(join(REPO, 'src', 'main'), REPO)).toBeNull();
  });

  it('allows the ordinary case: a normal output folder', () => {
    // The guard must not break normal use. Users generate files all day.
    const tmp = join(process.env.TEMP || process.env.TMPDIR || REPO, 'infinite-out');
    expect(outputDirectoryDenial(tmp, REPO)).toBeNull();
  });

  it('allows an unprotected folder inside the repo', () => {
    // Deliberate: Infinite OS stays free to rewrite itself in every way that
    // does not blind the user. Only the undo/audit machinery is protected, so
    // an ordinary source file is still writable — otherwise self-extension
    // would be impossible.
    expect(outputDirectoryDenial(join(REPO, 'src', 'main', 'tools'), REPO)).toBeNull();
  });

  it('is deterministic and does not depend on call order', () => {
    resetSelfModificationGuard();
    const first = guardOutputDirectory(join(REPO, 'src', 'main', 'audit'), REPO);
    const second = guardOutputDirectory(join(REPO, 'src', 'main', 'audit'), REPO);
    expect(first.allowed).toBe(second.allowed);
  });

  it('explains why rather than failing silently', () => {
    const denial = outputDirectoryDenial(join(REPO, 'src', 'main', 'audit'), REPO);
    expect(denial).toMatch(/refused to (write|create)/i);
    expect(denial).toContain('audit');
  });
});

describe('the runaway-loop window survives a restart', () => {
  it('counts edits made before the module was reloaded', async () => {
    const { guardSelfModification, resetSelfModificationGuard } = await import('../agent/self-modification.js');
    const { infiniteHome } = await import('../profiles/home.js');

    resetSelfModificationGuard();

    // The limit is 25 edits per minute and each call checks the count *before*
    // recording, so 25 edits are allowed and the next one is refused.
    const target = join(REPO, 'src', 'main', 'some-file.ts');
    for (let i = 0; i < 25; i++) {
      const r = guardSelfModification(REPO, target, 'modify');
      expect(r.allowed, `edit ${i + 1} was refused too early`).toBe(true);
    }

    // The window was written to the profile. Before this existed it lived only
    // in memory, so restarting the app handed a looping agent a clean budget
    // every time — which is exactly when the limit is needed.
    const stateFile = join(infiniteHome(), 'self-modification-runaway.json');
    expect(existsSync(stateFile), 'the edit window was not persisted').toBe(true);
    const saved = JSON.parse(readFileSync(stateFile, 'utf8')) as Record<string, number[]>;
    expect(Object.values(saved).flat().length).toBe(25);

    // A fresh load picks the history back up and refuses the next edit.
    // `resetModules` discards the in-memory map the way a restart would; the
    // on-disk window is what has to carry the state across.
    vi.resetModules();
    const reloaded = await import('../agent/self-modification.js');
    const next = reloaded.guardSelfModification(REPO, target, 'modify');
    expect(next.allowed, 'the loop was not detected after a restart').toBe(false);
    expect(next.reason).toMatch(/loop/i);

    reloaded.resetSelfModificationGuard();
  });
});