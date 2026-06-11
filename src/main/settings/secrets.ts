// Secrets store — API keys encrypted with Electron's safeStorage and persisted to disk.

import { safeStorage } from 'electron';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const FILE = join(homedir(), '.infinite-ai', 'secrets.bin');

let cache: Record<string, string> = {};
let loaded = false;

async function load(): Promise<void> {
  if (loaded) return;
  loaded = true;
  if (!safeStorage.isEncryptionAvailable()) {
    console.warn('[secrets] safeStorage unavailable; keys will be stored in plaintext');
  }
  if (!existsSync(FILE)) {
    cache = {};
    return;
  }
  try {
    const buf = await readFile(FILE);
    const json = safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(buf) : buf.toString('utf8');
    cache = JSON.parse(json);
  } catch {
    cache = {};
  }
}

async function save(): Promise<void> {
  await mkdir(join(homedir(), '.infinite-ai'), { recursive: true });
  const json = JSON.stringify(cache);
  const buf = safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(json) : Buffer.from(json, 'utf8');
  await writeFile(FILE, buf);
}

export async function getApiKey(provider: string): Promise<string> {
  await load();
  return cache[provider] ?? '';
}

export async function setApiKey(provider: string, key: string): Promise<void> {
  await load();
  cache[provider] = key;
  await save();
}

export async function hasApiKey(provider: string): Promise<boolean> {
  await load();
  return Boolean(cache[provider]);
}
