import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let dir = '';

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'audit-'));
  const log = import('./action-log.js').then((m) => m.actionAuditLog);
  return log.then((l) => {
    l.reset();
    l.setStorageDir(dir);
    l.setMemoryOnly(false);
  });
});

afterEach(() => {
  const log = import('./action-log.js').then((m) => m.actionAuditLog);
  return log.then((l) => {
    l.setStorageDir(null);
    l.setMemoryOnly(true);
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = '';
  });
});

async function load() {
  const m = await import('./action-log.js');
  return m.actionAuditLog;
}

describe('action audit log', () => {
  it('records entries to disk as JSONL with a chained hash', async () => {
    const log = await load();
    log.record({ sessionId: 's1', tool: 'Bash', input: { command: 'ls' }, decision: 'auto', outcome: 'ok', durationMs: 12 });
    log.record({ sessionId: 's1', tool: 'Write', input: { file_path: 'a.ts' }, decision: 'auto', outcome: 'ok', durationMs: 30 });

    const entries = (await (async () => { await log.flush(); return log.readDay(new Date()); })());
    expect(entries).toHaveLength(2);
    expect(entries[0].tool).toBe('Bash');
    expect(entries[1].tool).toBe('Write');
    expect(entries[0].hash).toBeTruthy();
    expect(entries[1].hash).not.toBe(entries[0].hash);
  });

  it('detects tampering via verifyIntegrity', async () => {
    const log = await load();
    log.record({ sessionId: 's1', tool: 'Read', input: {}, decision: 'auto', outcome: 'ok', durationMs: 1 });
    expect(log.verifyIntegrity()).toBeNull();

    // Simulate tampering with the in-memory tail
    const tail = log.recent(1);
    (tail[0] as unknown as { outcome: string }).outcome = 'ok';
    (tail[0] as unknown as { tool: string }).tool = 'Tampered';
    // Re-verify: hash no longer matches mutated entry
    expect(log.verifyIntegrity()).not.toBeNull();
  });

  it('truncates oversized inputs instead of failing', async () => {
    const log = await load();
    const big = 'x'.repeat(10_000);
    log.record({ sessionId: 's1', tool: 'Write', input: { data: big }, decision: 'auto', outcome: 'ok', durationMs: 2 });
    await log.flush();
    const entries = await log.readDay(new Date());
    expect(entries).toHaveLength(1);
    const input = entries[0].input as { _truncated?: string };
    expect(input._truncated).toBeTruthy();
    expect((input._truncated ?? '').length).toBeLessThanOrEqual(2000);
  });

  it('filters by session and tool prefix via query()', async () => {
    const log = await load();
    log.record({ sessionId: 'a', tool: 'Bash', input: {}, decision: 'auto', outcome: 'ok', durationMs: 1 });
    log.record({ sessionId: 'b', tool: 'GitPush', input: {}, decision: 'auto', outcome: 'ok', durationMs: 2 });
    log.record({ sessionId: 'a', tool: 'GitStatus', input: {}, decision: 'auto', outcome: 'ok', durationMs: 3 });

    expect(log.query({ sessionId: 'a' })).toHaveLength(2);
    expect(log.query({ toolPrefix: 'git' })).toHaveLength(2);
    expect(log.query({ sessionId: 'a', toolPrefix: 'git' })).toHaveLength(1);
    expect(log.query({})[0].tool).toBe('GitStatus'); // newest first
  });

  it('computes outcome stats', async () => {
    const log = await load();
    log.record({ sessionId: 'a', tool: 'Bash', input: {}, decision: 'auto', outcome: 'ok', durationMs: 1 });
    log.record({ sessionId: 'a', tool: 'Bash', input: {}, decision: 'denied', outcome: 'denied', durationMs: 1 });
    log.record({ sessionId: 'a', tool: 'Bash', input: {}, decision: 'auto', outcome: 'error', durationMs: 1 });
    const stats = log.stats();
    expect(stats.ok).toBe(1);
    expect(stats.denied).toBe(1);
    expect(stats.error).toBe(1);
  });

  it('flags unrestricted authority in the record', async () => {
    const log = await load();
    log.record({ sessionId: 's', tool: 'Bash', input: {}, decision: 'full-system', outcome: 'ok', durationMs: 5, unrestricted: true });
    await log.flush();
    const entries = await log.readDay(new Date());
    expect(entries[0].unrestricted).toBe(true);
    expect(entries[0].decision).toBe('full-system');
  });
});
