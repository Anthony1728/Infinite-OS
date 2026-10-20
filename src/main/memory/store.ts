import Database from 'better-sqlite3';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { infiniteHome } from '../profiles/home';
import { normalizeTier, tierForType, scoreMemory, toMs, VALID_TIERS, type MemoryTier } from './tiers.js';

export type { MemoryTier };

export interface MemoryEntry {
  id: string;
  type: 'preference' | 'project' | 'document' | 'chat' | 'note';
  title: string;
  content: string;
  tags: string[];
  sessionId?: string;
  /** Cognee-style namespace. Keeps unrelated memories out of recall. */
  dataset: string;
  createdAt: number;
  updatedAt: number;
  /** Stratified-memory tier (AIOS pattern): episodic = session events that decay,
   * semantic = durable facts/preferences, procedural = reusable how-tos. */
  tier: MemoryTier;
  importance: number;
  accessCount: number;
  lastAccessed: number;
}

let db: Database.Database | null = null;

/** Close the handle (shutdown/tests). Next getDb() reopens. */
export function closeDatabase(): void {
  try {
    db?.close();
  } catch { /* already closed */ }
  db = null;
}

export function getDb(): Database.Database {
  if (db) return db;

  const configDir = infiniteHome();
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
      dataset TEXT NOT NULL DEFAULT 'default',
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE INDEX IF NOT EXISTS idx_memories_type ON memories(type);
    CREATE INDEX IF NOT EXISTS idx_memories_session ON memories(session_id);
  `);

  // Stratified-memory migration (additive, idempotent): tier + recall signals.
  const columns = new Set(
    (db.prepare(`PRAGMA table_info(memories)`).all() as Array<{ name: string }>).map((c) => c.name),
  );
  if (!columns.has('tier')) db.exec(`ALTER TABLE memories ADD COLUMN tier TEXT NOT NULL DEFAULT 'semantic'`);
  if (!columns.has('dataset')) db.exec(`ALTER TABLE memories ADD COLUMN dataset TEXT NOT NULL DEFAULT 'default'`);
  if (!columns.has('importance')) db.exec(`ALTER TABLE memories ADD COLUMN importance REAL NOT NULL DEFAULT 0.5`);
  if (!columns.has('access_count')) db.exec(`ALTER TABLE memories ADD COLUMN access_count INTEGER NOT NULL DEFAULT 0`);
  if (!columns.has('last_accessed')) db.exec(`ALTER TABLE memories ADD COLUMN last_accessed INTEGER NOT NULL DEFAULT 0`); // SQLite forbids non-constant ALTER defaults; toMs() falls back to updated_at when reading.
  // Backfill pre-tier rows: chats are episodic events, everything else is semantic.
  // The importance/access guard keeps user-promoted rows untouched.
  db.exec(`UPDATE memories SET tier = 'episodic' WHERE type = 'chat' AND tier = 'semantic' AND importance = 0.5 AND access_count = 0`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_memories_tier ON memories(tier)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_memories_dataset ON memories(dataset)`);

  return db;
}

function mapRow(row: Record<string, unknown>): MemoryEntry {
  const updatedAt = toMs(row.updated_at, Date.now());
  return {
    id: row.id as string,
    type: row.type as MemoryEntry['type'],
    title: row.title as string,
    content: row.content as string,
    tags: JSON.parse((row.tags as string) || '[]'),
    sessionId: (row.session_id as string | null) ?? undefined,
    dataset: typeof row.dataset === 'string' && row.dataset ? row.dataset : 'default',
    createdAt: toMs(row.created_at, updatedAt),
    updatedAt,
    tier: normalizeTier(row.tier),
    importance: typeof row.importance === 'number' ? row.importance : 0.5,
    accessCount: typeof row.access_count === 'number' ? row.access_count : 0,
    lastAccessed: toMs(row.last_accessed, updatedAt),
  };
}

export interface NewMemory {
  type: MemoryEntry['type'];
  title: string;
  content: string;
  tags: string[];
  sessionId?: string;
  dataset?: string;
  tier?: MemoryTier;
  importance?: number;
}

/** Trim to a safe, path-free namespace label. */
export function normalizeDataset(dataset?: string): string {
  const value = (dataset ?? '').trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return value.slice(0, 64) || 'default';
}

