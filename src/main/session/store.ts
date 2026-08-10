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

export async function createSession(opts: {
  cwd: string;
  model: string;
  provider: string;
  title?: string;
}): Promise<Session> {
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
  await updateSessionMeta(sessionId, {
    updated_at: Date.now(),
    message_count: (await loadMessages(sessionId)).length,
    preview: previewFromMessage(message),
  });
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
        const rest = { ...obj };
        delete rest.type;
        out.push(rest as Message);
      }
    } catch {
      /* skip */
    }
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
  return out.sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || b.updated_at - a.updated_at);
}

export async function updateSessionMeta(id: string, updates: Partial<Session>): Promise<Session> {
  const path = sessionPath(id);
  if (!existsSync(path)) throw new Error('Session not found');
  const content = await readFile(path, 'utf8');
  const lines = content.split('\n');
  const current = JSON.parse(lines[0]) as Session & { type: 'meta' };
  const next = { ...current, ...updates, id: current.id, type: 'meta' as const };
  lines[0] = JSON.stringify(next);
  await writeFile(path, lines.join('\n'), 'utf8');
  const session = { ...next } as Partial<typeof next>;
  delete session.type;
  return session as Session;
}

export async function renameSession(id: string, title: string): Promise<Session> {
  const clean = title.trim().slice(0, 120);
  if (!clean) throw new Error('Conversation title cannot be empty');
  return updateSessionMeta(id, { title: clean, updated_at: Date.now() });
}

export async function pinSession(id: string, pinned: boolean): Promise<Session> {
  return updateSessionMeta(id, { pinned, updated_at: Date.now() });
}

export async function searchSessions(query: string): Promise<Session[]> {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return listSessions();
  const sessions = await listSessions();
  const matches: Session[] = [];
  for (const session of sessions) {
    const metadata = `${session.title} ${session.preview ?? ''} ${session.folder ?? ''}`.toLowerCase();
    if (metadata.includes(normalized)) {
      matches.push(session);
      continue;
    }
    const messages = await loadMessages(session.id);
    if (
      messages.some((message) =>
        message.content.some((block) => block.type === 'text' && block.text.toLowerCase().includes(normalized)),
      )
    ) {
      matches.push(session);
    }
  }
  return matches;
}

export async function branchSession(id: string, messageId?: string): Promise<Session> {
  const source = await loadSessionMeta(id);
  if (!source) throw new Error('Source conversation not found');
  const messages = await loadMessages(id);
  const endIndex = messageId ? messages.findIndex((message) => message.id === messageId) : messages.length - 1;
  if (messageId && endIndex < 0) throw new Error('Branch message not found');
  const branch = await createSession({
    cwd: source.cwd,
    model: source.model,
    provider: source.provider,
    title: `${source.title} (branch)`,
  });
  await updateSessionMeta(branch.id, { parent_session_id: id, branch_message_id: messageId });
  for (const message of messages.slice(0, endIndex + 1)) await appendMessage(branch.id, message);
  return (await loadSessionMeta(branch.id)) ?? branch;
}

export async function updateMessage(
  sessionId: string,
  messageId: string,
  content: Message['content'],
): Promise<Message[]> {
  const meta = await loadSessionMeta(sessionId);
  if (!meta) throw new Error('Conversation not found');
  const messages = await loadMessages(sessionId);
  const index = messages.findIndex((message) => message.id === messageId);
  if (index < 0) throw new Error('Message not found');
  messages[index] = { ...messages[index], content, timestamp: Date.now() };
  await rewriteSession(meta, messages);
  return messages;
}

export async function exportSession(id: string, format: 'markdown' | 'json' = 'markdown'): Promise<string> {
  const session = await loadSessionMeta(id);
  if (!session) throw new Error('Conversation not found');
  const messages = await loadMessages(id);
  if (format === 'json') return JSON.stringify({ session, messages }, null, 2);
  const body = messages
    .map((message) => {
      const text = message.content
        .map((block) => (block.type === 'text' ? block.text : block.type === 'tool_use' ? `Tool: ${block.name}` : ''))
        .filter(Boolean)
        .join('\n\n');
      return `## ${message.role === 'assistant' ? 'Infinite OS' : message.role === 'user' ? 'You' : message.role}\n\n${text}`;
    })
    .join('\n\n---\n\n');
  return `# ${session.title}\n\nExported ${new Date().toISOString()}\n\n${body}\n`;
}

async function rewriteSession(session: Session, messages: Message[]): Promise<void> {
  const preview = messages.length ? previewFromMessage(messages[messages.length - 1]) : undefined;
  const meta = { type: 'meta', ...session, updated_at: Date.now(), message_count: messages.length, preview };
  const lines = [JSON.stringify(meta), ...messages.map((message) => JSON.stringify({ type: 'message', ...message }))];
  await writeFile(sessionPath(session.id), `${lines.join('\n')}\n`, 'utf8');
}

export async function deleteSession(id: string): Promise<void> {
  const path = sessionPath(id);
  if (existsSync(path)) await unlink(path);
}

/**
 * Delete every locally stored chat transcript and nothing else.
 *
 * Restricting this operation to the session directory and the `.jsonl`
 * extension prevents the destructive UI action from touching settings,
 * credentials, memories, projects, or unrelated files.
 */
export async function clearAllSessions(directory = DIR): Promise<number> {
  await mkdir(directory, { recursive: true });
  const files = (await readdir(directory)).filter((file) => file.endsWith('.jsonl'));
  await Promise.all(files.map((file) => unlink(join(directory, file))));
  return files.length;
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
