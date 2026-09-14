/**
 * Push Infinite OS itself to GitHub — the engine behind the profile menu's
 * Deploy action. Stages everything, commits, and pushes the current branch
 * to origin. Every step runs real git; nothing is simulated.
 */
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

export interface OsPushStatus {
  ok: boolean;
  error?: string;
  root?: string;
  branch?: string;
  remote?: string;
  dirty?: number;
  ahead?: number;
  behind?: number;
  lastCommit?: string;
}

export interface OsPushResult {
  ok: boolean;
  error?: string;
  commit?: string;
  pushed?: boolean;
  output?: string;
}

function runGit(args: string[], cwd: string, timeoutMs = 120_000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd, timeout: timeoutMs, windowsHide: true }, (error, stdout, stderr) => {
      if (error) {
        const detail = `${stdout ?? ''}\n${stderr ?? ''}`.trim().slice(-800);
        reject(new Error(`git ${args[0]} failed: ${(error as Error).message}${detail ? `\n${detail}` : ''}`));
      } else {
        resolve((stdout ?? '').trim());
      }
    });
  });
}

/** Walk up from the app's working directory to the repo root (holds .git). */
export function findRepoRoot(): string | null {
  let dir = process.cwd();
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, '.git'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
  return null;
}

export async function osPushStatus(): Promise<OsPushStatus> {
  const root = findRepoRoot();
  if (!root) return { ok: false, error: 'No git repository found above the app directory.' };
  try {
    const [branch, remote, dirtyOut, lastCommit] = await Promise.all([
      runGit(['rev-parse', '--abbrev-ref', 'HEAD'], root).catch(() => 'HEAD'),
      runGit(['remote', 'get-url', 'origin'], root).catch(() => ''),
      runGit(['status', '--porcelain'], root).catch(() => ''),
      runGit(['log', '-1', '--format=%h %s'], root).catch(() => ''),
    ]);
    let ahead = 0;
    let behind = 0;
    try {
      const counts = await runGit(['rev-list', '--left-right', '--count', 'HEAD...@{u}'], root);
      const [a, b] = counts.split(/\s+/).map(Number);
      ahead = Number.isFinite(a) ? a : 0;
      behind = Number.isFinite(b) ? b : 0;
    } catch { /* no upstream yet — not an error */ }
    const dirty = dirtyOut ? dirtyOut.split('\n').filter(Boolean).length : 0;
    return { ok: true, root, branch, remote, dirty, ahead, behind, lastCommit };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export async function osPush(message?: string): Promise<OsPushResult> {
  const root = findRepoRoot();
  if (!root) return { ok: false, error: 'No git repository found above the app directory.' };
  try {
    const remote = await runGit(['remote', 'get-url', 'origin'], root).catch(() => '');
    if (!remote) {
      return { ok: false, error: 'No git remote named "origin" — add one with: git remote add origin <url>.' };
    }
    const log: string[] = [];
    await runGit(['add', '-A'], root);
    const dirty = await runGit(['status', '--porcelain'], root).catch(() => '');
    let commit = '';
    if (dirty.trim()) {
      const msg = (message?.trim() || `Infinite OS update ${new Date().toISOString().slice(0, 19).replace('T', ' ')}`).slice(0, 200);
      await runGit(['commit', '-m', msg], root);
      commit = await runGit(['rev-parse', '--short', 'HEAD'], root).catch(() => '');
      log.push(`committed ${commit}`);
    } else {
      log.push('working tree clean — nothing to commit');
    }
    const pushOut = await runGit(['push', 'origin', 'HEAD'], root);
    log.push(pushOut || 'pushed');
    return { ok: true, commit, pushed: true, output: log.join('\n').slice(-1500) };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
