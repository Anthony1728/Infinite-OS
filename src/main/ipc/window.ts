// Window Control IPC handlers

import { ipcMain, BrowserWindow } from 'electron';
import { IPC } from '../../shared/ipc.js';

let windowIpcRegistered = false;

export function registerWindowIpc(getMainWindow: () => BrowserWindow | null): void {
  if (windowIpcRegistered) return;
  windowIpcRegistered = true;

  ipcMain.handle(IPC.WINDOW_SET_FULLSCREEN, (_e, { fullScreen }) => {
    const win = getMainWindow();
    if (!win || win.isDestroyed()) return { error: 'No main window' };
    win.setFullScreen(fullScreen);
    return { ok: true, fullScreen };
  });

  ipcMain.handle(IPC.WINDOW_IS_FULLSCREEN, () => {
    const win = getMainWindow();
    if (!win || win.isDestroyed()) return { fullscreen: false };
    return { fullscreen: win.isFullScreen() };
  });

  ipcMain.handle(IPC.WINDOW_SET_ALWAYS_ON_TOP, (_e, { onTop }) => {
    const win = getMainWindow();
    if (!win || win.isDestroyed()) return { error: 'No main window' };
    win.setAlwaysOnTop(onTop);
    return { ok: true, onTop };
  });

  ipcMain.handle(IPC.WINDOW_IS_ALWAYS_ON_TOP, () => {
    const win = getMainWindow();
    if (!win || win.isDestroyed()) return { alwaysOnTop: false };
    return { alwaysOnTop: win.isAlwaysOnTop() };
  });

  ipcMain.handle(IPC.WINDOW_MINIMIZE, () => {
    const win = getMainWindow();
    if (!win || win.isDestroyed()) return;
    win.minimize();
  });

  ipcMain.handle(IPC.WINDOW_MAXIMIZE, () => {
    const win = getMainWindow();
    if (!win || win.isDestroyed()) return;
    if (win.isMaximized()) {
      win.unmaximize();
    } else {
      win.maximize();
    }
  });

  ipcMain.handle(IPC.WINDOW_RESTORE, () => {
    const win = getMainWindow();
    if (!win || win.isDestroyed()) return;
    win.restore();
  });

  ipcMain.handle(IPC.WINDOW_CLOSE, () => {
    const win = getMainWindow();
    if (!win || win.isDestroyed()) return;
    win.close();
  });

  ipcMain.handle(IPC.WINDOW_TOGGLE_FULLSCREEN, () => {
    const win = getMainWindow();
    if (!win || win.isDestroyed()) return { ok: false, error: 'No window' };
    const isFs = win.isFullScreen();
    win.setFullScreen(!isFs);
    win.webContents.send(IPC.WINDOW_FULLSCREEN_CHANGED, { fullscreen: !isFs });
    return { ok: true, fullscreen: !isFs };
  });

  ipcMain.handle(IPC.WINDOW_ENTER_FULLSCREEN, () => {
    const win = getMainWindow();
    if (!win || win.isDestroyed()) return { ok: false, error: 'No window' };
    win.setFullScreen(true);
    win.webContents.send(IPC.WINDOW_FULLSCREEN_CHANGED, { fullscreen: true });
    return { ok: true, fullscreen: true };
  });

  ipcMain.handle(IPC.WINDOW_EXIT_FULLSCREEN, () => {
    const win = getMainWindow();
    if (!win || win.isDestroyed()) return { ok: false, error: 'No window' };
    win.setFullScreen(false);
    win.webContents.send(IPC.WINDOW_FULLSCREEN_CHANGED, { fullscreen: false });
    return { ok: true, fullscreen: false };
  });

  ipcMain.handle(IPC.WINDOW_UNMAXIMIZE, () => {
    const win = getMainWindow();
    if (!win || win.isDestroyed()) return { ok: false };
    win.unmaximize();
    return { ok: true };
  });

  ipcMain.handle(IPC.WINDOW_IS_MAXIMIZED, () => {
    const win = getMainWindow();
    if (!win || win.isDestroyed()) return { maximized: false };
    return { maximized: win.isMaximized() };
  });
}