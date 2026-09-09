import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ENV_KEYS = ['TELEGRAM_INBOUND', 'TELEGRAM_BOT_TOKEN', 'TELEGRAM_ALLOWED_CHATS', 'TELEGRAM_CHAT_ID', 'INFINITE_TEST_HOME'];
let savedEnv: Record<string, string | undefined> = {};
let testHome = '';

// Isolate the poller from chokidar watchers (settings) and Electron safeStorage
// (secrets): the units under test are selection, offset IO, and loop wiring.
const settingsState = vi.hoisted(() => ({ values: {} as Record<string, unknown> }));
vi.mock('../settings/store.js', () => ({
  settings: {
    get: (key: string) => settingsState.values[key],
    set: async (_scope: string, key: string, value: unknown) => { settingsState.values[key] = value; },
  },
}));
vi.mock('../settings/secrets.js', () => ({
  getApiKey: async () => undefined,
}));

async function load() {
  return import('./telegram-inbound.js');
}

beforeEach(() => {
  savedEnv = {};
  for (const k of ENV_KEYS) {
    savedEnv[k] = process.env[k];
    delete process.env[k];
  }
  testHome = mkdtempSync(join(tmpdir(), 'tg-inbound-'));
  process.env.INFINITE_TEST_HOME = testHome;
});

afterEach(() => {
  const mod = (globalThis as Record<string, unknown>).__tgInbound as { stop?: () => void } | undefined;
  mod?.stop?.();
  delete (globalThis as Record<string, unknown>).__tgInbound;
  for (const k of ENV_KEYS) {
    if (k === 'INFINITE_TEST_HOME') continue;
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  delete process.env.INFINITE_TEST_HOME;
  if (testHome) rmSync(testHome, { recursive: true, force: true });
  vi.unstubAllGlobals();
});

describe('parseAllowedChats', () => {
  it('accepts arrays, csv strings, and strips @', async () => {
    const { parseAllowedChats } = await load();
    expect([...parseAllowedChats(['123', '@me'])]).toEqual(['123', 'me']);
    expect([...parseAllowedChats('1, 2 ,@three')]).toEqual(['1', '2', 'three']);
    expect(parseAllowedChats(undefined).size).toBe(0);
    expect(parseAllowedChats('').size).toBe(0);
  });
});

describe('selectInboundMessages', () => {
  it('only passes allowlisted human text, and advances the offset', async () => {
    const { selectInboundMessages } = await load();
    const allowed = new Set(['111']);
    const { actionable, nextOffset } = selectInboundMessages(
      [
        { update_id: 10, message: { chat: { id: 111 }, text: '  hello  ' } },
        { update_id: 11, message: { chat: { id: 999 }, text: 'stranger' } },
        { update_id: 12, message: { chat: { id: 111 }, from: { is_bot: true }, text: 'bot noise' } },
        { update_id: 13, message: { chat: { id: 111 } } },
        { update_id: 14 },
      ],
      allowed,
    );
    expect(actionable).toEqual([{ chatId: '111', text: 'hello' }]);
    expect(nextOffset).toBe(15);
  });

  it('returns null offset for an empty batch', async () => {
    const { selectInboundMessages } = await load();
    expect(selectInboundMessages([], new Set(['1']))).toEqual({ actionable: [], nextOffset: null });
  });
});

describe('offset persistence', () => {
  it('round-trips through the profile home', async () => {
    const { loadOffset, saveOffset } = await load();
    expect(loadOffset()).toBe(0);
    saveOffset(4242);
    expect(loadOffset()).toBe(4242);
  });
});

describe('poller loop', () => {
  it('answers an allowlisted DM and ignores strangers', async () => {
    process.env.TELEGRAM_INBOUND = '1';
    process.env.TELEGRAM_BOT_TOKEN = 'TESTTOKEN';
    process.env.TELEGRAM_ALLOWED_CHATS = '111';
    const { telegramInbound } = await load();
    (globalThis as Record<string, unknown>).__tgInbound = telegramInbound;

    const batch = {
      ok: true,
      result: [
        { update_id: 50, message: { chat: { id: 111 }, text: 'what time is it' } },
        { update_id: 51, message: { chat: { id: 999 }, text: 'hack attempt' } },
      ],
    };
    const fetchMock = vi.fn(async (url: string) => {
      // Behave like Telegram: once the offset passes the batch, results are empty.
      const m = /offset=(\d+)/.exec(String(url));
      const off = m ? Number(m[1]) : 0;
      return { ok: true, json: async () => (off > 51 ? { ok: true, result: [] } : batch) } as Response;
    });
    const runTurn = vi.fn(async (text: string) => `answer:${text}`);
    const replies: Array<{ chatId: string; text: string }> = [];
    const sendReply = vi.fn(async (chatId: string, text: string) => { replies.push({ chatId, text }); });

    telegramInbound.start({ fetchFn: fetchMock as unknown as typeof fetch, runTurn, sendReply, log: () => {} });
    const deadline = Date.now() + 8000;
    while (replies.length === 0 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 50));
    }
    telegramInbound.stop();

    expect(runTurn).toHaveBeenCalledTimes(1);
    expect(runTurn).toHaveBeenCalledWith('what time is it', '111');
    expect(replies).toEqual([{ chatId: '111', text: 'answer:what time is it' }]);
    // Poller must never leak the token anywhere but the request URL host path.
    const polledUrl = String(fetchMock.mock.calls[0][0]);
    expect(polledUrl).toContain('api.telegram.org/botTESTTOKEN/getUpdates');
  });

  it('stays idle when disabled', async () => {
    const { telegramInbound } = await load();
    (globalThis as Record<string, unknown>).__tgInbound = telegramInbound;
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ ok: true, result: [] }) }) as Response);
    telegramInbound.start({ fetchFn: fetchMock as unknown as typeof fetch, log: () => {} });
    await new Promise((r) => setTimeout(r, 300));
    telegramInbound.stop();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
