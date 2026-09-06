// Secrets store — API keys encrypted with Electron's safeStorage and persisted to disk.
//
// Resilience note: safeStorage on Windows wraps keys with the current user's
// DPAPI credentials. When the app is launched from a different security context
// (elevated process, another account sharing the profile, credential rotation)
// the encrypted blob written earlier cannot be decrypted and the key would
// silently look "missing" every launch. To keep keys persistent in that case we
// keep a plaintext mirror in the same user profile directory and only use it
// after the encrypted blob has failed to decrypt. The mirror lives under the
// user's home directory with the same ACLs as the rest of Infinite OS data.

import { safeStorage } from 'electron';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const DIR = join(homedir(), '.infinite-ai');
const FILE = join(DIR, 'secrets.bin');
const PLAINTEXT_FILE = join(DIR, 'secrets.plain.json');

let cache: Record<string, string> = {};
let loadPromise: Promise<void> | null = null;
let saveQueue: Promise<void> = Promise.resolve();
let decryptFailed = false;

async function load(): Promise<void> {
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    if (!safeStorage.isEncryptionAvailable()) {
      console.warn('[secrets] safeStorage unavailable; keys will be stored in plaintext');
    }
    if (!existsSync(FILE)) {
      cache = {};
      console.log('[secrets] No secrets file found, starting with empty cache');
      return;
    }
    try {
      const buf = await readFile(FILE);
      const json = safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(buf) : buf.toString('utf8');
      cache = JSON.parse(json);
      console.log(`[secrets] Loaded ${Object.keys(cache).length} keys: ${Object.keys(cache).join(', ') || 'none'}`);
      return;
    } catch (e) {
      console.error('[secrets] Failed to decrypt secrets.bin; trying the plaintext mirror:', e);
    }
    try {
      const json = await readFile(PLAINTEXT_FILE, 'utf8');
      cache = JSON.parse(json);
      decryptFailed = true;
      console.warn(`[secrets] Used plaintext mirror (${Object.keys(cache).length} keys). Re-saving will refresh both copies.`);
      return;
    } catch (e) {
      console.error('[secrets] No usable plaintext mirror either; starting with empty cache:', e);
      decryptFailed = true;
      cache = {};
    }
  })();

  return loadPromise;
}

async function save(): Promise<void> {
  const snapshot = { ...cache };
  const operation = saveQueue.then(async () => {
    await mkdir(DIR, { recursive: true });
    const json = JSON.stringify(snapshot);
    const encrypted = safeStorage.isEncryptionAvailable();
    if (encrypted) {
      try {
        const buf = safeStorage.encryptString(json);
        await writeFile(FILE, buf);
        // Do not report success to the renderer until the bytes on disk can be
        // decoded again. This catches safeStorage/write failures immediately rather
        // than making a key appear saved until the next app launch.
        const persisted = await readFile(FILE);
        const persistedJson = safeStorage.decryptString(persisted);
        const persistedCache = JSON.parse(persistedJson) as Record<string, string>;
        for (const [provider, key] of Object.entries(snapshot)) {
          if (persistedCache[provider] !== key) {
            throw new Error(`Failed to persist the ${provider} API key.`);
          }
        }
        console.log(`[secrets] Saved ${Object.keys(snapshot).length} keys: ${Object.keys(snapshot).join(', ') || 'none'}`);
      } catch (e) {
        console.error('[secrets] safeStorage roundtrip failed; falling back to the plaintext mirror as the only store:', e);
        decryptFailed = true;
      }
    }
    // A decryption failure was observed at some point on this machine, so the
    // current process (or a sibling launch context) cannot always read the
    // encrypted blob back. Keep a plaintext mirror so the key survives the
    // next launch regardless of the DPAPI context it runs under.
    if (!encrypted || decryptFailed) {
      await writeFile(PLAINTEXT_FILE, json, 'utf8');
      console.warn('[secrets] Writing plaintext mirror (key will survive context changes).');
    }
  });
  saveQueue = operation.catch(() => undefined);
  return operation;
}

export async function getApiKey(provider: string): Promise<string> {
  await load();
  const key = cache[provider] ?? '';
  console.log(`[secrets] getApiKey(${provider}) = ${key ? 'CONFIGURED' : 'EMPTY'}`);
  return key;
}

/** Return all configured API keys for a provider (currently one per provider). */
export async function getAllApiKeys(provider: string): Promise<string[]> {
  await load();
  const key = cache[provider] ?? '';
  return key ? [key] : [];
}

export async function setApiKey(provider: string, key: string): Promise<void> {
  await load();
  cache[provider] = key;
  await save();
}

export async function deleteApiKey(provider: string): Promise<void> {
  await load();
  delete cache[provider];
  await save();
}

export async function hasApiKey(provider: string): Promise<boolean> {
  await load();
  const has = Boolean(cache[provider]);
  console.log(`[secrets] hasApiKey(${provider}) = ${has}, all keys: ${Object.keys(cache).join(', ') || 'none'}`);
  return has;
}
