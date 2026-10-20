/**
 * Worker credential vault.
 *
 * Secrets live encrypted at rest through Electron's safeStorage (DPAPI on
 * Windows) and are never returned to the renderer. Workers receive access only
 * through an explicit per-credential allow-list, and the only way a secret
 * leaves the vault is keyboard input into a focused app.
 */

import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { infiniteHome } from '../profiles/home.js';

export interface VaultCipher {
  available(): boolean;
  label(): string;
  encrypt(plaintext: string): string;
  decrypt(encoded: string): string;
}

export interface VaultEntry {
  id: string;
  label: string;
  username: string;
  /** Ciphertext only. Never expose this as a plaintext field. */
  secret: string;
  workerIds: string[];
  createdAt: number;
  updatedAt: number;
}

export interface VaultEntryView {
  id: string;
  label: string;
  username: string;
  workerIds: string[];
  createdAt: number;
  updatedAt: number;
  cipher: string;
}

interface StoredVault {
  version: 1;
  entries: VaultEntry[];
}

export interface VaultAddInput {
  label: string;
  username?: string;
  secret: string;
  workerIds?: string[];
}

const MAX_LABEL = 120;
const MAX_USERNAME = 300;
const MAX_SECRET = 10_000;

function clean(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function uniqueWorkerIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.filter((item): item is string => typeof item === 'string' && item.length > 0 && item.length < 100)));
}

/**
 * Electron's safeStorage is imported lazily so unit tests (plain Node) can
 * inject a deterministic cipher without pulling in the Electron binary.
 */
function electronCipher(): VaultCipher | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const electron = require('electron') as typeof import('electron');
    if (!electron?.safeStorage?.isEncryptionAvailable()) return null;
    return {
      available: () => electron.safeStorage.isEncryptionAvailable(),
      label: () => process.platform === 'win32' ? 'Windows DPAPI' : process.platform === 'darwin' ? 'macOS Keychain' : 'OS keyring',
      encrypt: (plaintext) => electron.safeStorage.encryptString(plaintext).toString('base64'),
      decrypt: (encoded) => electron.safeStorage.decryptString(Buffer.from(encoded, 'base64')),
    };
  } catch {
    return null;
  }
}

export class CredentialVault {
  private readonly dataDir: string;
  private readonly cipher: VaultCipher | null;
  private entries = new Map<string, VaultEntry>();

  constructor(options: { dataDir?: string; cipher?: VaultCipher } = {}) {
    this.dataDir = options.dataDir ?? join(infiniteHome(), 'workers');
    this.cipher = options.cipher ?? electronCipher();
    this.load();
  }

  available(): boolean {
    return Boolean(this.cipher?.available());
  }

  cipherLabel(): string {
    return this.cipher?.available() ? this.cipher.label() : 'Unavailable';
  }

  list(workerId?: string): VaultEntryView[] {
    return Array.from(this.entries.values())
      .filter((entry) => !workerId || entry.workerIds.includes(workerId))
      .sort((a, b) => a.label.localeCompare(b.label))
      .map((entry) => this.view(entry));
  }

  add(input: VaultAddInput): VaultEntryView {
    if (!this.cipher?.available()) {
      throw new Error('Secure storage is not available on this machine.');
    }
    const label = clean(input.label, MAX_LABEL);
    const username = clean(input.username, MAX_USERNAME);
    const secret = typeof input.secret === 'string' ? input.secret.slice(0, MAX_SECRET) : '';
    if (!label) throw new Error('A credential label is required.');
    // Trim-checked but stored verbatim — whitespace-only is never a real secret.
    if (!secret.trim()) throw new Error('A password or token is required.');
    if (Array.from(this.entries.values()).some((entry) => entry.label.toLowerCase() === label.toLowerCase())) {
      throw new Error(`A credential named "${label}" already exists.`);
    }
    const now = Date.now();
    const entry: VaultEntry = {
      id: randomUUID(),
      label,
      username,
      secret: this.cipher.encrypt(secret),
      workerIds: uniqueWorkerIds(input.workerIds),
      createdAt: now,
      updatedAt: now,
    };
    this.entries.set(entry.id, entry);
    this.save();
    return this.view(entry);
  }

  authorize(id: string, workerIds: unknown): VaultEntryView {
    const entry = this.entries.get(id);
    if (!entry) throw new Error('Credential not found.');
    entry.workerIds = uniqueWorkerIds(workerIds);
    entry.updatedAt = Date.now();
    this.save();
    return this.view(entry);
  }

  remove(id: string): boolean {
    const deleted = this.entries.delete(id);
    if (deleted) this.save();
    return deleted;
  }

  /** Internal-only: resolve a secret for an explicitly authorized worker. */
  resolveSecret(id: string, workerId: string): { entry: VaultEntry; secret: string } {
    if (!this.cipher?.available()) throw new Error('Secure storage is not available on this machine.');
    const entry = this.entries.get(id);
    if (!entry) throw new Error('Credential not found.');
    if (!workerId || !entry.workerIds.includes(workerId)) {
      throw new Error('This worker is not authorized to use that credential.');
    }
    let secret: string;
    try {
      secret = this.cipher.decrypt(entry.secret);
    } catch {
      throw new Error('The saved credential could not be decrypted on this machine.');
    }
    return { entry, secret };
  }

  private view(entry: VaultEntry): VaultEntryView {
    return {
      id: entry.id,
      label: entry.label,
      username: entry.username,
      workerIds: [...entry.workerIds],
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
      cipher: this.cipherLabel(),
    };
  }

  private load(): void {
    try {
      const path = join(this.dataDir, 'vault.json');
      if (!existsSync(path)) return;
      const parsed = JSON.parse(readFileSync(path, 'utf8')) as StoredVault | VaultEntry[];
      const entries = Array.isArray(parsed) ? parsed : parsed.entries;
      if (!Array.isArray(entries)) return;
      for (const entry of entries) {
        if (!entry || typeof entry.id !== 'string' || typeof entry.secret !== 'string') continue;
        this.entries.set(entry.id, {
          ...entry,
          label: clean(entry.label, MAX_LABEL),
          username: clean(entry.username, MAX_USERNAME),
          workerIds: uniqueWorkerIds(entry.workerIds),
        });
      }
    } catch (error) {
      console.warn('[workers] failed to load vault.json:', error);
    }
  }

  private save(): void {
    try {
      if (!existsSync(this.dataDir)) mkdirSync(this.dataDir, { recursive: true });
      const payload: StoredVault = { version: 1, entries: Array.from(this.entries.values()) };
      writeFileSync(join(this.dataDir, 'vault.json'), JSON.stringify(payload, null, 2), 'utf8');
    } catch (error) {
      console.warn('[workers] failed to save vault.json:', error);
    }
  }
}

let singleton: CredentialVault | null = null;

export function getCredentialVault(): CredentialVault {
  if (!singleton) singleton = new CredentialVault();
  return singleton;
}

export function setCredentialVaultForTests(vault: CredentialVault | null): void {
  singleton = vault;
}
