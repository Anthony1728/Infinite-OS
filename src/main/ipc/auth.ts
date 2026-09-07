import { ipcMain, app } from 'electron';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { IPC } from '../../shared/ipc.js';
import { adoptProfileData, getActiveUid, setActiveUid } from '../profiles/home.js';

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

export function registerAuthIpc(): void {
  ipcMain.handle(IPC.AUTH_GET_USERS, async () => readJson<Record<string, unknown>>(authPath, {}));
  ipcMain.handle(IPC.AUTH_SET_USERS, async (_event, users: unknown) => {
    if (!users || typeof users !== 'object' || Array.isArray(users)) throw new Error('Invalid user store');
    await writeJson(authPath, users);
    return { ok: true };
  });
  ipcMain.handle(IPC.AUTH_GET_SESSION, async () => readJson<unknown>(sessionPath, null));
  ipcMain.handle(IPC.AUTH_SET_SESSION, async (_event, session: unknown) => {
    await writeJson(sessionPath, session);
    // Netflix-style switch: a different account (or logout) re-homes all
    // user data. Main caches the home + holds open DBs, so relaunch —
    // every store then re-resolves under the new profile from boot.
    const email = (session as { user?: { email?: unknown } } | null)?.user?.email;
    const uid = typeof email === 'string' && email ? email.toLowerCase() : null;
    if (uid !== getActiveUid()) {
      if (uid) {
        adoptProfileData(join(homedir(), '.infinite-ai'), uid);
        setActiveUid(uid);
      } else {
        setActiveUid(null);
      }
      setImmediate(() => {
        try {
          app.relaunch();
          app.exit(0);
        } catch {
          /* relaunch best-effort */
        }
      });
    }
    return { ok: true };
  });
  // Password-free roster for the "Who's using Infinite OS?" picker.
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
