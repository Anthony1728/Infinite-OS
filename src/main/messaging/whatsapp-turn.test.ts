import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// WhatsApp turns must answer on the user's SELECTED Infinite OS model — never
// a silent Ollama fallback that hogs the local machine.
const sessionState = vi.hoisted(() => ({ messages: new Map<string, unknown[]>() }));
vi.mock('../session/store.js', () => ({
  loadMessages: async (id: string) => [...(sessionState.messages.get(id) ?? [])],
  appendMessage: async (id: string, m: unknown) => {
    sessionState.messages.set(id, [...(sessionState.messages.get(id) ?? []), m]);
  },
  listSessions: async () => [],
  createSession: async (s: { title?: string }) => ({ id: `sess-${String(s.title ?? '').length}-${Date.now()}` }),
}));

import { whatsAppLink, whatsappTurnBudget } from './whatsapp-link.js';

let testHome = '';
const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ['INFINITE_TEST_HOME'] as const) {
    savedEnv[k] = process.env[k];
    delete process.env[k];
  }
  testHome = mkdtempSync(join(tmpdir(), 'wa-turn-'));
  process.env.INFINITE_TEST_HOME = testHome;
  sessionState.messages.clear();
});

afterEach(async () => {
  whatsAppLink.stop();
  await whatsAppLink.unpair().catch(() => undefined);
  for (const k of ['INFINITE_TEST_HOME'] as const) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  rmSync(testHome, { recursive: true, force: true });
});

function mockSocket() {
  const handlers = new Map<string, (d: Record<string, unknown>) => void>();
  const sent: Array<{ jid: string; text: string }> = [];
  return {
    handlers,
    sent,
    sock: {
      user: { id: '15551234567@s.whatsapp.net' },
      ev: { on: (e: string, cb: (d: Record<string, unknown>) => void) => { handlers.set(e, cb); } },
      sendMessage: async (jid: string, c: { text: string }) => {
        sent.push({ jid, text: c.text });
        return { key: { id: `sent-${sent.length}` } };
      },
      end: () => undefined,
    },
  };
}

const selfMsg = (id: string, text: string) => ({
  key: { remoteJid: '15551234567@s.whatsapp.net', id, fromMe: true },
  messageTimestamp: Math.floor(Date.now() / 1000),
  message: { conversation: text },
});

const assistantReply = (text: string) => [{
  id: 'a1',
  role: 'assistant',
  content: [{ type: 'text', text }],
  timestamp: Date.now(),
}];

/**
 * Poll until `cond` is true. Fixed sleeps flake under full-suite load: the
 * handler's dynamic imports can take longer than any fixed guess.
 */
async function waitFor(cond: () => boolean, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!cond()) {
    if (Date.now() > deadline) throw new Error(`waitFor: condition not met within ${timeoutMs}ms`);
    await new Promise((r) => setTimeout(r, 25));
  }
}

