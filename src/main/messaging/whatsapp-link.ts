/**
 * WhatsApp link — the OpenClaw loop for WhatsApp: scan a QR code once to link
 * your number (companion device, like WhatsApp Web), then message yourself —
 * the agent runs the turn on your PC and replies in that chat.
 *
 * Safety: answers ONLY the linked owner's self-chat plus explicitly allowlisted
 * JIDs; groups, broadcasts, strangers, and our own echoed replies are ignored.
 * Auth creds persist under <profile-home>/whatsapp-link. Never auto-starts —
 * the user starts it from Messaging → WhatsApp Link and scans the QR.
 */

import { join } from 'node:path';
import { rm } from 'node:fs/promises';
import { infiniteHome } from '../profiles/home.js';
import { settings } from '../settings/store.js';

export type WhatsAppLinkState = 'off' | 'qr' | 'connecting' | 'open' | 'closed';

export interface WhatsAppLinkStatus {
  state: WhatsAppLinkState;
  owner: string | null;
  qrDataUrl: string | null;
  lastError: string | null;
  startedAt: number | null;
  lastInbound: { at: number; from: string; reason: string; answered: boolean } | null;
  lastTurn: { at: number; ok: boolean; error: string | null } | null;
}

export interface WhatsAppLinkDeps {
  makeSocket?: (opts: Record<string, unknown>) => Promise<WhatsAppSocket>;
  loadAuth?: (dir: string) => Promise<{ state: unknown; saveCreds: () => Promise<void> }>;
  runTurn?: (text: string, from: string) => Promise<string>;
  log?: (...args: unknown[]) => void;
  now?: () => number;
}

// Structural subset of the Baileys socket surface we use (keeps tests light).
export interface WhatsAppSocket {
  user?: { id?: string };
  ev: { on: (event: string, cb: (data: Record<string, unknown>) => void) => void };
  sendMessage: (jid: string, content: { text: string }) => Promise<{ key?: { id?: string } }>;
  end: (error?: unknown) => void;
}

/** Normalize a JID for comparison (strip device suffix, lowercase). */
export function normalizeJid(jid: unknown): string {
  const raw = String(jid ?? '').trim().toLowerCase();
  if (!raw) return '';
  const [user, server] = raw.split('@');
  if (!user) return '';
  const bareUser = user.split(':')[0].replace(/\.\d+$/, '');
  return server ? `${bareUser}@${server}` : bareUser;
}

/** True when the message lives in the owner's self-chat. */
export function isSelfChat(remoteJid: unknown, ownJid: unknown): boolean {
  const remote = normalizeJid(remoteJid);
  const own = normalizeJid(ownJid);
  return Boolean(remote && own && remote === own);
}

/** Extract sendable text from a Baileys message (text, extended text, captions). */
export function extractInboundText(message: unknown): string {
  let msg = (message as Record<string, unknown> | null)?.message as Record<string, unknown> | undefined;
  if (!msg || typeof msg !== 'object') return '';
  // Disappearing / view-once messages wrap the real payload one level deep.
  for (let depth = 0; depth < 2; depth++) {
    const ephemeral = msg.ephemeralMessage as Record<string, unknown> | undefined;
    const viewOnce = (msg.viewOnceMessage ?? msg.viewOnceMessageV2) as Record<string, unknown> | undefined;
    const inner = (ephemeral?.message ?? viewOnce?.message) as Record<string, unknown> | undefined;
    if (!inner || typeof inner !== 'object') break;
    msg = inner;
  }
  const convo = msg.conversation;
  if (typeof convo === 'string' && convo.trim()) return convo.trim().slice(0, 4000);
  const extended = msg.extendedTextMessage as Record<string, unknown> | undefined;
  if (extended && typeof extended.text === 'string' && extended.text.trim()) {
    return extended.text.trim().slice(0, 4000);
  }
  for (const key of ['imageMessage', 'videoMessage', 'documentMessage']) {
    const media = msg[key] as Record<string, unknown> | undefined;
    if (media && typeof media.caption === 'string' && media.caption.trim()) {
      return media.caption.trim().slice(0, 4000);
    }
  }
  return '';
}

