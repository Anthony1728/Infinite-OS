/**
 * Close-to-tray background operation.
 *
 * Scheduled workers keep firing while the window is closed, so closing the
 * window no longer has to mean quitting the app. This mirrors Warmwind's
 * "workers keep running when the window is gone" behavior on a local desktop:
 * the Electron main process stays alive, the scheduler keeps ticking, and a
 * tray icon exposes Show / pause-the-app / Quit.
 *
 * What this deliberately does NOT claim: offline cloud execution. Workers run
 * only while this machine is on (and not asleep).
 */

import { app, BrowserWindow, Menu, nativeImage, Tray } from 'electron';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { settings } from '../settings/store.js';
import { automationScheduler } from '../automation/scheduler.js';

const SETTING_KEY = 'keepWorkersRunning';

let win: BrowserWindow | null = null;
let tray: Tray | null = null;
let quitting = false;
let hideHintShown = false;
let listenerBound = false;

export function isBackgroundEnabled(): boolean {
  const value = settings.get<boolean | string>(SETTING_KEY);
  return value === true || value === 'true';
}

export function getBackgroundStatus(): { enabled: boolean; windowVisible: boolean; tray: boolean; schedulerRunning: boolean } {
  return {
    enabled: isBackgroundEnabled(),
    windowVisible: Boolean(win && !win.isDestroyed() && win.isVisible()),
    tray: Boolean(tray && !tray.isDestroyed()),
    schedulerRunning: automationScheduler.getStatus().running,
  };
}

export async function setBackgroundEnabled(enabled: boolean): Promise<ReturnType<typeof getBackgroundStatus>> {
  const cwd = settings.get<string>('cwd') ?? process.cwd();
  await settings.set('user', SETTING_KEY, enabled, cwd);
  if (enabled) ensureTray();
  else if (win && !win.isDestroyed() && !win.isVisible()) win.show();
  return getBackgroundStatus();
}

/** Wire the main window once after it is created. */
export function attachBackgroundWindow(window: BrowserWindow): void {
  win = window;
  if (!listenerBound) {
    listenerBound = true;
    app.on('before-quit', () => { quitting = true; });
    app.on('browser-window-focus', () => {
      if (win && !win.isDestroyed()) win.setSkipTaskbar(false);
    });
  }
  window.on('close', (event) => {
    if (quitting || !isBackgroundEnabled()) return;
    event.preventDefault();
    window.hide();
    window.setSkipTaskbar(true);
    ensureTray();
    if (!hideHintShown) {
      hideHintShown = true;
      console.log('[background] window hidden to tray — scheduled workers keep running');
    }
  });
}

export function showMainWindow(): void {
  if (!win || win.isDestroyed()) return;
  win.setSkipTaskbar(false);
  if (!win.isVisible()) win.show();
  if (win.isMinimized()) win.restore();
  win.focus();
}

export function runDueNow(): void {
  try { automationScheduler.tick(); } catch (error) { console.error('[background] scheduler tick failed:', error); }
}

export function ensureTray(): void {
  if (tray && !tray.isDestroyed()) return;
  try {
    const iconPath = join(__dirname, '../../resources/icon.png');
    const image = existsSync(iconPath)
      ? nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 })
      : nativeImage.createEmpty();
    tray = new Tray(image);
    tray.setToolTip('Infinite OS — scheduled workers are running');
    tray.setContextMenu(buildMenu());
    tray.on('click', () => showMainWindow());
  } catch (error) {
    console.warn('[background] tray unavailable:', error);
    tray = null;
  }
}

function buildMenu(): Menu {
  return Menu.buildFromTemplate([
    { label: 'Show Infinite OS', click: () => showMainWindow() },
    { type: 'separator' },
    {
      label: 'Keep workers running when the window is closed',
      type: 'checkbox',
      checked: isBackgroundEnabled(),
      click: (item) => { void setBackgroundEnabled(item.checked); },
    },
    {
      label: 'Run due workers now',
      click: () => { runDueNow(); showMainWindow(); },
    },
    { type: 'separator' },
    { label: 'Quit Infinite OS', click: () => { quitting = true; app.quit(); } },
  ]);
}

function refreshTray(): void {
  if (tray && !tray.isDestroyed()) tray.setContextMenu(buildMenu());
}

export function disposeTray(): void {
  if (tray && !tray.isDestroyed()) tray.destroy();
  tray = null;
}

/** Rebuild the tray menu after the background setting changed elsewhere. */
export function notifyBackgroundChanged(): void {
  refreshTray();
}
