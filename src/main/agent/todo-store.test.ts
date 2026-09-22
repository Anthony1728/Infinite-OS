import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { vi } from 'vitest';

const dataDir = mkdtempSync(join(tmpdir(), 'infinite-todos-'));

vi.mock('../profiles/home.js', () => ({ infiniteHome: () => dataDir }));

import { getTodos, setTodos, clearTodos } from './todo-store.js';

describe('persistent todo store', () => {
  beforeEach(() => {
    clearTodos('sess-1');
  });

  it('round-trips items and persists to disk', () => {
    setTodos('sess-1', [
      { status: 'completed', content: 'inspect repo' },
      { status: 'in_progress', content: 'fix bug', activeForm: 'fixing the bug' },
      { status: 'pending', content: 'run tests' },
    ]);
    const items = getTodos('sess-1');
    expect(items).toHaveLength(3);
    expect(items.find((i) => i.content === 'fix bug')?.activeForm).toBe('fixing the bug');
    // Disk persistence: a fresh read (new Map) sees the same list.
    expect(existsSync(join(dataDir, 'todos', 'sess-1.json'))).toBe(true);
    const onDisk = JSON.parse(readFileSync(join(dataDir, 'todos', 'sess-1.json'), 'utf8')) as { todos: unknown[] };
    expect(onDisk.todos).toHaveLength(3);
  });

  it('filters invalid entries and normalizes status', () => {
    const items = setTodos('sess-1', [
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { status: 'bogus' as any, content: 'ok item' },
      { status: 'pending', content: '   ' },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      null as any,
    ]);
    expect(items).toHaveLength(1);
    expect(items[0].status).toBe('pending');
  });

  it('replaces the full list on each write', () => {
    setTodos('sess-1', [{ status: 'pending', content: 'a' }, { status: 'pending', content: 'b' }]);
    setTodos('sess-1', [{ status: 'completed', content: 'a' }]);
    expect(getTodos('sess-1')).toHaveLength(1);
    expect(getTodos('sess-1')[0].content).toBe('a');
  });

  it('clearTodos empties the list', () => {
    setTodos('sess-1', [{ status: 'pending', content: 'x' }]);
    clearTodos('sess-1');
    expect(getTodos('sess-1')).toHaveLength(0);
  });

  afterAll(() => {
    rmSync(dataDir, { recursive: true, force: true });
  });
});
