// Real tab IPC.
//
// Tabs used to have NO channel to main at all. The only way the agent could make
// one was to return a JSON string inside a `tool_result` and have the renderer
// sniff for it (`chat.ts` parses the result and looks for `action: 'create_tab'`).
// That worked by accident, could not report state back, and meant "list the tabs"
// and "what URL is this tab on" could only return a string of prose to the model.
//
// This is the actual channel: main emits, the renderer creates. It is the single
// transport for agent-created tabs — the tool_result sniffing path is kept only
// for tabs created by older sessions, and both funnel into the same store action.

import { BrowserWindow } from 'electron';
import { IPC } from '../shared/ipc.js';

export interface TabRequest {
  title: string;
  kind: string;
  prompt: string;
  content?: string;
  htmlContent?: string;
  filePath?: string;
  sections?: unknown[];
  metrics?: unknown[];
  chartData?: unknown;
  tableData?: unknown;
  actions?: Array<{ label: string; prompt: string }>;
  metadata?: Record<string, unknown>;
}

/**
 * Every live window, tolerating Electron being unavailable.
 *
 * These emitters are called from tool code paths, so an unguarded
 * `BrowserWindow.getAllWindows()` turns "no windows" into a thrown error that
 * takes out the tool call. Showing a tab is a convenience and must never break
 * the work that asked for it.
 */
function liveWindows(): BrowserWindow[] {
  try {
    if (!BrowserWindow || typeof BrowserWindow.getAllWindows !== 'function') return [];
    return BrowserWindow.getAllWindows().filter((win) => !win.isDestroyed());
  } catch {
    return [];
  }
}

/**
 * Ask every open window to create this tab and focus it.
 *
 * Broadcast rather than target one window: the user may have more than one, and
 * a tab that only exists in a window they are not looking at has not been shown
 * to them.
 */
export function emitTabRequest(tab: TabRequest): void {
  for (const win of liveWindows()) {
    win.webContents.send(IPC.TAB_CREATE, tab);
  }
}

/** Tell the renderer an existing tab changed (navigate, patch, close). */
export function emitTabUpdate(patch: { tabId: string; changes: Partial<TabRequest>; metadata?: Record<string, unknown> }): void {
  for (const win of liveWindows()) {
    win.webContents.send(IPC.TAB_UPDATE, patch);
  }
}