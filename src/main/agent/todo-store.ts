// Persistent session todos — the checklist the agent plans with survives the
// whole session (like Claude Code's TodoWrite state): written per-session to
// disk under the Infinite OS home, readable back via TodoRead, and pushed to
// the renderer over the chat stream channel so the UI can render a live plan.

import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { infiniteHome } from '../profiles/home.js';
import { IPC } from '../../shared/ipc.js';

export interface TodoItem {
  status: 'pending' | 'in_progress' | 'completed';
  content: string;
  activeForm?: string;
}

type Emit = (channel: string, payload: unknown) => void;
let emit: Emit | null = null;

/** Wire the renderer sink once from the ipc module. */
export function setTodoEmitter(fn: Emit): void {
  emit = fn;
}

const stores = new Map<string, Map<string, TodoItem>>();

function storePath(sessionId: string): string {
  const dir = join(infiniteHome(), 'todos');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return join(dir, `${sessionId}.json`);
}

export function getTodos(sessionId: string): TodoItem[] {
  let store = stores.get(sessionId);
  if (!store) {
    store = new Map();
    try {
      const raw = readFileSync(storePath(sessionId), 'utf8');
      const parsed = JSON.parse(raw) as { todos?: TodoItem[] };
      for (const item of parsed.todos ?? []) store.set(item.content, item);
    } catch { /* no file yet */ }
    stores.set(sessionId, store);
  }
  return [...store.values()];
}

function save(sessionId: string): void {
  try {
    writeFileSync(storePath(sessionId), JSON.stringify({ todos: getTodos(sessionId) }, null, 2), 'utf8');
  } catch (e) {
    console.warn('[todos] persist failed:', (e as Error).message);
  }
}

/** Replace the session checklist; returns the resulting items. */
export function setTodos(sessionId: string, items: TodoItem[]): TodoItem[] {
  const store = new Map<string, TodoItem>();
  for (const item of items) {
    if (!item?.content?.trim()) continue;
    const status: TodoItem['status'] = item.status === 'completed' || item.status === 'in_progress' ? item.status : 'pending';
    store.set(item.content.trim(), { status, content: item.content.trim(), ...(item.activeForm ? { activeForm: item.activeForm } : {}) });
  }
  stores.set(sessionId, store);
  save(sessionId);
  emit?.(IPC.CHAT_STREAM_EVENT, { sessionId, type: 'todo_update', todos: [...store.values()] });
  return [...store.values()];
}

export function clearTodos(sessionId: string): void {
  stores.delete(sessionId);
  try {
    const path = storePath(sessionId);
    if (existsSync(path)) writeFileSync(path, JSON.stringify({ todos: [] }, null, 2), 'utf8');
  } catch { /* best effort */ }
}
