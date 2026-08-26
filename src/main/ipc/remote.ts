// Phone remote IPC handlers

import { ipcMain } from 'electron';
import { IPC } from '../../shared/ipc.js';
import { phoneRemoteServer } from '../remote/server.js';

export function registerRemoteIpc(): void {
  ipcMain.handle(IPC.REMOTE_PHONE_INFO, async () => {
    return phoneRemoteServer.getInfo();
  });
}
