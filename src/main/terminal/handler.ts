/**
 * Interactive Terminal Handler
 * 
 * Manages PTY-based interactive terminal sessions.
 * Provides real-time streaming of terminal I/O via IPC.
 */

import { ipcMain, BrowserWindow } from 'electron';
import { IPC } from '../../shared/ipc.js';
import { getPtyManager, type PtyData } from './pty.js';

// Track active terminal sessions per window
const windowTerminals = new WeakMap<BrowserWindow, Set<string>>();

/**
 * Get or create terminal session set for a window
 */
function getWindowTerminals(win: BrowserWindow): Set<string> {
  let sessions = windowTerminals.get(win);
  if (!sessions) {
    sessions = new Set();
    windowTerminals.set(win, sessions);
  }
  return sessions;
}

/**
 * Register terminal IPC handlers
 */
export function registerTerminalIpc(): void {
  const ptyManager = getPtyManager();

  // Create a new terminal session
  ipcMain.handle(IPC.TERMINAL_CREATE_SESSION, async (event, options?: {
    cols?: number;
    rows?: number;
    cwd?: string;
  }) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) {
      return { error: 'No window available' };
    }

    try {
      const sessionData = ptyManager.createSession(options);
      if (!sessionData) {
        return { error: 'Failed to create terminal session (node-pty may not be available)' };
      }
      const sessions = getWindowTerminals(win);
      sessions.add(sessionData.sessionId);

      return {
        ok: true,
        session: sessionData,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { error: `Failed to create terminal: ${message}` };
    }
  });

  // Write to terminal
  ipcMain.handle(IPC.TERMINAL_WRITE, async (_event, args: {
    sessionId: string;
    data: string;
  }) => {
    const { sessionId, data } = args;

    if (!sessionId || !data) {
      return { error: 'sessionId and data are required' };
    }

    const success = ptyManager.write(sessionId, data);
    return { ok: success, error: success ? undefined : 'Session not found' };
  });

  // Resize terminal
  ipcMain.handle(IPC.TERMINAL_RESIZE, async (_event, args: {
    sessionId: string;
    cols: number;
    rows: number;
  }) => {
    const { sessionId, cols, rows } = args;

    if (!sessionId) {
      return { error: 'sessionId is required' };
    }

    const success = ptyManager.resize(sessionId, cols, rows);
    return { ok: success, error: success ? undefined : 'Session not found' };
  });

  // Close terminal session
  ipcMain.handle(IPC.TERMINAL_CLOSE_SESSION, async (event, args: {
    sessionId: string;
  }) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const { sessionId } = args;

    if (!sessionId) {
      return { error: 'sessionId is required' };
    }

    const success = ptyManager.closeSession(sessionId);

    if (success && win) {
      const sessions = getWindowTerminals(win);
      sessions.delete(sessionId);
    }

    return { ok: success, error: success ? undefined : 'Session not found' };
  });

  // List all sessions
  ipcMain.handle(IPC.TERMINAL_LIST_SESSIONS, async () => {
    return ptyManager.getSessions();
  });

  // Get session info
  ipcMain.handle(IPC.TERMINAL_GET_SESSION, async (_event, args: {
    sessionId: string;
  }) => {
    const session = ptyManager.getSession(args.sessionId);
    return session ?? { error: 'Session not found' };
  });

  // Register for terminal data events
  ipcMain.handle(IPC.TERMINAL_SUBSCRIBE, async (event, args: {
    sessionId: string;
  }) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) {
      return { error: 'No window available' };
    }

    const { sessionId } = args;
    if (!sessionId) {
      return { error: 'sessionId is required' };
    }

    // Subscribe to data
    ptyManager.onData(sessionId, (data: string) => {
      if (!win.isDestroyed()) {
        win.webContents.send(IPC.TERMINAL_DATA, { sessionId, data });
      }
    });

    // Subscribe to exit
    ptyManager.onExit(sessionId, (exitCode: number, signal: string) => {
      if (!win.isDestroyed()) {
        win.webContents.send(IPC.TERMINAL_EXIT, { sessionId, exitCode, signal });
      }
    });

    return { ok: true };
  });

  // Unsubscribe from terminal events
  ipcMain.handle(IPC.TERMINAL_UNSUBSCRIBE, async (_event, args: {
    sessionId: string;
  }) => {
    const { sessionId } = args;
    // The actual unsubscription happens via the returned functions
    // This just validates the session exists
    const session = ptyManager.getSession(sessionId);
    return {
      ok: !!session,
      error: session ? undefined : 'Session not found',
    };
  });

  // Close all terminals for a window
  ipcMain.handle(IPC.TERMINAL_CLOSE_ALL, async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) {
      return { error: 'No window available' };
    }

    const sessions = getWindowTerminals(win);
    for (const sessionId of sessions) {
      ptyManager.closeSession(sessionId);
    }
    sessions.clear();

    return { ok: true };
  });

  // Forward PTY events to renderer
  ptyManager.on('sessionCreate', (data: PtyData) => {
    // Notify all windows about new session
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send(IPC.TERMINAL_SESSION_CREATED, data);
      }
    }
  });

  ptyManager.on('sessionExit', (data: { sessionId: string; exitCode: number; signal: string }) => {
    // Notify all windows about session exit
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send(IPC.TERMINAL_EXIT, data);
      }
    }
  });
}

/**
 * Cleanup terminals for a window (call when window closes)
 */
export function cleanupWindowTerminals(win: BrowserWindow): void {
  const sessions = windowTerminals.get(win);
  if (sessions) {
    const ptyManager = getPtyManager();
    for (const sessionId of sessions) {
      ptyManager.closeSession(sessionId);
    }
    sessions.clear();
  }
  windowTerminals.delete(win);
}