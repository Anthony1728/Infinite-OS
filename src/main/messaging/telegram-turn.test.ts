import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Telegram turns must answer on the user's SELECTED model with a stable
// per-chat session — never a silent Ollama fallback, never amnesia.
const settingsState = vi.hoisted(() => ({ values: {} as Record<string, unknown> }));
const sessionState = vi.hoisted(() => ({ messages: new Map<string, unknown[]>(), sessions: [] as Array<{ id: string; title?: string }> }));
vi.mock('../settings/store.js', () => ({
  settings: { get: (key: string) => settingsState.values[key] },
}));
vi.mock('../settings/secrets.js', () => ({
  getApiKey: async () => undefined,
}));
vi.mock('../session/store.js', () => ({
  loadMessages: async (id: string) => [...(sessionState.messages.get(id) ?? [])],
  appendMessage: async (id: string, m: unknown) => {
    sessionState.messages.set(id, [...(sessionState.messages.get(id) ?? []), m]);
  },
  listSessions: async () => [...sessionState.sessions],
  createSession: async (s: { title?: string; cwd?: string; model?: string; provider?: string }) => {
    const id = `sess-${String(s.title ?? '').length}-${Date.now()}-${sessionState.sessions.length}`;
    sessionState.sessions.push({ id, title: s.title });
    return { id };
  },
}));

import { defaultRunTurn } from './telegram-inbound.js';

let testHome = '';
const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ['INFINITE_TEST_HOME'] as const) {
    savedEnv[k] = process.env[k];
    delete process.env[k];
  }
  testHome = mkdtempSync(join(tmpdir(), 'tg-turn-'));
  process.env.INFINITE_TEST_HOME = testHome;
  settingsState.values = {};
  sessionState.messages.clear();
  sessionState.sessions.length = 0;
});

afterEach(() => {
  for (const k of ['INFINITE_TEST_HOME'] as const) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  rmSync(testHome, { recursive: true, force: true });
});

const assistantReply = (text: string) => [{
  id: 'a1',
  role: 'assistant',
  content: [{ type: 'text', text }],
  timestamp: Date.now(),
}];

describe('telegram defaultRunTurn model selection', () => {
  it('runs on the selected provider/model/cwd with a stable per-chat session', async () => {
    settingsState.values = { provider: 'groq', model: 'llama-3.3-70b', cwd: 'D:/projects' };
    const seen: Array<{ provider: string; model: string; cwd: string; sessionId: string }> = [];
    const runAgentImpl = (async (_h: never, _u: never, opts: { provider: string; model: string; cwd: string; sessionId: string }) => {
      seen.push({ provider: opts.provider, model: opts.model, cwd: opts.cwd, sessionId: opts.sessionId });
      return assistantReply('tg-done') as never[];
    }) as never;

    const first = await defaultRunTurn('hello', '777', { runAgentImpl });
    const second = await defaultRunTurn('again', '777', { runAgentImpl });

    expect(first).toBe('tg-done');
    expect(second).toBe('tg-done');
    expect(seen).toHaveLength(2);
    for (const s of seen) {
      expect(s.provider).toBe('groq');
      expect(s.model).toBe('llama-3.3-70b');
      expect(s.cwd).toBe('D:/projects');
    }
    // Same chat → same session (history survives across messages).
    expect(seen[0].sessionId).toBe(seen[1].sessionId);
    expect(seen[0].sessionId).toMatch(/^sess-/);
  });

  it('returns setup guidance instead of spinning up Ollama when nothing is selected', async () => {
    let ran = 0;
    const answer = await defaultRunTurn('hello', '777', {
      runAgentImpl: (async () => { ran++; return [] as never[]; }) as never,
    });
    expect(ran).toBe(0);
    expect(answer).toMatch(/No AI provider selected/);
  });
});
