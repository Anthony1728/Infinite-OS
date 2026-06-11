// Permission prompt — asks the renderer to show a modal and awaits the answer.

import { BrowserWindow } from 'electron';
import { IPC } from '../../shared/ipc.js';
import type { ContentBlock } from '../../shared/types.js';

type ToolUse = Extract<ContentBlock, { type: 'tool_use' }>;

const pending = new Map<string, (allowed: boolean) => void>();

export async function requestPermission(tu: ToolUse, _opts: { sessionId: string; cwd: string }): Promise<boolean> {
  const id = crypto.randomUUID();
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
  if (!win) return false;

  return new Promise<boolean>((resolve) => {
    pending.set(id, resolve);
    win.webContents.send(IPC.PERMISSION_REQUEST, { id, tool: tu.name, input: tu.input });
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        resolve(false);
      }
    }, 5 * 60_000); // 5-min timeout
  });
}

export function respondToPermission(id: string, allowed: boolean): void {
  pending.get(id)?.(allowed);
  pending.delete(id);
}
