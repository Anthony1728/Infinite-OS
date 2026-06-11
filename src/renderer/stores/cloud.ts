import { create } from 'zustand';

export interface CloudDevice { id: string; name: string; lastSync: number; status: string; }
export interface CloudBackup { id: string; size: number; createdAt: number; status: string; }
export interface CloudRecord { id: string; type: string; data: unknown; syncedAt: number; }
export interface CloudStats { devices: number; backups: number; records: number; lastSync?: number; }

interface CloudState {
  devices: CloudDevice[]; backups: CloudBackup[]; records: CloudRecord[]; stats: CloudStats | null; loading: boolean;
  loadDevices: () => Promise<void>; loadBackups: () => Promise<void>; loadRecords: () => Promise<void>; loadStats: () => Promise<void>;
  registerDevice: (name: string) => Promise<void>;
  syncData: (type: string, data: unknown) => Promise<void>;
  createBackup: () => Promise<void>;
  restoreBackup: (id: string) => Promise<void>;
}

export const useCloudStore = create<CloudState>((set, get) => ({
  devices: [], backups: [], records: [], stats: null, loading: false,
  loadDevices: async () => { try { set({ devices: await window.api.cloudListDevices() as CloudDevice[] }); } catch {} },
  loadBackups: async () => { try { set({ backups: await window.api.cloudListBackups() as CloudBackup[] }); } catch {} },
  loadRecords: async () => { try { set({ records: await window.api.cloudRecentRecords() as CloudRecord[] }); } catch {} },
  loadStats: async () => { try { set({ stats: await window.api.cloudStats() as CloudStats }); } catch {} },
  registerDevice: async (name) => { await window.api.cloudRegisterDevice({ name }); await get().loadDevices(); await get().loadStats(); },
  syncData: async (type, data) => { await window.api.cloudSyncData({ type, data }); await get().loadRecords(); },
  createBackup: async () => { await window.api.cloudCreateBackup(); await get().loadBackups(); await get().loadStats(); },
  restoreBackup: async (id) => { await window.api.cloudRestoreBackup({ id }); },
}));
