// Conversation search engine — one implementation for the session list, the
// archive and the agent-facing ConversationSearch tool.
//
// Every leading AI workspace shipped the same idea in 2026: the agent can find
// its own earlier conversations. Claude Code pairs search with rewind, OpenCode
// filters sessions server-side, Grok Build indexes them, and OpenClaw turned
// it into a headline feature ("recall relevant context from that agent's other
// private conversations") with a `sessions_search` tool that returns snippets
// plus the session and message ids needed to pull the full transcript.
//
// Infinite OS had the transcripts on disk and a search box in the sidebar, but
// the scan was a literal substring test: "deploy postgres" never matched
// "deploy the postgres database", a title hit was thrown away because the body
// did not repeat it, and the agent could not reach any of it. This module
// fixes all three and is shared by every consumer so a query means the same
// thing wherever it is typed.

import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { Message, Session } from '../../shared/types.js';
import { sessionsDir } from './paths.js';
import { readSidecarMeta } from './meta.js';

export interface SearchTerm {
  /** Lowercased term. Phrase terms keep their spaces. */
  text: string;
  /** True when the term came from a quoted phrase and must match literally. */
  phrase: boolean;
}

export interface ParsedQuery {
  /** The query exactly as the user typed it. */
  raw: string;
  /** Every term must match for a conversation to qualify. */
  terms: SearchTerm[];
}

export type SnippetSource = 'message' | 'title' | 'preview' | 'folder' | 'path';

export interface Snippet {
  sessionId: string;
  title: string;
  role: string;
  messageId: string;
  snippet: string;
  updatedAt: number;
  /** Where the match was found. */
  source: SnippetSource;
  /** The terms that matched inside this snippet. */
  terms: string[];
}

export interface ConversationHit {
  session: Session;
  score: number;
  /** Which parts of the conversation matched. */
  reasons: string[];
  snippets: Snippet[];
  archived: boolean;
}

export interface ConversationSearchOptions {
  query: string;
  /** Also look at conversations filed in the archive. */
  includeArchived?: boolean;
  /** Look only at the archive. */
  archivedOnly?: boolean;
  /** Restrict body matches to one speaker. */
  role?: 'user' | 'assistant' | 'any';
  /** Characters of context kept around each match. */
  contextChars?: number;
  /** Snippets kept per conversation. */
  maxSnippetsPerSession?: number;
  /** Conversations returned. */
  maxSessions?: number;
}

export const DEFAULT_CONTEXT_CHARS = 90;
export const DEFAULT_SNIPPETS_PER_SESSION = 3;
export const DEFAULT_MAX_SESSIONS = 10;

// A title hit is the strongest signal a conversation carries, a body hit is
// the most common one. These weights keep a titled match above a long chat
// that happens to mention the word more often.
const TITLE_EXACT = 120;
const TITLE_LOOSE = 70;
const FOLDER_EXACT = 40;
const FOLDER_LOOSE = 25;
const PREVIEW_EXACT = 25;
const PREVIEW_LOOSE = 15;
const BODY_EXACT = 6;
const BODY_LOOSE = 3;
const BODY_SCORE_CAP = 90;

/**
 * Words that carry no retrieval signal. They are dropped so a natural
 * question ("what did we decide about the billing service") does not become a
 * six-term AND that matches nothing. When a query is made only of these words
 * they are kept, so it still means something.
 */
const STOP_WORDS = new Set([
  'a', 'about', 'all', 'am', 'an', 'and', 'any', 'are', 'as', 'at', 'be', 'been', 'but', 'by', 'can',
  'did', 'do', 'does', 'for', 'from', 'had', 'has', 'have', 'he', 'her', 'him', 'his', 'how', 'i',
  'if', 'in', 'into', 'is', 'it', 'its', 'me', 'my', 'of', 'on', 'or', 'our', 'ours', 'out', 'she',
  'should', 'so', 'some', 'such', 'than', 'that', 'the', 'their', 'them', 'then', 'there', 'these',
  'they', 'this', 'those', 'to', 'too', 'up', 'us', 'was', 'we', 'were', 'what', 'when', 'where',
  'which', 'while', 'who', 'whom', 'why', 'will', 'with', 'would', 'you', 'your', 'yours',
]);

