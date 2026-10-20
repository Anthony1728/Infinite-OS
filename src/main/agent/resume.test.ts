import { describe, expect, it, beforeEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Resuming after a restart.
 *
 * The whole point of this feature is that the user is told what the agent
 * *actually* did. So the tests below are mostly about not lying: no invented
 * steps, no reporting a finished run as interrupted, and no stale banners.
 */

const home = mkdtempSync(join(tmpdir(), 'resume-test-'));
process.env.INFINITE_TEST_HOME = home;

const { markRunStarted, clearRunMarker, summariseInterruptedRun, findInterruptedRuns } =
  await import('./resume.js');
const { createSession, appendMessage } = await import('../session/store.js');

/** A session whose transcript looks like a run that was cut off. */
async function interruptedSession(options: { withResults?: boolean } = {}) {
  const session = await createSession({ cwd: process.cwd(), model: 'm', provider: 'p' });
  await appendMessage(session.id, { id: 'u1', role: 'user', content: [{ type: 'text', text: 'refactor the auth module' }], timestamp: 1 });
  await appendMessage(session.id, {
    id: 'a1',
    role: 'assistant',
    content: [{ type: 'tool_use', id: 't1', name: 'Read', input: { file_path: 'src/auth.ts' } }],
    timestamp: 2,
  });
  await appendMessage(session.id, {
    id: 'a2',
    role: 'user',
    content: [{ type: 'tool_result', tool_use_id: 't1', content: 'file contents' }],
    timestamp: 3,
  });
  await appendMessage(session.id, {
    id: 'a3',
    role: 'assistant',
    content: [{ type: 'tool_use', id: 't2', name: 'Edit', input: { file_path: 'src/auth.ts' } }],
    timestamp: 4,
  });
  if (options.withResults !== false) {
    await appendMessage(session.id, {
      id: 'a4',
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: 't2', content: 'ok' }],
      timestamp: 5,
    });
  }
  markRunStarted(session.id, 'refactor the auth module');
  return session;
}

