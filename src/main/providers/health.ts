// Provider auth health — persistent memory of rejected logins.
//
// The in-memory quarantines (failover unhealthyUntil, opencode's credential
// flag) die with the process, so every app restart re-burns a minute grinding
// through free providers whose CLI logins are expired. This file remembers a
// rejected login across restarts (10-minute TTL) so dead providers fail fast
// from the first turn. Repaired logins clear it: Settings test success,
// a successful turn, or explicit re-setup.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { infiniteHome } from '../profiles/home.js';

const TTL_MS = 5 * 60_000;
let cache: Record<string, number> | null = null;

function filePath(): string {
  return join(infiniteHome(), 'provider-health.json');
}

function load(): Record<string, number> {
  if (cache) return cache;
  try {
    if (existsSync(filePath())) {
      const data = JSON.parse(readFileSync(filePath(), 'utf8')) as Record<string, unknown>;
      cache = {};
      for (const [key, value] of Object.entries(data)) {
        if (typeof value === 'number' && Number.isFinite(value)) cache[key] = value;
      }
      return cache;
    }
  } catch { /* start empty on corrupt file */ }
  cache = {};
  return cache;
}

function save(): void {
  try {
    mkdirSync(infiniteHome(), { recursive: true });
    writeFileSync(filePath(), JSON.stringify(cache ?? {}));
  } catch { /* health memory is best-effort */ }
}

/** Test seam: forget all persisted state. */
export function resetProviderAuthHealth(): void {
  cache = null;
}

export function noteProviderAuthFailure(providerId: string, nowMs = Date.now()): void {
  const store = load();
  store[providerId] = nowMs;
  save();
}

export function clearProviderAuthFailure(providerId: string): void {
  const store = load();
  if (store[providerId] !== undefined) {
    delete store[providerId];
    save();
  }
}

export function isProviderAuthKnownBad(providerId: string, nowMs = Date.now(), ttlMs = TTL_MS): boolean {
  const at = load()[providerId] ?? 0;
  return at > 0 && nowMs - at < ttlMs;
}
