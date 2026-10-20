import { describe, expect, it } from 'vitest';
import { SessionBoard } from './session-board.js';

describe('SessionBoard', () => {
  it('creates a queued session with defaults', () => {
    const board = new SessionBoard();
    const session = board.createSession('Test title');

    expect(session.status).toBe('queued');
    expect(session.type).toBe('standalone');
    expect(session.progress).toBe(0);
    expect(session.cwd).toBe(process.cwd());
    expect(board.getSession(session.id)).toBe(session);
  });

  it('keeps an explicit id, type and description', () => {
    const board = new SessionBoard();
    const session = board.createSession('Orch task', { id: 'abc-123', type: 'orchestrator', description: 'Do things' });

    expect(session.id).toBe('abc-123');
    expect(session.type).toBe('orchestrator');
    expect(session.description).toBe('Do things');
  });

  it('emits session_created to subscribers and supports unsubscribe', () => {
    const board = new SessionBoard();
    const events: string[] = [];
    const off = board.onEvent((e) => events.push(e.type));
    board.createSession('T');
    off();
    board.createSession('T2');

    expect(events).toEqual(['session_created']);
  });

  it('throws when the board is at capacity and nothing can be evicted', () => {
    const board = new SessionBoard();
    const MAX = 20;
    for (let i = 0; i < MAX; i++) board.createSession(`S${i}`);

    expect(() => board.createSession('overflow')).toThrow('Session board is full');
  });

  it('evicts old terminal sessions before refusing new ones', () => {
    const board = new SessionBoard();
    const MAX = 20;
    for (let i = 0; i < MAX - 1; i++) board.createSession(`S${i}`);
    const oldest = board.createSession('completed-slot');
    board.completeSession(oldest.id);

    // Capacitated with 19 queued + 1 completed. Creating another must evict the
    // completed session instead of throwing.
    const next = board.createSession('after-eviction');
    expect(next.status).toBe('queued');
    expect(board.getSession(oldest.id)).toBeUndefined();
  });

  it('transitions sessions and reports stats via getBoardData', () => {
    const board = new SessionBoard();
    const a = board.createSession('A');
    const b = board.createSession('B');
    const c = board.createSession('C');
    const d = board.createSession('D');

    board.completeSession(a.id, { result: 'ok' });
    board.failSession(b.id, 'boom');
    board.cancelSession(c.id);
    // d stays queued (no run)

    const boardData = board.getBoardData();
    expect(boardData.columns.completed.map((s) => s.id)).toEqual([a.id]);
    expect(boardData.columns.failed.map((s) => s.id)).toEqual([b.id]);
    expect(boardData.columns.cancelled.map((s) => s.id)).toEqual([c.id]);
    expect(boardData.columns.queued.map((s) => s.id)).toEqual([d.id]);
    expect(boardData.columns.running).toEqual([]);
    expect(boardData.stats).toMatchObject({
      total: 4,
      active: 1,
      queued: 1,
      completed: 1,
      failed: 1,
      cancelled: 1,
      running: 0,
    });

    const completed = board.getSession(a.id)!;
    expect(completed.status).toBe('completed');
    expect(completed.progress).toBe(100);
    expect(completed.results).toEqual({ result: 'ok' });
    expect(board.getSession(b.id)!.error).toBe('boom');
  });

  it('startSession returns null for unknown sessions', async () => {
    const board = new SessionBoard();
    expect(await board.startSession('missing', 'task')).toBeNull();
  });

  it('refuses to start a session that is not queued', async () => {
    const board = new SessionBoard();
    const session = board.createSession('T');
    board.completeSession(session.id);

    await expect(board.startSession(session.id, 'task')).rejects.toThrow('already completed');
  });

  it('cancelSession only cancels queued or running sessions once', () => {
    const board = new SessionBoard();
    const queued = board.createSession('queued');
    const done = board.createSession('done');
    board.completeSession(done.id);

    expect(board.cancelSession(queued.id)).toBe(true);
    expect(board.getSession(queued.id)!.status).toBe('cancelled');
    // A second cancel on an already-finished session is a no-op.
    expect(board.cancelSession(queued.id)).toBe(false);
    // Terminal sessions cannot be cancelled.
    expect(board.cancelSession(done.id)).toBe(false);
  });

  it('interject targets orchestrator sessions only', () => {
    const board = new SessionBoard();
    const standalone = board.createSession('SA');
    expect(board.interject(standalone.id, 'hello')).toBe(false);

    // Orchestrator without a task ref is not interjectable either.
    const orch = board.createSession('OR', { type: 'orchestrator' });
    expect(board.interject(orch.id, 'hello')).toBe(false);
    expect(board.interject('unknown', 'hello')).toBe(false);
  });

  it('cleanup removes sessions and worktrees without throwing', () => {
    const board = new SessionBoard();
    const a = board.createSession('A');
    const b = board.createSession('B');
    board.completeSession(a.id);
    board.cancelSession(b.id);

    expect(() => board.cleanup()).not.toThrow();
    expect(board.getAllSessions()).toEqual([]);
  });
});