import Database from 'better-sqlite3';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { infiniteHome } from '../profiles/home';
import { embedText } from '../indexing/embeddings.js';
import { hybridScore, isRelevant, lexicalOverlap, lexicalVectorSimilarity } from './hybrid.js';
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
  if (!columns.has('embedding')) db.exec(`ALTER TABLE memories ADD COLUMN embedding BLOB`);
  if (!columns.has('embedding_backend')) db.exec(`ALTER TABLE memories ADD COLUMN embedding_backend TEXT`);
  if (!columns.has('embedding_model')) db.exec(`ALTER TABLE memories ADD COLUMN embedding_model TEXT`);
  if (!columns.has('embedding_updated_at')) db.exec(`ALTER TABLE memories ADD COLUMN embedding_updated_at INTEGER NOT NULL DEFAULT 0`);
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

// ── Embedding persistence ──────────────────────────────────────────────────
// Vectors live in the same SQLite row as the memory. Float32 BLOBs keep the
// file small (~3 KB per memory) and decode without JSON parsing on every
// recall. The backend/model are stored alongside so a vector is never compared
// against a different embedding space (lexical hashed vectors vs nomic-embed
// vs mxbai-embed are not interchangeable).

const pendingEmbeddings = new Set<string>();

function encodeEmbedding(vector: number[]): Buffer {
  const floats = new Float32Array(vector);
  return Buffer.from(floats.buffer, floats.byteOffset, floats.byteLength);
}

function decodeEmbedding(raw: unknown): number[] | null {
  if (!raw) return null;
  if (Buffer.isBuffer(raw) || raw instanceof Uint8Array) {
    const bytes = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
    if (bytes.byteLength < 4 || bytes.byteLength % 4 !== 0) return null;
    const copy = new Float32Array(bytes.byteLength / 4);
    for (let i = 0; i < copy.length; i++) copy[i] = bytes.readFloatLE(i * 4);
    return Array.from(copy);
  }
  // Tolerate a JSON-array vector written by an older experiment.
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed) && parsed.every((v) => typeof v === 'number' && Number.isFinite(v))) {
        return parsed as number[];
      }
    } catch { /* not a JSON vector */ }
  }
  return null;
}

function embeddingText(row: { title: string; content: string; tags: string[] }): string {
  return `${row.title}\n${row.content}\n${row.tags.join(' ')}`.slice(0, 8_000);
}

async function embedMemoryNow(id: string): Promise<void> {
  try {
    const d = getDb();
    const row = d.prepare('SELECT title, content, tags FROM memories WHERE id = ?').get(id) as
      | { title: string; content: string; tags: string }
      | undefined;
    if (!row) return;
    const tags = JSON.parse(row.tags || '[]') as string[];
    const embedded = await embedText(embeddingText({ title: row.title, content: row.content, tags }));
    d.prepare(`
      UPDATE memories
      SET embedding = ?, embedding_backend = ?, embedding_model = ?, embedding_updated_at = ?
      WHERE id = ?
    `).run(
      encodeEmbedding(embedded.vector),
      embedded.backend,
      embedded.model ?? '',
      Date.now(),
      id,
    );
  } catch {
    // Embeddings are an enhancement, not a dependency: recall falls back to
    // lexical ranking whenever the vector backend is unavailable.
  }
}

/**
 * Persist a vector for one memory without blocking the caller. Safe to call
 * repeatedly; an in-flight id is deduplicated.
 */
export function queueMemoryEmbedding(id: string): void {
  if (pendingEmbeddings.has(id)) return;
  pendingEmbeddings.add(id);
  void embedMemoryNow(id).finally(() => pendingEmbeddings.delete(id));
}

/**
 * Embed memories that predate this feature (or whose content changed while
 * Ollama was offline). Returns how many rows were attempted/embedded.
 */
export async function backfillMemoryEmbeddings(opts?: { limit?: number }): Promise<{ scanned: number; embedded: number; failed: number }> {
  const d = getDb();
  const limit = Math.max(1, Math.min(500, opts?.limit ?? 64));
  const rows = d.prepare(`
    SELECT id FROM memories
    WHERE embedding IS NULL OR embedding_updated_at < updated_at
    ORDER BY importance DESC, updated_at DESC
    LIMIT ?
  `).all(limit) as Array<{ id: string }>;
  let embedded = 0;
  let failed = 0;
  for (const row of rows) {
    try {
      await embedMemoryNow(row.id);
      const check = d.prepare('SELECT embedding FROM memories WHERE id = ?').get(row.id) as { embedding: unknown } | undefined;
      if (check?.embedding) embedded++;
      else failed++;
    } catch {
      failed++;
    }
  }
  return { scanned: rows.length, embedded, failed };
}

