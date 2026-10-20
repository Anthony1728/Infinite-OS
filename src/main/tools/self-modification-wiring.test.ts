import { describe, expect, it, beforeEach, vi, afterAll } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';

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

vi.mock('electron', () => {
  const Notify = Object.assign(vi.fn(), { isSupported: (): boolean => false });
  return { Notification: Notify };
});

const settingsValues = new Map<string, unknown>();
vi.mock('../settings/store.js', () => ({
  settings: { get: (key: string) => settingsValues.get(key) },
}));

import { write } from './write.js';
import { deleteTool } from './delete.js';
import { fileOpsTool } from './file-ops.js';
import type { ToolContext } from './base.js';

/**
 * The guard's unit tests prove the rule. These prove the rule is actually
 * reached from the tools.
 *
 * That distinction matters more than usual here: the write tools call
 * `guardSelfModification` from inside a `try { ... } catch { /* guard optional
 * *\/ }` around the neighbouring source-guard call, so a wiring mistake would
 * leave the tool working perfectly while silently never checking anything. The
 * agent would then rewrite its own undo and report success.
 */

let repo: string;

function ctx(cwd: string): ToolContext {
  return {
    cwd,
    abortSignal: new AbortController().signal,
    sessionId: 'test-session',
    onUpdate: () => {},
  };
}

beforeEach(() => {
  settingsValues.clear();
  repo = mkdtempSync(join(tmpdir(), 'selfmod-'));
  // A directory that looks enough like the repo for findInfiniteRepoRoot to
  // accept it, with a protected file inside.
  mkdirSync(join(repo, 'src', 'main', 'audit'), { recursive: true });
  mkdirSync(join(repo, 'src', 'main', 'tools'), { recursive: true });
  writeFileSync(join(repo, 'package.json'), JSON.stringify({ name: 'infinite-os' }), 'utf8');
  writeFileSync(join(repo, 'src', 'main', 'audit', 'action-log.ts'), 'ORIGINAL AUDIT\n', 'utf8');
  writeFileSync(join(repo, 'src', 'main', 'tools', 'browser.ts'), 'ORIGINAL TOOL\n', 'utf8');
});

describe('the Write tool refuses to overwrite the machinery that protects the user', () => {
  it('leaves a protected file untouched and explains why', async () => {
    const target = join(repo, 'src', 'main', 'audit', 'action-log.ts');
    const result = await write.execute(
      { file_path: target, content: 'CLOBBERED\n' },
      ctx(repo),
    );

    expect(result.is_error).toBe(true);
    const text = typeof result.content === 'string' ? result.content : JSON.stringify(result.content);
    expect(text).toMatch(/protected/i);

    // The real assertion: the file on disk is unchanged. A refusal that still
    // wrote would be worse than no refusal.
    const { readFileSync } = await import('node:fs');
    expect(readFileSync(target, 'utf8')).toBe('ORIGINAL AUDIT\n');
  });

  it('still writes an ordinary file, so the guard is not just refusing everything', async () => {
    const target = join(repo, 'src', 'main', 'tools', 'browser.ts');
    const result = await write.execute(
      { file_path: target, content: 'UPDATED TOOL\n' },
      ctx(repo),
    );

    expect(result.is_error).toBeFalsy();
    const { readFileSync } = await import('node:fs');
    expect(readFileSync(target, 'utf8')).toBe('UPDATED TOOL\n');
  });

  it('writes the user\'s own files outside the repo without interference', async () => {
    const outside = mkdtempSync(join(tmpdir(), 'user-docs-'));
    const target = join(outside, 'notes.md');
    const result = await write.execute({ file_path: target, content: 'hello\n' }, ctx(repo));
    expect(result.is_error).toBeFalsy();
    expect(existsSync(target)).toBe(true);
    rmSync(outside, { recursive: true, force: true });
  });

  it('honours the user turning self-protection off', async () => {
    settingsValues.set('selfProtectionEnabled', false);
    const target = join(repo, 'src', 'main', 'audit', 'action-log.ts');
    const result = await write.execute({ file_path: target, content: 'ALLOWED\n' }, ctx(repo));
    expect(result.is_error).toBeFalsy();
    const { readFileSync } = await import('node:fs');
    expect(readFileSync(target, 'utf8')).toBe('ALLOWED\n');
  });
});

describe('FileOps cannot be used to sidestep the guard', () => {
  it('refuses to copy a file over a protected one', async () => {
    // FileOps is a write path the agent can reach. If it is not guarded, the
    // guard on Write/Edit/Delete is advisory only — the agent just copies a
    // file over the audit log instead, and reports success.
    const protectedPath = join(repo, 'src', 'main', 'audit', 'action-log.ts');
    const staged = join(repo, 'staged.ts');
    writeFileSync(staged, 'CLOBBERED BY COPY\n', 'utf8');

    const result = await fileOpsTool.execute(
      { action: 'copy', path: staged, destination: protectedPath },
      ctx(repo),
    );

    expect(result.is_error).toBe(true);
    const { readFileSync } = await import('node:fs');
    expect(readFileSync(protectedPath, 'utf8')).toBe('ORIGINAL AUDIT\n');
  });

  it('still copies to an ordinary destination', async () => {
    const staged = join(repo, 'staged.ts');
    writeFileSync(staged, 'copied\n', 'utf8');
    const destination = join(repo, 'src', 'main', 'tools', 'copied.ts');

    const result = await fileOpsTool.execute(
      { action: 'copy', path: staged, destination },
      ctx(repo),
    );

    expect(result.is_error).toBeFalsy();
    expect(existsSync(destination)).toBe(true);
  });

  it('still creates a directory anywhere the user likes', async () => {
    const outside = mkdtempSync(join(tmpdir(), 'user-mkdir-'));
    const result = await fileOpsTool.execute(
      { action: 'mkdir', path: join(outside, 'new-folder') },
      ctx(repo),
    );
    expect(result.is_error).toBeFalsy();
    expect(existsSync(join(outside, 'new-folder'))).toBe(true);
    rmSync(outside, { recursive: true, force: true });
  });
});

describe('the Delete tool refuses too, which is the irreversible one', () => {
  it('does not delete a protected file', async () => {
    const target = join(repo, 'src', 'main', 'audit', 'action-log.ts');
    const result = await deleteTool.execute({ path: target }, ctx(repo));

    expect(result.is_error).toBe(true);
    expect(existsSync(target)).toBe(true);
  });

  it('still deletes an ordinary file', async () => {
    const target = join(repo, 'src', 'main', 'tools', 'browser.ts');
    const result = await deleteTool.execute({ path: target }, ctx(repo));
    expect(result.is_error).toBeFalsy();
    expect(existsSync(target)).toBe(false);
  });
});
