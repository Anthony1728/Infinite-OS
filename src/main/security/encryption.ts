// Credential Encryption — Fernet-style encryption for API keys and secrets

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const KEY_LENGTH = 32;

export class CredentialManager {
  private masterKey: Buffer;
  private dataDir: string;
  private credentials: Map<string, { service: string; encrypted: string; iv: string; tag: string }> = new Map();

  constructor(passphrase?: string) {
    this.dataDir = join(homedir(), '.infinite-ai', 'credentials');
    if (!existsSync(this.dataDir)) {
      mkdirSync(this.dataDir, { recursive: true });
    }

    // Derive key from passphrase or use default
    const pass = passphrase || 'infinite-ai-default-key';
    const salt = Buffer.from('infinite-ai-salt-v1');
    this.masterKey = scryptSync(pass, salt, KEY_LENGTH);

    this.loadCredentials();
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
    const decipher = createDecipheriv(ALGORITHM, this.masterKey, Buffer.from(iv, 'hex'));
    decipher.setAuthTag(Buffer.from(tag, 'hex'));

    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  }

  saveCredential(id: string, service: string, apiKey: string): void {
    const { encrypted, iv, tag } = this.encrypt(apiKey);
    this.credentials.set(id, { service, encrypted, iv, tag });
    this.persistCredentials();
  }

  getCredential(id: string): string | null {
    const cred = this.credentials.get(id);
    if (!cred) return null;
    return this.decrypt(cred.encrypted, cred.iv, cred.tag);
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
