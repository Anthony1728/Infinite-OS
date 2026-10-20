import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CredentialVault, type VaultCipher } from './vault.js';

const directories: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'infinite-vault-test-'));
  directories.push(dir);
  return dir;
}

/** Deterministic stand-in for Electron's safeStorage so tests never need the binary. */
const testCipher: VaultCipher = {
  available: () => true,
  label: () => 'test-cipher',
  encrypt: (plaintext) => `enc(${plaintext})`,
  decrypt: (encoded) => {
    if (!encoded.startsWith('enc(') || !encoded.endsWith(')')) throw new Error('bad ciphertext');
    return encoded.slice(4, -1);
  },
};

afterEach(() => {
  for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('worker credential vault', () => {
  it('stores secrets encrypted and never hands them to a view', () => {
    const dir = tempDir();
    const vault = new CredentialVault({ dataDir: dir, cipher: testCipher });

    const view = vault.add({ label: 'Acme portal', username: 'me@example.com', secret: 'hunter2' });
    expect(view).not.toHaveProperty('secret');
    expect(JSON.stringify(view)).not.toContain('hunter2');
    expect(vault.available()).toBe(true);
    expect(vault.cipherLabel()).toBe('test-cipher');

    const onDisk = readFileSync(join(dir, 'vault.json'), 'utf8');
    expect(onDisk).toContain('enc(hunter2)');
    expect(onDisk).not.toContain('"hunter2"');
  });

  it('only resolves a secret for a worker the user authorized', () => {
    const dir = tempDir();
    const vault = new CredentialVault({ dataDir: dir, cipher: testCipher });
    const entry = vault.add({ label: 'Acme portal', secret: 'hunter2' });

    expect(() => vault.resolveSecret(entry.id, 'worker-allowed')).toThrow(/not authorized/);
    expect(vault.list('worker-allowed')).toEqual([]);

    vault.authorize(entry.id, ['worker-allowed']);
    expect(vault.list('worker-allowed').map((item) => item.label)).toEqual(['Acme portal']);
    const resolved = vault.resolveSecret(entry.id, 'worker-allowed');
    expect(resolved.secret).toBe('hunter2');

    // Revoking takes effect immediately, without rewriting the ciphertext.
    vault.authorize(entry.id, []);
    expect(() => vault.resolveSecret(entry.id, 'worker-allowed')).toThrow(/not authorized/);
    expect(vault.list('worker-allowed')).toEqual([]);
    expect(vault.list()).toHaveLength(1);
  });

  it('rejects duplicates, empty secrets and unauthorized reads', () => {
    const vault = new CredentialVault({ dataDir: tempDir(), cipher: testCipher });
    vault.add({ label: 'Acme', secret: 'one' });
    expect(() => vault.add({ label: 'acme', secret: 'two' })).toThrow(/already exists/);
    expect(() => vault.add({ label: 'NoSecret', secret: '  ' })).toThrow(/password or token/);
    expect(() => vault.add({ label: '', secret: 'x' })).toThrow(/label is required/);
    expect(() => vault.resolveSecret('missing', 'worker-1')).toThrow(/not authorized|not found/);
  });

  it('refuses to store anything when secure storage is unavailable', () => {
    const vault = new CredentialVault({ dataDir: tempDir(), cipher: { ...testCipher, available: () => false } });
    expect(vault.available()).toBe(false);
    expect(vault.cipherLabel()).toBe('Unavailable');
    expect(() => vault.add({ label: 'Acme', secret: 'hunter2' })).toThrow(/not available/);
  });

  it('survives a reload and keeps the allow-list', () => {
    const dir = tempDir();
    const first = new CredentialVault({ dataDir: dir, cipher: testCipher });
    const entry = first.add({ label: 'Acme', secret: 'hunter2', workerIds: ['worker-a'] });

    const reloaded = new CredentialVault({ dataDir: dir, cipher: testCipher });
    expect(reloaded.list('worker-a').map((item) => item.id)).toEqual([entry.id]);
    expect(reloaded.resolveSecret(entry.id, 'worker-a').secret).toBe('hunter2');
    expect(() => reloaded.resolveSecret(entry.id, 'worker-b')).toThrow(/not authorized/);
  });

  it('deletes an entry for good', () => {
    const vault = new CredentialVault({ dataDir: tempDir(), cipher: testCipher });
    const entry = vault.add({ label: 'Acme', secret: 'hunter2' });
    expect(vault.remove(entry.id)).toBe(true);
    expect(vault.remove(entry.id)).toBe(false);
    expect(vault.list()).toEqual([]);
    expect(() => vault.resolveSecret(entry.id, 'worker-a')).toThrow();
  });
});
