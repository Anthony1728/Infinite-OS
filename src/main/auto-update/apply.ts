// Apply a staged update — called at app startup before window creation.
// If ~/.infinite-ai/staged-update.json exists, the new build is staged and ready.
// This copies staged files over the installed app. Safe because it runs before
// any app code from the old version has loaded beyond this module.

import { existsSync, readFileSync, rmSync, readdirSync, copyFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const STAGED_MARKER = join(homedir(), '.infinite-ai', 'staged-update.json');

/** True if a staged update is waiting to be applied. */
export function hasPendingUpdate(): boolean {
  return existsSync(STAGED_MARKER);
}

/** Apply the staged update if one exists. Returns true if applied. */
export function applyStagedUpdateIfPresent(): boolean {
  if (!existsSync(STAGED_MARKER)) return false;

  let marker: { sourceDir: string; cwd: string; stagedAt: number };
  try {
    marker = JSON.parse(readFileSync(STAGED_MARKER, 'utf8'));
  } catch {
    return false;
  }

  const sourceDir: string = marker.sourceDir;
  if (!sourceDir || !existsSync(sourceDir)) {
    // Source was cleaned — just clear the marker
    try { rmSync(STAGED_MARKER, { force: true }); } catch { /* ignore */ }
    return false;
  }

  // Determine install dir — where the running binary lives
  // In production: %LOCALAPPDATA%\Programs\infinite-ai on Windows
  // In dev: not applicable (electron-vite dev serves from memory)
  const installDir = process.env.PORTABLE_EXECUTABLE_DIR
    || (process.execPath ? join(process.execPath, '..') : '');

  // Don't apply if we're in dev mode (no install dir match)
  if (!installDir || installDir.includes('node_modules')) return false;

  // Check if install dir looks like an Infinite OS install
  if (!existsSync(join(installDir, 'Infinite OS.exe')) && !existsSync(join(installDir, 'resources'))) {
    return false;
  }

  try {
    copyRecursive(sourceDir, installDir);
    rmSync(STAGED_MARKER, { force: true });
    // Don't delete STAGED_DIR — keep for debugging, cleaned on next staging
    console.log('[auto-update] Staged update applied successfully');
    return true;
  } catch (e) {
    console.error('[auto-update] Failed to apply staged update:', (e as Error).message);
    return false;
  }
}

function copyRecursive(src: string, dest: string): void {
  const entries = readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = join(src, entry.name);
    const destPath = join(dest, entry.name);
    if (entry.isDirectory()) {
      mkdirSync(destPath, { recursive: true });
      copyRecursive(srcPath, destPath);
    } else {
      try {
        copyFileSync(srcPath, destPath);
      } catch (e) {
        // File locked (running exe) — skip, will be updated on next restart
        if ((e as NodeJS.ErrnoException).code !== 'EBUSY' && (e as NodeJS.ErrnoException).code !== 'EPERM') {
          throw e;
        }
        console.warn(`[auto-update] Skipped locked file: ${entry.name}`);
      }
    }
  }
}
