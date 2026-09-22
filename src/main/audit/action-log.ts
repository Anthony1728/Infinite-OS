// Action audit log — durable, queryable record of every agent action.
//
// This is the "black box" of Infinite OS: every tool call the agent makes is
// recorded (tool, arguments, risk tier, decision, outcome, duration) to a
// daily JSONL file on disk, with an in-memory tail for fast queries.
//
// Design principles:
// - PURELY ADDITIVE: logging never blocks, never throws, never slows the
//   action down. It observes; it does not gate. Full-system-access profiles
//   and every permission mode keep working exactly as before — the log is a
//   record, not a restriction. Autonomy is unchanged; accountability is new.
// - Tamper-evident: each entry carries a hash chained to the previous entry,
//   so silent edits to the log are detectable (verifyLogIntegrity()).
// - Local-first: files live under the OS data dir, no network, no accounts.

import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

export interface AuditEntry {
  /** Monotonic sequence number within the log (chained per file). */
  seq: number;
  /** Epoch ms. */
  ts: number;
  sessionId: string;
  tool: string;
  /** Canonicalized input snapshot (best-effort, truncated). */
  input: unknown;
  /** Risk tier from the autonomy policy (auto | confirm | block) when known. */
  tier?: string;
  /** How the action was allowed: 'auto' | 'policy' | 'user' | 'full-system' | 'denied'. */
  decision: string;
  /** 'ok' | 'error' | 'denied' | 'timeout' | 'cancelled' | 'running'. */
  outcome: 'ok' | 'error' | 'denied' | 'timeout' | 'cancelled' | 'running';
  /** Wall-clock duration ms (0 for 'running' start records). */
  durationMs: number;
  /** True when the run executed with unrestricted (full system access) authority. */
  unrestricted?: boolean;
  /** Hash of this entry chained to the previous one (tamper evidence). */
  hash?: string;
}

const MAX_MEMORY_TAIL = 1000;
/** Inputs are best-effort snapshots, not full dumps — cap serialized size. */
const MAX_INPUT_CHARS = 2_000;

/** Chain hash: hash(prevHash + canonicalEntry) so edits are detectable. */
function entryHash(prevHash: string, e: Omit<AuditEntry, 'hash'>): string {
  const canonical = JSON.stringify({
    seq: e.seq, ts: e.ts, sessionId: e.sessionId, tool: e.tool,
    input: e.input, tier: e.tier, decision: e.decision,
    outcome: e.outcome, durationMs: e.durationMs, unrestricted: e.unrestricted,
  });
  return createHash('sha256').update(prevHash + canonical).digest('hex').slice(0, 16);
}

function serializeInput(input: unknown): unknown {
  try {
    const json = JSON.stringify(input ?? null);
    if (json.length <= MAX_INPUT_CHARS) return input;
    return { _truncated: json.slice(0, MAX_INPUT_CHARS) };
  } catch {
    return String(input).slice(0, MAX_INPUT_CHARS);
  }
}

class ActionAuditLog {
  private tail: AuditEntry[] = [];
  private seq = 0;
  private prevHash = '';
  /** Test/feature isolation: when set, no file writes occur. */
  private memoryOnly = false;
  private dirOverride: string | null = null;
  /** Last in-flight file append — lets callers await durability (tests, shutdown). */
  private lastWrite: Promise<void> = Promise.resolve();

  /** Override the storage dir (tests). Pass null to restore defaults. */
  setStorageDir(dir: string | null): void {
    this.dirOverride = dir;
  }

  /** Disable/enable file persistence (tests keep memory-only). */
  setMemoryOnly(v: boolean): void {
    this.memoryOnly = v;
  }

  private logDir(): string {
    if (this.dirOverride) return this.dirOverride;
    // Mirror the app's data layout without importing Electron (keeps this
    // module unit-testable and usable from headless exec).
    const base = process.env.APPDATA || (process.platform === 'darwin'
      ? join(process.env.HOME ?? '~', 'Library', 'Application Support')
      : join(process.env.HOME ?? '~', '.config'));
    return join(base, 'infinite-ai', 'audit');
  }

