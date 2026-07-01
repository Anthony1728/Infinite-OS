/**
 * Notification IPC Handler
 * 
 * Handles notification IPC requests from the renderer.
 */

import { ipcMain, Notification } from 'electron';
import { IPC } from '../../shared/ipc.js';

export function registerNotificationIpc(): void {
  // Show notification
  ipcMain.handle(IPC.NOTIFICATION_SHOW, async (_event, args: {
    title: string;
    body: string;
    silent?: boolean;
  }) => {
    try {
      if (!Notification.isSupported()) {
        return { ok: false, error: 'Notifications not supported on this platform' };
      }

      const notification = new Notification({
        title: args.title,
        body: args.body,
        silent: args.silent ?? false,
      });

      notification.show();

      return { ok: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, error: message };
    }
  });

  // Show progress notification
  ipcMain.handle(IPC.NOTIFICATION_PROGRESS, async (_event, args: {
    title: string;
    body?: string;
    progress?: number;
  }) => {
    try {
      if (!Notification.isSupported()) {
        return { ok: false, error: 'Notifications not supported on this platform' };
      }

      const notification = new Notification({
        title: args.title,
        body: args.body ?? `Progress: ${args.progress ?? 0}%`,
      });

      notification.show();
      return { ok: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, error: message };
    }
  });

  // Show notification with actions
  ipcMain.handle(IPC.NOTIFICATION_ACTION, async (_event, args: {
    title: string;
    body: string;
    actions?: Array<{ type: string; text: string }>;
  }) => {
    try {
      if (!Notification.isSupported()) {
        return { ok: false, error: 'Notifications not supported on this platform' };
      }

      const notification = new Notification({
        title: args.title,
        body: args.body,
        actions: args.actions?.map(a => ({ type: 'button' as const, text: a.text })),
      });

      return new Promise((resolve) => {
        notification.on('action', (_event, index) => {
          resolve({ ok: true, action: args.actions?.[index]?.text ?? index });
        });

        notification.on('click', () => {
          resolve({ ok: true, action: 'click' });
        });

        notification.on('close', () => {
          resolve({ ok: true, action: 'dismiss' });
        });

        notification.show();
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, error: message };
    }
  });

  // Get notification status
  ipcMain.handle(IPC.NOTIFICATION_STATUS, async () => {
    return {
      supported: Notification.isSupported(),
    };
  });

  // Clear all notifications
  ipcMain.handle(IPC.NOTIFICATION_CLEAR, async () => {
    // Note: Electron doesn't have a clearAll method,
    // but we can track and close individual notifications
    return { ok: true };
  });
}