export interface InboundDecision {
  answer: boolean;
  reason: string;
}

/**
 * Pure gate: should this inbound message become an agent turn? Exported for tests.
 * Self-chat (message-yourself flow) always qualifies; anything else needs an
 * explicit allowlist entry. Our own echoed replies and pre-link history never do.
 */
export function shouldAnswerInbound(opts: {
  remoteJid: string;
  ownJid: string;
  fromMe: boolean;
  isGroup: boolean;
  isBroadcast: boolean;
  messageId: string;
  messageTimeMs: number;
  linkStartedAtMs: number;
  sentIds: Set<string>;
  extraAllowedJids: Set<string>;
  hasText: boolean;
}): InboundDecision {
  if (opts.isBroadcast) return { answer: false, reason: 'broadcast' };
  if (opts.isGroup) return { answer: false, reason: 'group' };
  if (!opts.hasText) return { answer: false, reason: 'no-text' };
  if (opts.messageTimeMs < opts.linkStartedAtMs - 60_000) return { answer: false, reason: 'history' };
  if (opts.sentIds.has(opts.messageId)) return { answer: false, reason: 'own-echo' };
  const remote = normalizeJid(opts.remoteJid);
  const own = normalizeJid(opts.ownJid);
  if (remote && remote === own) return { answer: true, reason: 'self-chat' };
  if (!opts.fromMe && remote && opts.extraAllowedJids.has(remote)) return { answer: true, reason: 'allowlisted' };
  return { answer: false, reason: 'not-owner' };
}

export function extraAllowedJids(): Set<string> {
  const out = new Set<string>();
  const raw = settings.get<unknown>('whatsappAllowedJids');
  const list = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(',') : [];
  for (const entry of list) {
    const normalized = normalizeJid(entry);
    if (normalized) out.add(normalized);
  }
  return out;
}

class WhatsAppLink {
  private state: WhatsAppLinkState = 'off';
  private sock: WhatsAppSocket | null = null;
  private owner: string | null = null;
  private qrDataUrl: string | null = null;
  private lastError: string | null = null;
  private startedAt: number | null = null;
  private sentIds = new Set<string>();
  private wantOn = false;
  private starting: Promise<void> | null = null;
  private lastInbound: WhatsAppLinkStatus['lastInbound'] = null;
  private lastTurn: WhatsAppLinkStatus['lastTurn'] = null;

  status(): WhatsAppLinkStatus {
    return { state: this.state, owner: this.owner, qrDataUrl: this.qrDataUrl, lastError: this.lastError, startedAt: this.startedAt, lastInbound: this.lastInbound, lastTurn: this.lastTurn };
  }

  isOn(): boolean {
    return this.wantOn;
  }

  credsDir(): string {
    return join(infiniteHome(), 'whatsapp-link');
  }

  async start(deps: WhatsAppLinkDeps = {}): Promise<WhatsAppLinkStatus> {
    if (this.starting) {
      await this.starting;
      return this.status();
    }
    this.wantOn = true;
    this.starting = this.connect(deps).finally(() => {
      this.starting = null;
    });
    await this.starting;
    return this.status();
  }

  stop(): WhatsAppLinkStatus {
    this.wantOn = false;
    try {
      this.sock?.end(undefined);
    } catch { /* already closed */ }
    this.sock = null;
    if (this.state !== 'off') this.state = 'closed';
    this.qrDataUrl = null;
    return this.status();
  }

  async unpair(): Promise<WhatsAppLinkStatus> {
    this.stop();
    this.state = 'off';
    this.owner = null;
    this.lastError = null;
    this.startedAt = null;
    this.sentIds.clear();
    try {
      await rm(this.credsDir(), { recursive: true, force: true });
    } catch { /* nothing stored */ }
    return this.status();
  }

