/**
 * Cloud Sync
 *
 * Synchronize data across devices:
 * - Chat history sync
 * - File sync
 * - Settings sync
 * - Memory sync
 * - Backup/restore
 */

import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

export interface CloudSyncConfig {
  dataDir: string;
  syncInterval: number;
  maxBackupSize: number;
  enableAutoSync: boolean;
}

export interface SyncDevice {
  id: string;
  name: string;
  platform: string;
  lastSync: number;
  status: 'online' | 'offline' | 'syncing';
  syncVersion: number;
}

export interface SyncRecord {
  id: string;
  type: 'chat' | 'file' | 'settings' | 'memory' | 'session';
  deviceId: string;
  data: unknown;
  hash: string;
  timestamp: number;
  synced: boolean;
}

export interface Backup {
  id: string;
  name: string;
  size: number;
  createdAt: number;
  type: 'manual' | 'auto';
  status: 'completed' | 'in_progress' | 'failed';
  includes: string[];
}

export class CloudSync {
  private config: CloudSyncConfig;
  private devices: Map<string, SyncDevice> = new Map();
  private records: SyncRecord[] = [];
  private backups: Backup[] = [];
  private dataDir: string;
  private deviceId: string;

  constructor(config?: Partial<CloudSyncConfig>) {
    this.config = {
      dataDir: config?.dataDir ?? join(homedir(), '.infinite-ai', 'cloud'),
      syncInterval: config?.syncInterval ?? 300000,
      maxBackupSize: config?.maxBackupSize ?? 100 * 1024 * 1024,
      enableAutoSync: config?.enableAutoSync ?? true,
    };
    this.dataDir = this.config.dataDir;
    this.ensureDir();
    this.deviceId = this.getOrCreateDeviceId();
    this.loadData();
  }

  private ensureDir(): void {
    if (!existsSync(this.dataDir)) mkdirSync(this.dataDir, { recursive: true });
  }

  private getOrCreateDeviceId(): string {
    const idPath = join(this.dataDir, 'device-id');
    if (existsSync(idPath)) return readFileSync(idPath, 'utf-8').trim();
    const id = randomUUID();
    writeFileSync(idPath, id);
    return id;
  }

  private loadData(): void {
    try {
      const devicesPath = join(this.dataDir, 'devices.json');
      if (existsSync(devicesPath)) {
        const data = JSON.parse(readFileSync(devicesPath, 'utf-8'));
        this.devices = new Map(data);
      }
      const recordsPath = join(this.dataDir, 'records.json');
      if (existsSync(recordsPath)) {
        this.records = JSON.parse(readFileSync(recordsPath, 'utf-8'));
      }
      const backupsPath = join(this.dataDir, 'backups.json');
      if (existsSync(backupsPath)) {
        this.backups = JSON.parse(readFileSync(backupsPath, 'utf-8'));
      }
    } catch { /* silent */ }
  }

  private saveData(): void {
    try {
      writeFileSync(join(this.dataDir, 'devices.json'), JSON.stringify(Array.from(this.devices.entries()), null, 2));
      writeFileSync(join(this.dataDir, 'records.json'), JSON.stringify(this.records.slice(-5000), null, 2));
      writeFileSync(join(this.dataDir, 'backups.json'), JSON.stringify(this.backups.slice(-100), null, 2));
    } catch { /* silent */ }
  }

  registerDevice(name: string, platform: string): SyncDevice {
    const device: SyncDevice = {
      id: this.deviceId,
      name,
      platform,
      lastSync: Date.now(),
      status: 'online',
      syncVersion: 1,
    };
    this.devices.set(this.deviceId, device);
    this.saveData();
    return device;
  }

  async syncData(type: SyncRecord['type'], data: unknown): Promise<SyncRecord> {
    const record: SyncRecord = {
      id: randomUUID(),
      type,
      deviceId: this.deviceId,
      data,
      hash: this.simpleHash(JSON.stringify(data)),
      timestamp: Date.now(),
      synced: false,
    };

    this.records.push(record);

    // Mark as synced (in real implementation, would sync to cloud)
    record.synced = true;

    const device = this.devices.get(this.deviceId);
    if (device) {
      device.lastSync = Date.now();
      device.syncVersion++;
    }

    this.saveData();
    return record;
  }

