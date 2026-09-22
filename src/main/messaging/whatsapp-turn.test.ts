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

import { whatsAppLink } from './whatsapp-link.js';

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
    await new Promise((r) => setTimeout(r, 100));

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
    await new Promise((r) => setTimeout(r, 100));

    expect(ran).toBe(0);
    expect(sent).toHaveLength(1);
    expect(sent[0].text).toMatch(/No AI provider selected/);
    expect(sent[0].text).toMatch(/Settings → AI Provider/);
  });
});
