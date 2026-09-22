// Source Guard — protects Infinite OS source so only Infinite AI edits it.
// Uses a chokidar-style watcher (node:fs watch) on src/. When the agent writes
// via Write/Edit tools, it sets an allow-window so the watcher ignores that change.
// External edits (manual VS Code, notepad, etc.) trigger a warning notification.

import { watch, statSync, type FSWatcher } from 'node:fs';
import { join, relative } from 'node:path';

let watcher: FSWatcher | null = null;
const allowedPaths = new Set<string>();
let allowedUntil = 0;
const ALLOW_WINDOW_MS = 3000; // agent writes are allowed for 3s after the tool call
let onViolation: ((file: string) => void) | null = null;
// Windows recursive watch fires spuriously (AV scans, cloud sync, reads).
// Only warn when the file's mtime actually advanced, debounced per file.
const lastMtime = new Map<string, number>();
const lastReport = new Map<string, number>();
const REPORT_DEBOUNCE_MS = 30_000;

/** Test seam: true the first time a newer mtime is seen for a path. */
export function noteMtime(rel: string, mtimeMs: number): boolean {
  if (mtimeMs <= (lastMtime.get(rel) ?? 0)) return false;
  lastMtime.set(rel, mtimeMs);
  return true;
}

/** Test seam: true when a report for this path is not inside the debounce window. */
export function noteReport(rel: string, now: number = Date.now()): boolean {
  if (now - (lastReport.get(rel) ?? 0) < REPORT_DEBOUNCE_MS) return false;
  lastReport.set(rel, now);
  return true;
}

/** Call from Write/Edit tools before writing — allows the file for 3 seconds. */
export function allowWrite(filePath: string): void {
  allowedPaths.add(filePath.toLowerCase());
  allowedUntil = Date.now() + ALLOW_WINDOW_MS;
  // Auto-clear after window
  setTimeout(() => {
    if (Date.now() >= allowedUntil) allowedPaths.clear();
  }, ALLOW_WINDOW_MS + 500).unref?.();
}

export function isAllowed(filePath: string): boolean {
  if (Date.now() > allowedUntil) return false;
  return allowedPaths.has(filePath.toLowerCase());
}

export function setViolationHandler(handler: (file: string) => void): void {
  onViolation = handler;
}

export function startGuard(cwd: string): void {
  if (watcher) return;
  const srcDir = join(cwd, 'src');
  try {
    watcher = watch(srcDir, { recursive: true }, (_event, filename) => {
      if (!filename) return;
      const fullPath = join(srcDir, filename as string);
      const rel = relative(cwd, fullPath).replace(/\\/g, '/');
      // Ignore build output, node_modules, and agent tool temp files.
      if (rel.includes('node_modules') || rel.startsWith('out/') || rel.startsWith('dist/')) return;
      if (/(^|\/)\.hermes-tmp\./.test(rel)) return;
      // If this write was allowed (agent tool), ignore
      if (isAllowed(fullPath) || isAllowed(rel)) return;
      // Spurious-event filter: mtime must have advanced since we last saw it.
      // Debounced per file — Windows recursive watch is noisy.
      try {
        const mtime = statSync(fullPath, { throwIfNoEntry: false })?.mtimeMs ?? 0;
        if (!noteMtime(rel, mtime) || !noteReport(rel)) return;
      } catch {
        return;
      }
      onViolation?.(rel);
    });
    watcher.on('error', () => { /* ignore */ });
  } catch {
    // src/ may not exist or watching not supported — silently skip
  }
}

export function stopGuard(): void {
  if (watcher) {
    watcher.close();
    watcher = null;
  }
  allowedPaths.clear();
  onViolation = null;
}
