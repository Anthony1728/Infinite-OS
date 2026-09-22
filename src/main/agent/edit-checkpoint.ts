// Checkpoint-on-edit — every successful Write/Edit/Delete records the file
// mutation into the existing CheckpointManager, grouped by run. This is the
// backbone of "rewind to here": pick any message in the transcript, restore
// the file state as it was before/after that point. Works across every
// provider (Claude Code's checkpoints, but not tied to one vendor).

import { basename } from 'node:path';
import { getCheckpointManager } from '../checkpoint/manager.js';
import type { TaskState } from '../checkpoint/manager.js';

interface FileMutation {
  path: string;
  operation: 'create' | 'modify' | 'delete';
  originalContent?: string;
  newContent: string;
}

/** Mutations accumulated for the current run, keyed by sessionId. */
const runMutations = new Map<string, { taskId: string; startedAt: number; files: Map<string, FileMutation> }>();

export function beginRunCheckpoint(sessionId: string): void {
  runMutations.set(sessionId, { taskId: `run-${sessionId}`, startedAt: Date.now(), files: new Map() });
}

export function endRunCheckpoint(sessionId: string): void {
  runMutations.delete(sessionId);
}

/**
 * Record one file mutation. Called by Write/Edit/Delete tools after success.
 * The ORIGINAL content (pre-edit) is what makes rollback possible; tools pass
 * what they read before writing.
 */
export function recordFileMutation(opts: {
  sessionId: string;
  path: string;
  operation: 'create' | 'modify' | 'delete';
  originalContent?: string;
  newContent: string;
}): void {
  let run = runMutations.get(opts.sessionId);
  if (!run) {
    beginRunCheckpoint(opts.sessionId);
    run = runMutations.get(opts.sessionId)!;
  }
  // First mutation of a file in this run wins for `originalContent` — that's
  // the true pre-run state a full rewind restores.
  if (!run.files.has(opts.path)) {
    run.files.set(opts.path, {
      path: opts.path,
      operation: opts.operation,
      originalContent: opts.originalContent,
      newContent: opts.newContent,
    });
  } else {
    const existing = run.files.get(opts.path)!;
    existing.newContent = opts.newContent;
    if (existing.operation === 'create' && opts.operation === 'delete') existing.operation = 'create';
  }
}

/** Persist the accumulated mutations as a named checkpoint. */
export function snapshotRunCheckpoint(sessionId: string, name?: string): string | null {
  const run = runMutations.get(sessionId);
  if (!run || run.files.size === 0) return null;
  const state: TaskState = {
    status: 'completed',
    progress: 100,
    currentStep: 0,
    totalSteps: 0,
    cwd: '',
    history: [],
    variables: {},
    modifiedFiles: [...run.files.values()],
  };
  const checkpoint = getCheckpointManager().create({
    taskId: run.taskId,
    name: name ?? `auto: ${[...run.files.values()].map((f) => basename(f.path)).join(', ').slice(0, 80)}`,
    state,
    metadata: { automatic: true, startedAt: run.startedAt, files: run.files.size },
  });
  return checkpoint.id;
}

/** Restore the pre-run file state captured in this session's checkpoint run. */
export function rewindToCheckpoint(checkpointId: string): { success: boolean; actions: string[]; error?: string } {
  const manager = getCheckpointManager();
  const result = manager.rollback(checkpointId);
  return {
    success: result.success,
    actions: result.rollbackActions ?? [],
    error: result.error,
  };
}

/** List auto checkpoints for a session (newest first). */
export function listRunCheckpoints(sessionId: string) {
  return getCheckpointManager().list(`run-${sessionId}`, 20);
}
