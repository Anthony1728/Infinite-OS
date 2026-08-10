import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { write } from './write.js';
import { read } from './read.js';
import { edit } from './edit.js';
import { fileOpsTool } from './file-ops.js';

const roots: string[] = [];

async function workspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'infinite-os-test-'));
  roots.push(root);
  return root;
}

function context(cwd: string) {
  return { cwd, sessionId: 'integration-test', abortSignal: new AbortController().signal, onUpdate: () => undefined };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('filesystem tools', () => {
  it('writes, reads, and edits a project file', async () => {
    const cwd = await workspace();
    const ctx = context(cwd);
    expect((await write.execute({ file_path: 'src/example.txt', content: 'hello world' }, ctx)).is_error).not.toBe(true);
    const initial = await read.execute({ file_path: 'src/example.txt' }, ctx);
    expect(initial.content).toContain('hello world');
    expect((await edit.execute({ file_path: 'src/example.txt', old_string: 'world', new_string: 'Infinite OS' }, ctx)).is_error).not.toBe(true);
    expect(await readFile(join(cwd, 'src', 'example.txt'), 'utf8')).toBe('hello Infinite OS');
  });

  it('creates, copies, lists, and moves without overwriting', async () => {
    const cwd = await workspace();
    const ctx = context(cwd);
    await write.execute({ file_path: 'source.txt', content: 'verified' }, ctx);
    expect((await fileOpsTool.execute({ action: 'mkdir', path: 'archive' }, ctx)).is_error).not.toBe(true);
    expect((await fileOpsTool.execute({ action: 'copy', path: 'source.txt', destination: 'archive/copy.txt' }, ctx)).is_error).not.toBe(true);
    const duplicate = await fileOpsTool.execute({ action: 'copy', path: 'source.txt', destination: 'archive/copy.txt' }, ctx);
    expect(duplicate.is_error).toBe(true);
    const listing = await fileOpsTool.execute({ action: 'list', path: 'archive' }, ctx);
    expect(listing.content).toContain('copy.txt');
    expect((await fileOpsTool.execute({ action: 'move', path: 'archive/copy.txt', destination: 'moved.txt' }, ctx)).is_error).not.toBe(true);
    expect(await readFile(join(cwd, 'moved.txt'), 'utf8')).toBe('verified');
  });
});