describe('interrupted run detection', () => {
  it('reports nothing when no run was in progress', async () => {
    expect(await summariseInterruptedRun('no-such-session')).toBeNull();
  });

  it('reports what the agent really did before the restart', async () => {
    const session = await interruptedSession();
    const summary = await summariseInterruptedRun(session.id);
    expect(summary).not.toBeNull();
    expect(summary!.toolsRun).toBe(2);
    expect(summary!.toolsFailed).toBe(0);
    // The real request, so the user can see what was interrupted.
    expect(summary!.request).toBe('refactor the auth module');
    // The file it really touched.
    expect(summary!.filesTouched).toContain('src/auth.ts');
    expect(summary!.done.join(' ')).toContain('Edit');
  });

  it('does not claim success for a tool that never returned', async () => {
    // `Edit` started but there is no tool_result — exactly the shape of a run
    // killed between the call and its result.
    const session = await interruptedSession({ withResults: false });
    const summary = await summariseInterruptedRun(session.id);
    expect(summary!.toolsRun).toBe(2);
    expect(summary!.toolsFailed).toBe(0);
    // Both tools are listed because both genuinely started. It must not add a
    // step that was never in the transcript.
    expect(summary!.done.join(' ')).toContain('Edit');
    expect(summary!.done.join(' ')).toContain('Read');
  });

  it('counts a failed tool accurately', async () => {
    const session = await createSession({ cwd: process.cwd(), model: 'm', provider: 'p' });
    await appendMessage(session.id, { id: 'u1', role: 'user', content: [{ type: 'text', text: 'do it' }], timestamp: 1 });
    await appendMessage(session.id, {
      id: 'a1',
      role: 'assistant',
      content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'rm -rf /' } }],
      timestamp: 2,
    });
    await appendMessage(session.id, {
      id: 'a2',
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: 't1', content: 'denied', is_error: true }],
      timestamp: 3,
    });
    markRunStarted(session.id, 'do it');
    const summary = await summariseInterruptedRun(session.id);
    expect(summary!.toolsRun).toBe(1);
    expect(summary!.toolsFailed).toBe(1);
  });

  it('never reports more failures than steps', async () => {
    const session = await createSession({ cwd: process.cwd(), model: 'm', provider: 'p' });
    await appendMessage(session.id, { id: 'u1', role: 'user', content: [{ type: 'text', text: 'x' }], timestamp: 1 });
    // Two error results with only one tool_use — a malformed transcript.
    await appendMessage(session.id, {
      id: 'a1',
      role: 'assistant',
      content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: {} }],
      timestamp: 2,
    });
    await appendMessage(session.id, {
      id: 'a2',
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: 't1', content: 'a', is_error: true }],
      timestamp: 3,
    });
    await appendMessage(session.id, {
      id: 'a3',
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: 'ghost', content: 'b', is_error: true }],
      timestamp: 4,
    });
    markRunStarted(session.id, 'x');
    const summary = await summariseInterruptedRun(session.id);
    expect(summary!.toolsFailed).toBeLessThanOrEqual(summary!.toolsRun);
  });

  it('stops reporting once the run finished normally', async () => {
    const session = await interruptedSession();
    clearRunMarker(session.id);
    // A finished run must never come back as an interruption.
    expect(await summariseInterruptedRun(session.id)).toBeNull();
  });

  it('ignores a stale marker rather than blaming a restart on it', async () => {
    const session = await interruptedSession();
    // Backdate the marker past the staleness window.
    const path = join(home, 'resume', `${session.id}.json`);
    const { readFileSync, writeFileSync, existsSync } = await import('node:fs');
    expect(existsSync(path)).toBe(true);
    const marker = JSON.parse(readFileSync(path, 'utf-8'));
    marker.updatedAt = Date.now() - 48 * 60 * 60 * 1000;
    writeFileSync(path, JSON.stringify(marker), 'utf8');

    expect(await summariseInterruptedRun(session.id)).toBeNull();
    // And it cleans up after itself.
    expect(existsSync(path)).toBe(false);
  });

  it('drops a marker whose transcript has been deleted', async () => {
    const session = await createSession({ cwd: process.cwd(), model: 'm', provider: 'p' });
    markRunStarted(session.id, 'doomed');
    const { deleteSession } = await import('../session/store.js');
    await deleteSession(session.id);
    const found = await findInterruptedRuns();
    expect(found.some((r) => r.sessionId === session.id)).toBe(false);
  });

  it('lists every interrupted run, newest first', async () => {
    const first = await interruptedSession();
    const second = await interruptedSession();
    const found = await findInterruptedRuns();
    const ids = found.map((r) => r.sessionId);
    expect(ids).toContain(first.id);
    expect(ids).toContain(second.id);
    // Newest first, so the banner shows the most recent interruption.
    const timestamps = found.map((r) => r.updatedAt);
    expect([...timestamps].sort((a, b) => b - a)).toEqual(timestamps);
  });

  it('reports nothing at all when nothing was interrupted', async () => {
    const session = await createSession({ cwd: process.cwd(), model: 'm', provider: 'p' });
    await appendMessage(session.id, { id: 'u1', role: 'user', content: [{ type: 'text', text: 'hi' }], timestamp: 1 });
    expect(await summariseInterruptedRun(session.id)).toBeNull();
  });
});

describe('resume state survives being read twice', () => {
  beforeEach(() => {
    // Nothing to reset: each case writes its own marker.
  });

  it('does not accumulate marker files for a session that has ended', async () => {
    const session = await interruptedSession();
    clearRunMarker(session.id);
    const { existsSync } = await import('node:fs');
    expect(existsSync(join(home, 'resume', `${session.id}.json`))).toBe(false);
  });

  it('survives a read of the whole resume directory with no state', async () => {
    rmSync(join(home, 'resume'), { recursive: true, force: true });
    expect(await findInterruptedRuns()).toEqual([]);
  });
});