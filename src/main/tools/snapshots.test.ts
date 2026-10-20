import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let root = '';

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'snap-'));
  // Fake an infinite-ai repo with a nested file.
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'infinite-ai' }), 'utf8');
  mkdirSync(join(root, 'src', 'deep'), { recursive: true });
  writeFileSync(join(root, 'src', 'deep', 'a.ts'), 'const a = 1;\n', 'utf8');
  writeFileSync(join(root, 'outside.txt'), 'plain\n', 'utf8');
});

afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true });
  root = '';
});

async function load() {
  return import('./backup.js');
}

describe('findInfiniteRepoRoot', () => {
  it('finds the repo from a nested file and rejects other projects', async () => {
    const { findInfiniteRepoRoot } = await load();
    expect(findInfiniteRepoRoot(join(root, 'src', 'deep', 'a.ts'))).toBe(root);
    const other = mkdtempSync(join(tmpdir(), 'snap-other-'));
    try {
      writeFileSync(join(other, 'package.json'), JSON.stringify({ name: 'something-else' }), 'utf8');
      expect(findInfiniteRepoRoot(join(other, 'package.json'))).toBeNull();
    } finally {
      rmSync(other, { recursive: true, force: true });
    }
  });

  it('finds the repo when given the repo root itself', async () => {
    // Every guard passes the conversation cwd, which is normally the repo root.
    // This used to begin the walk at the *parent*, so it never found the repo
    // and returned null — which silently disabled BuildFeature's guard, the
    // one caller with no `?? ctx.cwd` fallback. The case the guard exists for
    // was the one case where it did not run.
    const { findInfiniteRepoRoot } = await load();
    expect(findInfiniteRepoRoot(root)).toBe(root);
  });

  it('finds the repo from a directory inside it', async () => {
    const { findInfiniteRepoRoot } = await load();
    expect(findInfiniteRepoRoot(join(root, 'src', 'main'))).toBe(root);
  });
});

describe('session snapshots', () => {
  it('groups pre-edit content per session and keeps the first write', async () => {
    const { backupFile } = await load();
    const target = join(root, 'src', 'deep', 'a.ts');
    const first = await backupFile(target, 'sess-1');
    expect(first).toContain('.infinite-backups');
    // Simulate the agent edit, then a second edit in the same session.
    writeFileSync(target, 'const a = 2;\n', 'utf8');
    const second = await backupFile(target, 'sess-1');
    expect(second).toBe(first);
    expect(readFileSync(first!, 'utf8')).toBe('const a = 1;\n');
  });

  it('falls back to legacy .backups outside the repo or without a session', async () => {
    const { backupFile } = await load();
    const lone = mkdtempSync(join(tmpdir(), 'snap-lone-'));
    try {
      const file = join(lone, 'x.txt');
      writeFileSync(file, 'data\n', 'utf8');
      const legacy = await backupFile(file, 'sess-9');
      expect(legacy).toContain('.backups');
      expect(legacy).not.toContain('.infinite-backups');
      const noSession = await backupFile(join(root, 'outside.txt'));
      expect(noSession).toContain('.backups');
    } finally {
      rmSync(lone, { recursive: true, force: true });
    }
  });

  it('lists and restores a version round-trip', async () => {
    const { backupFile } = await load();
    const snaps = await import('./snapshots.js');
    const target = join(root, 'src', 'deep', 'a.ts');
    await backupFile(target, 'sess-restore');
    writeFileSync(target, 'const a = 999;\n', 'utf8');
    const listed = await snaps.listSnapshots(root);
    expect(listed.map((s) => s.sessionId)).toContain('sess-restore');
    const { restored, missing } = await snaps.restoreSnapshot(root, 'sess-restore');
    expect(missing).toEqual([]);
    expect(restored.map((r) => r.replace(/\\/g, '/'))).toEqual(['src/deep/a.ts']);
    expect(readFileSync(target, 'utf8')).toBe('const a = 1;\n');
  });
});
