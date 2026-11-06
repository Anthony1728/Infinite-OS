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

  // Consolidate: decay stale episodic trivia via stratified-memory pruning
  // (importance-gated, promoted rows survive). Replaces a legacy raw-SQL
  // prune that referenced a non-existent column and could never match.
  try {
    const { pruneEpisodic } = await import('../memory/store.js');
    const deleted = pruneEpisodic({ olderThanDays: 30 });
    if (deleted > 0) {
      console.log(`[heartbeat] pruned ${deleted} stale episodic memories`);
    }
  } catch { /* memory not ready yet */ }

  // Consolidate: promote battle-tested episodic memories. A recalled episode
  // is a fact that keeps proving useful — three or more accesses promote it
  // to the semantic tier so it outranks decay and becomes durable context
  // for future turns. This closes the memory lifecycle: write → recall →
  // consolidate → prune.
  try {
    const { listMemories, promoteMemory } = await import('../memory/store.js');
    const episodic = listMemories('chat').filter((m) => m.tier === 'episodic' && (m.accessCount ?? 0) >= 3);
    for (const memory of episodic.slice(0, 25)) {
      promoteMemory(memory.id, 'semantic', Math.max(memory.importance ?? 0, 0.7));
    }
    if (episodic.length > 0) {
      console.log(`[heartbeat] promoted ${Math.min(episodic.length, 25)} recalled episodic memories to semantic`);
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
