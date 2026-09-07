import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { clearAllSessions, importSession } from './store.js';

const createdDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(createdDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('clearAllSessions', () => {
  it('deletes every transcript while preserving unrelated files', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'infinite-os-session-test-'));
    createdDirectories.push(directory);
    await Promise.all([
      writeFile(join(directory, 'first.jsonl'), '{"type":"meta"}\n'),
      writeFile(join(directory, 'second.jsonl'), '{"type":"meta"}\n'),
      writeFile(join(directory, 'keep.txt'), 'not a session'),
    ]);

    await expect(clearAllSessions(directory)).resolves.toBe(2);
    await expect(readFile(join(directory, 'keep.txt'), 'utf8')).resolves.toBe('not a session');
  });

  it('is idempotent for an empty or missing session directory', async () => {
    const root = await mkdtemp(join(tmpdir(), 'infinite-os-session-test-'));
    createdDirectories.push(root);
    const directory = join(root, 'missing');

    await expect(clearAllSessions(directory)).resolves.toBe(0);
    await expect(clearAllSessions(directory)).resolves.toBe(0);
  });
});

describe('importSession validation', () => {
  const base = { cwd: '.', model: 'qwen3:4b', provider: 'ollama' };
  it('rejects empty content', async () => {
    await expect(importSession({ ...base, format: 'json', content: '   ' })).rejects.toThrow('empty');
  });
  it('rejects malformed JSON', async () => {
    await expect(importSession({ ...base, format: 'json', content: '{nope' })).rejects.toThrow('Invalid JSON');
  });
  it('rejects JSON without a messages array', async () => {
    await expect(importSession({ ...base, format: 'json', content: '{"session":{}}' })).rejects.toThrow('messages array');
  });
  it('rejects JSON with no importable text turns', async () => {
    const content = JSON.stringify({ session: { title: 'x' }, messages: [{ role: 'user', content: [] }] });
    await expect(importSession({ ...base, format: 'json', content })).rejects.toThrow('No importable messages');
  });
  it('rejects oversized payloads', async () => {
    await expect(importSession({ ...base, format: 'markdown', content: 'x'.repeat(500_001) })).rejects.toThrow('too large');
  });
});
