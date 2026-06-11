import Database from 'better-sqlite3';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import type { AgentType } from './types.js';

export interface CustomAgent {
  id: string;
  name: string;
  description: string;
  icon: string;
  color: string;
  systemPrompt: string;
  allowedTools: string[];
  maxTurns: number;
  createdAt: number;
  updatedAt: number;
}

let db: Database.Database | null = null;

function getDb(): Database.Database {
  if (db) return db;

  const configDir = join(homedir(), '.infinite-ai');
  mkdirSync(configDir, { recursive: true });

  db = new Database(join(configDir, 'agents.db'));
  db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS custom_agents (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      icon TEXT NOT NULL DEFAULT '✦',
      color TEXT NOT NULL DEFAULT '#8b5cf6',
      system_prompt TEXT NOT NULL DEFAULT '',
      allowed_tools TEXT NOT NULL DEFAULT '["Bash","Read","Write","Edit","Glob","Grep"]',
      max_turns INTEGER NOT NULL DEFAULT 20,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
  `);

  return db;
}

export function createCustomAgent(agent: Omit<CustomAgent, 'id' | 'createdAt' | 'updatedAt'>): CustomAgent {
  const d = getDb();
  const id = `custom-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const now = Date.now();

  d.prepare(`
    INSERT INTO custom_agents (id, name, description, icon, color, system_prompt, allowed_tools, max_turns, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, agent.name, agent.description, agent.icon, agent.color, agent.systemPrompt, JSON.stringify(agent.allowedTools), agent.maxTurns, now, now);

  return getCustomAgent(id)!;
}

export function getCustomAgent(id: string): CustomAgent | null {
  const d = getDb();
  const row = d.prepare('SELECT * FROM custom_agents WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  if (!row) return null;

  return {
    id: row.id as string,
    name: row.name as string,
    description: row.description as string,
    icon: row.icon as string,
    color: row.color as string,
    systemPrompt: row.system_prompt as string,
    allowedTools: JSON.parse(row.allowed_tools as string),
    maxTurns: row.max_turns as number,
    createdAt: row.created_at as number,
    updatedAt: row.updated_at as number,
  };
}

export function listCustomAgents(): CustomAgent[] {
  const d = getDb();
  const rows = d.prepare('SELECT * FROM custom_agents ORDER BY created_at DESC').all() as Record<string, unknown>[];

  return rows.map((row) => ({
    id: row.id as string,
    name: row.name as string,
    description: row.description as string,
    icon: row.icon as string,
    color: row.color as string,
    systemPrompt: row.system_prompt as string,
    allowedTools: JSON.parse(row.allowed_tools as string),
    maxTurns: row.max_turns as number,
    createdAt: row.created_at as number,
    updatedAt: row.updated_at as number,
  }));
}

export function updateCustomAgent(id: string, updates: Partial<Omit<CustomAgent, 'id' | 'createdAt'>>): CustomAgent | null {
  const d = getDb();
  const existing = getCustomAgent(id);
  if (!existing) return null;

  const now = Date.now();
  const fields: string[] = [];
  const values: unknown[] = [];

  if (updates.name !== undefined) { fields.push('name = ?'); values.push(updates.name); }
  if (updates.description !== undefined) { fields.push('description = ?'); values.push(updates.description); }
  if (updates.icon !== undefined) { fields.push('icon = ?'); values.push(updates.icon); }
  if (updates.color !== undefined) { fields.push('color = ?'); values.push(updates.color); }
  if (updates.systemPrompt !== undefined) { fields.push('system_prompt = ?'); values.push(updates.systemPrompt); }
  if (updates.allowedTools !== undefined) { fields.push('allowed_tools = ?'); values.push(JSON.stringify(updates.allowedTools)); }
  if (updates.maxTurns !== undefined) { fields.push('max_turns = ?'); values.push(updates.maxTurns); }

  fields.push('updated_at = ?');
  values.push(now);

  values.push(id);

  d.prepare(`UPDATE custom_agents SET ${fields.join(', ')} WHERE id = ?`).run(...values);

  return getCustomAgent(id);
}

export function deleteCustomAgent(id: string): boolean {
  const d = getDb();
  const result = d.prepare('DELETE FROM custom_agents WHERE id = ?').run(id);
  return result.changes > 0;
}

export function customAgentToAgentType(agent: CustomAgent): AgentType {
  return {
    id: agent.id,
    name: agent.name,
    description: agent.description,
    icon: agent.icon,
    color: agent.color,
    systemPrompt: agent.systemPrompt,
    allowedTools: agent.allowedTools,
    maxTurns: agent.maxTurns,
  };
}
