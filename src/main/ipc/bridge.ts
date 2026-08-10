// Browser Bridge IPC — lets the renderer inspect and drive the Infinite OS
// Bridge browser extension through the local bridge server.

import { ipcMain } from 'electron';
import { IPC } from '../../shared/ipc.js';
import { bridgeServer } from '../bridge/server.js';

export function registerBridgeIpc(): void {
  ipcMain.handle(IPC.BRIDGE_STATUS, async () => {
    return { ok: true, status: bridgeServer.getStatus() };
  });

  ipcMain.handle(IPC.BRIDGE_EXEC, async (_e, { command, params, timeoutMs }: { command: string; params?: Record<string, unknown>; timeoutMs?: number }) => {
    if (!command || typeof command !== 'string') return { ok: false, error: 'missing "command"' };
    return bridgeServer.exec(command, params || {}, timeoutMs);
  });
}
