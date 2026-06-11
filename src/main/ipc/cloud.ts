// Cloud Sync IPC handlers

import { ipcMain } from 'electron';
import { IPC } from '../../shared/ipc.js';
import { cloudSync } from '../index.js';

export function registerCloudIpc(): void {
  ipcMain.handle(IPC.CLOUD_REGISTER_DEVICE, async (_e, { name, platform }) => {
    return cloudSync.registerDevice(name, platform);
  });

  ipcMain.handle(IPC.CLOUD_SYNC_DATA, async (_e, { type, data }) => {
    return cloudSync.syncData(type, data);
  });

  ipcMain.handle(IPC.CLOUD_CREATE_BACKUP, async (_e, { name, includes }) => {
    return cloudSync.createBackup(name, includes);
  });

  ipcMain.handle(IPC.CLOUD_RESTORE_BACKUP, async (_e, { backupId }) => {
    return cloudSync.restoreBackup(backupId);
  });

  ipcMain.handle(IPC.CLOUD_LIST_DEVICES, async () => {
    return cloudSync.listDevices();
  });

  ipcMain.handle(IPC.CLOUD_RECENT_RECORDS, async (_e, { type, count }) => {
    return cloudSync.getRecentRecords(type, count);
  });

  ipcMain.handle(IPC.CLOUD_LIST_BACKUPS, async () => {
    return cloudSync.getBackups();
  });

  ipcMain.handle(IPC.CLOUD_STATS, async () => {
    return cloudSync.getStats();
  });
}
