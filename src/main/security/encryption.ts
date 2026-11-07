// Credential Encryption — AES-256-GCM for email and stored credentials.
//
// Key material: a RANDOM per-install master key wrapped by Electron
// safeStorage (DPAPI on Windows) — never a hardcoded passphrase. Credentials
// written by older builds used a static scrypt key; those still decrypt via
// the retained legacy key and are transparently re-encrypted under the new
// master key on first read, so an app upgrade never breaks a stored email
// password. When the OS offers no encrypted storage at all, the master key
// falls back to the legacy static derivation (same strength as before,
// never weaker) and says so in the file.

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { safeStorage } from 'electron';
import { infiniteHome } from '../profiles/home.js';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const KEY_LENGTH = 32;
const LEGACY_PASSPHRASE = 'infinite-ai-default-key';
const LEGACY_SALT = Buffer.from('infinite-ai-salt-v1');
const MASTER_KEY_FILE = 'master.key';

interface WrappedMasterKey {
  /** safeStorage-wrapped base64 of the random master key. */
  wrapped: string;
  algo: 'safeStorage';
}

function safeStorageAvailable(): boolean {
  try { return Boolean(safeStorage?.isEncryptionAvailable?.()); } catch { return false; }
}

export class CredentialManager {
  private masterKey: Buffer;
  /** Pre-upgrade key: kept ONLY so legacy credentials can be read and
   *  transparently re-encrypted. Never used for new writes. */
  private legacyKey: Buffer;
  private dataDir: string;
  private credentials: Map<string, { service: string; encrypted: string; iv: string; tag: string }> = new Map();

  constructor(passphrase?: string) {
    this.dataDir = join(infiniteHome(), 'credentials');
    if (!existsSync(this.dataDir)) {
      mkdirSync(this.dataDir, { recursive: true });
    }

    this.legacyKey = scryptSync(passphrase || LEGACY_PASSPHRASE, LEGACY_SALT, KEY_LENGTH);
    this.masterKey = this.loadOrCreateMasterKey();

    this.loadCredentials();
  }

  /** Random per-install master key, wrapped with safeStorage. A missing or
   *  unwrappable key file regenerates the key — credentials that only exist
   *  under the OLD key still decrypt via the legacy path below. */
  private loadOrCreateMasterKey(): Buffer {
    const keyPath = join(this.dataDir, MASTER_KEY_FILE);
    if (existsSync(keyPath)) {
      try {
        const record = JSON.parse(readFileSync(keyPath, 'utf-8')) as WrappedMasterKey;
        if (record.algo === 'safeStorage' && safeStorageAvailable()) {
          const decoded = safeStorage.decryptString(Buffer.from(record.wrapped, 'base64'));
          const key = Buffer.from(decoded, 'base64');
          if (key.length === KEY_LENGTH) return key;
        }
      } catch {
        // Unreadable wrapped key (context change, corruption): regenerate.
        // The legacy-key migration path keeps existing credentials readable.
      }
    }
    const fresh = randomBytes(KEY_LENGTH);
    try {
      if (safeStorageAvailable()) {
        const wrapped = safeStorage.encryptString(fresh.toString('base64'));
        writeFileSync(keyPath, JSON.stringify({ wrapped: wrapped.toString('base64'), algo: 'safeStorage' } satisfies WrappedMasterKey, null, 2));
        return fresh;
      }
    } catch { /* fall through to static derivation */ }
    // No OS-level encrypted storage: static derivation, honestly labelled.
    console.warn('[credentials] safeStorage unavailable — using static key derivation for stored credentials');
    return this.legacyKey;
  }

  private decryptWith(key: Buffer, encrypted: string, iv: string, tag: string): string {
    const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(iv, 'hex'));
    decipher.setAuthTag(Buffer.from(tag, 'hex'));
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  }

  encrypt(plaintext: string): { encrypted: string; iv: string; tag: string } {
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, this.masterKey, iv);

    let encrypted = cipher.update(plaintext, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const tag = cipher.getAuthTag();

    return {
      encrypted,
      iv: iv.toString('hex'),
      tag: tag.toString('hex'),
    };
  }

  decrypt(encrypted: string, iv: string, tag: string): string {
    return this.decryptWith(this.masterKey, encrypted, iv, tag);
  }

  saveCredential(id: string, service: string, apiKey: string): void {
    const { encrypted, iv, tag } = this.encrypt(apiKey);
    this.credentials.set(id, { service, encrypted, iv, tag });
    this.persistCredentials();
  }

  getCredential(id: string): string | null {
    const cred = this.credentials.get(id);
    if (!cred) return null;
    try {
      return this.decryptWith(this.masterKey, cred.encrypted, cred.iv, cred.tag);
    } catch {
      // Written by a pre-rekey build under the static key: read it with the
      // legacy key, then transparently upgrade it to the current master key.
      const legacy = this.decryptWith(this.legacyKey, cred.encrypted, cred.iv, cred.tag);
      this.saveCredential(id, cred.service, legacy);
      return legacy;
    }
  }

  deleteCredential(id: string): boolean {
    const result = this.credentials.delete(id);
    if (result) this.persistCredentials();
    return result;
  }

  listCredentials(): Array<{ id: string; service: string }> {
    return Array.from(this.credentials.entries()).map(([id, cred]) => ({
      id,
      service: cred.service,
    }));
  }

  hasCredential(id: string): boolean {
    return this.credentials.has(id);
  }

  // Safety: detect secrets in text
  detectSecrets(text: string): string[] {
    const patterns = [
      /sk-[a-zA-Z0-9]{20,}/g,                    // OpenAI API keys
      /nvapi-[a-zA-Z0-9_-]{20,}/g,               // NVIDIA API keys
      /ghp_[a-zA-Z0-9]{36}/g,                     // GitHub tokens
      /AKIA[A-Z0-9]{16}/g,                        // AWS access keys
      /password\s*[:=]\s*["']([^"']+)["']/gi,    // Passwords in code
      /secret\s*[:=]\s*["']([^"']+)["']/gi,      // Secrets in code
    ];

    const found: string[] = [];
    for (const pattern of patterns) {
      const matches = text.match(pattern);
      if (matches) found.push(...matches);
    }
    return found;
  }

  private loadCredentials(): void {
    const credPath = join(this.dataDir, 'credentials.json');
    if (existsSync(credPath)) {
      try {
        const data = JSON.parse(readFileSync(credPath, 'utf-8'));
        for (const [id, cred] of Object.entries(data)) {
          this.credentials.set(id, cred as { service: string; encrypted: string; iv: string; tag: string });
        }
      } catch { /* ignore corrupt file */ }
    }
  }

  private persistCredentials(): void {
    const credPath = join(this.dataDir, 'credentials.json');
    const data: Record<string, unknown> = {};
    for (const [id, cred] of this.credentials) {
      data[id] = cred;
    }
    writeFileSync(credPath, JSON.stringify(data, null, 2));
  }
}

let credInstance: CredentialManager | null = null;

export function getCredentials(): CredentialManager {
  if (!credInstance) credInstance = new CredentialManager();
  return credInstance;
}
