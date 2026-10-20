// Session store — append-only JSONL transcripts plus a tiny meta sidecar.
//
// Transcripts are append-only JSONL. The current metadata (title, preview,
// archive flag, message count) lives in `<id>.meta.json` next to them, because
// updating it inside the transcript would mean rewriting every message on each
// append. See `meta.ts` for why.

import { appendFile, readFile, writeFile, mkdir, unlink, readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import type { Message, Session } from '../../shared/types.js';
import { v4 as uuid } from 'uuid';
import { sessionsDir } from './paths.js';
import { searchConversations } from './search.js';
import {
  countTranscriptMessages,
  hasMetaSidecar,
  isMetaSidecarFile,
  metaPathFor,
  readSessionMetaFile,
  writeSessionMetaFile,
  writeTranscriptHeader,
} from './meta.js';

/** Upper bound on how many conversations one search may return. */
const SEARCH_RESULT_CAP = 200;

export async function ensureDir(): Promise<void> {
  await mkdir(sessionsDir(), { recursive: true });
}

export function sessionPath(id: string): string {
  return join(sessionsDir(), `${id}.jsonl`);
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
  // The header line stays as a creation-time stamp so a transcript is still
  // self-describing; the sidecar is what readers treat as current.
  await writeTranscriptHeader(path, session);
  await writeSessionMetaFile(path, session);
  return session;
}

/**
 * Serialises appends per conversation.
 *
 * Appending used to read the whole transcript to recount its messages, which
 * made every message cost more than the last (95 ms each on a 1 MB thread,
 * measured). The count now comes from the meta sidecar, which is only correct
 * if two appends cannot read the same count and write the same increment — so
 * appends for one conversation run strictly one after another. Appends to
 * different conversations still run in parallel.
 */
const appendQueues = new Map<string, Promise<void>>();

export async function appendMessage(sessionId: string, message: Message): Promise<void> {
  const previous = appendQueues.get(sessionId) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(() => appendMessageNow(sessionId, message));
  const settled = next.catch(() => undefined);
  appendQueues.set(sessionId, settled);
  void settled.then(() => {
    if (appendQueues.get(sessionId) === settled) appendQueues.delete(sessionId);
  });
  return next;
}

async function appendMessageNow(sessionId: string, message: Message): Promise<void> {
  await ensureDir();
  const path = sessionPath(sessionId);
  const exists = existsSync(path);
  const current = exists ? await loadSessionMeta(sessionId) : null;
  const line = `${JSON.stringify({ type: 'message', ...message })}\n`;

  if (current) {
    // The count comes from the sidecar. For a conversation that predates
    // sidecars there is none yet, so seed the count from the transcript once —
    // its header may carry a stale number — and keep it from there.
    const seeded = (await hasMetaSidecar(path))
      ? (current.message_count ?? 0)
      : await countTranscriptMessages(path);
    await appendFile(path, line, 'utf8');
    await writeSessionMetaFile(path, {
      ...current,
      updated_at: Date.now(),
      message_count: seeded + 1,
      preview: previewFromMessage(message),
    });
    return;
  }

  // No usable meta: either the conversation was never created (the phone
  // remote appends to an id with no create step) or its first line is a
  // message rather than a header. Appending used to leave such a file with no
  // meta at all — every reader then reported "Session not found" — so write the
  // sidecar now, and a header line only while the transcript is still empty.
  const preview = previewFromMessage(message);
  const prior = exists ? await countTranscriptMessages(path) : 0;
  const meta: Session = {
    id: sessionId,
    title: preview.startsWith('[') ? 'New session' : preview,
    created_at: Date.now(),
    updated_at: Date.now(),
    cwd: process.cwd(),
    model: 'unknown',
    provider: 'unknown',
    message_count: prior + 1,
    preview,
  };
  if (!exists) await writeTranscriptHeader(path, { ...meta, message_count: 0 });
  await appendFile(path, line, 'utf8');
  await writeSessionMetaFile(path, meta);
}

function previewFromMessage(m: Message): string {
  const first = m.content.find((b) => b.type === 'text');
  if (first && first.type === 'text') return first.text.slice(0, 120);
  return `[${m.role}]`;
}

export async function loadSessionMeta(id: string): Promise<Session | null> {
  const path = sessionPath(id);
  if (!existsSync(path)) return null;
  return readSessionMetaFile(path);
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
  const files = (await readdir(sessionsDir())).filter((f) => f.endsWith('.jsonl'));
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
  const current = await loadSessionMeta(id);
  if (!current) throw new Error('Session not found');
  const next: Session = { ...current, ...updates, id: current.id };
  await writeSessionMetaFile(path, next);
  return next;
}

export async function renameSession(id: string, title: string): Promise<Session> {
  const clean = title.trim().slice(0, 120);
  if (!clean) throw new Error('Conversation title cannot be empty');
  return updateSessionMeta(id, { title: clean, updated_at: Date.now() });
}

export async function pinSession(id: string, pinned: boolean): Promise<Session> {
  return updateSessionMeta(id, { pinned, updated_at: Date.now() });
}

/**
 * Move a conversation into or out of the archive.
 *
 * Archiving is a flag on the session, not a move: the transcript stays exactly
 * where it is and is never rewritten. That matters because a conversation can be
 * unarchived, searched and resumed like any other — an archive that relocated
 * files would need a matching un-move, and any mismatch would strand the
 * transcript.
 */
export async function setSessionArchived(id: string, archived: boolean): Promise<Session> {
  return updateSessionMeta(id, {
    archived,
    // Stamped on both directions so the archive can be ordered by when a
    // conversation was filed rather than when it was last edited.
    ...(archived ? { archived_at: Date.now() } : { archived_at: undefined }),
    updated_at: Date.now(),
  });
}

/** Only archived conversations. */
export async function listArchivedSessions(): Promise<Session[]> {
  const sessions = await listSessions();
  return sessions
    .filter((session) => session.archived)
    .sort((a, b) => (b.archived_at ?? b.updated_at) - (a.archived_at ?? a.updated_at));
}

/**
 * Search the archive by content.
 *
 * `searchSessions` already walks message text, but it also matches titles and
 * previews of live chats. Archived search deliberately looks only inside the
 * archive, so a query cannot quietly return conversations the user filed away.
 */
export async function searchArchivedSessions(query: string): Promise<Session[]> {
  if (!query.trim()) return listArchivedSessions();
  const hits = await searchConversations({ query, archivedOnly: true, maxSessions: SEARCH_RESULT_CAP });
  return hits.map((hit) => hit.session);
}

/**
 * Search the live conversations by content.
 *
 * Archived conversations are filed away, so they never turn up here - the
 * same rule the session list itself follows. Matching is tokenised, so
 * "deploy postgres" finds a chat that says "deploy the postgres database",
 * and a conversation only qualifies when every word of the query is in it.
 */
export async function searchSessions(query: string): Promise<Session[]> {
  if (!query.trim()) {
    const sessions = await listSessions();
    return sessions.filter((session) => !session.archived);
  }
  const hits = await searchConversations({ query, maxSessions: SEARCH_RESULT_CAP });
  return hits.map((hit) => hit.session);
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
  const updated_at = Date.now();
  const meta = { type: 'meta', ...session, updated_at, message_count: messages.length, preview };
  const lines = [JSON.stringify(meta), ...messages.map((message) => JSON.stringify({ type: 'message', ...message }))];
  await writeFile(sessionPath(session.id), `${lines.join('\n')}\n`, 'utf8');
  // Keep the authoritative sidecar in step with the rewritten transcript.
  await writeSessionMetaFile(sessionPath(session.id), { ...session, updated_at, message_count: messages.length, preview });
}

export async function deleteSession(id: string): Promise<void> {
  const path = sessionPath(id);
  if (existsSync(path)) await unlink(path);
  await unlink(metaPathFor(path)).catch(() => undefined);
}

/**
 * Delete every locally stored chat transcript and nothing else.
 *
 * Restricting this operation to the session directory and the `.jsonl`
 * extension prevents the destructive UI action from touching settings,
 * credentials, memories, projects, or unrelated files.
 */
export async function clearAllSessions(directory = sessionsDir()): Promise<number> {
  await mkdir(directory, { recursive: true });
  const files = (await readdir(directory)).filter((file) => file.endsWith('.jsonl'));
  const sidecars = (await readdir(directory)).filter(isMetaSidecarFile);
  await Promise.all([
    ...files.map((file) => unlink(join(directory, file))),
    // Sidecars ride along with the transcripts; the return value still counts
    // conversations, which is what the UI reports.
    ...sidecars.map((file) => unlink(join(directory, file)).catch(() => undefined)),
  ]);
  return files.length;
}

export async function cleanupOld(maxAgeDays: number): Promise<number> {
  await ensureDir();
  const cutoff = Date.now() - maxAgeDays * 86_400_000;
  const files = await readdir(sessionsDir());
  let deleted = 0;
  for (const f of files) {
    const full = join(sessionsDir(), f);
    const s = await stat(full);
    if (s.mtimeMs < cutoff) {
      await unlink(full);
      // Drop the matching sidecar too so the directory cannot accumulate
      // orphans. Only transcripts count as deleted conversations.
      if (f.endsWith('.jsonl')) {
        await unlink(metaPathFor(full)).catch(() => undefined);
        deleted++;
      }
    }
  }
  return deleted;
}

const IMPORT_ROLES = new Set(['user', 'assistant', 'system', 'tool']);

function sanitizeImportedMessage(raw: unknown, fallbackModel: string, fallbackProvider: string): Message | null {
  if (!raw || typeof raw !== 'object') return null;
  const m = raw as Record<string, unknown>;
  if (!IMPORT_ROLES.has(String(m.role))) return null;
  const blocks = Array.isArray(m.content)
    ? (m.content as unknown[]).filter(
        (b): b is Message['content'][number] =>
          !!b && typeof b === 'object' && (b as { type?: unknown }).type === 'text' &&
          typeof (b as { text?: unknown }).text === 'string',
      )
    : typeof m.content === 'string'
      ? [{ type: 'text' as const, text: m.content }]
      : [];
  if (!blocks.length) return null;
  return {
    id: typeof m.id === 'string' && m.id ? m.id : uuid(),
    role: m.role as Message['role'],
    content: blocks.map((b) => (b.type === 'text' ? { type: 'text' as const, text: b.text.slice(0, 50000) } : b)),
    timestamp: typeof m.timestamp === 'number' && Number.isFinite(m.timestamp) ? m.timestamp : Date.now(),
    model: typeof m.model === 'string' ? m.model : fallbackModel,
    provider: typeof m.provider === 'string' ? m.provider : fallbackProvider,
  };
}

/**
 * Import a session from exported content.
 * - json: Infinite OS `{ session, messages }` export (or bare messages array).
 * - markdown: whole file becomes one user message; title from first `# `.
 * Returns the new session (fresh id — never overwrites an existing one).
 */
export async function importSession(opts: {
  format: 'markdown' | 'json';
  content: string;
  cwd: string;
  model: string;
  provider: string;
}): Promise<Session> {
  const MAX_CHARS = 500_000;
  const MAX_MESSAGES = 500;
  if (!opts.content || !opts.content.trim()) throw new Error('Import file is empty');
  if (opts.content.length > MAX_CHARS) throw new Error('Import file is too large (max ~500KB)');

  let title = 'Imported session';
  let messages: Message[] = [];

  if (opts.format === 'json') {
    let parsed: unknown;
    try {
      parsed = JSON.parse(opts.content);
    } catch {
      throw new Error('Invalid JSON — expected an Infinite OS session export');
    }
    const root = parsed as Record<string, unknown>;
    const rawMessages = Array.isArray(root) ? root : (root.messages as unknown);
    if (!Array.isArray(rawMessages)) throw new Error('Invalid session JSON — missing messages array');
    if (typeof root.session === 'object' && root.session !== null) {
      const t = (root.session as Record<string, unknown>).title;
      if (typeof t === 'string' && t.trim()) title = t.trim().slice(0, 120);
    }
    messages = rawMessages
      .slice(0, MAX_MESSAGES)
      .map((m) => sanitizeImportedMessage(m, opts.model, opts.provider))
      .filter((m): m is Message => m !== null);
    if (!messages.length) throw new Error('No importable messages found (need user/assistant text turns)');
  } else {
    const firstHeading = opts.content.match(/^#\s+(.+)$/m)?.[1]?.trim();
    if (firstHeading) title = firstHeading.slice(0, 120);
    messages = [
      {
        id: uuid(),
        role: 'user',
        content: [{ type: 'text', text: opts.content.slice(0, 50000) }],
        timestamp: Date.now(),
        model: opts.model,
        provider: opts.provider,
      },
    ];
  }

  const session = await createSession({ cwd: opts.cwd, model: opts.model, provider: opts.provider, title });
  for (const message of messages) await appendMessage(session.id, message);
  return { ...session, message_count: messages.length };
}
