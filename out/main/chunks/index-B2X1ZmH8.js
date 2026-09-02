import { join } from "node:path";
import { homedir } from "node:os";
import { existsSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
const HEARTBEAT_INTERVAL_MS = 30 * 6e4;
const HEARTBEAT_FILE = join(homedir(), ".infinite-ai", "heartbeat.json");
const MIN_IDLE_MS = 5 * 6e4;
let heartbeatTimer;
let lastActivityAt = Date.now();
let heartbeatCount = 0;
function loadState() {
  try {
    if (existsSync(HEARTBEAT_FILE)) {
      return JSON.parse(readFileSync(HEARTBEAT_FILE, "utf8"));
    }
  } catch {
  }
  return { lastRun: 0, runs: 0 };
}
function saveState(state) {
  try {
    mkdirSync(join(homedir(), ".infinite-ai"), { recursive: true });
    writeFileSync(HEARTBEAT_FILE, JSON.stringify(state, null, 2));
  } catch {
  }
}
function heartbeatTouch() {
  lastActivityAt = Date.now();
}
function isIdle() {
  return Date.now() - lastActivityAt >= MIN_IDLE_MS;
}
async function runHeartbeat() {
  if (!isIdle()) return;
  const state = loadState();
  heartbeatCount++;
  try {
    const { getDb } = await import("../index.js").then((n) => n.s);
    const db = getDb();
    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1e3;
    const result = db.prepare(
      "DELETE FROM memories WHERE updatedAt < ? AND type = 'note' AND json_extract(tags, '$[0]') IS NULL"
    ).run(thirtyDaysAgo);
    if (result.changes > 0) {
      console.log(`[heartbeat] pruned ${result.changes} stale notes`);
    }
  } catch {
  }
  saveState({ lastRun: Date.now(), runs: state.runs + 1 });
  console.log(`[heartbeat] run #${heartbeatCount} completed`);
}
function startHeartbeat() {
  if (heartbeatTimer) return;
  heartbeatTimer = setInterval(runHeartbeat, HEARTBEAT_INTERVAL_MS);
  heartbeatTimer.unref?.();
  console.log("[heartbeat] started (every 30m, requires 5m idle)");
}
function heartbeatStatus() {
  const state = loadState();
  return {
    running: !!heartbeatTimer,
    lastRun: state.lastRun,
    runs: state.runs,
    idle: isIdle()
  };
}
export {
  heartbeatStatus,
  heartbeatTouch,
  startHeartbeat
};
