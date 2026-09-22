// Quick Capture — append timestamped entries to a markdown scratch file in
// ~/Documents/Infinite OS/Quick Notes/<yyyy-mm-dd>.md. Used by the global hotkey
// and command palette to drop a thought without leaving the current app.

import { app, ipcMain, shell } from 'electron';
import { promises as fs, readdirSync } from 'node:fs';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { IPC } from '../../shared/ipc.js';
import { logger } from '../util/logger.js';

const FOLDER_NAME = 'Quick Notes';
const APP_SUBFOLDER = 'Infinite OS';

function resolveNotesDir(): string {
  // Prefer Electron's userData/docs path; fall back to ~/Documents so the
  // user's own file-explorer folder always works even on locked-down installs.
  const fromApp = join(app.getPath('documents'), APP_SUBFOLDER, FOLDER_NAME);
  if (!existsSync(fromApp)) {
    try {
      mkdirSync(fromApp, { recursive: true });
    } catch {
      // Fall back to plain ~/Documents/Quick Notes so the user still gets
      // a writable location even when the app-specific folder is blocked.
      const fallback = join(homedir(), 'Documents', FOLDER_NAME);
      try {
        mkdirSync(fallback, { recursive: true });
        return fallback;
      } catch (err) {
        logger.warn({ err }, 'Quick Capture could not create a notes folder');
        return '';
      }
    }
  }
  return fromApp;
}

function dateStamp(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function timeStamp(d: Date = new Date()): string {
  return d.toTimeString().slice(0, 5);
}

function sanitize(text: string): string {
  // Markdown headings could break the layout; keep entries as plain paragraphs
  // and bullet points. Newlines from the user are preserved as bullet lines.
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0)
    .map((line, i) => (i === 0 ? line : `- ${line}`))
    .join('\n');
}

function latestNotePath(dir: string): string | null {
  if (!existsSync(dir)) return null;
  // Synchronous list to avoid async caller plumbing; the folder is tiny.
  const entries = readdirSync(dir);
  const notes = entries.filter((f) => /^Quick Notes \d{4}-\d{2}-\d{2}\.md$/.test(f));
  if (!notes.length) return null;
  notes.sort();
  return join(dir, notes[notes.length - 1]);
}

export function registerQuickCapture(): void {
  const dir = resolveNotesDir();

  ipcMain.handle(IPC.QUICK_CAPTURE_APPEND, async (_e, args: { text?: string } = {}) => {
    const raw = typeof args?.text === 'string' ? args.text.trim() : '';
    if (!raw) return { ok: false, error: 'Empty capture' };
    if (!dir) return { ok: false, error: 'Notes folder unavailable' };

    const file = join(dir, `Quick Notes ${dateStamp()}.md`);
    const entry = `\n## ${timeStamp()}\n\n${sanitize(raw)}\n`;
    try {
      await fs.appendFile(file, entry, 'utf8');
      return { ok: true, path: file };
    } catch {
      // Fallback to a sync write in case the async append was blocked by AV.
      try {
        if (!existsSync(file)) writeFileSync(file, `# Quick Notes\n${entry}`, 'utf8');
        else writeFileSync(file, readFileSync(file, 'utf8') + entry, 'utf8');
        return { ok: true, path: file };
      } catch (err2) {
        logger.warn({ err: err2 }, 'Quick Capture append failed');
        return { ok: false, error: err2 instanceof Error ? err2.message : String(err2) };
      }
    }
  });

  ipcMain.handle(IPC.QUICK_CAPTURE_OPEN, () => {
    if (!dir) return { ok: false, error: 'Notes folder unavailable' };
    const path = latestNotePath(dir) ?? join(dir, `Quick Notes ${dateStamp()}.md`);
    // Ensure a file exists so the OS picker doesn't open a blank-folder view.
    if (!existsSync(path)) {
      try {
        writeFileSync(path, `# Quick Notes\n\n_Created ${dateStamp()}._\n`, 'utf8');
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    }
    void shell.openPath(path);
    return { ok: true, path };
  });

  ipcMain.handle(IPC.QUICK_CAPTURE_LATEST, () => {
    if (!dir) return null;
    const path = latestNotePath(dir);
    if (!path || !existsSync(path)) return null;
    try {
      const preview = readFileSync(path, 'utf8').slice(-2_000);
      return { path, preview };
    } catch {
      return { path };
    }
  });
}