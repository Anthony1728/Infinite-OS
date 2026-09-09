/**
 * Telegram inbound — the OpenClaw loop: a DM to your bot becomes an agent
 * turn, and the answer is sent back to that chat. Long-polls getUpdates,
 * so no public webhook URL is needed on a desktop machine.
 *
 * Safety: replies ONLY to allowlisted chat ids (never strangers), text
 * messages only, per-turn timeout, offset persisted so restarts never
 * re-answer old messages. Enable with the `telegramInboundEnabled`
 * setting (or TELEGRAM_INBOUND=1); allowlist via `telegramAllowedChatIds`
 * setting (or TELEGRAM_ALLOWED_CHATS=123,456). Bot token from the
 * `telegram` secrets entry or TELEGRAM_BOT_TOKEN.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { infiniteHome } from '../profiles/home.js';
import { settings } from '../settings/store.js';
import { getApiKey } from '../settings/secrets.js';
import { messagingTool } from '../tools/messaging.js';
// NOTE: runAgent is lazy-imported inside defaultRunTurn so that tests and
// lightweight consumers of this module never load the full agent graph.

export interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id?: number;
    chat?: { id?: number | string };
    from?: { is_bot?: boolean };
    text?: string;
  };
}

export interface InboundDeps {
  fetchFn?: typeof fetch;
  runTurn?: (text: string, chatId: string) => Promise<string>;
  sendReply?: (chatId: string, text: string) => Promise<void>;
  log?: (...args: unknown[]) => void;
}

const OFFSET_FILE = 'messaging/telegram-inbound.json';

function offsetPath(): string {
  return join(infiniteHome(), OFFSET_FILE);
}

export function loadOffset(): number {
  try {
    if (!existsSync(offsetPath())) return 0;
    const data = JSON.parse(readFileSync(offsetPath(), 'utf8')) as { offset?: unknown };
    return typeof data.offset === 'number' && data.offset > 0 ? Math.floor(data.offset) : 0;
  } catch {
    return 0;
  }
}

export function saveOffset(offset: number): void {
  try {
    mkdirSync(dirname(offsetPath()), { recursive: true });
    writeFileSync(offsetPath(), JSON.stringify({ offset }), 'utf8');
  } catch { /* offset persistence is best-effort */ }
}

/**
 * Pure filter: from a getUpdates batch, extract actionable (chatId, text)
 * pairs — text DMs from allowlisted, non-bot senders — plus the next offset.
 * Exported for tests.
 */
export function selectInboundMessages(
  updates: TelegramUpdate[],
  allowedChats: Set<string>,
): { actionable: Array<{ chatId: string; text: string }>; nextOffset: number | null } {
  const actionable: Array<{ chatId: string; text: string }> = [];
  let maxId: number | null = null;
  for (const u of updates ?? []) {
    if (typeof u?.update_id === 'number') maxId = maxId === null ? u.update_id : Math.max(maxId, u.update_id);
    const chatId = u?.message?.chat?.id;
    const text = u?.message?.text?.trim();
    if (chatId === undefined || chatId === null || !text) continue;
    if (u.message?.from?.is_bot) continue;
    const key = String(chatId);
    if (!allowedChats.has(key)) continue;
    actionable.push({ chatId: key, text: text.slice(0, 4000) });
  }
  return { actionable, nextOffset: maxId === null ? null : maxId + 1 };
}

export function parseAllowedChats(raw: unknown): Set<string> {
  const out = new Set<string>();
  const push = (v: unknown) => {
    const s = String(v ?? '').trim().replace(/^@/, '');
    if (s) out.add(s);
  };
  if (Array.isArray(raw)) raw.forEach(push);
  else if (typeof raw === 'string') raw.split(',').forEach(push);
  return out;
}

async function resolveToken(): Promise<string | undefined> {
  try {
    const saved = await getApiKey('telegram').catch(() => undefined);
    if (saved) return saved;
  } catch { /* fall through to env */ }
  return process.env.TELEGRAM_BOT_TOKEN || undefined;
}

function resolveAllowed(): Set<string> {
  const fromSettings = settings.get<unknown>('telegramAllowedChatIds');
  const set = parseAllowedChats(fromSettings);
  if (set.size === 0) parseAllowedChats(process.env.TELEGRAM_ALLOWED_CHATS).forEach((c) => set.add(c));
  const single = settings.get<unknown>('telegramDefaultChatId') ?? process.env.TELEGRAM_CHAT_ID;
  if (single !== undefined && single !== null && String(single).trim()) set.add(String(single).trim().replace(/^@/, ''));
  return set;
}