const WORD_CHAR = /[\p{L}\p{N}_]/u;

function clamp(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : fallback;
  return Math.min(max, Math.max(min, n));
}

function stripEdges(word: string): string {
  return word.replace(/^[^\p{L}\p{N}_]+/u, '').replace(/[^\p{L}\p{N}_]+$/u, '').toLowerCase();
}

/**
 * Turns a raw query into the terms a conversation has to satisfy.
 *
 * Quoted phrases stay whole and must match literally; everything else becomes
 * a single word. All terms must match (AND) — a conversation that only has
 * one of the words is not an answer to the question.
 */
export function parseQuery(query: string): ParsedQuery {
  const raw = (query ?? '').trim();
  if (!raw) return { raw, terms: [] };

  const phrases: string[] = [];
  const withoutPhrases = raw.replace(/"([^"]*)"/g, (_match, phrase: string) => {
    const clean = phrase.trim().toLowerCase();
    if (clean) phrases.push(clean);
    return ' ';
  });

  const words = withoutPhrases
    .split(/\s+/)
    .map(stripEdges)
    .filter((word) => word.length > 0);

  const meaningful = words.filter((word) => !STOP_WORDS.has(word));
  const chosen = meaningful.length > 0 ? meaningful : words;

  const terms: SearchTerm[] = [];
  const seen = new Set<string>();
  for (const phrase of phrases) {
    const key = `p:${phrase}`;
    if (seen.has(key)) continue;
    seen.add(key);
    terms.push({ text: phrase, phrase: true });
  }
  for (const word of chosen) {
    if (seen.has(word)) continue;
    seen.add(word);
    terms.push({ text: word, phrase: false });
  }
  return { raw, terms };
}

/** True when the match sits on a word boundary ("deploy" in "deploy the db"). */
function isBoundary(text: string, index: number, length: number): boolean {
  const before = index > 0 ? text[index - 1] : '';
  const after = index + length < text.length ? text[index + length] : '';
  const beforeOk = before === '' || !WORD_CHAR.test(before);
  const afterOk = after === '' || !WORD_CHAR.test(after);
  return beforeOk && afterOk;
}

export interface TextMatch {
  /** Indexes into the parsed term list that were found. */
  matched: number[];
  /** How many of those sat on a word boundary. */
  exact: number;
}

/**
 * Finds every term inside a piece of text. A term matches as a substring so
 * "deploy" still finds "deployment", but a boundary match scores higher.
 */
export function matchText(text: string, spec: ParsedQuery): TextMatch {
  const matched: number[] = [];
  let exact = 0;
  if (!text) return { matched, exact };
  const lower = text.toLowerCase();
  for (let i = 0; i < spec.terms.length; i++) {
    const term = spec.terms[i];
    const index = lower.indexOf(term.text);
    if (index < 0) continue;
    matched.push(i);
    if (isBoundary(lower, index, term.text.length)) exact += 1;
  }
  return { matched, exact };
}

/** Cuts a readable window around the match and normalises the whitespace. */
export function buildSnippet(text: string, spec: ParsedQuery, context: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  const lower = flat.toLowerCase();
  let best = -1;
  let bestLength = 0;
  for (const term of spec.terms) {
    const index = lower.indexOf(term.text);
    if (index >= 0 && (best < 0 || index < best)) {
      best = index;
      bestLength = term.text.length;
    }
  }
  if (best < 0) return flat.slice(0, context * 2);
  const start = Math.max(0, best - context);
  const end = Math.min(flat.length, best + bestLength + context);
  return `${start > 0 ? '…' : ''}${flat.slice(start, end)}${end < flat.length ? '…' : ''}`;
}

function textOf(block: unknown): string {
  if (!block || typeof block !== 'object') return '';
  const b = block as { type?: string; text?: unknown };
  return b.type === 'text' && typeof b.text === 'string' ? b.text : '';
}

/** A message shape loose enough for callers that only know about text blocks. */
export interface LooseMessage {
  id?: string;
  role?: string;
  content?: unknown[];
}

/**
 * Pulls the passages of a single conversation that mention `needle`.
 *
 * Kept as a standalone helper so the tool, the tests and any future caller
 * share one snippet implementation.
 */
