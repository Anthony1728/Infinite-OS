// EOL-agnostic patch: add a monotonic timestamp clock to CheckpointManager so
// newest-first ordering is deterministic even for same-millisecond creates.
import { readFileSync, writeFileSync } from 'node:fs';

const file = new URL('../src/main/checkpoint/manager.ts', import.meta.url);
const src = readFileSync(file, 'utf8');

// Normalize to LF, apply, keep LF (the repo tolerates both; git normalizes).
const lf = src.replace(/\r\n/g, '\n');

const fieldOld = [
  "  private store: CheckpointStore = { checkpoints: {}, metadata: { version: 1, lastUpdated: Date.now() } };",
  "",
  "  constructor(dataDir?: string) {",
].join('\n');

const fieldNew = [
  "  private store: CheckpointStore = { checkpoints: {}, metadata: { version: 1, lastUpdated: Date.now() } };",
  "  // Monotonic clock: guarantees strictly increasing timestamps even when two",
  "  // checkpoints are created within the same millisecond, so newest-first",
  "  // ordering is deterministic (see list/listAll).",
  "  private lastTimestamp = 0;",
  "",
  "  constructor(dataDir?: string) {",
].join('\n');

const createOld = [
  "  create(options: CheckpointCreateOptions): Checkpoint {",
  "    const checkpoint: Checkpoint = {",
  "      id: randomUUID(),",
  "      taskId: options.taskId,",
  "      name: options.name,",
  "      description: options.description,",
  "      timestamp: Date.now(),",
].join('\n');

const createNew = [
  "  create(options: CheckpointCreateOptions): Checkpoint {",
  "    const now = Date.now();",
  "    this.lastTimestamp = now > this.lastTimestamp ? now : this.lastTimestamp + 1;",
  "    const checkpoint: Checkpoint = {",
  "      id: randomUUID(),",
  "      taskId: options.taskId,",
  "      name: options.name,",
  "      description: options.description,",
  "      timestamp: this.lastTimestamp,",
].join('\n');

function replaceOnce(haystack, needle, replacement, label) {
  const count = haystack.split(needle).length - 1;
  if (count !== 1) throw new Error(`patch failed: ${label} matched ${count} times, expected 1`);
  return haystack.replace(needle, replacement);
}

let out = lf;
out = replaceOnce(out, fieldOld, fieldNew, 'store/constructor block');
out = replaceOnce(out, createOld, createNew, 'create() opening');
writeFileSync(file, out, 'utf8');
console.log('checkpoint/manager.ts patched OK');
