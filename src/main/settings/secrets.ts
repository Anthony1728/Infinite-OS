// Secrets store — API keys encrypted with Electron's safeStorage and persisted to disk.
//
// Resilience note: safeStorage on Windows wraps keys with the current user's
// DPAPI credentials. When the app is launched from a different security context
// (elevated process, another account sharing the profile, credential rotation)
// the encrypted blob written earlier cannot be decrypted and the key would
// silently look "missing" every launch. A legacy plaintext mirror could bridge
// that gap; today it is only ever a TRANSIENT recovery path — a mirror written
// by an old build (or on a platform with no encrypted storage at all) is
// re-encrypted under the current context and deleted the moment a working
// context reads it. Plaintext keys stop existing at the first opportunity.

import { safeStorage } from 'electron';
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { infiniteHome } from '../profiles/home.js';

const DIR = infiniteHome();
const FILE = join(DIR, 'secrets.bin');
const PLAINTEXT_FILE = join(DIR, 'secrets.plain.json');

let cache: Record<string, string> = {};
let loadPromise: Promise<void> | null = null;
let saveQueue: Promise<void> = Promise.resolve();

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
      console.warn(`[secrets] Used plaintext mirror (${Object.keys(cache).length} keys).`);
      // The mirror is a last-resort bridge for machines where safeStorage is
      // genuinely unavailable — never a permanent second store. When THIS
      // context can encrypt (typical after a context switch broke the old
      // DPAPI blob), re-persist encrypted right now and delete the plaintext
      // copy so it stops existing.
      if (safeStorage.isEncryptionAvailable()) {
        try {
          await save();
          await rm(PLAINTEXT_FILE, { force: true });
          console.log('[secrets] Re-encrypted under the current context; plaintext mirror removed.');
        } catch (e) {
          console.error('[secrets] Re-encryption after mirror recovery failed; mirror kept:', e);
        }
      }
      return;
    } catch (e) {
      console.error('[secrets] No usable plaintext mirror either; starting with empty cache:', e);
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
        console.error('[secrets] safeStorage roundtrip failed; the key is saved in memory only for this session:', e);
      }
    }
    // Plaintext on disk is written ONLY when the platform has no encrypted
    // storage at all (rare; DPAPI is always present on Windows). An encrypted
    // write that failed its read-back verification surfaces an error instead
    // of quietly duplicating the keys as plaintext.
    if (!encrypted) {
      await writeFile(PLAINTEXT_FILE, json, 'utf8');
      console.warn('[secrets] safeStorage unavailable — writing plaintext store.');
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
