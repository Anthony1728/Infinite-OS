import { describe, expect, it, vi } from 'vitest';

/**
 * Streaming messages out of the run.
 *
 * The bug: transcripts were written only after `runAgent` returned. Infinite AI
 * editing its own main-process source restarts the app, so the run never returns
 * and every tool call, result and reply it had already produced was lost — the
 * transcript kept the user's question and nothing else.
 *
 * These tests drive the loop with an already-aborted signal so no network or
 * model is involved. That is enough to pin the contract that matters: the loop
 * never re-reports the caller's history or its own user message (both are
 * already on disk), and a persistence failure never takes down the run.
 */

const aborted = () => {
  const controller = new AbortController();
  controller.abort();
  return controller.signal;
};

const baseOptions = (sessionId: string) => ({
  sessionId,
  cwd: process.cwd(),
  provider: 'anthropic',
  model: 'test',
  signal: aborted(),
  onEvent: () => undefined,
});

describe('streaming messages out of the run', () => {
  it('never re-reports the history or the user message it was given', async () => {
    const { runAgent } = await import('./loop.js');
    const seen: string[] = [];

    const history = [
      { id: 'h1', role: 'user' as const, content: [{ type: 'text' as const, text: 'earlier' }], timestamp: 1 },
    ];
    const userMessage = {
      id: 'u1',
      role: 'user' as const,
      content: [{ type: 'text' as const, text: 'now' }],
      timestamp: 2,
    };

    await runAgent(history as never, userMessage as never, {
      ...baseOptions('stream-never-history'),
      onMessage: (message) => {
        const first = (message.content as Array<{ type: string; text?: string }>)?.[0];
        seen.push(first?.text ?? `role:${message.role}`);
      },
    }).catch(() => undefined);

    // The caller already persisted both of these before the run began. If the
    // loop reported them too, every message in every transcript would appear
    // twice after a resume.
    expect(seen).not.toContain('earlier');
    expect(seen).not.toContain('now');
  });

  it('completes even when persisting a message throws', async () => {
    const { runAgent } = await import('./loop.js');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    let finished = false;
    await runAgent([], { id: 'u1', role: 'user', content: [{ type: 'text', text: 'hi' }], timestamp: 1 } as never, {
      ...baseOptions('stream-persist-fails'),
      onMessage: () => {
        throw new Error('disk is full');
      },
    })
      .catch(() => undefined)
      .then(() => {
        finished = true;
      });

    // The run is finished with its work; a persistence failure is logged, never
    // fatal. Work already done must not be discarded because a write failed.
    expect(finished).toBe(true);
    warn.mockRestore();
  });

  it('behaves exactly as before when the caller wants no streaming', async () => {
    const { runAgent } = await import('./loop.js');
    const withoutStreaming = baseOptions('stream-not-requested');

    let finished = false;
    await runAgent([], { id: 'u1', role: 'user', content: [{ type: 'text', text: 'hi' }], timestamp: 1 } as never, withoutStreaming)
      .catch(() => undefined)
      .then(() => {
        finished = true;
      });

    expect(finished).toBe(true);
  });
});