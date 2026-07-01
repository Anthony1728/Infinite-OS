/**
 * Clipboard IPC Handler
 * 
 * Handles clipboard IPC requests from the renderer.
 */

import { ipcMain, clipboard, nativeImage } from 'electron';
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

  // Read image from clipboard
  ipcMain.handle(IPC.CLIPBOARD_READ_IMAGE, async () => {
    try {
      const image = clipboard.readImage();
      if (image.isEmpty()) {
        return { ok: true, isEmpty: true };
      }

      return {
        ok: true,
        isEmpty: false,
        dataUrl: image.toDataURL(),
        size: image.getSize(),
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, error: message };
    }
  });

  // Write image to clipboard
  ipcMain.handle(IPC.CLIPBOARD_WRITE_IMAGE, async (_event, args: { imageBase64: string }) => {
    try {
      let base64Data = args.imageBase64;
      if (base64Data.startsWith('data:')) {
        base64Data = base64Data.split(',')[1];
      }

      const buffer = Buffer.from(base64Data, 'base64');
      const image = nativeImage.createFromBuffer(buffer);

      if (image.isEmpty()) {
        return { ok: false, error: 'Invalid image data' };
      }

      clipboard.writeImage(image);
      return { ok: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, error: message };
    }
  });
}