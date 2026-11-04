// Browser Bridge IPC — lets the renderer inspect and drive the Infinite OS
// Bridge browser extension through the local bridge server.

import { ipcMain, clipboard } from 'electron';
import { IPC } from '../../shared/ipc.js';
import { bridgeServer } from '../bridge/server.js';
import {
  buildStatus,
  ensureBrowserReady,
  installBridgeExtension,
  openExtensionFolder,
  openExtensionInstallPage,
  restartInfiniteOsBrowser,
} from '../bridge/extension-setup.js';
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

  // -------------------------------------------------------------------------
  // Extension setup — zero-click dedicated browser
  // -------------------------------------------------------------------------

  ipcMain.handle(IPC.BRIDGE_SETUP_STATUS, async () => {
    return { ok: true, status: await buildStatus() };
  });

  ipcMain.handle(IPC.BRIDGE_SETUP_LAUNCH, async () => {
    return ensureBrowserReady({ launch: true });
  });

  ipcMain.handle(IPC.BRIDGE_SETUP_RESTART, async () => {
    return restartInfiniteOsBrowser();
  });

  /**
   * Guided install for the user's main Chrome. Chrome 136+ cannot be automated
   * on the default profile, so this copies the unpacked folder, opens
   * chrome://extensions, and puts the path on the clipboard for Load unpacked.
   */
  ipcMain.handle(IPC.BRIDGE_SETUP_INSTALL, async () => {
    const installed = installBridgeExtension();
    if (!installed.ok) return { ok: false, error: installed.error, status: await buildStatus() };
    try {
      clipboard.writeText(installed.path);
    } catch {
      /* clipboard can be unavailable in a locked session */
    }
    const opened = openExtensionInstallPage();
    return {
      ok: opened.ok,
      extensionPath: installed.path,
      version: installed.version,
      copiedToClipboard: true,
      error: opened.error,
      status: await buildStatus(),
    };
  });

  ipcMain.handle(IPC.BRIDGE_SETUP_OPEN_FOLDER, async () => openExtensionFolder());

  ipcMain.handle(IPC.BRIDGE_SETUP_COPY_PATH, async () => {
    const installed = installBridgeExtension();
    if (!installed.ok) return { ok: false, error: installed.error };
    try {
      clipboard.writeText(installed.path);
      return { ok: true, path: installed.path };
    } catch (err) {
      return { ok: false, error: String((err as Error).message || err), path: installed.path };
    }
  });
}