  private setState(state: WhatsAppLinkState): void {
    this.state = state;
    if (state !== 'qr') this.qrDataUrl = null;
  }

  private async connect(deps: WhatsAppLinkDeps): Promise<void> {
    const log = deps.log ?? (() => {});
    const now = deps.now ?? Date.now;
    this.lastError = null;
    this.startedAt = now();
    this.setState('connecting');
    try {
      const baileys = deps.makeSocket
        ? null
        : await import('@whiskeysockets/baileys').catch((e: unknown) => {
            throw new Error(`WhatsApp library failed to load: ${(e as Error).message}`);
          });
      const { state: authState, saveCreds } = deps.loadAuth
        ? await deps.loadAuth(this.credsDir())
        : await (async () => {
            const { useMultiFileAuthState } = baileys as typeof import('@whiskeysockets/baileys');
            return useMultiFileAuthState(this.credsDir());
          })();
      const sock: WhatsAppSocket = deps.makeSocket
        ? await deps.makeSocket({ auth: authState })
        : await (async () => {
            const { makeWASocket, Browsers } = baileys as typeof import('@whiskeysockets/baileys');
            return makeWASocket({
              auth: authState as never,
              browser: Browsers.macOS('Infinite OS'),
              syncFullHistory: false,
              markOnlineOnConnect: false,
            }) as unknown as WhatsAppSocket;
          })();
      this.sock = sock;
      try {
        const credListener = (): void => {
          void saveCreds().catch(() => undefined);
        };
        (sock.ev.on as (event: string, cb: () => void) => void)('creds.update', credListener);
      } catch { /* optional */ }

      sock.ev.on('connection.update', (update) => {
        void this.onConnectionUpdate(update, deps).catch((e) => log('[whatsapp-link]', (e as Error).message));
      });
      sock.ev.on('messages.upsert', (upsert) => {
        void this.onMessages(upsert, deps).catch((e) => log('[whatsapp-link]', (e as Error).message));
      });
    } catch (e) {
      this.lastError = (e as Error).message;
      this.setState('closed');
      if (this.wantOn) {
        // One delayed retry so transient load failures don't need a click.
        setTimeout(() => {
          if (this.wantOn && (this.state === 'closed' || this.state === 'connecting')) void this.start(deps);
        }, 15000).unref?.();
      }
    }
  }

  private async onConnectionUpdate(update: Record<string, unknown>, deps: WhatsAppLinkDeps): Promise<void> {
    const log = deps.log ?? (() => {});
    const connection = update.connection as string | undefined;
    if (typeof update.qr === 'string' && update.qr) {
      try {
        const { default: QRCode } = await import('qrcode');
        this.qrDataUrl = await QRCode.toDataURL(update.qr, { width: 264, margin: 1 });
      } catch {
        this.qrDataUrl = null;
      }
      this.setState('qr');
      return;
    }
    if (connection === 'open') {
      const ownId = this.sock?.user?.id ? normalizeJid(this.sock.user.id) : '';
      this.owner = ownId || this.owner;
      this.lastError = null;
      this.setState('open');
      log('[whatsapp-link] connected as', this.owner ?? '(unknown)');
      return;
    }
    if (connection === 'close') {
      const statusCode = (update.lastDisconnect as Record<string, unknown> | undefined)?.error as { output?: { statusCode?: number } } | undefined;
      const code = statusCode?.output?.statusCode;
      this.sock = null;
      if (code === 401) {
        // Logged out on the phone — creds are dead, stay off until re-pair.
        this.lastError = 'Logged out on the phone. Unpair and scan again.';
        this.wantOn = false;
        this.setState('closed');
        return;
      }
      this.lastError = `Connection closed${code ? ` (${code})` : ''}.`;
      this.setState('closed');
      if (this.wantOn) {
        this.setState('connecting');
        setTimeout(() => {
          if (this.wantOn) void this.start(deps);
        }, 8000).unref?.();
      }
    }
  }

