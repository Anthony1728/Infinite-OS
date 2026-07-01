/**
 * Debug IPC Handler
 */

import { ipcMain, BrowserWindow } from 'electron';
import { IPC } from '../../shared/ipc.js';
import { getDebugAdapter } from '../debug/adapter.js';

export function registerDebugIpc(): void {
  const adapter = getDebugAdapter();

  // Start debug session
  ipcMain.handle(IPC.DEBUG_START, async (event, args: {
    filePath: string;
    breakPoints?: string[];
  }) => {
    try {
      const result = adapter.start(args.filePath, args.breakPoints ?? []);
      
      // Forward debug events to renderer
      adapter.on('event', (data) => {
        const win = BrowserWindow.fromWebContents(event.sender);
        if (win && !win.isDestroyed()) {
          win.webContents.send('debug:event', data);
        }
      });

      return { ok: true, ...result };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, error: message };
    }
  });

  // Stop debug session
  ipcMain.handle(IPC.DEBUG_STOP, async () => {
    try {
      const stopped = adapter.stop();
      return { ok: stopped };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, error: message };
    }
  });

  // Get debug status
  ipcMain.handle(IPC.DEBUG_STATUS, async () => {
    try {
      const status = adapter.getStatus();
      return { ok: true, ...status };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, error: message };
    }
  });

  // Set breakpoints
  ipcMain.handle(IPC.DEBUG_BREAKPOINTS_SET, async (_event, args: {
    filePath: string;
    lines: number[];
  }) => {
    try {
      const breakpoints = adapter.setBreakpoints(args.filePath, args.lines);
      return { ok: true, breakpoints };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, error: message };
    }
  });

  // List breakpoints
  ipcMain.handle(IPC.DEBUG_BREAKPOINTS_LIST, async (_event, args: {
    filePath: string;
  }) => {
    try {
      const breakpoints = adapter.listBreakpoints(args.filePath);
      return { ok: true, breakpoints };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, error: message };
    }
  });

  // Evaluate expression
  ipcMain.handle(IPC.DEBUG_EVALUATE, async (_event, args: {
    expression: string;
  }) => {
    try {
      const result = adapter.evaluate(args.expression);
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, error: message };
    }
  });

  // Step
  ipcMain.handle(IPC.DEBUG_STEP, async (_event, args: {
    action: 'in' | 'out' | 'over';
  }) => {
    try {
      const success = adapter.step(args.action);
      return { ok: success };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, error: message };
    }
  });

  // Continue
  ipcMain.handle(IPC.DEBUG_CONTINUE, async () => {
    try {
      const success = adapter.continue();
      return { ok: success };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, error: message };
    }
  });

  // Pause
  ipcMain.handle(IPC.DEBUG_PAUSE, async () => {
    try {
      const success = adapter.pause();
      return { ok: success };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, error: message };
    }
  });
}