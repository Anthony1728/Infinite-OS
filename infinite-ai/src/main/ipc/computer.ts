// Computer Control IPC handlers

import { ipcMain } from 'electron';
import { IPC } from '../../shared/ipc.js';
import { computerControl } from '../index.js';

export function registerComputerIpc(): void {
  ipcMain.handle(IPC.COMPUTER_MOVE_MOUSE, async (_e, { x, y }) => {
    return computerControl.moveMouse(x, y);
  });

  ipcMain.handle(IPC.COMPUTER_CLICK_MOUSE, async (_e, { x, y, button }) => {
    return computerControl.clickMouse(x, y, button);
  });

  ipcMain.handle(IPC.COMPUTER_TYPE_TEXT, async (_e, { text }) => {
    return computerControl.typeText(text);
  });

  ipcMain.handle(IPC.COMPUTER_PRESS_KEY, async (_e, { keys }) => {
    return computerControl.pressKey(...keys);
  });

  ipcMain.handle(IPC.COMPUTER_CAPTURE_SCREEN, async () => {
    return computerControl.captureScreen();
  });

  ipcMain.handle(IPC.COMPUTER_OPEN_APP, async (_e, { name, path }) => {
    return computerControl.openApplication(name, path);
  });

  ipcMain.handle(IPC.COMPUTER_CLOSE_APP, async (_e, { appId }) => {
    return computerControl.closeApplication(appId);
  });

  ipcMain.handle(IPC.COMPUTER_STATS, async () => {
    return computerControl.getStats();
  });
}
