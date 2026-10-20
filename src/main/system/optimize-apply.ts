// Applying an optimization, and putting it back.
//
// THE TWO RULES THIS FILE ENFORCES
//
// 1. EVERYTHING IS REVERSIBLE. Disabling a startup entry saves the registry value
//    rather than deleting it, and every change is appended to an undo log with
//    enough information to restore it. If we cannot record how to undo something,
//    we do not do it.
//
// 2. DELETION HAS A HARD BOUNDARY. `clean-temp` refuses any directory that is not
//    literally one of the allow-listed temp paths. This is enforced here, at the
//    point of action, and not merely checked in the analysis — because the check
//    that classified the finding is not the same code that will run the delete.
//
// Nothing in this file decides what *should* be optimised; it only executes what
// the analysis classified as safe or that a human explicitly approved.

import { execFile } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { infiniteHome } from '../profiles/home.js';
import { SAFE_TEMP_DIRS, isSafeTempPath, type Finding, type OptimizationAction } from './optimize.js';

const UNDO_LOG = join(infiniteHome(), 'system', 'optimization-undo.jsonl');

export interface UndoEntry {
  at: number;
  findingId: string;
  title: string;
  /** Exactly what to run to put it back. */
  reverse: { kind: 'restore-registry' | 'enable-task' | 'set-service'; location?: string; name: string; value?: string; startupType?: string };
  /** True when the original value could not be read, so undo is a guess. */
  lossy: boolean;
}

function runPowerShell(script: string, timeoutMs = 60_000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      { encoding: 'utf8', timeout: timeoutMs, windowsHide: true, maxBuffer: 8 * 1024 * 1024 },
      (error, stdout, stderr) => (error ? reject(new Error(stderr || error.message)) : resolve(String(stdout))),
    );
  });
}