  private logFile(now = new Date()): string {
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return join(this.logDir(), `actions-${y}-${m}-${d}.jsonl`);
  }

  /**
   * Record one audit entry. Fire-and-forget: callers never await this and
   * failures are swallowed (an audit failure must never break an action).
   */
  record(entry: Omit<AuditEntry, 'seq' | 'ts' | 'hash'>): void {
    const full: Omit<AuditEntry, 'hash'> = {
      ...entry,
      input: serializeInput(entry.input),
      seq: ++this.seq,
      ts: Date.now(),
    };
    const withHash: AuditEntry = { ...full, hash: entryHash(this.prevHash, full) };
    this.prevHash = withHash.hash!;
    this.tail.push(withHash);
    if (this.tail.length > MAX_MEMORY_TAIL) this.tail.splice(0, this.tail.length - MAX_MEMORY_TAIL);
    if (this.memoryOnly) return;
    this.lastWrite = this.appendToFile(withHash);
  }

  /** Await pending disk writes (useful for tests and graceful shutdown). */
  async flush(): Promise<void> {
    await this.lastWrite;
  }

  private async appendToFile(e: AuditEntry): Promise<void> {
    try {
      const dir = this.logDir();
      if (!existsSync(dir)) await mkdir(dir, { recursive: true });
      await appendFile(this.logFile(new Date(e.ts)), `${JSON.stringify(e)}\n`, 'utf8');
    } catch { /* audit must never break the action */ }
  }

  /** Most recent entries, newest first. */
  recent(limit = 50): AuditEntry[] {
    return this.tail.slice(-limit).reverse();
  }

  /** Entries for one session, newest first. */
  bySession(sessionId: string, limit = 50): AuditEntry[] {
    return this.tail.filter((e) => e.sessionId === sessionId).slice(-limit).reverse();
  }

  /** Entries matching a tool-name prefix (e.g. 'Git', 'Bash'), newest first. */
  byTool(namePrefix: string, limit = 50): AuditEntry[] {
    const p = namePrefix.toLowerCase();
    return this.tail.filter((e) => e.tool.toLowerCase().startsWith(p)).slice(-limit).reverse();
  }

  /** Unified query over the in-memory tail (all filters optional), newest first. */
  query(opts?: { sessionId?: string; toolPrefix?: string; limit?: number }): AuditEntry[] {
    let out = this.tail;
    if (opts?.sessionId) out = out.filter((e) => e.sessionId === opts.sessionId);
    if (opts?.toolPrefix) {
      const p = opts.toolPrefix.toLowerCase();
      out = out.filter((e) => e.tool.toLowerCase().startsWith(p));
    }
    return out.slice(-(opts?.limit ?? 50)).reverse();
  }

  /** Count entries by outcome for the in-memory tail. */
  stats(): Record<AuditEntry['outcome'], number> {
    const counts: Record<AuditEntry['outcome'], number> = { ok: 0, error: 0, denied: 0, timeout: 0, cancelled: 0, running: 0 };
    for (const e of this.tail) counts[e.outcome]++;
    return counts;
  }

  /**
   * Verify the hash chain of the in-memory tail. Returns the first broken
   * sequence number, or null when intact. Detects silent log edits.
   */
  verifyIntegrity(): number | null {
    let prev = '';
    for (const e of this.tail) {
      const { hash, ...rest } = e;
      if (entryHash(prev, rest) !== hash) return e.seq;
      prev = hash!;
    }
    return null;
  }

  /**
   * Load a specific day's log from disk (newest last). Used for post-hoc
   * review/exports; the in-memory tail only covers the current process.
   */
  async readDay(date = new Date()): Promise<AuditEntry[]> {
    try {
      const raw = await readFile(this.logFile(date), 'utf8');
      return raw.split('\n').filter(Boolean).map((line) => JSON.parse(line) as AuditEntry);
    } catch {
      return [];
    }
  }

  /** Test isolation: reset memory state. */
  reset(): void {
    this.tail = [];
    this.seq = 0;
    this.prevHash = '';
  }
}

export const actionAuditLog = new ActionAuditLog();
