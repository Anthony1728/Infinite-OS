// Session store — append-only JSONL transcripts, indexed by SQLite FTS5 for search.

import { appendFile, readFile, writeFile, mkdir, unlink, readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { homedir } from 'node:os';
import type { Message, Session } from '../../shared/types.js';
import { v4 as uuid } from 'uuid';

const DIR = join(homedir(), '.infinite-ai', 'sessions');

export async function ensureDir(): Promise<void> {
  await mkdir(DIR, { recursive: true });
}

export function sessionPath(id: string): string {
  return join(DIR, `${id}.jsonl`);
}

export async function createSession(opts: { cwd: string; model: string; provider: string; title?: string }): Promise<Session> {
  await ensureDir();
  const id = uuid();
  const session: Session = {
    id,
    title: opts.title ?? 'New session',
    created_at: Date.now(),
    updated_at: Date.now(),
    cwd: opts.cwd,
    model: opts.model,
    provider: opts.provider,
    message_count: 0,
  };
  const path = sessionPath(id);
  await writeFile(path, JSON.stringify({ type: 'meta', ...session }) + '\n', 'utf8');
  return session;
}

export async function appendMessage(sessionId: string, message: Message): Promise<void> {
  await ensureDir();
  const path = sessionPath(sessionId);
  await appendFile(path, JSON.stringify({ type: 'message', ...message }) + '\n', 'utf8');
  // Touch updated_at
  try {
    const session = await loadSessionMeta(sessionId);
    if (session) {
      session.updated_at = Date.now();
      session.message_count += 1;
      session.preview = previewFromMessage(message);
    }
  } catch { /* skip */ }
}

function previewFromMessage(m: Message): string {
  const first = m.content.find((b) => b.type === 'text');
  if (first && first.type === 'text') return first.text.slice(0, 120);
  return `[${m.role}]`;
}

export async function loadSessionMeta(id: string): Promise<Session | null> {
  const path = sessionPath(id);
  if (!existsSync(path)) return null;
  const content = await readFile(path, 'utf8');
  const firstLine = content.split('\n')[0];
  if (!firstLine) return null;
  try {
    return JSON.parse(firstLine) as Session;
  } catch {
    return null;
  }
}

export async function loadMessages(id: string): Promise<Message[]> {
  const path = sessionPath(id);
  if (!existsSync(path)) return [];
  const content = await readFile(path, 'utf8');
  const out: Message[] = [];
  for (const line of content.split('\n')) {
    if (!line.trim()) continue;
    try {
      const obj = JSON.parse(line);
      if (obj.type === 'message') {
        const { type: _t, ...rest } = obj;
        out.push(rest as Message);
      }
    } catch { /* skip */ }
  }
  return out;
}

export async function listSessions(): Promise<Session[]> {
  await ensureDir();
  const files = (await readdir(DIR)).filter((f) => f.endsWith('.jsonl'));
  const out: Session[] = [];
  for (const f of files) {
    const id = basename(f, '.jsonl');
    const meta = await loadSessionMeta(id);
    if (meta) out.push(meta);
  }
  return out.sort((a, b) => b.updated_at - a.updated_at);
}

export async function deleteSession(id: string): Promise<void> {
  const path = sessionPath(id);
  if (existsSync(path)) await unlink(path);
}

export async function cleanupOld(maxAgeDays: number): Promise<number> {
  await ensureDir();
  const cutoff = Date.now() - maxAgeDays * 86_400_000;
  const files = await readdir(DIR);
  let deleted = 0;
  for (const f of files) {
    const full = join(DIR, f);
    const s = await stat(full);
    if (s.mtimeMs < cutoff) {
      await unlink(full);
      deleted++;
    }
  }
  return deleted;
}
