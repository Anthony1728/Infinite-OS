// Permission prompt — asks the renderer to show a modal and awaits the answer.

import { BrowserWindow } from 'electron';
import { IPC } from '../../shared/ipc.js';
import type { ContentBlock } from '../../shared/types.js';

type ToolUse = Extract<ContentBlock, { type: 'tool_use' }>;

const pending = new Map<string, (allowed: boolean) => void>();

export async function requestPermission(tu: ToolUse, opts: { sessionId: string; cwd: string; signal?: AbortSignal }): Promise<boolean> {
  const id = crypto.randomUUID();
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
  if (!win) return false;

  return new Promise<boolean>((resolve) => {
    let settled = false;
    const settle = (allowed: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      opts.signal?.removeEventListener('abort', onAbort);
      pending.delete(id);
      resolve(allowed);
    };
    const onAbort = () => settle(false);
    const timer = setTimeout(() => settle(false), 5 * 60_000);
    pending.set(id, settle);
    win.webContents.send(IPC.PERMISSION_REQUEST, { id, tool: tu.name, input: tu.input });
    opts.signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export function respondToPermission(id: string, allowed: boolean): void {
  pending.get(id)?.(allowed);
  pending.delete(id);
}

