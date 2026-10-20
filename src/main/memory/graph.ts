/**
 * Cognee-style graph memory.
 *
 * The flat memory store answers "what did we say?". This module answers
 * "what is connected to what?" by keeping typed nodes and weighted edges in
 * the same SQLite database. It is deliberately deterministic: entity
 * extraction, deduplication, traversal, and graph improvement all run locally
 * and never require a model call, so recall stays fast and reproducible.
 */

import { randomUUID } from 'node:crypto';
import { getDb, normalizeDataset } from './store.js';

export type GraphNodeType =
  | 'concept'
  | 'person'
  | 'project'
  | 'tool'
  | 'file'
  | 'idea'
  | 'task'
  | 'note'
  | 'fact'
  | 'skill'
  | 'tag'
  | 'resource'
  | 'organization'
  | 'event';

export interface GraphNode {
  id: string;
  dataset: string;
  type: GraphNodeType;
  name: string;
  content: string;
  tags: string[];
  createdAt: number;
  updatedAt: number;
  accessCount: number;
  lastAccessed: number;
  degree: number;
}

export interface GraphEdge {
  id: string;
  dataset: string;
  sourceId: string;
  targetId: string;
  relation: string;
  weight: number;
  createdAt: number;
}

export interface GraphRecall {
  dataset: string;
  query: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
}

const NODE_TYPES = new Set<GraphNodeType>([
  'concept', 'person', 'project', 'tool', 'file', 'idea', 'task', 'note',
  'fact', 'skill', 'tag', 'resource', 'organization', 'event',
]);

const STOPWORDS = new Set([
  'The', 'This', 'That', 'These', 'Those', 'A', 'An', 'And', 'But', 'For',
  'With', 'From', 'When', 'Where', 'Which', 'While', 'After', 'Before', 'It',
  'We', 'You', 'They', 'In', 'On', 'At', 'To', 'Of', 'As', 'If', 'Then',
  'There', 'Here', 'What', 'Who', 'How', 'Why', 'All', 'Any', 'Each', 'Every',
  'Use', 'Using', 'Used', 'Can', 'Will', 'Would', 'Should', 'Could', 'May',
  'Might', 'Must', 'Not', 'No', 'Yes', 'Do', 'Does', 'Did', 'Has', 'Have',
  'Had', 'Is', 'Are', 'Was', 'Were', 'Be', 'Been', 'Being', 'Or', 'So',
]);

