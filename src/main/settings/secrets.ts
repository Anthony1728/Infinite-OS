// Secrets store — API keys encrypted with Electron's safeStorage and persisted to disk.

import { safeStorage } from 'electron';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const FILE = join(homedir(), '.infinite-ai', 'secrets.bin');

let cache: Record<string, string> = {};
let loadPromise: Promise<void> | null = null;

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
    } catch (e) {
      console.error('[secrets] Failed to load secrets:', e);
      cache = {};
    }
  })();
  
  return loadPromise;
}

async function save(): Promise<void> {
  await mkdir(join(homedir(), '.infinite-ai'), { recursive: true });
  const json = JSON.stringify(cache);
  const buf = safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(json) : Buffer.from(json, 'utf8');
  await writeFile(FILE, buf);
  console.log(`[secrets] Saved ${Object.keys(cache).length} keys: ${Object.keys(cache).join(', ') || 'none'}`);
}

export async function getApiKey(provider: string): Promise<string> {
  await load();
  const key = cache[provider] ?? '';
  console.log(`[secrets] getApiKey(${provider}) = ${key ? key.slice(0, 8) + '...' : 'EMPTY'}`);
  return key;
}

export async function setApiKey(provider: string, key: string): Promise<void> {
  await load();
  cache[provider] = key;
  await save();
}

export async function hasApiKey(provider: string): Promise<boolean> {
  await load();
  const has = Boolean(cache[provider]);
  console.log(`[secrets] hasApiKey(${provider}) = ${has}, all keys: ${Object.keys(cache).join(', ') || 'none'}`);
  return has;
}

