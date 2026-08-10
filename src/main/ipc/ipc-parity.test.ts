import { describe, expect, it } from 'vitest';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

const root = process.cwd();

describe('renderer/main IPC parity', () => {
  it('registers a main-process handler for every IPC constant invoked by preload', async () => {
    const preload = await readFile(join(root, 'src', 'preload', 'index.ts'), 'utf8');
    const mainSources = await readTypeScript(join(root, 'src', 'main'));
    const invoked = matches(preload, /ipcRenderer\.invoke\(\s*IPC\.([A-Z0-9_]+)/g);
    const handled = matches(mainSources, /ipcMain\.handle\(\s*IPC\.([A-Z0-9_]+)/g);
    const missing = [...invoked].filter((channel) => !handled.has(channel)).sort();
    expect(missing, `Preload invokes channels with no main handler: ${missing.join(', ')}`).toEqual([]);
  });

  it('registers raw-string preload channels as well as shared constants', async () => {
    const preload = await readFile(join(root, 'src', 'preload', 'index.ts'), 'utf8');
    const mainSources = await readTypeScript(join(root, 'src', 'main'));
    const invoked = matches(preload, /ipcRenderer\.invoke\(\s*['"]([^'"]+)/g);
    const handled = matches(mainSources, /ipcMain\.handle\(\s*['"]([^'"]+)/g);
    const missing = [...invoked].filter((channel) => !handled.has(channel)).sort();
    expect(missing, `Preload invokes raw channels with no main handler: ${missing.join(', ')}`).toEqual([]);
  });
});

function matches(source: string, pattern: RegExp): Set<string> {
  return new Set([...source.matchAll(pattern)].map((match) => match[1]));
}

async function readTypeScript(directory: string): Promise<string> {
  const entries = await readdir(directory, { withFileTypes: true });
  const content = await Promise.all(entries.map(async (entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return readTypeScript(path);
    return entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')
      ? readFile(path, 'utf8')
      : '';
  }));
  return content.join('\n');
}
