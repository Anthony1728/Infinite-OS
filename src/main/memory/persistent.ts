// Persistent Memory — SQLite-based memory for sessions, knowledge, audit logs

import Database from 'better-sqlite3';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

export class PersistentMemory {
  private db: Database.Database;
  private dataDir: string;

  constructor(dbPath?: string) {
    this.dataDir = join(homedir(), '.infinite-ai', 'memory');
    if (!existsSync(this.dataDir)) {
      mkdirSync(this.dataDir, { recursive: true });
    }
    const path = dbPath || join(this.dataDir, 'memory.db');
    this.db = new Database(path);
    this.db.pragma('journal_mode = WAL');
    this.initTables();
  }

  private initTables(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memory (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        category TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(category, key)
      );

      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        title TEXT,
        history TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS audit_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        action TEXT NOT NULL,
        details TEXT,
        source TEXT DEFAULT 'system',
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS knowledge (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        input TEXT NOT NULL,
        output TEXT NOT NULL,
        source TEXT DEFAULT 'conversation',
        confidence REAL DEFAULT 1.0,
        tags TEXT DEFAULT '[]',
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS credentials (
        id TEXT PRIMARY KEY,
        service TEXT NOT NULL,
        encrypted_key TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_memory_category ON memory(category);
      CREATE INDEX IF NOT EXISTS idx_knowledge_source ON knowledge(source);
      CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_logs(timestamp);
    `);
  }

  // ── Memory ──
  saveMemory(category: string, key: string, value: string): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO memory (category, key, value) VALUES (?, ?, ?)
    `);
    stmt.run(category, key, value);
  }

  getMemory(category: string): Array<{ key: string; value: string }> {
    const stmt = this.db.prepare('SELECT key, value FROM memory WHERE category = ?');
    return stmt.all(category) as Array<{ key: string; value: string }>;
  }

  getMemoryValue(category: string, key: string): string | null {
    const stmt = this.db.prepare('SELECT value FROM memory WHERE category = ? AND key = ?');
    const row = stmt.get(category, key) as { value: string } | undefined;
    return row?.value ?? null;
  }

  deleteMemory(category: string, key: string): void {
    this.db.prepare('DELETE FROM memory WHERE category = ? AND key = ?').run(category, key);
  }

  // ── Sessions ──
  saveSession(sessionId: string, history: unknown[], title?: string): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO sessions (id, title, history, updated_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)
    `).run(sessionId, title || null, JSON.stringify(history));
  }

  loadSession(sessionId: string): unknown[] | null {
    const row = this.db.prepare('SELECT history FROM sessions WHERE id = ?').get(sessionId) as { history: string } | undefined;
    return row ? JSON.parse(row.history) : null;
  }

  listSessions(): Array<{ id: string; title: string | null; created_at: string; updated_at: string }> {
    return this.db.prepare('SELECT id, title, created_at, updated_at FROM sessions ORDER BY updated_at DESC').all() as Array<{
      id: string;
      title: string | null;
      created_at: string;
      updated_at: string;
    }>;
  }

  deleteSession(sessionId: string): void {
    this.db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
  }

  // ── Audit ──
  logAudit(action: string, details?: string, source?: string): void {
    this.db.prepare('INSERT INTO audit_logs (action, details, source) VALUES (?, ?, ?)').run(action, details || '', source || 'system');
  }

  getAuditLogs(limit: number = 50): Array<{ action: string; details: string; source: string; timestamp: string }> {
    return this.db.prepare('SELECT action, details, source, timestamp FROM audit_logs ORDER BY timestamp DESC LIMIT ?').all(limit) as Array<{
      action: string;
      details: string;
      source: string;
      timestamp: string;
    }>;
  }

  // ── Knowledge ──
  saveKnowledge(input: string, output: string, source: string = 'conversation', tags: string[] = []): void {
    this.db.prepare('INSERT INTO knowledge (input, output, source, tags) VALUES (?, ?, ?, ?)').run(input, output, source, JSON.stringify(tags));
  }

  searchKnowledge(query: string, limit: number = 10): Array<{ input: string; output: string; source: string; confidence: number }> {
    const stmt = this.db.prepare(`
      SELECT input, output, source, confidence FROM knowledge 
      WHERE input LIKE ? OR output LIKE ? OR tags LIKE ?
      ORDER BY timestamp DESC LIMIT ?
    `);
    const like = `%${query}%`;
    return stmt.all(like, like, like, limit) as Array<{
      input: string;
      output: string;
      source: string;
      confidence: number;
    }>;
  }

  getKnowledgeStats(): { total: number; bySource: Record<string, number> } {
    const total = (this.db.prepare('SELECT COUNT(*) as count FROM knowledge').get() as { count: number }).count;
    const rows = this.db.prepare('SELECT source, COUNT(*) as count FROM knowledge GROUP BY source').all() as Array<{ source: string; count: number }>;
    const bySource: Record<string, number> = {};
    for (const row of rows) bySource[row.source] = row.count;
    return { total, bySource };
  }

  // ── Stats ──
  getStats(): {
    memory: number;
    sessions: number;
    auditLogs: number;
    knowledge: number;
  } {
    return {
      memory: (this.db.prepare('SELECT COUNT(*) as count FROM memory').get() as { count: number }).count,
      sessions: (this.db.prepare('SELECT COUNT(*) as count FROM sessions').get() as { count: number }).count,
      auditLogs: (this.db.prepare('SELECT COUNT(*) as count FROM audit_logs').get() as { count: number }).count,
      knowledge: (this.db.prepare('SELECT COUNT(*) as count FROM knowledge').get() as { count: number }).count,
    };
  }

  close(): void {
    this.db.close();
  }
}

let memoryInstance: PersistentMemory | null = null;

export function getPersistentMemory(): PersistentMemory {
  if (!memoryInstance) memoryInstance = new PersistentMemory();
  return memoryInstance;
}