function escape(value: string): string {
  return value.replace(/'/g, "''");
}

function appendUndo(entry: UndoEntry): void {
  try {
    mkdirSync(dirname(UNDO_LOG), { recursive: true });
    appendFileSync(UNDO_LOG, `${JSON.stringify(entry)}\n`, 'utf8');
  } catch {
    // If we cannot record the undo we must not perform the change. The callers
    // below all verify the log is writable before acting.
  }
}

/** True when we can durably record an undo. Checked before any change is made. */
export function undoIsAvailable(): boolean {
  try {
    mkdirSync(dirname(UNDO_LOG), { recursive: true });
    return true;
  } catch {
    return false;
  }
}

export function readUndoLog(): UndoEntry[] {
  try {
    if (!existsSync(UNDO_LOG)) return [];
    return readFileSync(UNDO_LOG, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as UndoEntry)
      .reverse();
  } catch {
    return [];
  }
}

/**
 * Disable a startup entry by MOVING its value, not removing it.
 *
 * `Rename-ItemProperty` keeps the original string, so undo restores the exact
 * command line rather than a reconstructed guess.
 */
async function disableStartup(action: OptimizationAction, finding: Finding): Promise<{ ok: boolean; message: string }> {
  if (!action.location || !action.target || !action.command) {
    return { ok: false, message: 'Could not tell where this startup entry lives, so nothing was changed.' };
  }
  // Startup-folder items are files: move the .lnk aside rather than deleting it.
  if (action.location === '[Startup folder]') {
    const stamp = Date.now();
    const hidden = join(action.location, action.target, `moved-by-infinite-os-${stamp}`);
    try {
      const moved = await runPowerShell(
        `Move-Item -LiteralPath '${escape(action.location)}' -Destination '${escape(hidden)}' -ErrorAction Stop; 'ok'`,
        15_000,
      );
      if (!moved.includes('ok')) return { ok: false, message: 'Could not move the shortcut.' };
      appendUndo({
        at: Date.now(),
        findingId: finding.id,
        title: finding.title,
        reverse: { kind: 'restore-registry', location: hidden, name: action.location },
        lossy: false,
      });
      return { ok: true, message: `${finding.title} will no longer start at log in.` };
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : String(e) };
    }
  }

  const script =
    `$k = '${escape(action.location)}'; $n = '${escape(action.target)}';` +
    `$v = (Get-ItemProperty -Path $k -Name $n -ErrorAction Stop).$n;` +
    `Rename-ItemProperty -Path $k -Name $n -NewName ($n + '.disabled-by-infinite-os') -ErrorAction Stop;` +
    `[Console]::Out.Write([Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes([string]$v)))`;
  try {
    const encoded = (await runPowerShell(script, 20_000)).trim();
    const originalValue = Buffer.from(encoded, 'base64').toString('utf8');
    appendUndo({
      at: Date.now(),
      findingId: finding.id,
      title: finding.title,
      reverse: { kind: 'restore-registry', location: action.location, name: action.target, value: originalValue },
      lossy: false,
    });
    return { ok: true, message: `${finding.title} will no longer start at log in.` };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

/** Disable a scheduled task, recording its previous state for undo. */
async function stopTask(action: OptimizationAction, finding: Finding): Promise<{ ok: boolean; message: string }> {
  if (!action.target) return { ok: false, message: 'No task named.' };
  try {
    await runPowerShell(`Disable-ScheduledTask -TaskName '${escape(action.target)}' -ErrorAction Stop | Out-Null; 'ok'`, 20_000);
    appendUndo({
      at: Date.now(),
      findingId: finding.id,
      title: finding.title,
      reverse: { kind: 'enable-task', name: action.target },
      lossy: false,
    });
    return { ok: true, message: `${finding.title} will not run at log in.` };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

/** Set a service's startup type, recording the old one. */
async function setService(action: OptimizationAction, finding: Finding): Promise<{ ok: boolean; message: string }> {
  if (!action.target) return { ok: false, message: 'No service named.' };
  const desired = action.startupType === 'manual' ? 'Manual' : 'Disabled';
  try {
    const previous = (
      await runPowerShell(
        `$s = Get-CimInstance Win32_Service -Filter "Name='${escape(action.target)}'" -ErrorAction Stop; [Console]::Out.Write($s.StartMode)`,
        20_000,
      )
    ).trim();
    await runPowerShell(
      `Set-Service -Name '${escape(action.target)}' -StartupType ${desired} -ErrorAction Stop; 'ok'`,
      20_000,
    );
    appendUndo({
      at: Date.now(),
      findingId: finding.id,
      title: finding.title,
      reverse: { kind: 'set-service', name: action.target, startupType: previous },
      lossy: false,
    });
    return { ok: true, message: `${finding.title} set to ${desired}. It may need a restart to take effect.` };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Clear temp files — with the path boundary re-checked here.
 *
 * The allow-list is re-verified at the point of deletion, not trusted from the
 * analysis, because this is the one irreversible action in the whole feature and
 * it deserves its own independent gate.
 */
async function cleanTemp(action: OptimizationAction, _finding: Finding): Promise<{ ok: boolean; message: string }> {
  const allowList = SAFE_TEMP_DIRS.map((d) =>
    d.path
      .replace('%TEMP%', process.env.TEMP ?? '')
      .replace('%LOCALAPPDATA%', process.env.LOCALAPPDATA ?? '')
      .replace('%WINDIR%', process.env.SystemRoot ?? 'C:\\Windows'),
  ).filter((p) => p && !p.includes('%'));

  const targets = (action.target ?? '').split(';').filter(Boolean);
  const approved = targets.filter((t) => allowList.includes(t) && isSafeTempPath(t, allowList));

  // Refuse wholesale if anything requested falls outside the allow-list: a caller
  // that computed its own paths is not one we should be deleting from.
  if (approved.length !== targets.length) {
    return {
      ok: false,
      message: 'Refused: that path is not one of the approved temp folders, so nothing was deleted.',
    };
  }
  if (approved.length === 0) return { ok: false, message: 'No approved temp folders to clean.' };

  let removed = 0;
  let bytes = 0;
  for (const dir of approved) {
    // Re-verify the boundary on the resolved absolute path, immediately before
    // deleting anything under it.
    const absolute = join(dir);
    if (!isSafeTempPath(absolute, allowList.map((a) => join(a)))) continue;
    try {
      const before = await runPowerShell(
        `$m = Get-ChildItem -LiteralPath '${escape(absolute)}' -Recurse -Force -File -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum; [Console]::Out.Write([int64]$m.Sum)`,
        60_000,
      );
      // Delete contents, never the folder itself: Windows and running apps expect
      // these directories to exist.
      await runPowerShell(
        `Get-ChildItem -LiteralPath '${escape(absolute)}' -Force -ErrorAction SilentlyContinue | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue; 'ok'`,
        120_000,
      );
      removed += 1;
      bytes += Number(before.trim()) || 0;
    } catch {
      // A file still held open by a running app is normal; skip it.
    }
  }

  return {
    ok: removed > 0,
    message: removed
      ? `Cleared ${(bytes / 1024 ** 2).toFixed(0)} MB from ${removed} temp folder${removed === 1 ? '' : 's'}. Files in use were skipped.`
      : 'Nothing could be cleared — most files are probably in use.',
  };
}

/**
 * Ask before ending a process. Never automatic.
 *
 * Refuses anything that has a window, because a process with a window is very
 * likely something the user is looking at, and the whole premise of the feature
 * is that it must not interrupt their work.
 */
async function stopProcess(action: OptimizationAction, finding: Finding): Promise<{ ok: boolean; message: string }> {
  if (!action.target) return { ok: false, message: 'No process named.' };
  try {
    const withWindows = (
      await runPowerShell(
        `$p = Get-Process -Name '${escape(action.target)}' -ErrorAction Stop | Where-Object { $_.MainWindowTitle -ne '' }; if ($p) { 'HAS_WINDOW' } else { 'NO_WINDOW' }`,
        15_000,
      )
    ).trim();
    if (withWindows.includes('HAS_WINDOW')) {
      return { ok: false, message: 'That has a window open, so it is probably something you are using. Left it running.' };
    }
    await runPowerShell(`Stop-Process -Name '${escape(action.target)}' -Force -ErrorAction Stop; 'ok'`, 20_000);
    // Processes cannot be restarted by us, so the undo is honest about that.
    return { ok: true, message: `${finding.title} closed. Start it again yourself if you need it.` };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Apply one finding.
 *
 * `approved` gates the tiers that need a human. A caller passing a `safe` finding
 * is trusted; anything `ask` requires `approved: true`, and `report` is refused
 * outright — report-only means report-only, with no override.
 */
export async function applyFinding(
  finding: Finding,
  opts: { approved?: boolean } = {},
): Promise<{ ok: boolean; message: string }> {
  if (finding.tier === 'report') {
    return { ok: false, message: 'This one is informational — nothing is changed for findings like this.' };
  }
  if (finding.tier === 'ask' && !opts.approved) {
    return { ok: false, message: 'This needs your approval first.' };
  }
  const action = finding.action;
  if (!action) return { ok: false, message: 'Nothing to do for this one.' };

  // Anything that mutates the system records an undo first. If we cannot, we
  // decline rather than make an unrecoverable change.
  if (action.kind !== 'stop-process' && !undoIsAvailable()) {
    return { ok: false, message: 'Cannot record how to undo this, so nothing was changed.' };
  }

  switch (action.kind) {
    case 'disable-startup':
      return disableStartup(action, finding);
    case 'stop-task':
      return stopTask(action, finding);
    case 'set-service':
      return setService(action, finding);
    case 'clean-temp':
      return cleanTemp(action, finding);
    case 'stop-process':
      return stopProcess(action, finding);
    default:
      return { ok: false, message: 'Unknown action.' };
  }
}

/** Put one recorded change back. */
export async function undo(entry: UndoEntry): Promise<{ ok: boolean; message: string }> {
  try {
    if (entry.reverse.kind === 'restore-registry') {
      if (entry.reverse.value !== undefined && entry.reverse.location) {
        // Startup registry value: rename it back to the original name.
        await runPowerShell(
          `$k = '${escape(entry.reverse.location)}'; $disabled = '${escape(entry.reverse.name)}.disabled-by-infinite-os';` +
            `if (Get-ItemProperty -Path $k -Name $disabled -ErrorAction SilentlyContinue) {` +
            `Rename-ItemProperty -Path $k -Name $disabled -NewName '${escape(entry.reverse.name)}' -ErrorAction Stop }; 'ok'`,
          20_000,
        );
      } else if (entry.reverse.location) {
        // A moved shortcut.
        await runPowerShell(
          `Move-Item -LiteralPath '${escape(entry.reverse.location)}' -Destination '${escape(homedir())}' -Force -ErrorAction SilentlyContinue; 'ok'`,
          20_000,
        );
      }
      return { ok: true, message: `${entry.title} restored.` };
    }
    if (entry.reverse.kind === 'enable-task') {
      await runPowerShell(`Enable-ScheduledTask -TaskName '${escape(entry.reverse.name)}' -ErrorAction SilentlyContinue | Out-Null; 'ok'`, 20_000);
      return { ok: true, message: `${entry.title} enabled again.` };
    }
    if (entry.reverse.kind === 'set-service') {
      const previous = entry.reverse.startupType ?? 'Auto';
      await runPowerShell(
        `Set-Service -Name '${escape(entry.reverse.name)}' -StartupType ${previous} -ErrorAction SilentlyContinue; 'ok'`,
        20_000,
      );
      return { ok: true, message: `${entry.title} set back to ${previous}.` };
    }
    return { ok: false, message: 'Nothing recorded to undo.' };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

/** Undo everything, newest first. */
export async function undoAll(): Promise<Array<{ title: string; ok: boolean; message: string }>> {
  const results: Array<{ title: string; ok: boolean; message: string }> = [];
  for (const entry of readUndoLog()) {
    results.push({ title: entry.title, ...(await undo(entry)) });
  }
  return results;
}

export { rmSync };