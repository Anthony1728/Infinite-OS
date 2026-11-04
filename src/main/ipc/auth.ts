import { ipcMain, app } from 'electron';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { IPC } from '../../shared/ipc.js';
import { adoptProfileData, getActiveUid, setActiveUid, sessionUidFor } from '../profiles/home.js';
import { getOwnerManager } from '../owner/manager.js';

const authPath = join(homedir(), '.infinite-ai', 'auth.json');
const sessionPath = join(homedir(), '.infinite-ai', 'auth-session.json');

async function readJson<T>(path: string, fallback: T): Promise<T> {
  if (!existsSync(path)) return fallback;
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T;
  } catch {
    return fallback;
  }
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify(value, null, 2), 'utf8');
  await rename(temporary, path);
}

/**
 * Tie the local owner record to the account that is actually signed in.
 *
 * Every installation starts with a generic owner and updates it on first
 * sign-in, so a new user never inherits the identity or elevated local
 * privileges of whoever built the app. Failures here must never block auth.
 */
function syncLocalOwner(session: unknown): void {
  const user = (session as { user?: { name?: unknown; email?: unknown } } | null)?.user;
  if (!user || typeof user.email !== 'string' || !user.email.trim()) return;
  const email = user.email.trim();
  const fullName = typeof user.name === 'string' ? user.name.trim() : '';
  try {
    const owner = getOwnerManager();
    const current = owner.getProfile();
    const preferredName = fullName ? fullName.split(/\s+/)[0] : current.preferredName;
    if (
      current.email.toLowerCase() === email.toLowerCase() &&
      (!fullName || current.fullName === fullName)
    ) {
      return;
    }
    owner.updateProfile({
      email,
      ...(fullName ? { fullName, preferredName } : {}),
    });
  } catch {
    /* owner store failure must never block sign-in */
  }
}

export function registerAuthIpc(): void {
  ipcMain.handle(IPC.AUTH_GET_USERS, async () => readJson<Record<string, unknown>>(authPath, {}));
  ipcMain.handle(IPC.AUTH_SET_USERS, async (_event, users: unknown) => {
    if (!users || typeof users !== 'object' || Array.isArray(users)) throw new Error('Invalid user store');
    await writeJson(authPath, users);
    return { ok: true };
  });
  ipcMain.handle(IPC.AUTH_GET_SESSION, async () => {
    const session = await readJson<unknown>(sessionPath, null);
    syncLocalOwner(session);
    return session;
  });
  ipcMain.handle(IPC.AUTH_SET_SESSION, async (_event, session: unknown) => {
    await writeJson(sessionPath, session);
    syncLocalOwner(session);
    // Profile switch: a different account (or logout) re-homes all
    // user data. Main caches the home + holds open DBs, so relaunch —
    // every store then re-resolves under the new profile from boot.
    // NOTE: compare SANITIZED uids — the session carries the raw email while
    // the pointer file stores sanitizeUid(email). Comparing raw-vs-stored
    // mismatches forever and would relaunch on every boot (black orphan
    // window in dev, where the relaunched electron has no vite server).
    const uid = sessionUidFor(session);
    if (uid !== getActiveUid()) {
      if (uid) {
        adoptProfileData(join(homedir(), '.infinite-ai'), uid);
        setActiveUid(uid);
      } else {
        setActiveUid(null);
      }
      // app.relaunch() under `npm run dev` spawns a bare electron with no
      // vite server — it paints black and squats the ports. Only relaunch
      // in packaged builds; in dev, ask for a manual restart instead.
      if (app.isPackaged) {
        setImmediate(() => {
          try {
            app.relaunch();
            app.exit(0);
          } catch {
            /* relaunch best-effort */
          }
        });
      } else {
        console.warn(`[profiles] Account changed in dev (session=${uid} active=${getActiveUid()}) — restart \`npm run dev\` to re-home.`);
      }
    }
    return { ok: true };
  });
  // Password-free roster for the "Who's using Infinite OS?" picker. The roster
  // carries only public profile data; opening a profile still requires the
  // account password (enforced in the renderer auth store).
  ipcMain.handle(IPC.AUTH_LIST_PROFILES, async () => {
    const users = await readJson<Record<string, { user?: { name?: string; email?: string; avatar?: string; lastLoginAt?: number } }>>(authPath, {});
    return Object.values(users)
      .map((entry) => ({
        name: entry.user?.name ?? 'User',
        email: entry.user?.email ?? '',
        avatar: entry.user?.avatar,
        lastLoginAt: entry.user?.lastLoginAt ?? 0,
      }))
      .filter((p) => p.email)
      .sort((a, b) => b.lastLoginAt - a.lastLoginAt);
  });
}
