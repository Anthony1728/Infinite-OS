import { describe, it, expect, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  isGitRepo,
  createAgentWorktrees,
  mergeBackWorktrees,
  cleanupWorktrees,
} from './worktree.js';

const root = mkdtempSync(join(tmpdir(), 'infinite-wt-'));
const repo = join(root, 'repo');

function git(args: string[], cwd = repo): void {
  execFileSync('git', args, { cwd, stdio: 'pipe' });
}

function initRepo(): void {
  execFileSync('git', ['init', repo], { stdio: 'pipe' });
  git(['config', 'user.email', 'test@infinite.os']);
  git(['config', 'user.name', 'Infinite Test']);
  writeFileSync(join(repo, 'README.md'), '# demo repo\n');
  git(['add', '.']);
  git(['commit', '-m', 'init']);
}

describe('worktree isolation', () => {
  it('detects git repos', () => {
    expect(isGitRepo(root)).toBe(false);
  });

  it('refuses to create worktrees in a non-repo', async () => {
    const result = await createAgentWorktrees(root, ['agent-a']);
    expect(result.worktrees).toHaveLength(0);
    expect(result.error).toContain('not a git');
  });

  it('refuses dirty repos', async () => {
    initRepo();
    writeFileSync(join(repo, 'dirty.txt'), 'uncommitted');
    const result = await createAgentWorktrees(repo, ['agent-a']);
    expect(result.worktrees).toHaveLength(0);
    expect(result.error).toContain('uncommitted');
    // Stage+commit the file so the follow-up "clean" test has a new commit
    // to make and the tree is pristine again.
    git(['add', '.']);
    git(['commit', '-m', 'dirty file']);
    rmSync(join(repo, 'dirty.txt'));
    git(['add', '-A']);
  });

  it('creates per-agent worktrees, merges back, and cleans up', async () => {
    git(['add', '.']);
    git(['commit', '-m', 'clean']);
    const agents = ['coder', 'tester'];
    const { worktrees, error } = await createAgentWorktrees(repo, agents);
    expect(error).toBeUndefined();
    expect(worktrees).toHaveLength(2);
    for (const wt of worktrees) {
      expect(existsSync(join(wt.path, 'README.md'))).toBe(true);
      expect(wt.branch.startsWith('infinite/')).toBe(true);
    }
    // Each agent "edits" its own file in its own worktree.
    writeFileSync(join(worktrees[0].path, 'coder.txt'), 'work from coder\n');
    writeFileSync(join(worktrees[1].path, 'tester.txt'), 'work from tester\n');
    for (const wt of worktrees) {
      execFileSync('git', ['add', '.'], { cwd: wt.path, stdio: 'pipe' });
      execFileSync('git', ['commit', '-m', `agent work on ${wt.branch}`], { cwd: wt.path, stdio: 'pipe' });
    }
    const merge = await mergeBackWorktrees(repo, worktrees);
    expect(merge.mergedBranches).toHaveLength(2);
    expect(merge.needsManualResolution).toBe(false);
    // Git autocrlf may round-trip LF→CRLF on Windows checkouts.
    expect(readFileSyncSafe(join(repo, 'coder.txt'))?.replace(/\r/g, '')).toBe('work from coder\n');
    expect(readFileSyncSafe(join(repo, 'tester.txt'))?.replace(/\r/g, '')).toBe('work from tester\n');
    await cleanupWorktrees(repo, worktrees);
    for (const wt of worktrees) expect(existsSync(wt.path)).toBe(false);
  });

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });
});

function readFileSyncSafe(path: string): string | null {
  try { return readFileSync(path, 'utf8'); } catch { return null; }
}