export function createMemory(entry: NewMemory): MemoryEntry {
  const d = getDb();
  const id = `mem-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const now = Date.now();
  const tier = normalizeTier(entry.tier ?? tierForType(entry.type));
  const importance = Math.max(0, Math.min(1, typeof entry.importance === 'number' ? entry.importance : 0.5));
  const dataset = normalizeDataset(entry.dataset);

  d.prepare(`
    INSERT INTO memories (id, type, title, content, tags, session_id, dataset, created_at, updated_at, tier, importance, access_count, last_accessed)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
  `).run(id, entry.type, entry.title, entry.content, JSON.stringify(entry.tags), entry.sessionId ?? null, dataset, now, now, tier, importance, now);

  return getMemory(id)!;
}

export function getMemory(id: string): MemoryEntry | null {
  const d = getDb();
  const row = d.prepare('SELECT * FROM memories WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  if (!row) return null;
  return mapRow(row);
}

export function listMemories(type?: string, search?: string, dataset?: string): MemoryEntry[] {
  const d = getDb();
  let query = 'SELECT * FROM memories';
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (type && type !== 'all') {
    conditions.push('type = ?');
    params.push(type);
  }
  if (dataset) {
    conditions.push('dataset = ?');
    params.push(normalizeDataset(dataset));
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

  return rows.map(mapRow);
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
  if (updates.dataset !== undefined) { fields.push('dataset = ?'); values.push(normalizeDataset(updates.dataset)); }
  if ((updates as { tier?: unknown }).tier !== undefined) { fields.push('tier = ?'); values.push(normalizeTier((updates as { tier?: unknown }).tier)); }
  if (typeof (updates as { importance?: unknown }).importance === 'number') {
    fields.push('importance = ?');
    values.push(Math.max(0, Math.min(1, (updates as { importance: number }).importance)));
  }

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

export function searchMemories(query: string, dataset?: string): MemoryEntry[] {
  return listMemories(undefined, query, dataset);
}

export function getMemoryStats(dataset?: string): { total: number; byType: Record<string, number>; byTier: Record<string, number>; datasets: number } {
  const d = getDb();
  const where = dataset ? ' WHERE dataset = ?' : '';
  const params = dataset ? [normalizeDataset(dataset)] : [];
  const total = (d.prepare(`SELECT COUNT(*) as count FROM memories${where}`).get(...params) as { count: number }).count;
  const rows = d.prepare(`SELECT type, COUNT(*) as count FROM memories${where} GROUP BY type`).all(...params) as { type: string; count: number }[];
  const byType = Object.fromEntries(rows.map((r) => [r.type, r.count]));
  const tierRows = d.prepare(`SELECT tier, COUNT(*) as count FROM memories${where} GROUP BY tier`).all(...params) as { tier: string; count: number }[];
  const byTier = Object.fromEntries(tierRows.map((r) => [r.tier, r.count]));
  const datasets = (d.prepare('SELECT COUNT(DISTINCT dataset) as count FROM memories').get() as { count: number }).count;
  return { total, byType, byTier, datasets };
}

function touchAccess(ids: string[]): void {
  if (ids.length === 0) return;
  const d = getDb();
  const now = Date.now();
  const placeholders = ids.map(() => '?').join(',');
  d.prepare(`UPDATE memories SET access_count = access_count + 1, last_accessed = ? WHERE id IN (${placeholders})`).run(now, ...ids);
}

/**
 * Tier-aware recall: LIKE-matches candidates, then ranks by importance,
 * recency (30-day half-life), and prior usefulness (access log). Semantic and
 * procedural memories outrank stale episodic ones at equal match quality.
 * Every returned memory counts as a use (tunes future ranking).
 */
export function recallMemories(query: string, opts?: { tiers?: MemoryTier[]; limit?: number; dataset?: string }): MemoryEntry[] {
  const d = getDb();
  const tiers = (opts?.tiers ?? []).filter((t) => VALID_TIERS.includes(t));
  const limit = Math.max(1, Math.min(50, opts?.limit ?? 10));
  const conditions: string[] = ['(title LIKE ? OR content LIKE ? OR tags LIKE ?)'];
  const params: unknown[] = [`%${query}%`, `%${query}%`, `%${query}%`];
  if (opts?.dataset) {
    conditions.push('dataset = ?');
    params.push(normalizeDataset(opts.dataset));
  }
  if (tiers.length > 0) {
    conditions.push(`tier IN (${tiers.map(() => '?').join(',')})`);
    params.push(...tiers);
  }
  const rows = d.prepare(`SELECT * FROM memories WHERE ${conditions.join(' AND ')} LIMIT 200`).all(...params) as Record<string, unknown>[];
  const now = Date.now();
  const scored = rows.map((row) => {
    const entry = mapRow(row);
    return { entry, score: scoreMemory(entry, query, now) };
  });
  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, limit);
  touchAccess(top.map((s) => s.entry.id));
  return top.map((s) => ({ ...s.entry, accessCount: s.entry.accessCount + 1, lastAccessed: now }));
}

/** Move a memory between tiers (e.g. episodic event → durable semantic fact). */
export function promoteMemory(id: string, tier: MemoryTier, importance?: number): MemoryEntry | null {
  if (!VALID_TIERS.includes(tier)) return null;
  return updateMemory(id, { tier, ...(typeof importance === 'number' ? { importance } : {}) });
}

/** Record a session event into decaying episodic memory. */
export function recordEpisodic(sessionId: string, title: string, content: string, importance = 0.4): MemoryEntry {
  return createMemory({ type: 'chat', title, content, tags: [], sessionId, tier: 'episodic', importance });
}

/**
 * Decay maintenance: deletes low-importance episodic memories older than
 * `olderThanDays`. Important (> keepImportantAbove) or promoted rows survive.
 * Returns the deleted count.
 */
export function pruneEpisodic(opts?: { olderThanDays?: number; keepImportantAbove?: number }): number {
  const d = getDb();
  const olderThanDays = opts?.olderThanDays ?? 30;
  const keepImportantAbove = opts?.keepImportantAbove ?? 0.7;
  const cutoff = Date.now() - olderThanDays * 86_400_000;
  const result = d.prepare(`DELETE FROM memories WHERE tier = 'episodic' AND updated_at < ? AND importance <= ?`).run(cutoff, keepImportantAbove);
  return Number(result.changes);
}