export function collectSnippets(
  session: { id: string; title: string; updated_at: number },
  messages: LooseMessage[],
  needle: string,
  context: number,
): Snippet[] {
  const spec = parseQuery(needle);
  if (spec.terms.length === 0) return [];

  const hits: Array<{ role: string; messageId: string; text: string; matched: number[] }> = [];
  for (const message of messages ?? []) {
    const blocks = Array.isArray(message.content) ? message.content : [];
    for (const block of blocks) {
      const text = textOf(block);
      if (!text) continue;
      const match = matchText(text, spec);
      if (match.matched.length === 0) continue;
      hits.push({
        role: message.role ?? 'unknown',
        messageId: message.id ?? '',
        text,
        matched: match.matched,
      });
    }
  }

  return hits.slice(0, DEFAULT_SNIPPETS_PER_SESSION).map((hit) => ({
    sessionId: session.id,
    title: session.title,
    role: hit.role,
    messageId: hit.messageId,
    snippet: buildSnippet(hit.text, spec, context),
    updatedAt: session.updated_at,
    source: 'message' as SnippetSource,
    terms: hit.matched.map((index) => spec.terms[index].text),
  }));
}

/** Splits a JSONL transcript into its metadata header and its messages. */
function parseTranscript(content: string): { meta: Session | null; messages: Message[] } {
  const lines = content.split('\n');
  const messages: Message[] = [];
  let meta: Session | null = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    if (!parsed || typeof parsed !== 'object') continue;
    const record = parsed as Record<string, unknown>;
    if (i === 0 && record.type !== 'message') {
      const header = { ...record };
      delete header.type;
      meta = header as unknown as Session;
      continue;
    }
    if (record.type === 'message') {
      const message = { ...record };
      delete message.type;
      messages.push(message as unknown as Message);
    }
  }
  return { meta, messages };
}

interface FieldWeight {
  field: SnippetSource;
  text: string;
  exact: number;
  loose: number;
}

/**
 * Scores one conversation against the query.
 *
 * Every term has to be found somewhere in the conversation - title, folder,
 * path, preview or body - otherwise it is not an answer. A conversation whose
 * title matches but whose body never repeats the word still qualifies: the
 * match is reported against the title instead of being thrown away.
 */