describe('whatsapp turn model selection', () => {
  it('runs the turn on the selected provider/model/cwd, never Ollama', async () => {
    const { handlers, sent, sock } = mockSocket();
    const seen: Array<{ provider: string; model: string; cwd: string; sessionId: string }> = [];
    await whatsAppLink.start({
      makeSocket: async () => sock,
      loadAuth: async () => ({ state: {}, saveCreds: async () => undefined }),
      getSetting: ((key: string) =>
        ({ provider: 'nvidia', model: 'meta/llama-3.3-70b-instruct', cwd: 'C:/work' })[key] as unknown) as never,
      runAgentImpl: (async (
        _h: never,
        _u: never,
        opts: { provider: string; model: string; cwd: string; sessionId: string },
      ) => {
        seen.push({ provider: opts.provider, model: opts.model, cwd: opts.cwd, sessionId: opts.sessionId });
        return assistantReply('done-remote') as never[];
      }) as never,
    });
    handlers.get('connection.update')!({ connection: 'open' });
    handlers.get('messages.upsert')!({ type: 'notify', messages: [selfMsg('m1', 'hello pc')] });
    await waitFor(() => seen.length > 0 && sent.length > 0);

    expect(seen).toHaveLength(1);
    expect(seen[0].provider).toBe('nvidia');
    expect(seen[0].model).toBe('meta/llama-3.3-70b-instruct');
    expect(seen[0].cwd).toBe('C:/work');
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ jid: '15551234567@s.whatsapp.net', text: 'done-remote' });
  });

  it('answers with setup guidance instead of spinning up Ollama when nothing is selected', async () => {
    const { handlers, sent, sock } = mockSocket();
    let ran = 0;
    await whatsAppLink.start({
      makeSocket: async () => sock,
      loadAuth: async () => ({ state: {}, saveCreds: async () => undefined }),
      getSetting: (() => undefined) as never,
      runAgentImpl: (async () => { ran++; return [] as never[]; }) as never,
    });
    handlers.get('connection.update')!({ connection: 'open' });
    handlers.get('messages.upsert')!({ type: 'notify', messages: [selfMsg('m2', 'hello?')] });
    await waitFor(() => sent.length > 0);

    expect(ran).toBe(0);
    expect(sent).toHaveLength(1);
    expect(sent[0].text).toMatch(/No AI provider selected/);
    expect(sent[0].text).toMatch(/Settings → AI Provider/);
  });
});

describe('whatsapp turn budget', () => {
  it('gives conversational self-chat a tight ceiling so replies come back fast', () => {
    expect(whatsappTurnBudget('hello pc')).toEqual({ maxTurns: 6, wallClockMs: 3 * 60_000 });
    expect(whatsappTurnBudget('what files changed today?')).toEqual({ maxTurns: 6, wallClockMs: 3 * 60_000 });
    expect(whatsappTurnBudget('thanks!')).toEqual({ maxTurns: 6, wallClockMs: 3 * 60_000 });
  });

  it('gives real tasks a working-size budget', () => {
    expect(whatsappTurnBudget('build me a dashboard and deploy it')).toEqual({
      maxTurns: 30,
      wallClockMs: 15 * 60_000,
    });
    expect(whatsappTurnBudget('research competitors and write a plan')).toEqual({
      maxTurns: 30,
      wallClockMs: 15 * 60_000,
    });
    // Long messages are always treated as tasks regardless of wording.
    expect(whatsappTurnBudget('x'.repeat(300)).maxTurns).toBe(30);
  });

  it('passes the per-message budget into the agent run', async () => {
    const { handlers, sent, sock } = mockSocket();
    const seen: Array<{ maxTurns?: number; wallClockMs?: number }> = [];
    await whatsAppLink.start({
      makeSocket: async () => sock,
      loadAuth: async () => ({ state: {}, saveCreds: async () => undefined }),
      getSetting: ((key: string) =>
        ({ provider: 'nvidia', model: 'meta/llama-3.3-70b-instruct', cwd: 'C:/work' })[key] as unknown) as never,
      runAgentImpl: (async (
        _h: never,
        _u: never,
        opts: { maxTurns?: number; wallClockMs?: number },
      ) => {
        seen.push({ maxTurns: opts.maxTurns, wallClockMs: opts.wallClockMs });
        return assistantReply('ok') as never[];
      }) as never,
    });
    handlers.get('connection.update')!({ connection: 'open' });

    handlers.get('messages.upsert')!({ type: 'notify', messages: [selfMsg('b1', 'hello pc')] });
    await waitFor(() => seen.length >= 1 && sent.length >= 1);
    handlers.get('messages.upsert')!({ type: 'notify', messages: [selfMsg('b2', 'build me a landing page')] });
    await waitFor(() => seen.length >= 2 && sent.length >= 2);

    expect(seen).toHaveLength(2);
    expect(seen[0]).toEqual({ maxTurns: 6, wallClockMs: 3 * 60_000 });
    expect(seen[1]).toEqual({ maxTurns: 30, wallClockMs: 15 * 60_000 });
  });
});
