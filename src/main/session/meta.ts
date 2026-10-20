// Session metadata location and IO.
//
// A conversation's meta used to live only on the transcript's first JSONL line.
// That is fine at creation and wrong under load: renaming a chat, archiving it,
// or appending a single message all rewrite that first line, and rewriting the
// first line of a JSONL file means reading, re-serialising and rewriting every
// byte after it. On a 1 MB transcript that was ~95 ms of main-process work per
// message, growing quadratically with the conversation.
//
// So the authoritative meta lives in a tiny sidecar next to the transcript —
// `<id>.meta.json` — which costs the same to update whether the conversation
// has three messages or three thousand. The first transcript line is kept as a
// creation-time header so transcripts stay self-describing (and so older files
// keep working), but nothing depends on it being current: readers go through
// `readSessionMetaFile`, which prefers the sidecar.
//
// This module is deliberately free of imports from `store.ts`/`search.ts`:
// both of them need it, and a cycle between those two would be fragile.

import { open, readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { Session } from '../../shared/types.js';

const SIDECAR_SUFFIX = '.meta.json';
const TRANSCRIPT_SUFFIX = '.jsonl';

/** Sidecar path for a transcript path. Works for any directory, not just the
 *  live sessions dir, so cleanup/backup code can use it too. */
export function metaPathFor(transcriptPath: string): string {
  return transcriptPath.endsWith(TRANSCRIPT_SUFFIX)
    ? `${transcriptPath.slice(0, -TRANSCRIPT_SUFFIX.length)}${SIDECAR_SUFFIX}`
    : `${transcriptPath}${SIDECAR_SUFFIX}`;
}

export function isMetaSidecarFile(fileName: string): boolean {
  return fileName.endsWith(SIDECAR_SUFFIX);
}

/** True when the authoritative sidecar exists for a transcript. */
export async function hasMetaSidecar(transcriptPath: string): Promise<boolean> {
  try {
    await readFile(metaPathFor(transcriptPath), 'utf8');
    return true;
  } catch {
    return false;
  }
}

/**
 * Counts the message lines in a transcript.
 *
 * Only used once, when a conversation written before sidecars existed receives
 * its first append: the creation-time header may carry a stale count, so it is
 * corrected from the transcript itself and then maintained incrementally.
 */
export async function countTranscriptMessages(transcriptPath: string): Promise<number> {
  let handle: Awaited<ReturnType<typeof open>> | null = null;
  try {
    handle = await open(transcriptPath, 'r');
    const chunks: Buffer[] = [];
    const buffer = Buffer.alloc(64 * 1024);
    for (;;) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
      if (bytesRead <= 0) break;
      chunks.push(Buffer.from(buffer.subarray(0, bytesRead)));
    }
    const lines = Buffer.concat(chunks).toString('utf8').split('\n');
    let count = 0;
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (trimmed.startsWith('{"type":"message"')) count++;
    }
    return count;
  } catch {
    return 0;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

/**
 * Reads just the first line of a file.
 *
 * The header is a single small JSON object, so this avoids pulling an entire
 * transcript into memory and splitting it to reach line 0. The buffer is
 * deliberately generous: titles are capped at 120 characters and every other
 * field is small, so 64 KB cannot be exhausted by a well-formed header.
 */
async function readHeaderLine(path: string): Promise<string | null> {
  let handle: Awaited<ReturnType<typeof open>> | null = null;
  try {
    handle = await open(path, 'r');
    const buffer = Buffer.alloc(64 * 1024);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    if (bytesRead <= 0) return null;
    const chunk = buffer.subarray(0, bytesRead).toString('utf8');
    const newline = chunk.indexOf('\n');
    return newline >= 0 ? chunk.slice(0, newline) : chunk;
  } catch {
    return null;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

/** Parses the creation-time header line of a transcript, if it is one. */
export async function readTranscriptHeader(transcriptPath: string): Promise<Session | null> {
  const line = await readHeaderLine(transcriptPath);
  if (!line?.trim()) return null;
  try {
    const parsed = JSON.parse(line) as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object' || parsed.type === 'message') return null;
    const meta = { ...parsed };
    delete meta.type;
    return meta as unknown as Session;
  } catch {
    return null;
  }
}

/** Writes a transcript header line. Only used when a transcript is created. */
export async function writeTranscriptHeader(transcriptPath: string, meta: Session): Promise<void> {
  await writeFile(transcriptPath, `${JSON.stringify({ type: 'meta', ...meta })}\n`, 'utf8');
}

/** The sidecar alone, without falling back to the transcript header. */
export async function readSidecarMeta(transcriptPath: string): Promise<Session | null> {
  try {
    const sidecar = await readFile(metaPathFor(transcriptPath), 'utf8');
    const parsed = JSON.parse(sidecar) as Session;
    if (parsed && typeof parsed === 'object' && typeof parsed.id === 'string') return parsed;
    return null;
  } catch {
    // No sidecar (a transcript older than sidecars) or unreadable.
    return null;
  }
}

/**
 * The current meta for a transcript: sidecar when present (authoritative),
 * otherwise the creation-time header.
 *
 * This is the read path every consumer shares, which is what keeps renames,
 * archiving and message counts consistent across the store, search and tools.
 */
export async function readSessionMetaFile(transcriptPath: string): Promise<Session | null> {
  return (await readSidecarMeta(transcriptPath)) ?? readTranscriptHeader(transcriptPath);
}

/** Persists meta to the sidecar. Small, atomic-enough, and O(1) in transcript size. */
export async function writeSessionMetaFile(transcriptPath: string, meta: Session): Promise<void> {
  const sidecar = metaPathFor(transcriptPath);
  await mkdir(dirname(sidecar), { recursive: true });
  await writeFile(sidecar, JSON.stringify(meta), 'utf8');
}
