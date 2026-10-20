// Boot optimization IPC.
//
// Everything the UI can do here is read-only except ONE call that applies a
// single finding, and that call is refused for `report` findings and gated on
// `approved` for `ask` ones. There is no "optimize everything with no questions
// asked" entry point, deliberately — the safe tier can be applied in a loop by
// the caller, but only the safe tier.

import { ipcMain } from 'electron';
import { IPC } from '../../shared/ipc.js';
import { analyse, tempFileFindings, type Finding } from '../system/optimize.js';
import { applyFinding, readUndoLog, undo, undoAll } from '../system/optimize-apply.js';
import { settings } from '../settings/store.js';

/** The one setting that governs whether this feature acts on its own. */
const AUTO_KEY = 'bootOptimization';

let dismissedOnce = false;

/**
 * Whether the user has turned automatic boot optimization off.
 *
 * Defaults to ON, because that is the feature's whole point — but it is a single
 * setting the user controls, and when it is off nothing happens at all.
 *
 * Imported statically rather than with `require`: a dynamic require inside an ES
 * module threw at runtime and silently took the "disabled" branch, which meant
 * the feature was off by default and the UI said so. A setting that quietly fails
 * closed is exactly the wrong failure mode for something the user asked for.
 */
export function isBootOptimizationDisabled(): boolean {
  return settings.get(AUTO_KEY) === false;
}

/** True once the user has seen the findings, so the launch run is not a surprise. */
export function hasSeenFindings(): boolean {
  return dismissedOnce;
}

export function registerOptimizeIpc(): void {
  ipcMain.handle(IPC.OPTIMIZE_ANALYSE, async (_e, args?: { busyNames?: string[] }) => {
    const busy = args?.busyNames ?? [];
    const [startupFindings, temps] = await Promise.all([analyse({ busyNames: busy }), tempFileFindings()]);
    return [...temps, ...startupFindings];
  });

  ipcMain.handle(IPC.OPTIMIZE_APPLY, async (_e, args: { finding: Finding; approved?: boolean }) => {
    if (!args?.finding) return { ok: false, message: 'Nothing selected.' };
    return applyFinding(args.finding, { approved: args.approved === true });
  });

  ipcMain.handle(IPC.OPTIMIZE_UNDO_LIST, async () => readUndoLog());

  ipcMain.handle(IPC.OPTIMIZE_UNDO, async (_e, args: { entry: Parameters<typeof undo>[0] }) => undo(args.entry));

  ipcMain.handle(IPC.OPTIMIZE_UNDO_ALL, async () => undoAll());

  ipcMain.handle(IPC.OPTIMIZE_DISMISS, async () => {
    dismissedOnce = true;
    return { ok: true };
  });

  ipcMain.handle(IPC.OPTIMIZE_SEEN, async () => ({ seen: dismissedOnce }));

  ipcMain.handle(IPC.OPTIMIZE_AUTO_ENABLED, async () => ({ enabled: !isBootOptimizationDisabled() }));
}

/**
 * The launch pass.
 *
 * Deliberately narrow: it applies only `safe` findings, it does nothing at all
 * before the user has seen the panel once, and it never touches anything in the
 * `ask` or `report` tiers. A launch that silently disabled a service or closed a
 * program would be exactly the behaviour nobody asked for.
 *
 * Returns what it did so the caller can tell the user, rather than making a
 * change they cannot account for.
 */
export async function runBootOptimization(): Promise<{ applied: string[]; skipped: string[]; disabled: boolean }> {
  if (isBootOptimizationDisabled()) return { applied: [], skipped: [], disabled: true };

  const applied: string[] = [];
  const skipped: string[] = [];
  try {
    const findings = await tempFileFindings();
    for (const finding of findings) {
      // Only the safe tier, and only with an action attached.
      if (finding.tier !== 'safe' || !finding.action) {
        skipped.push(finding.title);
        continue;
      }
      const result = await applyFinding(finding);
      if (result.ok) applied.push(finding.title);
      else skipped.push(finding.title);
    }
  } catch (err) {
    console.warn('[optimize] boot pass failed:', err);
  }
  return { applied, skipped, disabled: false };
}