function scoreConversation(
  session: Session,
  messages: Message[],
  spec: ParsedQuery,
  options: { role: 'user' | 'assistant' | 'any'; context: number; maxSnippets: number },
): ConversationHit | null {
  const matched = new Set<number>();
  const reasons: string[] = [];
  let score = 0;

  const fields: FieldWeight[] = [
    { field: 'title', text: session.title ?? '', exact: TITLE_EXACT, loose: TITLE_LOOSE },
    { field: 'folder', text: session.folder ?? '', exact: FOLDER_EXACT, loose: FOLDER_LOOSE },
    { field: 'path', text: session.cwd ?? '', exact: FOLDER_EXACT, loose: FOLDER_LOOSE },
    { field: 'preview', text: session.preview ?? '', exact: PREVIEW_EXACT, loose: PREVIEW_LOOSE },
  ];

  for (const field of fields) {
    if (!field.text) continue;
    // The preview is a copy of the opening message, so it would answer a
    // "what did I say" question with the other speaker's words.
    if (field.field === 'preview' && options.role !== 'any') continue;
    const match = matchText(field.text, spec);
    if (match.matched.length === 0) continue;
    for (const index of match.matched) matched.add(index);
    score += match.exact * field.exact + (match.matched.length - match.exact) * field.loose;
    reasons.push(field.field);
  }

  const bodyMatched = new Set<number>();
  let bodyScore = 0;
  const candidates: Array<{
    role: string;
    messageId: string;
    text: string;
    matched: number[];
    exact: number;
  }> = [];

  for (const message of messages) {
    if (options.role !== 'any' && message.role !== options.role) continue;
    const blocks = Array.isArray(message.content) ? message.content : [];
    for (const block of blocks) {
      const text = textOf(block);
      if (!text) continue;
      const match = matchText(text, spec);
      if (match.matched.length === 0) continue;
      for (const index of match.matched) bodyMatched.add(index);
      bodyScore += match.exact * BODY_EXACT + (match.matched.length - match.exact) * BODY_LOOSE;
      candidates.push({
        role: message.role ?? 'unknown',
        messageId: message.id ?? '',
        text,
        matched: match.matched,
        exact: match.exact,
      });
    }
  }

  if (candidates.length > 0) {
    reasons.push('message');
    for (const index of bodyMatched) matched.add(index);
    score += Math.min(bodyScore, BODY_SCORE_CAP);
  }

  if (spec.terms.length > 0) {
    for (let i = 0; i < spec.terms.length; i++) {
      if (!matched.has(i)) return null;
    }
  }

  candidates.sort((a, b) => b.matched.length - a.matched.length || b.exact - a.exact);
  const snippets: Snippet[] = candidates.slice(0, options.maxSnippets).map((candidate) => ({
    sessionId: session.id,
    title: session.title,
    role: candidate.role,
    messageId: candidate.messageId,
    snippet: buildSnippet(candidate.text, spec, options.context),
    updatedAt: session.updated_at,
    source: 'message' as SnippetSource,
    terms: candidate.matched.map((index) => spec.terms[index].text),
  }));

  if (snippets.length === 0) {
    // The conversation qualified on its metadata alone. Say which field
    // matched so the result is still actionable.
    const source = (reasons[0] ?? 'title') as SnippetSource;
    const value =
      source === 'title'
        ? session.title
        : source === 'preview'
          ? (session.preview ?? '')
          : source === 'folder'
            ? (session.folder ?? '')
            : (session.cwd ?? '');
    snippets.push({
      sessionId: session.id,
      title: session.title,
      role: 'metadata',
      messageId: '',
      snippet: `${source}: ${value}`,
      updatedAt: session.updated_at,
      source,
      terms: Array.from(matched).map((index) => spec.terms[index].text),
    });
  }

  return { session, score, reasons, snippets, archived: session.archived === true };
}

/**
 * Searches every transcript on disk and returns the conversations that match,
 * best first.
 *
 * Each transcript is read once, so a search costs one pass over the corpus
 * instead of the two the old substring scan needed.
 */
export async function searchConversations(
  options: ConversationSearchOptions,
): Promise<ConversationHit[]> {
  const spec = parseQuery(options.query);
  const role = options.role ?? 'any';
  const context = clamp(options.contextChars, DEFAULT_CONTEXT_CHARS, 20, 400);
  const maxSnippets = clamp(
    options.maxSnippetsPerSession,
    DEFAULT_SNIPPETS_PER_SESSION,
    1,
    5,
  );
  const maxSessions = clamp(options.maxSessions, DEFAULT_MAX_SESSIONS, 1, 500);
  const includeArchived = options.includeArchived === true;
  const archivedOnly = options.archivedOnly === true;

  const dir = sessionsDir();
  let files: string[] = [];
  try {
    files = (await readdir(dir)).filter((file) => file.endsWith('.jsonl'));
  } catch {
    return [];
  }

  const hits: ConversationHit[] = [];
  for (const file of files) {
    const transcriptPath = join(dir, file);
    const content = await readFile(transcriptPath, 'utf8').catch(() => null);
    if (content === null) continue;
    const { meta: header, messages } = parseTranscript(content);
    // The sidecar carries the current meta (renamed title, archive flag,
    // message count); the transcript header only carries the creation-time
    // values, so prefer the sidecar and fall back to the header for legacy
    // transcripts. Check the sidecar before giving up: a file whose first line
    // is a message rather than a header still has a sidecar once it has had an
    // append, and it must not disappear from search.
    const meta = (await readSidecarMeta(transcriptPath)) ?? header;
    if (!meta) continue;
    const archived = meta.archived === true;
    if (archivedOnly && !archived) continue;
    if (!archivedOnly && !includeArchived && archived) continue;
    const hit = scoreConversation(meta, messages, spec, { role, context, maxSnippets });
    if (hit) hits.push(hit);
  }

  hits.sort((a, b) => b.score - a.score || b.session.updated_at - a.session.updated_at);
  return hits.slice(0, maxSessions);
}