/** Count rows with a persisted vector. Surfaced in stats and diagnostics. */
export function getEmbeddingStats(): { total: number; embedded: number; lexicalBackend: number; ollamaBackend: number } {
  const d = getDb();
  const total = (d.prepare('SELECT COUNT(*) as count FROM memories').get() as { count: number }).count;
  const embedded = (d.prepare('SELECT COUNT(*) as count FROM memories WHERE embedding IS NOT NULL').get() as { count: number }).count;
  const lexicalBackend = (d.prepare(`SELECT COUNT(*) as count FROM memories WHERE embedding_backend = 'lexical'`).get() as { count: number }).count;
  const ollamaBackend = (d.prepare(`SELECT COUNT(*) as count FROM memories WHERE embedding_backend = 'ollama'`).get() as { count: number }).count;
  return { total, embedded, lexicalBackend, ollamaBackend };
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

  queueMemoryEmbedding(id);
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

  const textChanged = updates.title !== undefined || updates.content !== undefined || updates.tags !== undefined;
  if (textChanged) queueMemoryEmbedding(id);
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

export function getMemoryStats(dataset?: string): { total: number; byType: Record<string, number>; byTier: Record<string, number>; datasets: number; embedded: number } {
  const d = getDb();
  const where = dataset ? ' WHERE dataset = ?' : '';
  const params = dataset ? [normalizeDataset(dataset)] : [];
  const total = (d.prepare(`SELECT COUNT(*) as count FROM memories${where}`).get(...params) as { count: number }).count;
  const rows = d.prepare(`SELECT type, COUNT(*) as count FROM memories${where} GROUP BY type`).all(...params) as { type: string; count: number }[];
  const byType = Object.fromEntries(rows.map((r) => [r.type, r.count]));
  const tierRows = d.prepare(`SELECT tier, COUNT(*) as count FROM memories${where} GROUP BY tier`).all(...params) as { tier: string; count: number }[];
  const byTier = Object.fromEntries(tierRows.map((r) => [r.tier, r.count]));
  const datasets = (d.prepare('SELECT COUNT(DISTINCT dataset) as count FROM memories').get() as { count: number }).count;
  const embedded = (d.prepare(`SELECT COUNT(*) as count FROM memories${where ? `${where} AND` : ' WHERE'} embedding IS NOT NULL`).get(...params) as { count: number }).count;
  return { total, byType, byTier, datasets, embedded };
}

function touchAccess(ids: string[]): void {
  if (ids.length === 0) return;
  const d = getDb();
  const now = Date.now();
  const placeholders = ids.map(() => '?').join(',');
  d.prepare(`UPDATE memories SET access_count = access_count + 1, last_accessed = ? WHERE id IN (${placeholders})`).run(now, ...ids);
}

/**
 * Tier-aware lexical recall. Stays synchronous for call sites that cannot
 * await; ranking now includes a lexical-vector similarity signal so related
 * wording beats pure title coincidence even before embeddings are available.
 *
 * The embedding-backed path is recallMemoriesHybrid(); this function remains
 * the deterministic fallback and the prefilter for the SQLite UI.
 */
export function recallMemories(query: string, opts?: { tiers?: MemoryTier[]; limit?: number; dataset?: string }): MemoryEntry[] {
  const d = getDb();
  const tiers = (opts?.tiers ?? []).filter((t) => VALID_TIERS.includes(t));
  const limit = Math.max(1, Math.min(50, opts?.limit ?? 10));
  // Tokenized matching: the old whole-query LIKE ("what did we decide about
  // the deploy pipeline") matched almost nothing unless the exact substring
  // existed. Each meaningful word becomes its own OR clause so partial
  // relevance surfaces; scoreMemory ranking still separates signal from noise.
  const words = Array.from(
    new Set(
      query
        .toLowerCase()
        .split(/[^a-z0-9_]+/)
        .map((w) => w.trim())
        .filter((w) => w.length >= 3),
    ),
  ).slice(0, 8);
  const matchers = words.length > 0 ? words : [query.trim()].filter(Boolean);
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (matchers.length > 0) {
    conditions.push(`(${matchers.map(() => '(title LIKE ? OR content LIKE ? OR tags LIKE ?)').join(' OR ')})`);
    for (const word of matchers) {
      const pattern = `%${word}%`;
      params.push(pattern, pattern, pattern);
    }
  }
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
    const text = `${entry.title} ${entry.content} ${entry.tags.join(' ')}`;
    return {
      entry,
      score: hybridScore({
        baseScore: scoreMemory(entry, query, now),
        semanticSimilarity: lexicalVectorSimilarity(query, text),
        lexicalOverlap: lexicalOverlap(query, text),
      }),
    };
  });
  scored.sort((a, b) => b.score - a.score || b.entry.updatedAt - a.entry.updatedAt);
  const top = scored.slice(0, limit);
  touchAccess(top.map((s) => s.entry.id));
  return top.map((s) => ({ ...s.entry, accessCount: s.entry.accessCount + 1, lastAccessed: now }));
}