export function ensureGraphSchema(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS graph_nodes (
      id TEXT PRIMARY KEY,
      dataset TEXT NOT NULL DEFAULT 'default',
      type TEXT NOT NULL DEFAULT 'concept',
      name TEXT NOT NULL,
      normalized TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      tags TEXT NOT NULL DEFAULT '[]',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      access_count INTEGER NOT NULL DEFAULT 0,
      last_accessed INTEGER NOT NULL DEFAULT 0
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_graph_nodes_name ON graph_nodes(dataset, normalized);
    CREATE INDEX IF NOT EXISTS idx_graph_nodes_dataset ON graph_nodes(dataset);

    CREATE TABLE IF NOT EXISTS graph_edges (
      id TEXT PRIMARY KEY,
      dataset TEXT NOT NULL DEFAULT 'default',
      source_id TEXT NOT NULL,
      target_id TEXT NOT NULL,
      relation TEXT NOT NULL DEFAULT 'related_to',
      weight REAL NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_graph_edges_unique ON graph_edges(dataset, source_id, target_id, relation);
    CREATE INDEX IF NOT EXISTS idx_graph_edges_source ON graph_edges(source_id);
    CREATE INDEX IF NOT EXISTS idx_graph_edges_target ON graph_edges(target_id);
  `);
}

export function normalizeName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/^[#@]+/, '')
    .replace(/[^\p{L}\p{N}\s._-]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160);
}

function cleanName(name: string): string {
  return name.trim().replace(/^[#@]+/, '').replace(/[.,;:!?]+$/, '').slice(0, 160);
}

interface ExtractedEntity {
  name: string;
  type: GraphNodeType;
  relation: string;
}

/** Deterministic entity extraction: wiki links, tags, handles, URLs, and names. */
export function extractEntities(text: string, title: string, tags: string[] = []): ExtractedEntity[] {
  const seen = new Set<string>();
  const entities: ExtractedEntity[] = [];
  const add = (raw: string, type: GraphNodeType, relation: string) => {
    const name = cleanName(raw);
    if (!name || name.length < 2) return;
    const key = normalizeName(name);
    if (!key || key === normalizeName(title) || seen.has(key)) return;
    seen.add(key);
    entities.push({ name, type, relation });
  };

  for (const tag of tags) add(tag, 'tag', 'tagged');
  for (const m of text.matchAll(/\[\[([^\]]{2,160})\]\]/g)) add(m[1], 'concept', 'mentions');
  for (const m of text.matchAll(/#([\p{L}\p{N}][\p{L}\p{N}._-]{1,60})/gu)) add(m[1], 'tag', 'tagged');
  for (const m of text.matchAll(/@([\p{L}\p{N}][\p{L}\p{N}._-]{1,60})/gu)) add(m[1], 'person', 'mentions');
  for (const m of text.matchAll(/https?:\/\/[^\s<>"')\]]{4,300}/g)) add(m[0], 'resource', 'references');
  for (const m of text.matchAll(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2}\b/g)) {
    const name = m[0];
    if (STOPWORDS.has(name) || name.length < 3) continue;
    add(name, 'concept', 'mentions');
  }
  return entities.slice(0, 32);
}

function mapNode(row: Record<string, unknown>, degree = 0): GraphNode {
  return {
    id: row.id as string,
    dataset: (row.dataset as string) || 'default',
    type: NODE_TYPES.has(row.type as GraphNodeType) ? (row.type as GraphNodeType) : 'concept',
    name: row.name as string,
    content: (row.content as string) || '',
    tags: JSON.parse((row.tags as string) || '[]') as string[],
    createdAt: Number(row.created_at) || 0,
    updatedAt: Number(row.updated_at) || 0,
    accessCount: Number(row.access_count) || 0,
    lastAccessed: Number(row.last_accessed) || 0,
    degree,
  };
}

function mapEdge(row: Record<string, unknown>): GraphEdge {
  return {
    id: row.id as string,
    dataset: (row.dataset as string) || 'default',
    sourceId: row.source_id as string,
    targetId: row.target_id as string,
    relation: (row.relation as string) || 'related_to',
    weight: Number(row.weight) || 1,
    createdAt: Number(row.created_at) || 0,
  };
}

function upsertNode(dataset: string, name: string, type: GraphNodeType, content: string, tags: string[]): GraphNode {
  const db = getDb();
  const normalized = normalizeName(name);
  if (!normalized) throw new Error('Graph node name cannot be empty.');
  const now = Date.now();
  db.prepare(`
    INSERT INTO graph_nodes (id, dataset, type, name, normalized, content, tags, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(dataset, normalized) DO UPDATE SET
      updated_at = excluded.updated_at,
      content = CASE WHEN length(excluded.content) > length(graph_nodes.content) THEN excluded.content ELSE graph_nodes.content END,
      tags = CASE WHEN excluded.tags = '[]' THEN graph_nodes.tags ELSE excluded.tags END,
      type = CASE WHEN graph_nodes.type = 'concept' THEN excluded.type ELSE graph_nodes.type END
  `).run(randomUUID(), dataset, NODE_TYPES.has(type) ? type : 'concept', cleanName(name), normalized, content, JSON.stringify(tags), now, now);
  const row = db.prepare('SELECT * FROM graph_nodes WHERE dataset = ? AND normalized = ?').get(dataset, normalized) as Record<string, unknown>;
  return mapNode(row, nodeDegree(row.id as string));
}

function upsertEdge(dataset: string, sourceId: string, targetId: string, relation: string): void {
  if (sourceId === targetId) return;
  const db = getDb();
  db.prepare(`
    INSERT INTO graph_edges (id, dataset, source_id, target_id, relation, weight, created_at)
    VALUES (?, ?, ?, ?, ?, 1, ?)
    ON CONFLICT(dataset, source_id, target_id, relation) DO UPDATE SET weight = weight + 1
  `).run(randomUUID(), dataset, sourceId, targetId, relation, Date.now());
}

function nodeDegree(nodeId: string): number {
  const row = getDb().prepare('SELECT COUNT(*) AS count FROM graph_edges WHERE source_id = ? OR target_id = ?').get(nodeId, nodeId) as { count: number };
  return Number(row.count) || 0;
}

export interface RememberGraphInput {
  dataset?: string;
  title: string;
  content: string;
  tags?: string[];
  type?: GraphNodeType;
}

export interface RememberGraphResult {
  node: GraphNode;
  entities: GraphNode[];
  edges: number;
}

/**
 * Store one durable fact as a primary node plus its extracted entities.
 * Repeating the same fact updates the node and strengthens existing edges
 * instead of creating duplicates.
 */
export function rememberGraph(input: RememberGraphInput): RememberGraphResult {
  ensureGraphSchema();
  const dataset = normalizeDataset(input.dataset);
  const title = cleanName(input.title);
  if (!title) throw new Error('title is required.');
  const tags = (input.tags ?? []).map(cleanName).filter(Boolean).slice(0, 20);
  const primary = upsertNode(dataset, title, input.type ?? 'concept', input.content ?? '', tags);
  const entities = extractEntities(`${input.content ?? ''}\n${tags.join(' ')}`, title, tags);
  let edges = 0;
  const stored: GraphNode[] = [];
  for (const entity of entities) {
    const node = upsertNode(dataset, entity.name, entity.type, '', []);
    upsertEdge(dataset, primary.id, node.id, entity.relation);
    stored.push(node);
    edges += 1;
  }
  return { node: { ...primary, degree: nodeDegree(primary.id) }, entities: stored, edges };
}

/** Explicit edge creation, for relationships extraction cannot infer. */
export function linkGraphNodes(input: {
  dataset?: string;
  sourceId: string;
  targetId: string;
  relation?: string;
}): GraphEdge {
  ensureGraphSchema();
  const db = getDb();
  const dataset = normalizeDataset(input.dataset);
  const source = db.prepare('SELECT id FROM graph_nodes WHERE id = ? AND dataset = ?').get(input.sourceId, dataset) as { id: string } | undefined;
  const target = db.prepare('SELECT id FROM graph_nodes WHERE id = ? AND dataset = ?').get(input.targetId, dataset) as { id: string } | undefined;
  if (!source) throw new Error(`Source node not found in dataset "${dataset}".`);
  if (!target) throw new Error(`Target node not found in dataset "${dataset}".`);
  upsertEdge(dataset, source.id, target.id, (input.relation ?? 'related_to').trim().slice(0, 60) || 'related_to');
  const row = db.prepare('SELECT * FROM graph_edges WHERE dataset = ? AND source_id = ? AND target_id = ? AND relation = ?')
    .get(dataset, source.id, target.id, (input.relation ?? 'related_to').trim().slice(0, 60) || 'related_to') as Record<string, unknown>;
  return mapEdge(row);
}

/**
 * Graph-first recall. Matches seed nodes, then walks outward to the requested
 * depth so "deploy" can return the project, the tool, and the person attached
 * to it even when those words never appeared in the query.
 */
export function recallGraph(query: string, opts?: { dataset?: string; depth?: number; limit?: number }): GraphRecall {
  ensureGraphSchema();
  const db = getDb();
  const dataset = normalizeDataset(opts?.dataset);
  const depth = Math.max(1, Math.min(3, opts?.depth ?? 1));
  const limit = Math.max(1, Math.min(50, opts?.limit ?? 12));
  const q = query.trim();
  const seedRows = q
    ? db.prepare(`
        SELECT n.*, (
          SELECT COUNT(*) FROM graph_edges e WHERE e.source_id = n.id OR e.target_id = n.id
        ) AS degree
        FROM graph_nodes n
        WHERE n.dataset = ? AND (n.name LIKE ? OR n.content LIKE ? OR n.tags LIKE ?)
        ORDER BY degree DESC, n.updated_at DESC
        LIMIT 40
      `).all(dataset, `%${q}%`, `%${q}%`, `%${q}%`) as Array<Record<string, unknown>>
    : db.prepare(`
        SELECT n.*, (
          SELECT COUNT(*) FROM graph_edges e WHERE e.source_id = n.id OR e.target_id = n.id
        ) AS degree
        FROM graph_nodes n WHERE n.dataset = ?
        ORDER BY degree DESC, n.updated_at DESC LIMIT 20
      `).all(dataset) as Array<Record<string, unknown>>;

  const nodes = new Map<string, GraphNode>();
  for (const row of seedRows) nodes.set(row.id as string, mapNode(row, Number(row.degree) || 0));

  let frontier = [...nodes.keys()];
  const edges = new Map<string, GraphEdge>();
  for (let d = 0; d < depth; d++) {
    if (frontier.length === 0) break;
    const placeholders = frontier.map(() => '?').join(',');
    const edgeRows = db.prepare(`
      SELECT * FROM graph_edges
      WHERE dataset = ? AND (source_id IN (${placeholders}) OR target_id IN (${placeholders}))
      ORDER BY weight DESC LIMIT 400
    `).all(dataset, ...frontier, ...frontier) as Array<Record<string, unknown>>;
    const next: string[] = [];
    for (const row of edgeRows) {
      const edge = mapEdge(row);
      edges.set(edge.id, edge);
      for (const id of [edge.sourceId, edge.targetId]) {
        if (!nodes.has(id)) {
          const nodeRow = db.prepare('SELECT * FROM graph_nodes WHERE id = ?').get(id) as Record<string, unknown> | undefined;
          if (nodeRow) {
            nodes.set(id, mapNode(nodeRow, nodeDegree(id)));
            next.push(id);
          }
        }
      }
    }
    frontier = next;
  }

  const ranked = [...nodes.values()]
    .sort((a, b) => scoreNode(b, q) - scoreNode(a, q) || b.degree - a.degree || b.updatedAt - a.updatedAt)
    .slice(0, limit);
  const ids = new Set(ranked.map((n) => n.id));
  const keptEdges = [...edges.values()].filter((e) => ids.has(e.sourceId) && ids.has(e.targetId));
  if (ranked.length) {
    const placeholders = ranked.map(() => '?').join(',');
    db.prepare(`UPDATE graph_nodes SET access_count = access_count + 1, last_accessed = ? WHERE id IN (${placeholders})`)
      .run(Date.now(), ...ranked.map((n) => n.id));
  }
  return { dataset, query: q, nodes: ranked, edges: keptEdges };
}

function scoreNode(node: GraphNode, query: string): number {
  const q = query.toLowerCase();
  const name = node.name.toLowerCase();
  let score = 0;
  if (q && name === q) score += 20;
  else if (q && name.startsWith(q)) score += 12;
  else if (q && name.includes(q)) score += 8;
  else if (q && node.content.toLowerCase().includes(q)) score += 4;
  score += Math.min(6, node.degree);
  score += Math.min(3, node.accessCount * 0.25);
  const ageDays = Math.max(0, (Date.now() - node.updatedAt) / 86_400_000);
  score += Math.max(0, 3 - ageDays / 30);
  return score;
}

/**
 * Deterministic "improve": connect nodes that share at least two tags, or a
 * tag plus a name token. This turns a pile of remembered facts into a
 * traversable neighbourhood without an LLM in the loop.
 */
export function improveGraph(dataset?: string): { linked: number; nodes: number; edges: number } {
  ensureGraphSchema();
  const db = getDb();
  const ds = normalizeDataset(dataset);
  const rows = db.prepare('SELECT * FROM graph_nodes WHERE dataset = ? ORDER BY updated_at DESC LIMIT 500').all(ds) as Array<Record<string, unknown>>;
  const nodes = rows.map((r) => mapNode(r));
  const tags = nodes.map((node) => new Set(node.tags.map(normalizeName)));
  const tokens = nodes.map((node) => new Set(normalizeName(node.name).split(' ').filter((token) => token.length > 2)));
  const existing = new Set((db.prepare("SELECT source_id, target_id FROM graph_edges WHERE dataset = ? AND relation = 'related_to'")
    .all(ds) as Array<{ source_id: string; target_id: string }>).map((edge) => `${edge.source_id}|${edge.target_id}`));
  let linked = 0;
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i];
      const b = nodes[j];
      let sharedTags = 0;
      for (const tag of tags[i]) if (tags[j].has(tag)) sharedTags += 1;
      if (sharedTags < 1) continue;
      let sharesToken = false;
      if (sharedTags === 1) {
        for (const token of tokens[i]) if (tokens[j].has(token)) { sharesToken = true; break; }
      }
      if (sharedTags >= 2 || sharesToken) {
        const key = `${a.id}|${b.id}`;
        if (existing.has(key)) continue;
        upsertEdge(ds, a.id, b.id, 'related_to');
        existing.add(key);
        linked += 1;
      }
    }
  }
  const edgeCount = (db.prepare('SELECT COUNT(*) AS count FROM graph_edges WHERE dataset = ?').get(ds) as { count: number }).count;
  return { linked, nodes: nodes.length, edges: Number(edgeCount) || 0 };
}

export function forgetGraph(input: { dataset?: string; nodeId?: string; query?: string }): { nodes: number; edges: number } {
  ensureGraphSchema();
  const db = getDb();
  const dataset = normalizeDataset(input.dataset);
  let ids: string[] = [];
  if (input.nodeId) {
    const row = db.prepare('SELECT id FROM graph_nodes WHERE id = ? AND dataset = ?').get(input.nodeId, dataset) as { id: string } | undefined;
    if (row) ids = [row.id];
  } else if (input.query?.trim()) {
    const rows = db.prepare('SELECT id FROM graph_nodes WHERE dataset = ? AND (name LIKE ? OR content LIKE ?)')
      .all(dataset, `%${input.query.trim()}%`, `%${input.query.trim()}%`) as Array<{ id: string }>;
    ids = rows.map((r) => r.id);
  }
  if (ids.length === 0) return { nodes: 0, edges: 0 };
  const placeholders = ids.map(() => '?').join(',');
  const edges = db.prepare(`DELETE FROM graph_edges WHERE dataset = ? AND (source_id IN (${placeholders}) OR target_id IN (${placeholders}))`)
    .run(dataset, ...ids, ...ids);
  const nodes = db.prepare(`DELETE FROM graph_nodes WHERE dataset = ? AND id IN (${placeholders})`).run(dataset, ...ids);
  return { nodes: Number(nodes.changes) || 0, edges: Number(edges.changes) || 0 };
}

export function graphStats(dataset?: string): {
  nodes: number;
  edges: number;
  byType: Record<string, number>;
  byRelation: Record<string, number>;
  top: Array<{ name: string; type: string; degree: number }>;
} {
  ensureGraphSchema();
  const db = getDb();
  const ds = dataset ? normalizeDataset(dataset) : null;
  const where = ds ? ' WHERE dataset = ?' : '';
  const params = ds ? [ds] : [];
  const nodes = (db.prepare(`SELECT COUNT(*) AS count FROM graph_nodes${where}`).get(...params) as { count: number }).count;
  const edges = (db.prepare(`SELECT COUNT(*) AS count FROM graph_edges${where}`).get(...params) as { count: number }).count;
  const byType = Object.fromEntries((db.prepare(`SELECT type, COUNT(*) AS count FROM graph_nodes${where} GROUP BY type`).all(...params) as Array<{ type: string; count: number }>)
    .map((r) => [r.type, Number(r.count)]));
  const byRelation = Object.fromEntries((db.prepare(`SELECT relation, COUNT(*) AS count FROM graph_edges${where} GROUP BY relation`).all(...params) as Array<{ relation: string; count: number }>)
    .map((r) => [r.relation, Number(r.count)]));
  const top = (db.prepare(`
    SELECT n.name, n.type, COUNT(e.id) AS degree
    FROM graph_nodes n LEFT JOIN graph_edges e ON e.source_id = n.id OR e.target_id = n.id
    ${ds ? 'WHERE n.dataset = ?' : ''}
    GROUP BY n.id ORDER BY degree DESC, n.updated_at DESC LIMIT 10
  `).all(...params) as Array<{ name: string; type: string; degree: number }>).map((r) => ({ name: r.name, type: r.type, degree: Number(r.degree) || 0 }));
  return { nodes: Number(nodes) || 0, edges: Number(edges) || 0, byType, byRelation, top };
}

export function listDatasets(): Array<{ name: string; memories: number; nodes: number; edges: number }> {
  ensureGraphSchema();
  const db = getDb();
  const memoryRows = db.prepare('SELECT dataset, COUNT(*) AS count FROM memories GROUP BY dataset').all() as Array<{ dataset: string; count: number }>;
  const nodeRows = db.prepare('SELECT dataset, COUNT(*) AS count FROM graph_nodes GROUP BY dataset').all() as Array<{ dataset: string; count: number }>;
  const edgeRows = db.prepare('SELECT dataset, COUNT(*) AS count FROM graph_edges GROUP BY dataset').all() as Array<{ dataset: string; count: number }>;
  const names = new Set(['default', ...memoryRows.map((r) => r.dataset), ...nodeRows.map((r) => r.dataset), ...edgeRows.map((r) => r.dataset)]);
  return [...names].sort().map((name) => ({
    name,
    memories: Number(memoryRows.find((r) => r.dataset === name)?.count ?? 0),
    nodes: Number(nodeRows.find((r) => r.dataset === name)?.count ?? 0),
    edges: Number(edgeRows.find((r) => r.dataset === name)?.count ?? 0),
  }));
}
