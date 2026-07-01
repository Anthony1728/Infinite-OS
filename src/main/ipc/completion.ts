/**
 * Completion IPC Handler
 */

import { ipcMain, BrowserWindow } from 'electron';
import { IPC } from '../../shared/ipc.js';
import { getCompletionEngine } from '../completion/engine.js';

export function registerCompletionIpc(): void {
  const engine = getCompletionEngine();

  // Request completions
  ipcMain.handle(IPC.COMPLETION_REQUEST, async (event, args: {
    filePath: string;
    position: { line: number; character: number };
    context: string;
  }) => {
    try {
      // Read file content
      let content = args.context;
      
      const completions = engine.getCompletions(
        args.filePath,
        content,
        args.position
      );

      // Send completions to renderer
      const win = BrowserWindow.fromWebContents(event.sender);
      if (win && !win.isDestroyed()) {
        win.webContents.send('completion:result', {
          id: args.filePath,
          position: args.position,
          completions,
        });
      }

      return { ok: true, count: completions.length };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, error: message };
    }
  });

  // Cancel completion
  ipcMain.handle(IPC.COMPLETION_CANCEL, async (_event, args: { id: string }) => {
    try {
      engine.cancelCompletion(args.id);
      return { ok: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, error: message };
    }
  });

  // List supported languages
  ipcMain.handle(IPC.COMPLETION_LIST, async () => {
    return {
      ok: true,
      languages: ['typescript', 'javascript', 'python', 'go', 'rust', 'java'],
    };
  });
}