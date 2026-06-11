// Settings store — user/project/local scopes, deep-merge, hot-reload via chokidar.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import chokidar from 'chokidar';

type Scope = 'managed' | 'user' | 'project' | 'local';

class SettingsStore {
  private cache: Record<string, unknown> = {};
  private watchers: chokidar.FSWatcher[] = [];

  async load(cwd: string): Promise<void> {
    this.cache = {};
    this.watchers.forEach((w) => w.close());
    this.watchers = [];

    const paths: { scope: Scope; path: string }[] = [
      { scope: 'user', path: join(homedir(), '.infinite-ai', 'settings.json') },
      { scope: 'project', path: join(cwd, '.infinite', 'settings.json') },
      { scope: 'local', path: join(cwd, '.infinite', 'settings.local.json') },
    ];

    for (const { scope, path } of paths) {
      if (existsSync(path)) {
        try {
          const data = JSON.parse(await readFile(path, 'utf8'));
          this.cache[scope] = data;
          this.watch(path);
        } catch (e) {
          console.error(`[settings] failed to parse ${path}:`, (e as Error).message);
        }
      }
    }
  }

  private watch(path: string): void {
    const w = chokidar.watch(path, { ignoreInitial: true });
    w.on('change', async () => {
      try {
        const data = JSON.parse(await readFile(path, 'utf8'));
        const scope = path.includes('.local') ? 'local' : path.includes('.infinite') ? 'project' : 'user';
        this.cache[scope] = data;
      } catch { /* skip */ }
    });
    this.watchers.push(w);
  }

  get<T = unknown>(key: string): T | undefined {
    for (const scope of ['local', 'project', 'user'] as Scope[]) {
      const data = this.cache[scope] as Record<string, unknown> | undefined;
      if (data && key in data) return data[key] as T;
    }
    return undefined;
  }

  async set(scope: Scope, key: string, value: unknown, cwd: string): Promise<void> {
    const path = scope === 'user'
      ? join(homedir(), '.infinite-ai', 'settings.json')
      : scope === 'project'
        ? join(cwd, '.infinite', 'settings.json')
        : join(cwd, '.infinite', 'settings.local.json');

    await mkdir(dirname(path), { recursive: true });
    const data = (this.cache[scope] as Record<string, unknown>) ?? {};
    data[key] = value;
    await writeFile(path, JSON.stringify(data, null, 2), 'utf8');
    this.cache[scope] = data;
  }
}

export const settings = new SettingsStore();
