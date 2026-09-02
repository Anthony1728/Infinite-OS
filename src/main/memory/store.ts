import Database from 'better-sqlite3';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';

export interface MemoryEntry {
  id: string;
  type: 'preference' | 'project' | 'document' | 'chat' | 'note';
  title: string;
  content: string;
  tags: string[];
  sessionId?: string;
  createdAt: number;
  updatedAt: number;
}

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (db) return db;

  const configDir = join(homedir(), '.infinite-ai');
  mkdirSync(configDir, { recursive: true });

  db = new Database(join(configDir, 'memory.db'));
  db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS memories (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL DEFAULT 'note',
      title TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      tags TEXT NOT NULL DEFAULT '[]',
      session_id TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE INDEX IF NOT EXISTS idx_memories_type ON memories(type);
    CREATE INDEX IF NOT EXISTS idx_memories_session ON memories(session_id);
  `);

  return db;
}

export function createMemory(entry: Omit<MemoryEntry, 'id' | 'createdAt' | 'updatedAt'>): MemoryEntry {
  const d = getDb();
  const id = `mem-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const now = Date.now();

  d.prepare(`
    INSERT INTO memories (id, type, title, content, tags, session_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, entry.type, entry.title, entry.content, JSON.stringify(entry.tags), entry.sessionId ?? null, now, now);

  return getMemory(id)!;
}

export function getMemory(id: string): MemoryEntry | null {
  const d = getDb();
  const row = d.prepare('SELECT * FROM memories WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  if (!row) return null;

  return {
    id: row.id as string,
    type: row.type as MemoryEntry['type'],
    title: row.title as string,
    content: row.content as string,
    tags: JSON.parse(row.tags as string),
    sessionId: row.session_id as string | undefined,
    createdAt: row.created_at as number,
    updatedAt: row.updated_at as number,
  };
}

export function listMemories(type?: string, search?: string): MemoryEntry[] {
  const d = getDb();
  let query = 'SELECT * FROM memories';
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (type && type !== 'all') {
    conditions.push('type = ?');
    params.push(type);
  }
  if (search) {
    conditions.push('(title LIKE ? OR content LIKE ?)');
    params.push(`%${search}%`, `%${search}%`);
  }

  if (conditions.length > 0) {
    query += ' WHERE ' + conditions.join(' AND ');
  }
  query += ' ORDER BY updated_at DESC';

  const rows = d.prepare(query).all(...params) as Record<string, unknown>[];

  return rows.map((row) => ({
    id: row.id as string,
    type: row.type as MemoryEntry['type'],
    title: row.title as string,
    content: row.content as string,
    tags: JSON.parse(row.tags as string),
    sessionId: row.session_id as string | undefined,
    createdAt: row.created_at as number,
    updatedAt: row.updated_at as number,
  }));
}

export function updateMemory(id: string, updates: Partial<Omit<MemoryEntry, 'id' | 'createdAt'>>): MemoryEntry | null {
  const d = getDb();
  const existing = getMemory(id);
  if (!existing) return null;

  const now = Date.now();
  const fields: string[] = [];
  const values: unknown[] = [];

  if (updates.type !== undefined) { fields.push('type = ?'); values.push(updates.type); }
  if (updates.title !== undefined) { fields.push('title = ?'); values.push(updates.title); }
  if (updates.content !== undefined) { fields.push('content = ?'); values.push(updates.content); }
  if (updates.tags !== undefined) { fields.push('tags = ?'); values.push(JSON.stringify(updates.tags)); }
  if (updates.sessionId !== undefined) { fields.push('session_id = ?'); values.push(updates.sessionId); }

  fields.push('updated_at = ?');
  values.push(now);
  values.push(id);

  d.prepare(`UPDATE memories SET ${fields.join(', ')} WHERE id = ?`).run(...values);

  return getMemory(id);
}

export function deleteMemory(id: string): boolean {
  const d = getDb();
  const result = d.prepare('DELETE FROM memories WHERE id = ?').run(id);
  return result.changes > 0;
}

export function searchMemories(query: string): MemoryEntry[] {
  return listMemories(undefined, query);
}

export function getMemoryStats(): { total: number; byType: Record<string, number> } {
  const d = getDb();
  const total = (d.prepare('SELECT COUNT(*) as count').get() as { count: number }).count;
  const rows = d.prepare('SELECT type, COUNT(*) as count FROM memories GROUP BY type').all() as { type: string; count: number }[];
  const byType = Object.fromEntries(rows.map((r) => [r.type, r.count]));
  return { total, byType };
}