export function isInboundEnabled(): boolean {
  const flag = settings.get<unknown>('telegramInboundEnabled');
  if (typeof flag === 'boolean') return flag;
  return process.env.TELEGRAM_INBOUND === '1';
}

async function defaultRunTurn(text: string): Promise<string> {
  const provider = settings.get<string>('provider') ?? 'ollama';
  const model = settings.get<string>('model') ?? 'qwen3:4b';
  const { runAgent } = await import('../agent/loop.js');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 4 * 60_000);
  try {
    const userMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: [{ type: 'text', text }],
      timestamp: Date.now(),
    } as never;
    const completed = await runAgent([], userMessage, {
      sessionId: `telegram-${Date.now()}`,
      cwd: process.cwd(),
      provider,
      model,
      signal: ctrl.signal,
      onEvent: () => {},
    });
    const last = [...completed].reverse().find((m) => m.role === 'assistant');
    const blocks = (last?.content ?? []) as Array<{ type?: string; text?: string }>;
    const answer = blocks.filter((b) => b.type === 'text' && b.text).map((b) => b.text).join('\n\n').trim();
    return answer || '(The agent finished with no text answer.)';
  } finally {
    clearTimeout(timer);
  }
}

async function defaultSendReply(token: string, chatId: string, text: string): Promise<void> {
  const result = await messagingTool.execute(
    { action: 'send_telegram', telegramToken: token, telegramChatId: chatId, text },
    { cwd: process.cwd(), abortSignal: AbortSignal.timeout(20000), sessionId: 'telegram-inbound', onUpdate: () => {} } as never,
  );
  if (result.is_error) throw new Error(String(result.content).slice(0, 200));
}

class TelegramInbound {
  private running = false;
  private timer: ReturnType<typeof setTimeout> | null = null;

  isRunning(): boolean {
    return this.running;
  }

  start(deps: InboundDeps = {}): void {
    if (this.running) return;
    this.running = true;
    void this.loop(deps);
  }

  stop(): void {
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private async loop(deps: InboundDeps): Promise<void> {
    const log = deps.log ?? (() => {});
    const fetchFn = deps.fetchFn ?? fetch;
    let offset = loadOffset();
    let backoffMs = 1000;
    while (this.running) {
      try {
        if (!isInboundEnabled()) {
          await this.sleep(15000);
          continue;
        }
        const token = await resolveToken();
        if (!token) {
          await this.sleep(30000);
          continue;
        }
        const allowed = resolveAllowed();
        if (allowed.size === 0) {
          await this.sleep(30000);
          continue;
        }
        const url = `https://api.telegram.org/bot${token}/getUpdates?offset=${offset}&timeout=25&allowed_updates=${encodeURIComponent(JSON.stringify(['message']))}`;
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 35000);
        let res: Response;
        try {
          res = await fetchFn(url, { signal: ctrl.signal });
        } finally {
          clearTimeout(t);
        }
        if (!res.ok) throw new Error(`Telegram getUpdates HTTP ${res.status}`);
        const data = (await res.json()) as { ok?: boolean; result?: TelegramUpdate[] };
        const { actionable, nextOffset } = selectInboundMessages(data.result ?? [], allowed);
        if (nextOffset !== null) {
          offset = nextOffset;
          saveOffset(offset);
        }
        backoffMs = 1000;
        for (const item of actionable) {
          if (!this.running) return;
          try {
            const answer = deps.runTurn
              ? await deps.runTurn(item.text, item.chatId)
              : await defaultRunTurn(item.text);
            if (deps.sendReply) await deps.sendReply(item.chatId, answer);
            else await defaultSendReply(token, item.chatId, answer);
          } catch (err) {
            log('[telegram-inbound] turn failed:', (err as Error).message);
          }
        }
        if (actionable.length === 0) {
          // Idle beat: yield the event loop so instant empty polls (and
          // mocked transports) can never hot-spin the process.
          await this.sleep(1000);
        }
      } catch (err) {
        log('[telegram-inbound] poll error:', (err as Error).message);
        backoffMs = Math.min(backoffMs * 2, 60_000);
        await this.sleep(backoffMs);
      }
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      this.timer = setTimeout(resolve, ms);
    });
  }
}

export const telegramInbound = new TelegramInbound();
