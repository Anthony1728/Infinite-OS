// Survive-the-reload queue for in-flight agent runs.
//
// THE PROBLEM THIS SOLVES
//
// When Infinite OS rebuilds itself (or the app restarts for any reason), a
// run that was streaming dies with the process: the agent stops mid-task and
// stops communicating. Messages persisted so far survive, but the WORK does
// not continue. The user asked for exactly this to stop happening.
//
// HOW IT WORKS
//
// Main tracks every live run's identity (session, request, provider, model).
// Before a relaunch — self-apply rebuild, or app quit — those snapshots are
// written to a queue file. On the next startup the queue is consumed and each
// entry is re-launched as a background continuation run on the SAME session:
// the agent sees the transcript already in the conversation and is instructed
// to verify current state (files may already be written) and finish the task.

import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { infiniteHome } from '../profiles/home.js';

const QUEUE_PATH = join(infiniteHome(), 'resume-queue.json');

export interface ResumeEntry {
  sessionId: string;
  /** The user's original request — re-stated in the continuation prompt. */
  request: string;
  provider: string;
  model: string;
  cwd: string;
  background: boolean;
  savedAt: number;
}

function ensureDir(): void {
  const dir = join(infiniteHome());
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

/** Atomically persist the snapshot of live runs ahead of a relaunch. */
export function writeResumeQueue(entries: ResumeEntry[]): void {
  try {
    ensureDir();
    const temporary = `${QUEUE_PATH}.${process.pid}.tmp`;
    writeFileSync(temporary, JSON.stringify({ version: 1, entries, savedAt: Date.now() }, null, 2), 'utf8');
    renameSync(temporary, QUEUE_PATH);
  } catch {
    // Losing the queue must never break the relaunch itself.
  }
}

/**
 * Read and CLEAR the queue (each entry is claimed exactly once). Entries
 * whose session transcript no longer exists are dropped, not surfaced.
 * The predicate is async (session meta lives on disk).
 */
export async function consumeResumeQueue(
  sessionExists: (sessionId: string) => Promise<boolean>,
): Promise<ResumeEntry[]> {
  if (!existsSync(QUEUE_PATH)) return [];
  try {
    const parsed = JSON.parse(readFileSync(QUEUE_PATH, 'utf8')) as { entries?: ResumeEntry[] };
    rmQueueFile();
    const entries = Array.isArray(parsed.entries) ? parsed.entries : [];
    const kept: ResumeEntry[] = [];
    for (const entry of entries) {
      if (!entry.sessionId) continue;
      if (await sessionExists(entry.sessionId).catch(() => false)) kept.push(entry);
    }
    return kept;
  } catch {
    rmQueueFile();
    return [];
  }
}

function rmQueueFile(): void {
  try {
    const stale = `${QUEUE_PATH}.bak`;
    if (existsSync(QUEUE_PATH)) {
      renameSync(QUEUE_PATH, stale);
      // Keep exactly one stale backup; older ones rotate out naturally.
      const dir = join(infiniteHome());
      for (const name of readdirSync(dir)) {
        if (name.startsWith('resume-queue.json.bak') && name !== 'resume-queue.json.bak') {
          try { fsUnlink(join(dir, name)); } catch { /* best-effort rotation */ }
        }
      }
    }
  } catch {
    /* best-effort */
  }
}

// Small indirection so the module imports stay minimal.
import { unlinkSync as fsUnlink } from 'node:fs';