export interface HybridRecallOptions {
  tiers?: MemoryTier[];
  limit?: number;
  dataset?: string;
  /** Hard ceiling for the query embedding call. The turn must never wait on
   *  a cold/slow embedding server; lexical fallback covers that turn. */
  timeoutMs?: number;
}

interface QueryVector {
  vector: number[];
  backend: 'ollama' | 'lexical';
  model: string;
}

/** Embed a query within a bounded budget. The background call is allowed to
 *  finish (warming the model for the next turn) but never blocks this one. */
async function embedQueryBounded(text: string, timeoutMs: number): Promise<QueryVector | null> {
  const task = embedText(text)
    .then((result): QueryVector => ({ vector: result.vector, backend: result.backend, model: result.model ?? '' }))
    .catch(() => null);
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), Math.max(200, timeoutMs));
    timer.unref?.();
  });
  const result = await Promise.race([task, timeout]);
  if (timer) clearTimeout(timer);
  return result;
}

/**
 * Embedding-backed hybrid recall.
 *
 * Unlike the legacy path this does NOT prefilter by LIKE: it scans the dataset
 * (capped at 400 rows) and ranks by importance/recency + cosine similarity +
 * token overlap. That is what lets "how do we ship releases?" find a memory
 * titled "Deployment pipeline" with no shared words. Rows that have not been
 * backfilled yet borrow a deterministic lexical-vector similarity so recall
 * quality degrades honestly instead of dropping them.
 */
export async function recallMemoriesHybrid(query: string, opts?: HybridRecallOptions): Promise<MemoryEntry[]> {
  const d = getDb();
  const tiers = (opts?.tiers ?? []).filter((t) => VALID_TIERS.includes(t));
  const limit = Math.max(1, Math.min(50, opts?.limit ?? 10));
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (opts?.dataset) {
    conditions.push('dataset = ?');
    params.push(normalizeDataset(opts.dataset));
  }
  if (tiers.length > 0) {
    conditions.push(`tier IN (${tiers.map(() => '?').join(',')})`);
    params.push(...tiers);
  }
  const where = conditions.length ? ` WHERE ${conditions.join(' AND ')}` : '';
  const rows = d.prepare(`SELECT * FROM memories${where} ORDER BY updated_at DESC LIMIT 400`).all(...params) as Record<string, unknown>[];
  if (!rows.length) return [];

  const trimmed = query.trim();
  const hasQuery = trimmed.length > 0;
  const queryVector = hasQuery ? await embedQueryBounded(trimmed, opts?.timeoutMs ?? 2_500) : null;
  const now = Date.now();
  const scored: Array<{ entry: MemoryEntry; score: number }> = [];

  for (const row of rows) {
    const entry = mapRow(row);
    const text = `${entry.title}\n${entry.content}\n${entry.tags.join(' ')}`;
    const lexical = hasQuery ? lexicalOverlap(query, text) : 0;
    let semantic = 0;
    if (hasQuery) {
      const stored = decodeEmbedding(row.embedding);
      const storedBackend = typeof row.embedding_backend === 'string' ? row.embedding_backend : null;
      const storedModel = typeof row.embedding_model === 'string' ? row.embedding_model : '';
      if (
        stored &&
        queryVector &&
        storedBackend === queryVector.backend &&
        (queryVector.backend === 'lexical' || storedModel === queryVector.model) &&
        stored.length === queryVector.vector.length
      ) {
        semantic = dot(stored, queryVector.vector);
      } else {
        // No compatible vector yet (legacy row, backend change, or Ollama was
        // offline at write time): use the deterministic lexical vector.
        semantic = lexicalVectorSimilarity(query, text);
      }
      if (!isRelevant(semantic, lexical, true)) continue;
    }
    scored.push({
      entry,
      score: hybridScore({
        baseScore: scoreMemory(entry, query, now),
        semanticSimilarity: semantic,
        lexicalOverlap: lexical,
      }),
    });
  }

  scored.sort((a, b) => b.score - a.score || b.entry.updatedAt - a.entry.updatedAt);
  const top = scored.slice(0, limit);
  touchAccess(top.map((s) => s.entry.id));
  return top.map((s) => ({ ...s.entry, accessCount: s.entry.accessCount + 1, lastAccessed: now }));
}

/** Dot product for already-normalized vectors (cosine without re-normalizing). */
function dot(a: number[], b: number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i] * b[i];
  return sum;
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