  private async onMessages(upsert: Record<string, unknown>, deps: WhatsAppLinkDeps): Promise<void> {
    const log = deps.log ?? (() => {});
    const now = deps.now ?? Date.now;
    if (upsert.type !== 'notify') return;
    const messages = (upsert.messages ?? []) as Array<Record<string, unknown>>;
    const ownJid = this.owner ?? (this.sock?.user?.id ? normalizeJid(this.sock.user.id) : '');
    for (const raw of messages) {
      const key = (raw.key ?? {}) as Record<string, unknown>;
      const remoteJid = String(key.remoteJid ?? '');
      const fromMe = key.fromMe === true;
      const messageId = String(key.id ?? '');
      const messageTimeMs = typeof raw.messageTimestamp === 'number' ? raw.messageTimestamp * 1000 : now();
      const text = extractInboundText(raw);
      const decision = shouldAnswerInbound({
        remoteJid,
        ownJid,
        fromMe,
        isGroup: remoteJid.endsWith('@g.us'),
        isBroadcast: remoteJid === 'status@broadcast',
        messageId,
        messageTimeMs,
        linkStartedAtMs: this.startedAt ?? now(),
        sentIds: this.sentIds,
        extraAllowedJids: extraAllowedJids(),
        hasText: text.length > 0,
      });
      if (!decision.answer || !this.sock) {
        // Record drops too — a panel showing "dropped (history)" beats silence.
        if (text) this.lastInbound = { at: now(), from: remoteJid, reason: this.sock ? decision.reason : 'no-socket', answered: false };
        continue;
      }
      // Claim the id BEFORE the turn so our own echo can never re-trigger.
      if (messageId) {
        this.sentIds.add(messageId);
        if (this.sentIds.size > 200) {
          const first = this.sentIds.values().next();
          if (!first.done) this.sentIds.delete(first.value);
        }
      }
      this.lastInbound = { at: now(), from: remoteJid, reason: decision.reason, answered: true };
      log('[whatsapp-link] answering', remoteJid, `(${decision.reason})`);
      try {
        const answer = deps.runTurn ? await deps.runTurn(text, remoteJid) : await this.defaultRunTurn(text, log);
        this.lastTurn = { at: now(), ok: true, error: null };
        const sent = await this.sock.sendMessage(remoteJid, { text: answer.slice(0, 4000) });
        const sentId = sent?.key?.id;
        if (sentId) this.sentIds.add(sentId);
      } catch (e) {
        const err = (e as Error).message;
        this.lastTurn = { at: now(), ok: false, error: err };
        this.lastError = `Reply failed: ${err}`;
        log('[whatsapp-link] turn failed:', err);
        try {
          await this.sock.sendMessage(remoteJid, { text: `Sorry — I tried to run that but hit an error: ${err.slice(0, 300)}` });
        } catch { /* send itself broken; panel + logs carry it */ }
      }
    }
  }

  private async defaultRunTurn(text: string, log: (...args: unknown[]) => void = () => {}): Promise<string> {
    const provider = settings.get<string>('provider') ?? 'ollama';
    const model = settings.get<string>('model') ?? 'qwen3:4b';
    log('[whatsapp-link] turn start via', `${provider}/${model}`);
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
        sessionId: `whatsapp-${Date.now()}`,
        cwd: process.cwd(),
        provider,
        model,
        signal: ctrl.signal,
        onEvent: () => {},
      });
      const last = [...completed].reverse().find((m) => m.role === 'assistant');
      const blocks = (last?.content ?? []) as Array<{ type?: string; text?: string }>;
      const answer = blocks.filter((b) => b.type === 'text' && b.text).map((b) => b.text).join('\n\n').trim();
      log('[whatsapp-link] turn done, answer chars:', answer.length);
      return answer || '(The agent finished with no text answer.)';
    } finally {
      clearTimeout(timer);
    }
  }
}

export const whatsAppLink = new WhatsAppLink();
