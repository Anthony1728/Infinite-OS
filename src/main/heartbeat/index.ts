// Heartbeat — lightweight periodic consolidation inspired by Hermes Agent.
// Runs while the app is idle: consolidates recent session learnings into
// long-term memory, prunes stale entries, and keeps the system healthy.
// Does NOT block or slow down active agent runs.

import { join } from 'node:path';
import { homedir } from 'node:os';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const HEARTBEAT_INTERVAL_MS = 30 * 60_000; // 30 minutes
const HEARTBEAT_FILE = join(homedir(), '.infinite-ai', 'heartbeat.json');
const MIN_IDLE_MS = 5 * 60_000; // only run if idle 5+ minutes

let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
let lastActivityAt = Date.now();
let heartbeatCount = 0;

interface HeartbeatState {
  lastRun: number;
  runs: number;
}

function loadState(): HeartbeatState {
  try {
    if (existsSync(HEARTBEAT_FILE)) {
      return JSON.parse(readFileSync(HEARTBEAT_FILE, 'utf8'));
    }
  } catch { /* ignore */ }
  return { lastRun: 0, runs: 0 };
}

function saveState(state: HeartbeatState): void {
  try {
    mkdirSync(join(homedir(), '.infinite-ai'), { recursive: true });
    writeFileSync(HEARTBEAT_FILE, JSON.stringify(state, null, 2));
  } catch { /* ignore */ }
}

/** Called on every user message / agent activity to reset idle timer. */
export function heartbeatTouch(): void {
  lastActivityAt = Date.now();
}

function isIdle(): boolean {
  return Date.now() - lastActivityAt >= MIN_IDLE_MS;
}

async function runHeartbeat(): Promise<void> {
  if (!isIdle()) return;

  const state = loadState();
  heartbeatCount++;

  // Consolidate: check if there are recent sessions worth summarizing.
  // This is intentionally lightweight — just logs for now, but can be
  // extended to call the LLM for summarization when a provider is free.
  try {
    const { getDb } = await import('../memory/store.js');
    const db = getDb();
    // Prune old ephemeral entries (older than 30 days, not pinned)
    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const result = db.prepare(
      "DELETE FROM memories WHERE updatedAt < ? AND type = 'note' AND json_extract(tags, '$[0]') IS NULL",
    ).run(thirtyDaysAgo);
    if (result.changes > 0) {
      console.log(`[heartbeat] pruned ${result.changes} stale notes`);
    }
  } catch { /* memory not ready yet */ }

  saveState({ lastRun: Date.now(), runs: state.runs + 1 });
  console.log(`[heartbeat] run #${heartbeatCount} completed`);
}

export function startHeartbeat(): void {
  if (heartbeatTimer) return;
  heartbeatTimer = setInterval(runHeartbeat, HEARTBEAT_INTERVAL_MS);
  heartbeatTimer.unref?.();
  console.log('[heartbeat] started (every 30m, requires 5m idle)');
}

export function stopHeartbeat(): void {
  if (!heartbeatTimer) return;
  clearInterval(heartbeatTimer);
  heartbeatTimer = undefined;
}

export function heartbeatStatus(): { running: boolean; lastRun: number; runs: number; idle: boolean } {
  const state = loadState();
  return {
    running: !!heartbeatTimer,
    lastRun: state.lastRun,
    runs: state.runs,
    idle: isIdle(),
  };
}
