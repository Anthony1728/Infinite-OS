/**
 * Clipboard IPC Handler
 * 
 * Handles clipboard IPC requests from the renderer.
 */

import { ipcMain, clipboard } from 'electron';
import { IPC } from '../../shared/ipc.js';

export function registerClipboardIpc(): void {
  // Read from clipboard
  ipcMain.handle(IPC.CLIPBOARD_READ, async (_event, args?: { format?: string }) => {
    try {
      const format = args?.format ?? 'text';

      switch (format) {
        case 'text':
          return { ok: true, content: clipboard.readText() };

        case 'html':
          return { ok: true, content: clipboard.readHTML() };

        case 'image': {
          const image = clipboard.readImage();
          if (image.isEmpty()) {
            return { ok: true, content: '', isEmpty: true };
          }
          return { ok: true, content: image.toDataURL(), isEmpty: false };
        }

        default:
          return { ok: false, error: `Unknown format: ${format}` };
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, error: message };
    }
  });

  // Write to clipboard
  ipcMain.handle(IPC.CLIPBOARD_WRITE, async (_event, args: { text?: string; html?: string }) => {
    try {
      if (args.text) {
        clipboard.writeText(args.text);
      }
      if (args.html) {
        clipboard.writeHTML(args.html);
      }

      return {
        ok: true,
        message: `Written to clipboard: ${args.text ? `${args.text.length} chars` : ''} ${args.html ? 'HTML' : ''}`,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, error: message };
    }
  });

  // Clipboard image read/write was implemented here and never exposed on the
  // preload bridge, so no renderer could reach it. Removed rather than left as
  // unreachable code; the agent reads and writes images through tools, which
  // are permission-checked.
}