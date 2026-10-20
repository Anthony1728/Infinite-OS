// Picking up the conversation after a restart.
//
// THE PROBLEM
//
// When Infinite AI edits Infinite OS's own source, the app restarts — which is
// the single most likely way for a run to be cut off. Before streaming messages
// to disk, a transcript was written only once the run returned, so a restart left
// a file with the user's question and nothing else. Every tool call, result and
// reply it had already produced was gone. Worse, on the next launch the chat view
// opened empty with no session selected, so the user had no idea a conversation
// was even waiting.
//
// WHAT THIS DOES
//
// A run marks a session as in-progress while it works, and clears the mark when
// it finishes. If a mark is still set at startup, the run was interrupted — and
// because messages are now persisted as they happen, the transcript holds
// exactly what really got done. This reads that back and reports it plainly.
//
// The report is derived from the transcript, never from memory of an intent:
// if it says a file was written, a `Write` really did run.

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { infiniteHome } from '../profiles/home.js';
import { loadMessages, loadSessionMeta } from '../session/store.js';
import type { ContentBlock } from '../../shared/types.js';

const DIR = join(infiniteHome(), 'resume');

/** How long a marker may sit before it is treated as stale rather than a crash. */
const MARKER_TTL_MS = 6 * 60 * 60 * 1000;

export interface InterruptedRun {
  sessionId: string;
  /** The user's last request, so the user can see what was interrupted. */
  request: string;
  /** Real, human-readable lines describing what actually happened. */
  done: string[];
  /** Counts, so the summary is not just prose. */
  toolsRun: number;
  toolsFailed: number;
  filesTouched: string[];
  startedAt: number;
  updatedAt: number;
}

function markerPath(sessionId: string): string {
  return join(DIR, `${sessionId}.json`);
}

function ensureDir(): void {
  if (!existsSync(DIR)) mkdirSync(DIR, { recursive: true });
}

/** Record that a run has started. Cheap and synchronous — it runs per turn. */
export function markRunStarted(sessionId: string, request: string): void {
  try {
    ensureDir();
    const existing = readMarker(sessionId);
    const now = Date.now();
    writeFileSync(
      markerPath(sessionId),
      JSON.stringify({
        sessionId,
        request,
        startedAt: existing?.startedAt ?? now,
        // Bumped on every turn so a marker mid-turn is visibly live, and a
        // marker untouched for a long time can be treated as abandoned.
        updatedAt: now,
      }),
      'utf8',
    );
  } catch {
    // Never let bookkeeping break the actual run.
  }
}

function readMarker(sessionId: string): InterruptedRun | null {
  try {
    const path = markerPath(sessionId);
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, 'utf-8')) as InterruptedRun;
  } catch {
    return null;
  }
}

export function clearRunMarker(sessionId: string): void {
  try {
    rmSync(markerPath(sessionId), { force: true });
  } catch {
    /* ignore */
  }
}

/** A short, speakable description of what a tool was pointed at. */
function describeTool(name: string, input: unknown): string {
  const record = (input ?? {}) as Record<string, unknown>;
  const target =
    (typeof record.file_path === 'string' && record.file_path) ||
    (typeof record.path === 'string' && record.path) ||
    (typeof record.command === 'string' && record.command) ||
    (typeof record.url === 'string' && record.url) ||
    (typeof record.query === 'string' && record.query) ||
    (typeof record.pattern === 'string' && record.pattern) ||
    '';
  const short = target.length > 70 ? `${target.slice(0, 70)}…` : target;
  return short ? `${name} — ${short}` : name;
}

/**
 * Read a session's transcript and say what really happened.
 *
 * Counts every tool call and every tool result that is actually in the
 * transcript, so the summary cannot claim work that did not occur.
 */
export async function summariseInterruptedRun(sessionId: string): Promise<InterruptedRun | null> {
  const marker = readMarker(sessionId);
  if (!marker) return null;

  // A stale marker means the run finished long ago and the process died later;
  // reporting that as "interrupted" would be wrong.
  if (Date.now() - (marker.updatedAt ?? 0) > MARKER_TTL_MS) {
    clearRunMarker(sessionId);
    return null;
  }

  const messages = await loadMessages(sessionId).catch(() => []);
  if (messages.length === 0) {
    clearRunMarker(sessionId);
    return null;
  }

  // Map tool_use id -> name, so each tool_result can be attributed and matched
  // as a real pair rather than counted blindly.
  const toolNames = new Map<string, string>();
  const done: string[] = [];
  const filesTouched = new Set<string>();
  let toolsRun = 0;
  let toolsFailed = 0;

  for (const message of messages) {
    for (const block of (message.content ?? []) as ContentBlock[]) {
      if (block.type === 'tool_use') {
        toolsRun += 1;
        toolNames.set(block.id, block.name);
        const label = describeTool(block.name, block.input);
        // Keep the list readable; the counts above stay exact.
        if (done.length < 8 && !done.includes(label)) done.push(label);
        const filePath = (block.input as Record<string, unknown> | undefined)?.file_path;
        if (typeof filePath === 'string' && filePath) filesTouched.add(filePath);
      } else if (block.type === 'tool_result') {
        if (block.is_error) toolsFailed += 1;
      }
    }
  }

  // Only report a failure whose tool actually started, so a stray result cannot
  // inflate the error count.
  if (toolsRun > 0 && toolsFailed > toolsRun) toolsFailed = toolsRun;

  const request = messages
    .filter((m) => m.role === 'user')
    .flatMap((m) => (m.content ?? []) as ContentBlock[])
    .filter((b): b is Extract<ContentBlock, { type: 'text' }> => b.type === 'text')
    .map((b) => b.text.trim())
    .filter((text) => text && !text.startsWith('[User update') && !text.startsWith('[Execution guard'))
    .at(-1) ?? marker.request ?? '';

  return {
    sessionId,
    request,
    done,
    toolsRun,
    toolsFailed,
    filesTouched: [...filesTouched],
    startedAt: marker.startedAt ?? Date.now(),
    updatedAt: marker.updatedAt ?? Date.now(),
  };
}

/**
 * Every session that looks like it was cut off by a restart, newest first.
 *
 * Called once at startup so the user is told what happened without having to go
 * looking for it.
 */
export async function findInterruptedRuns(): Promise<InterruptedRun[]> {
  let files: string[];
  try {
    if (!existsSync(DIR)) return [];
    files = readdirSync(DIR);
  } catch {
    return [];
  }

  const results: InterruptedRun[] = [];
  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    const sessionId = file.replace(/\.json$/, '');
    // A marker whose transcript has since been deleted is meaningless.
    if (!(await loadSessionMeta(sessionId).catch(() => null))) {
      clearRunMarker(sessionId);
      continue;
    }
    const summary = await summariseInterruptedRun(sessionId).catch(() => null);
    if (summary) results.push(summary);
  }
  return results.sort((a, b) => b.updatedAt - a.updatedAt);
}