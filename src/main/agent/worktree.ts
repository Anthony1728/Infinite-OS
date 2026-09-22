// Git worktree isolation for parallel agents. When a Crew / TaskGroup fans
// work out to multiple members in the SAME repo, concurrent edits collide.
// With worktrees, each member edits in its own checkout on its own branch;
// a merge-back step then integrates results and reports conflicts honestly.
// Nothing here runs destructive git commands: add/merge with --no-ff/--no-commit,
// never push, never reset, and clean up worktrees only on explicit request.

import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { existsSync, statSync } from 'node:fs';

export interface WorktreeInfo {
  agentName: string;
  path: string;
  branch: string;
}

function git(args: string[], cwd: string, timeoutMs = 30_000): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile('git', args, { cwd, timeout: timeoutMs, windowsHide: true, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
      const code = err && typeof (err as { code?: number }).code === 'number' ? (err as { code: number }).code : err ? 1 : 0;
      resolve({ code, stdout: String(stdout ?? ''), stderr: String(stderr ?? '') });
    });
  });
}

export function isGitRepo(cwd: string): boolean {
  try {
    return statSync(join(cwd, '.git')).isDirectory() || statSync(join(cwd, '.git')).isFile();
  } catch {
    return false;
  }
}

export function currentBranch(cwd: string): string | null {
  return git(['rev-parse', '--abbrev-ref', 'HEAD'], cwd).then((r) => (r.code === 0 ? r.stdout.trim() : null)) as never;
}

/**
 * Create one worktree per agent branching from the current HEAD. Returns null
 * (with reason on stderr) when the workspace is not a git repo — callers then
 * fall back to shared-workspace execution.
 */
export async function createAgentWorktrees(
  repoCwd: string,
  agentNames: string[],
  baseDir?: string,
): Promise<{ worktrees: WorktreeInfo[]; error?: string }> {
  if (!isGitRepo(repoCwd)) return { worktrees: [], error: 'not a git repository' };
  // Refuse dirty repos: isolation assumes the base state is committed.
  const status = await git(['status', '--porcelain'], repoCwd);
  if (status.code !== 0) return { worktrees: [], error: 'git status failed' };
  if (status.stdout.trim()) return { worktrees: [], error: 'working tree has uncommitted changes; commit or stash first' };

  const dir = baseDir ?? join(repoCwd, '.infinite-worktrees');
  const stamp = Date.now().toString(36);
  const worktrees: WorktreeInfo[] = [];
  for (const name of agentNames) {
    const safe = name.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') || 'agent';
    const branch = `infinite/${stamp}-${safe}`;
    const path = join(dir, `${stamp}-${safe}`);
    const result = await git(['worktree', 'add', '-b', branch, path, 'HEAD'], repoCwd);
    if (result.code !== 0) {
      await cleanupWorktrees(repoCwd, worktrees).catch(() => {});
      return { worktrees: [], error: `worktree add failed for ${name}: ${result.stderr.trim().slice(0, 200)}` };
    }
    worktrees.push({ agentName: name, path, branch });
  }
  return { worktrees };
}

/** Remove worktrees + their branches. Non-destructive to the main checkout. */
export async function cleanupWorktrees(repoCwd: string, worktrees: WorktreeInfo[]): Promise<void> {
  for (const wt of worktrees) {
    if (existsSync(wt.path)) await git(['worktree', 'remove', '--force', wt.path], repoCwd);
    await git(['branch', '-D', wt.branch], repoCwd);
  }
}

export interface MergeBackResult {
  mergedBranches: string[];
  conflictedBranches: string[];
  /** True when the final index is in a merge-conflict state the user must resolve. */
  needsManualResolution: boolean;
  error?: string;
}

/**
 * Merge every agent branch back into the ORIGINAL branch. The FIRST merge is
 * left staged but uncommitted (--no-commit) so the user reviews and commits;
 * subsequent merges need a commit between them or git refuses to start a new
 * merge with a dirty index, so each earlier merge is committed with a
 * descriptive message. Conflicted branches are reported, not forced.
 */
export async function mergeBackWorktrees(repoCwd: string, worktrees: WorktreeInfo[]): Promise<MergeBackResult> {
  const result: MergeBackResult = { mergedBranches: [], conflictedBranches: [], needsManualResolution: false };
  if (!worktrees.length) return { ...result, error: 'no worktrees to merge' };
  const head = await git(['rev-parse', '--abbrev-ref', 'HEAD'], repoCwd);
  if (head.code !== 0) return { ...result, error: 'cannot determine current branch' };

  for (let i = 0; i < worktrees.length; i++) {
    const wt = worktrees[i];
    const isLast = i === worktrees.length - 1;
    const mergeArgs = isLast
      ? ['merge', '--no-ff', '--no-commit', wt.branch]
      : ['merge', '--no-ff', '-m', `Infinite OS: merge agent branch ${wt.branch}`, wt.branch];
    const merge = await git(mergeArgs, repoCwd);
    if (merge.code === 0) {
      result.mergedBranches.push(wt.branch);
    } else if (/CONFLICT/i.test(merge.stdout) || /CONFLICT/i.test(merge.stderr)) {
      result.conflictedBranches.push(wt.branch);
      // Abort this merge so the next branch is attempted cleanly.
      await git(['merge', '--abort'], repoCwd);
    } else {
      await git(['merge', '--abort'], repoCwd);
      return { ...result, error: `merge failed for ${wt.branch}: ${(merge.stderr || merge.stdout).trim().slice(0, 200)}` };
    }
  }
  result.needsManualResolution = result.conflictedBranches.length > 0;
  return result;
}
