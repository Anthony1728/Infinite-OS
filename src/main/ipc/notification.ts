/**
 * Notification IPC Handler
 * 
 * Handles notification IPC requests from the renderer.
 */

import { ipcMain, Notification } from 'electron';
import { IPC } from '../../shared/ipc.js';

/**
 * Notifications this app has shown and not yet been dismissed.
 *
 * Electron has no `Notification.clearAll()`, so the previous handler just
 * returned `{ ok: true }` and cleared nothing — the caller was told it had
 * worked. Tracking what we create makes "clear all" real: each one is closed on
 * request, and the caller is told how many were actually dismissed.
 */
const liveNotifications = new Set<Notification>();

/** Close and forget every notification we are still holding. */
function clearLiveNotifications(): number {
  let closed = 0;
  for (const notification of liveNotifications) {
    try {
      notification.close();
      closed++;
    } catch {
      // Already gone — not a failure, it just was not open.
    }
  }
  liveNotifications.clear();
  return closed;
}

/** Show a notification and keep it until the user or "clear all" removes it. */
function showTracked(options: ConstructorParameters<typeof Notification>[0]): Notification {
  const notification = new Notification(options);
  // Once it closes on its own, stop tracking it, or the set grows forever.
  notification.on('close', () => liveNotifications.delete(notification));
  liveNotifications.add(notification);
  notification.show();
  return notification;
}

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

      // Shown as a tracked notification so "clear all" can actually dismiss it.
      showTracked({
        title: args.title,
        body: args.body,
        silent: args.silent ?? false,
      });

      return { ok: true };
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
  //
  // Real now: closes every notification this app still has open and reports the
  // count, instead of reporting success without having done anything.
  ipcMain.handle(IPC.NOTIFICATION_CLEAR, async () => {
    const cleared = clearLiveNotifications();
    return { ok: true, cleared };
  });

  // How many are open right now — lets the UI tell the truth about whether
  // "clear all" has anything to do.
  ipcMain.handle(IPC.NOTIFICATION_ACTIVE_COUNT, async () => {
    return { count: liveNotifications.size };
  });
}