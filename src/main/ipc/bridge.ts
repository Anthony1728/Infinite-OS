// Browser Bridge IPC — lets the renderer inspect and drive the Infinite OS
// Bridge browser extension through the local bridge server.

import { ipcMain } from 'electron';
import { IPC } from '../../shared/ipc.js';
import { bridgeServer } from '../bridge/server.js';
import { abortAllRuns } from '../agent/runtime.js';

export function registerBridgeIpc(): void {
  // The extension's Emergency Stop (and a spoken "stop") aborts here, so a run
  // that is mid-browser stops immediately instead of finishing its clicks.
  bridgeServer.onAbort = (reason) => {
    try {
      abortAllRuns(`Browser control stopped (${reason}).`);
    } catch {
      /* runtime not ready — the in-flight bridge commands were already failed */
    }
  };

  ipcMain.handle(IPC.BRIDGE_STATUS, async () => {
    return { ok: true, status: bridgeServer.getStatus() };
  });

  ipcMain.handle(IPC.BRIDGE_EXEC, async (_e, { command, params, timeoutMs }: { command: string; params?: Record<string, unknown>; timeoutMs?: number }) => {
    if (!command || typeof command !== 'string') return { ok: false, error: 'missing "command"' };
    return bridgeServer.exec(command, params || {}, timeoutMs);
  });
}
