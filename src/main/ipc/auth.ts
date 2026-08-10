import { ipcMain } from 'electron';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { IPC } from '../../shared/ipc.js';

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
    return { ok: true };
  });
}
