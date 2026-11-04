// Background Build — lets Infinite AI edit & rebuild while the app stays running.
// Uses a staging pattern: build → stage → notify → apply on restart.
// The installed app (for example %LOCALAPPDATA%\Programs\infinite-ai on Windows)
// is NEVER overwritten while running. New builds are staged alongside it.

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

export type BuildStatus =
  | { phase: 'idle' }
  | { phase: 'building'; startedAt: number }
  | { phase: 'ready'; stagedAt: number; stagedPath: string }
  | { phase: 'failed'; error: string }
  | { phase: 'applying' };

let status: BuildStatus = { phase: 'idle' };
let buildProcess: ReturnType<typeof spawn> | null = null;
let onStatusChange: ((s: BuildStatus) => void) | null = null;

const STAGED_DIR = join(homedir(), '.infinite-ai', 'staged-update');
const STAGED_MARKER = join(homedir(), '.infinite-ai', 'staged-update.json');

export function getBuildStatus(): BuildStatus {
  return status;
}

export function onBuildStatusChange(cb: (s: BuildStatus) => void): () => void {
  onStatusChange = cb;
  return () => { if (onStatusChange === cb) onStatusChange = null; };
}

function setStatus(s: BuildStatus): void {
  status = s;
  onStatusChange?.(s);
}

/**
 * Build in background — runs `npm run build` without stopping the app.
 * Output goes to out/ and dist/, staged copy goes to ~/.infinite-ai/staged-update/.
 * App keeps running. Caller gets notified when ready.
 */
export function buildInBackground(cwd: string): Promise<BuildStatus> {
  if (status.phase === 'building') {
    return Promise.resolve(status);
  }

  setStatus({ phase: 'building', startedAt: Date.now() });

  return new Promise((resolve) => {
    const isWin = process.platform === 'win32';
    const npmCmd = isWin ? 'npm.cmd' : 'npm';

    // electron-vite build outputs to out/ — does NOT touch the installed app
    buildProcess = spawn(npmCmd, ['run', 'build'], {
      cwd,
      shell: isWin,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stderr = '';
    buildProcess.stderr?.on('data', (d: Buffer) => { stderr += d.toString(); });
    buildProcess.stdout?.on('data', () => {}); // drain

    buildProcess.on('close', (code) => {
      buildProcess = null;
      if (code === 0) {
        // Stage the build for next restart
        try {
          stageBuild(cwd);
          const ready: BuildStatus = { phase: 'ready', stagedAt: Date.now(), stagedPath: STAGED_DIR };
          setStatus(ready);
          resolve(ready);
        } catch (e) {
          const failed: BuildStatus = { phase: 'failed', error: (e as Error).message };
          setStatus(failed);
          resolve(failed);
        }
      } else {
        const failed: BuildStatus = { phase: 'failed', error: stderr.slice(-2000) || `Build exited ${code}` };
        setStatus(failed);
        resolve(failed);
      }
    });

    buildProcess.on('error', (e) => {
      buildProcess = null;
      const failed: BuildStatus = { phase: 'failed', error: e.message };
      setStatus(failed);
      resolve(failed);
    });
  });
}

function stageBuild(cwd: string): void {
  const outDir = join(cwd, 'out');
  const distDir = join(cwd, 'dist', 'win-unpacked');

  // Ensure out/ exists (vite output)
  if (!existsSync(outDir)) throw new Error('Build output not found (out/ missing)');

  // Use dist/win-unpacked if it exists, otherwise out/
  const sourceDir = existsSync(distDir) ? distDir : outDir;

  // Clean previous staging
  if (existsSync(STAGED_DIR)) rmSync(STAGED_DIR, { recursive: true, force: true });
  mkdirSync(STAGED_DIR, { recursive: true });

  // Write marker with timestamp
  const marker = JSON.stringify({ stagedAt: Date.now(), sourceDir, cwd }, null, 2);
  const markerDir = join(homedir(), '.infinite-ai');
  mkdirSync(markerDir, { recursive: true });
  writeFileSync(STAGED_MARKER, marker);

  // Copy via robocopy on Windows (handles locked files by staging, not overwriting live app)
  // For now, just mark as ready — actual file copy happens at apply time
  // This keeps the build fast and avoids copying 500MB while running
}

export function hasStagedUpdate(): boolean {
  return existsSync(STAGED_MARKER);
}

export function clearStagedUpdate(): void {
  try {
    if (existsSync(STAGED_MARKER)) rmSync(STAGED_MARKER, { force: true });
    if (existsSync(STAGED_DIR)) rmSync(STAGED_DIR, { recursive: true, force: true });
  } catch { /* ignore */ }
  setStatus({ phase: 'idle' });
}

export function cancelBuild(): boolean {
  if (buildProcess && status.phase === 'building') {
    buildProcess.kill();
    buildProcess = null;
    setStatus({ phase: 'idle' });
    return true;
  }
  return false;
}