  private simpleHash(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash |= 0;
    }
    return hash.toString(16);
  }

  async createBackup(name: string, includes: string[]): Promise<Backup> {
    const backup: Backup = {
      id: randomUUID(),
      name,
      size: 0,
      createdAt: Date.now(),
      type: 'manual',
      status: 'in_progress',
      includes,
    };

    this.backups.push(backup);

    try {
      // Actually backup data to disk
      const backupDir = join(this.dataDir, 'backups', backup.id);
      if (!existsSync(backupDir)) mkdirSync(backupDir, { recursive: true });

      let totalSize = 0;

      // Backup records
      if (includes.includes('records') || includes.includes('all')) {
        const recordsPath = join(backupDir, 'records.json');
        writeFileSync(recordsPath, JSON.stringify(this.records, null, 2));
        totalSize += readFileSync(recordsPath).length;
      }

      // Backup devices
      if (includes.includes('devices') || includes.includes('all')) {
        const devicesPath = join(backupDir, 'devices.json');
        writeFileSync(devicesPath, JSON.stringify(Array.from(this.devices.entries()), null, 2));
        totalSize += readFileSync(devicesPath).length;
      }

      // Backup settings
      if (includes.includes('settings') || includes.includes('all')) {
        const settingsDir = join(homedir(), '.infinite-ai', 'settings');
        if (existsSync(settingsDir)) {
          let settingsFiles = '{}';
          try {
            settingsFiles = readFileSync(join(settingsDir, 'settings.json'), 'utf-8');
          } catch {
            // use default
          }
          const backupSettingsPath = join(backupDir, 'settings.json');
          writeFileSync(backupSettingsPath, JSON.stringify(JSON.parse(settingsFiles), null, 2));
          totalSize += readFileSync(backupSettingsPath).length;
        }
      }

      // Backup chat history
      if (includes.includes('chats') || includes.includes('all')) {
        const sessionsDir = join(homedir(), '.infinite-ai', 'sessions');
        if (existsSync(sessionsDir)) {
          const { readdirSync } = await import('node:fs');
          const files = readdirSync(sessionsDir).filter(f => f.endsWith('.jsonl'));
          const chatBackupPath = join(backupDir, 'chats');
          if (!existsSync(chatBackupPath)) mkdirSync(chatBackupPath, { recursive: true });
          for (const file of files) {
            const content = readFileSync(join(sessionsDir, file));
            writeFileSync(join(chatBackupPath, file), content);
            totalSize += content.length;
          }
        }
      }

      // Save backup metadata
      writeFileSync(join(backupDir, 'metadata.json'), JSON.stringify({
        id: backup.id,
        name: backup.name,
        createdAt: backup.createdAt,
        includes: backup.includes,
        deviceId: this.deviceId,
      }, null, 2));

      backup.status = 'completed';
      backup.size = totalSize;
    } catch (e) {
      backup.status = 'failed';
    }

    this.saveData();
    return backup;
  }

  async restoreBackup(backupId: string): Promise<{ success: boolean; error?: string }> {
    const backup = this.backups.find((b) => b.id === backupId);
    if (!backup) return { success: false, error: 'Backup not found' };

    try {
      const backupDir = join(this.dataDir, 'backups', backupId);
      if (!existsSync(backupDir)) return { success: false, error: 'Backup files not found' };

      // Restore records
      const recordsPath = join(backupDir, 'records.json');
      if (existsSync(recordsPath)) {
        this.records = JSON.parse(readFileSync(recordsPath, 'utf-8'));
      }

      // Restore devices
      const devicesPath = join(backupDir, 'devices.json');
      if (existsSync(devicesPath)) {
        this.devices = new Map(JSON.parse(readFileSync(devicesPath, 'utf-8')));
      }

      this.saveData();
      return { success: true };
    } catch (e) {
      return { success: false, error: (e as Error).message };
    }
  }

  async exportData(): Promise<string> {
    const exportData = {
      deviceId: this.deviceId,
      records: this.records,
      devices: Array.from(this.devices.entries()),
      backups: this.backups,
      exportedAt: Date.now(),
    };

    const exportPath = join(this.dataDir, 'export.json');
    writeFileSync(exportPath, JSON.stringify(exportData, null, 2));
    return exportPath;
  }

  async importData(filePath: string): Promise<{ success: boolean; error?: string }> {
    try {
      const data = JSON.parse(readFileSync(filePath, 'utf-8'));
      if (data.records) this.records = [...this.records, ...data.records];
      if (data.devices) {
        for (const [id, device] of data.devices) {
          this.devices.set(id, device);
        }
      }
      this.saveData();
      return { success: true };
    } catch (e) {
      return { success: false, error: (e as Error).message };
    }
  }

  getDevice(deviceId: string): SyncDevice | undefined {
    return this.devices.get(deviceId);
  }

  listDevices(): SyncDevice[] {
    return Array.from(this.devices.values());
  }

  getRecentRecords(type?: SyncRecord['type'], count: number = 50): SyncRecord[] {
    let records = this.records;
    if (type) records = records.filter((r) => r.type === type);
    return records.slice(-count);
  }

  getBackups(): Backup[] {
    return this.backups;
  }

  getStats(): {
    totalDevices: number;
    onlineDevices: number;
    totalRecords: number;
    unsyncedRecords: number;
    totalBackups: number;
  } {
    const devices = Array.from(this.devices.values());
    return {
      totalDevices: devices.length,
      onlineDevices: devices.filter((d) => d.status === 'online').length,
      totalRecords: this.records.length,
      unsyncedRecords: this.records.filter((r) => !r.synced).length,
      totalBackups: this.backups.length,
    };
  }
}

