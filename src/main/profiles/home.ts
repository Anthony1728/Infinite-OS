/**
 * Profile home — Netflix-style account isolation for Infinite OS.
 *
 * Every user-data store resolves its directory through infiniteHome():
 * - no active profile  → ~/.infinite-ai            (legacy single-user path)
 * - active profile uid → ~/.infinite-ai/profiles/<uid>
 *
 * Profile switches always relaunch the app, so this value is read once and
 * cached for the process lifetime — no store can ever straddle two profiles.
 * Machine-global files (auth registry, logs, browser caches, staged updates)
 * keep using homedir() directly and are never namespaced.
 */

import { readFileSync, existsSync, mkdirSync, renameSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

export const PROFILES_DIR_NAME = 'profiles';
export const ACTIVE_PROFILE_FILE = 'active-profile.json';

let cached: string | null = null;

function sanitizeUid(uid: string): string {
  const clean = uid.replace(/[^a-zA-Z0-9-_]/g, '').slice(0, 64);
  if (!clean) throw new Error('Invalid profile id');
  return clean;
}

/** Test hook — point the profile home at a temp dir. */
export function infiniteHome(): string {
  // The test override wins on EVERY call and is checked before the cache —
  // otherwise a module-scope caller (e.g. session/store.ts resolving DIR at
  // import time) pins the real profile first and silently defeats every
  // test's temp home, writing test artifacts into the user's real data.
  const testOverride = process.env.INFINITE_TEST_HOME;
  if (testOverride) {
    cached = testOverride;
    return cached;
  }
  if (cached) return cached;
  const base = join(homedir(), '.infinite-ai');
  try {
    const raw = readFileSync(join(base, ACTIVE_PROFILE_FILE), 'utf8');
    const uid = (JSON.parse(raw) as { uid?: unknown }).uid;
    cached = typeof uid === 'string' && uid ? join(base, PROFILES_DIR_NAME, sanitizeUid(uid)) : base;
  } catch {
    cached = base;
  }
  return cached;
}

/** User-data directories adopted into a fresh profile on first activation. */
export const ADOPT_DIRS = [
  'sessions',
  'memory',
  'memory.db',
  'agents.db',
  'owner.db',
  'automations',
  'automation',
  'brain',
  'improvement',
  'monitor',
  'learning',
  'marketplace',
  'skills',
  'INFINITE.md',
  'checkpoints',
  'projects',
  'project',
  'pages',
  'business',
  'multi-agent',
  'workspaces',
  'ollama-brain',
  'replay',
  'computer',
  'cloud',
  'engine',
  'queues',
  'voice',
  'websites',
  'apps',
  'email.json',
  'settings.json',
  'knowledge-graph',
  'proactive',
  'scheduler',
  'api-connections',
  'credentials',
  'secrets.bin',
  'secrets.plain.json',
  'callcenter',
  'teams',
  'plugins',
  'github',
  'index',
  'personalization',
];

/** Global files that must never move into a profile. */
export const ADOPT_DENY = new Set([
  'auth.json',
  'auth.json.bak',
  'auth-session.json',
  'active-profile.json',
  'profiles',
  'logs',
  'browser',
  'chrome-background-profile',
  'chrome-operator-profile',
  'operator-screenshots',
  'screenshots',
  '.screenshots-trash',
  'extensions',
  'staged-update',
  'staged-update.json',
  'bridge-token',
  'remote-token',
  'heartbeat.json',
  'history.jsonl',
  'elev-test.bin',
  'secrets-test.bin',
  'skills-nvidia-backup-20260812215538',
]);

export function isAdoptable(name: string): boolean {
  if (ADOPT_DENY.has(name)) return false;
  if (name.startsWith('.')) return false;
  return ADOPT_DIRS.includes(name);
}

/** True when this profile directory already adopted its data. */
export function adoptMarkerPath(profileDir: string): string {
  return join(profileDir, '.adopted');
}

export function profileDirFor(base: string, uid: string): string {
  return join(base, PROFILES_DIR_NAME, sanitizeUid(uid));
}

/** Session payload → sanitized profile uid (null = logged out). Must match getActiveUid(). */
export function sessionUidFor(session: unknown): string | null {
  const email = (session as { user?: { email?: unknown } } | null)?.user?.email;
  return typeof email === 'string' && email ? sanitizeUid(email.toLowerCase()) : null;
}

/** Read the active profile id fresh from disk (no cache — used at switch time). */
export function getActiveUid(base: string = join(homedir(), '.infinite-ai')): string | null {
  try {
    const raw = readFileSync(join(base, ACTIVE_PROFILE_FILE), 'utf8');
    const uid = (JSON.parse(raw) as { uid?: unknown }).uid;
    return typeof uid === 'string' && uid ? sanitizeUid(uid) : null;
  } catch {
    return null;
  }
}

/** Persist the active profile id (null = logged out). Never touches the cache. */
export function setActiveUid(uid: string | null, base: string = join(homedir(), '.infinite-ai')): void {
  mkdirSync(base, { recursive: true });
  const path = join(base, ACTIVE_PROFILE_FILE);
  if (uid === null) {
    try {
      unlinkSync(path);
    } catch {
      /* already logged out */
    }
    return;
  }
  writeFileSync(path, JSON.stringify({ uid: sanitizeUid(uid) }), 'utf8');
}

/**
 * First-login adoption: move legacy top-level user data into the profile dir.
 * Never overwrites — entries already present in the profile are skipped.
 * Idempotent via the .adopted marker. Returns moved entry names.
 */
export function adoptProfileData(base: string, uid: string): string[] {
  const dir = profileDirFor(base, uid);
  mkdirSync(dir, { recursive: true });
  if (existsSync(adoptMarkerPath(dir))) return [];
  const moved: string[] = [];
  for (const name of ADOPT_DIRS) {
    if (!isAdoptable(name)) continue;
    const src = join(base, name);
    const dest = join(dir, name);
    try {
      if (!existsSync(src) || existsSync(dest)) continue;
      renameSync(src, dest);
      moved.push(name);
    } catch {
      /* best-effort per entry — a locked file must not block login */
    }
  }
  try {
    writeFileSync(adoptMarkerPath(dir), String(Date.now()), 'utf8');
  } catch {
    /* marker failure just means we re-scan next login */
  }
  return moved;
}

export { sanitizeUid };
