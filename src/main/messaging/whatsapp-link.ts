/**
 * WhatsApp link — the OpenClaw loop for WhatsApp: scan a QR code once to link
 * your number (companion device, like WhatsApp Web), then message yourself —
 * the agent runs the turn on your PC and replies in that chat.
 *
 * Safety (self-chat-only): ONLY the owner's message-yourself chat is ever
 * answered. Every other chat — direct 1:1s from anyone else, groups,
 * broadcasts, our own outbound messages, echoed replies, pre-link history —
 * is ignored and never receives a reply, an acknowledgement, or a permission
 * prompt. There is no allowlist and no stranger path.
 *
 * Auth creds persist under <profile-home>/whatsapp-link. A previous pairing
 * auto-resumes on app launch; fresh installs stay off until the user links
 * from Messaging → WhatsApp Link and scans the QR.
 */

import { join } from 'node:path';
import { rm } from 'node:fs/promises';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, appendFileSync, statSync } from 'node:fs';
import { infiniteHome } from '../profiles/home.js';
import { settings } from '../settings/store.js';
import * as sessionStore from '../session/store.js';
import { setPermissionRelay } from '../agent/permission-prompt.js';
import {
  NoActiveModelError,
  resolveActiveModel,
  type ActiveModel,
  type AgentRunner,
  type SettingsGetter,
} from '../agent/active-model.js';
import { IPC } from '../../shared/ipc.js';

export type WhatsAppLinkState = 'off' | 'qr' | 'connecting' | 'open' | 'closed';

export interface WhatsAppLinkStatus {
  state: WhatsAppLinkState;
  owner: string | null;
  qrDataUrl: string | null;
  lastError: string | null;
  startedAt: number | null;
  lastInbound: { at: number; from: string; reason: string; answered: boolean } | null;
  lastTurn: { at: number; ok: boolean; error: string | null } | null;
  debugLog: string | null;
}

export interface WhatsAppLinkDeps {
  makeSocket?: (opts: Record<string, unknown>) => Promise<WhatsAppSocket>;
  loadAuth?: (dir: string) => Promise<{ state: unknown; saveCreds: () => Promise<void> }>;
  runTurn?: (text: string, from: string) => Promise<string>;
  /** Test seam: override settings reads (defaults to the live settings store). */
  getSetting?: SettingsGetter;
  /** Test seam: override the agent runner (defaults to the real runAgent). */
  runAgentImpl?: AgentRunner;
  log?: (...args: unknown[]) => void;
  now?: () => number;
}

// Structural subset of the Baileys socket surface we use (keeps tests light).
// user carries every identity WhatsApp may give the account (PN id plus LID
// variants); sendPresenceUpdate is best-effort typing presence.
export interface WhatsAppSocket {
  user?: { id?: string; lid?: string; phoneNumber?: string };
  ev: { on: (event: string, cb: (data: Record<string, unknown>) => void) => void };
  sendMessage: (jid: string, content: { text: string }) => Promise<{ key?: { id?: string } }>;
  sendPresenceUpdate?: (presence: string, jid: string) => Promise<void>;
  end: (error?: unknown) => void;
}

/**
 * Pure approval-reply parser: 'yes'/'y'/'approve' (or no variants) when a
 * permission is pending. Exported for tests; the allowlist of words is
 * deliberately tight — a chatty "yes, and also…" must never approve anything.
 */
export function parseApprovalReply(text: string): 'yes' | 'no' | null {
  const t = text.trim().toLowerCase().replace(/[^a-z]/g, '');
  if (t === 'yes' || t === 'y') return 'yes';
  if (t === 'no' || t === 'n') return 'no';
  return null;
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
 * Self-chat-only mode: the owner's message-yourself chat always qualifies (in
 * either direction, with echo protection); EVERYTHING else is ignored —
 * direct 1:1s from anyone, groups, broadcasts, our own outbound messages,
 * textless messages, and pre-link history. There is deliberately no stranger
 * path: no reply, no acknowledgement, no permission prompt. `extraAllowedJids`
 * is retained on the signature for compatibility but is never consulted.
 */
export function shouldAnswerInbound(opts: {
  remoteJid: string;
  ownJid: string;
  ownerAltJids?: string[];
  remoteJidAlt?: string;
  fromMe: boolean;
  isGroup: boolean;
  isBroadcast: boolean;
  messageId: string;
  messageTimeMs: number;
  linkStartedAtMs: number;
  sentIds: Set<string>;
  extraAllowedJids?: Set<string>;
  hasText: boolean;
}): InboundDecision {
  if (opts.isBroadcast) return { answer: false, reason: 'broadcast' };
  if (opts.isGroup) return { answer: false, reason: 'group' };
  if (!opts.hasText) return { answer: false, reason: 'no-text' };
  if (opts.messageTimeMs < opts.linkStartedAtMs - 60_000) return { answer: false, reason: 'history' };
  if (opts.sentIds.has(opts.messageId)) return { answer: false, reason: 'own-echo' };
  // Identity set: the account's PN plus every LID variant WhatsApp reports.
  // LID-vs-PN mismatches must never misclassify a self message as outbound.
  const owners = new Set<string>();
  const own = normalizeJid(opts.ownJid);
  if (own) owners.add(own);
  for (const alt of opts.ownerAltJids ?? []) {
    const n = normalizeJid(alt);
    if (n) owners.add(n);
  }
  const remote = normalizeJid(opts.remoteJid);
  const remoteAlt = normalizeJid(opts.remoteJidAlt);
  if ((remote && owners.has(remote)) || (remoteAlt && owners.has(remoteAlt))) {
    return { answer: true, reason: 'self-chat' };
  }
  // My own outbound messages to other people: their reply will come as its
  // own inbound — answering my own sends would double-reply every chat.
  if (opts.fromMe) return { answer: false, reason: 'my-outbound' };
  // Self-chat-only: anyone else is ignored, allowlist or not.
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

export function debugLogPath(): string {
  return join(infiniteHome(), 'whatsapp-link', 'debug.log');
}

/** Append-only debug log (capped): every connection event, inbound summary,
 * gate decision, and turn outcome lands here so a silent phone-side failure
 * can be diagnosed from the file instead of guessed at. */
export function appendDebugLog(line: string): void {
  try {
    const p = debugLogPath();
    mkdirSync(join(infiniteHome(), 'whatsapp-link'), { recursive: true });
    try {
      // Cap the file: keep the last ~100KB so it can never grow unbounded.
      if (statSync(p).size > 200_000) {
        writeFileSync(p, readFileSync(p, 'utf8').slice(-100_000), 'utf8');
      }
    } catch { /* no log yet */ }
    appendFileSync(p, `${new Date().toISOString()} ${line}\n`, 'utf8');
  } catch { /* logging must never break the link */ }
}

class WhatsAppLink {
  private state: WhatsAppLinkState = 'off';
  private sock: WhatsAppSocket | null = null;
  private owner: string | null = null;
  // Every normalized identity that counts as "me" (PN id + LID variants).
  private ownerAlts = new Set<string>();
  private qrDataUrl: string | null = null;
  private lastError: string | null = null;
  private startedAt: number | null = null;
  private sentIds = new Set<string>();
  private wantOn = false;
  private starting: Promise<void> | null = null;
  private lastInbound: WhatsAppLinkStatus['lastInbound'] = null;
  private lastTurn: WhatsAppLinkStatus['lastTurn'] = null;
  // Per-JID conversation history for multi-turn WhatsApp conversations.
  private conversationHistory = new Map<string, Array<{ id: string; role: string; content: Array<{ type: string; text: string }>; timestamp: number }>>();
  private conversationSessionIds = new Map<string, string>();

  status(): WhatsAppLinkStatus {
    return { state: this.state, owner: this.owner, qrDataUrl: this.qrDataUrl, lastError: this.lastError, startedAt: this.startedAt, lastInbound: this.lastInbound, lastTurn: this.lastTurn, debugLog: debugLogPath() };
  }

  isOn(): boolean {
    return this.wantOn;
  }

  credsDir(): string {
    return join(infiniteHome(), 'whatsapp-link');
  }

  /** True when a previous pairing left creds on disk (auto-resume candidate). */
  hasLinkedCreds(): boolean {
    try {
      const dir = this.credsDir();
      if (!existsSync(dir)) return false;
      return readdirSync(dir).length > 0;
    } catch {
      return false;
    }
  }

  /**
   * Outbound delivery into the owner's self-chat (used by automation
   * notifications such as the morning brief). Never throws — failures come
   * back as { ok: false } so callers can surface them. Messaging anyone else
   * is impossible by construction: the target is always the linked owner
   * identity. Claim sent ids so our own delivery echoes can never re-trigger.
   */
  async sendToSelf(text: string): Promise<{ ok: boolean; error?: string }> {
    const target = this.owner;
    if (!this.sock || !target || this.state !== 'open') {
      return { ok: false, error: `WhatsApp is not linked (state: ${this.state}). Link it from Messaging → WhatsApp Link first.` };
    }
    const body = text.trim();
    if (!body) return { ok: false, error: 'Nothing to send.' };
    try {
      for (let i = 0; i < body.length; i += 4000) {
        const sent = await this.sock.sendMessage(target, { text: body.slice(i, i + 4000) });
        const id = sent?.key?.id;
        if (id) {
          this.sentIds.add(id);
          if (this.sentIds.size > 200) {
            const first = this.sentIds.values().next();
            if (!first.done) this.sentIds.delete(first.value);
          }
        }
      }
      appendDebugLog(`sendToSelf chars=${body.length} ok`);
      return { ok: true };
    } catch (e) {
      const err = (e as Error).message;
      appendDebugLog(`sendToSelf FAILED error=${err.slice(0, 200)}`);
      return { ok: false, error: err };
    }
  }

  /** All normalized identities that count as "me" (PN + LID variants). */
  private selfJids(): Set<string> {
    const out = new Set<string>();
    if (this.owner) out.add(this.owner);
    for (const alt of this.ownerAlts) out.add(alt);
    return out;
  }

  /** True when a JID (or its alt identity) is the owner's self-chat. */
  private isSelfRemote(remoteJid: string, remoteJidAlt?: string): boolean {
    const self = this.selfJids();
    if (self.size === 0) return false;
    if (remoteJid && self.has(normalizeJid(remoteJid))) return true;
    if (remoteJidAlt && self.has(normalizeJid(remoteJidAlt))) return true;
    return false;
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
    this.ownerAlts.clear();
    this.lastError = null;
    this.startedAt = null;
    this.sentIds.clear();
    this.conversationHistory.clear();
    this.conversationSessionIds.clear();
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
    // Watchdog: a socket stuck in "connecting" (dead network, killed phone
    // radio) must say so instead of spinning silently.
    const connectMark = this.startedAt;
    setTimeout(() => {
      if (this.wantOn && this.state === 'connecting' && this.startedAt === connectMark) {
        this.lastError = 'Still connecting after 45s — the phone may be offline. Disconnect and link again.';
        appendDebugLog('watchdog: still connecting after 45s');
      }
    }, 45_000).unref?.();
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
      appendDebugLog('event connection.update qr=present');
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
      const u = this.sock?.user;
      // The account may present as PN, LID, or both — every variant counts as
      // "me" so self-chat is recognised whichever identity a message carries.
      const ids = [u?.id, u?.lid, u?.phoneNumber].map((j) => normalizeJid(j)).filter(Boolean);
      this.ownerAlts = new Set(ids);
      this.owner = ids[0] || this.owner;
      this.lastError = null;
      this.setState('open');
      appendDebugLog(`event connection=open owner=${this.owner ?? '(unknown)'} identities=${ids.join(',') || '(none)'}`);
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
        appendDebugLog('event connection=close code=401 (logged out on phone)');
        this.wantOn = false;
        this.setState('closed');
        return;
      }
      this.lastError = `Connection closed${code ? ` (${code})` : ''}.`;
      appendDebugLog(`event connection=close code=${code ?? 'unknown'}`);
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
    appendDebugLog(`event messages.upsert count=${messages.length}`);
    const ownJid = this.owner ?? (this.sock?.user?.id ? normalizeJid(this.sock.user.id) : '');
    for (const raw of messages) {
      const key = (raw.key ?? {}) as Record<string, unknown>;
      const remoteJid = String(key.remoteJid ?? '');
      const remoteJidAlt = typeof key.remoteJidAlt === 'string' ? key.remoteJidAlt : '';
      const fromMe = key.fromMe === true;
      const messageId = String(key.id ?? '');
      const messageTimeMs = typeof raw.messageTimestamp === 'number' ? raw.messageTimestamp * 1000 : now();
      const text = extractInboundText(raw);
      const decision = shouldAnswerInbound({
        remoteJid,
        remoteJidAlt,
        ownJid,
        ownerAltJids: [...this.ownerAlts],
        fromMe,
        isGroup: remoteJid.endsWith('@g.us'),
        isBroadcast: remoteJid === 'status@broadcast',
        messageId,
        messageTimeMs,
        linkStartedAtMs: this.startedAt ?? now(),
        sentIds: this.sentIds,
        hasText: text.length > 0,
      });
      if (!decision.answer || !this.sock) {
        // Record drops too — a panel showing "dropped (history)" beats silence.
        if (text) {
          this.lastInbound = { at: now(), from: remoteJid, reason: this.sock ? decision.reason : 'no-socket', answered: false };
          appendDebugLog(`inbound from=${remoteJid} decision=${this.sock ? decision.reason : 'no-socket'} answered=false chars=${text.length}`);
        }
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

      // YES/NO replies resolve a pending permission instead of becoming turns.
      if (this.pendingApprovals.size > 0) {
        const approval = parseApprovalReply(text);
        const jidKey = normalizeJid(remoteJid);
        if (approval) {
          const pendingId = this.pendingApprovals.get(jidKey);
          if (pendingId) {
            this.pendingApprovals.delete(jidKey);
            const { respondToPermission } = await import('../agent/permission-prompt.js');
            respondToPermission(pendingId, approval === 'yes');
            this.lastInbound = { at: now(), from: remoteJid, reason: `approval:${approval}`, answered: true };
            appendDebugLog(`approval from=${remoteJid} verdict=${approval}`);
            try {
              await this.sock.sendMessage(remoteJid, { text: approval === 'yes' ? '✅ Approved — continuing.' : '🛑 Denied — skipping that step.' });
            } catch { /* reply best-effort */ }
            continue;
          }
        }
      }

      this.lastInbound = { at: now(), from: remoteJid, reason: decision.reason, answered: true };
      log('[whatsapp-link] answering', remoteJid, `(${decision.reason})`);
      appendDebugLog(`inbound from=${remoteJid} decision=${decision.reason} answered=true chars=${text.length}`);
      try {
        // Instant "typing…" presence so the phone feels alive while the turn
        // runs on the PC — the OpenClaw-style responsiveness cue.
        try {
          await this.sock.sendPresenceUpdate?.('composing', remoteJid);
        } catch { /* presence is cosmetic */ }
        const answer = deps.runTurn ? await deps.runTurn(text, remoteJid) : await this.defaultRunTurn(text, log, remoteJid, deps);
        try {
          await this.sock.sendPresenceUpdate?.('paused', remoteJid);
        } catch { /* presence is cosmetic */ }
        this.lastTurn = { at: now(), ok: true, error: null };
        appendDebugLog(`turn ok chars=${answer.length}`);
        const sent = await this.sock.sendMessage(remoteJid, { text: answer.slice(0, 4000) });
        const sentId = sent?.key?.id;
        if (sentId) this.sentIds.add(sentId);
        appendDebugLog(`reply sent id=${sentId ?? '(unknown)'}`);
      } catch (e) {
        const err = (e as Error).message;
        this.lastTurn = { at: now(), ok: false, error: err };
        this.lastError = `Reply failed: ${err}`;
        appendDebugLog(`turn FAILED error=${err.slice(0, 200)}`);
        log('[whatsapp-link] turn failed:', err);
        try {
          await this.sock.sendMessage(remoteJid, { text: `Sorry — I tried to run that but hit an error: ${err.slice(0, 300)}` });
        } catch { /* send itself broken; panel + logs carry it */ }
      }
    }
  }

  /**
   * Permission approvals from the phone: JID → pending permission id. The
   * relay announces the request; the contact's YES/NO reply resolves it via
   * respondToPermission (same resolver the desktop modal uses).
   */
  private pendingApprovals = new Map<string, string>();

  /** Wire the permission relay once so ask-gated tools can be approved from
   * the phone instead of stalling into the 5-minute desktop timeout.
   * Self-chat-only: the prompt goes to the owner and nobody else. */
  private ensurePermissionRelay(): void {
    setPermissionRelay((info) => {
      // Resolve the waiting run's contact (reverse-lookup the live map first,
      // fall back to the session-id convention), then verify it is the owner.
      let candidate: string | null = null;
      for (const [contact, sessionId] of this.conversationSessionIds) {
        if (sessionId === info.sessionId) { candidate = contact; break; }
      }
      if (!candidate && info.sessionId.startsWith('whatsapp-')) {
        candidate = info.sessionId.replace(/^whatsapp-/, '').replace(/-\d+$/, '');
      }
      if (!candidate || !this.sock) return;
      const target = candidate.includes('@') ? candidate : `${candidate}@s.whatsapp.net`;
      if (!this.isSelfRemote(target)) return; // never prompt strangers
      this.pendingApprovals.set(target, info.id);
      const input = typeof info.input === 'string' ? info.input : JSON.stringify(info.input);
      void this.sock.sendMessage(
        target,
        { text: `🔐 Permission needed: ${info.tool}\n${String(input).slice(0, 300)}\n\nReply YES to allow, NO to deny (5 min).` },
      ).catch(() => undefined);
    });
  }

  private async defaultRunTurn(text: string, log: (...args: unknown[]) => void = () => {}, remoteJid?: string, deps?: WhatsAppLinkDeps): Promise<string> {
    // The phone always answers on the user's SELECTED Infinite OS model.
    // There is no silent Ollama fallback: unasked local inference hogs the
    // machine and answers on a model nobody picked. With nothing selected the
    // user gets an actionable message instead of a hung turn.
    let active: ActiveModel;
    try {
      const get: SettingsGetter = deps?.getSetting ?? ((key) => settings.get(key));
      active = resolveActiveModel(get);
    } catch (e) {
      if (e instanceof NoActiveModelError) {
        log('[whatsapp-link] no active model:', (e as Error).message);
        return e.message;
      }
      throw e;
    }
    const { provider, model, cwd } = active;
    log('[whatsapp-link] turn start via', `${provider}/${model}`, 'cwd:', cwd);
    this.ensurePermissionRelay();
    const runAgent = deps?.runAgentImpl ?? (await import('../agent/loop.js')).runAgent;
    const ctrl = new AbortController();
    // Long-running builds/launches from the phone need more than a chat reply:
    // 20 minutes covers a LaunchProduct run end-to-end.
    const timer = setTimeout(() => ctrl.abort(), 20 * 60_000);
    try {
      // Stable per-contact session, PERSISTED in the session store so history
      // survives restarts and the desktop transcript shows the phone-driven work.
      const sessionId = remoteJid
        ? (this.conversationSessionIds.get(remoteJid) ?? await this.resolvePersistentSession(remoteJid))
        : `whatsapp-${Date.now()}`;
      if (remoteJid) this.conversationSessionIds.set(remoteJid, sessionId);
      const history = await sessionStore.loadMessages(sessionId).catch(() => []);
      const userMessage = {
        id: crypto.randomUUID(),
        role: 'user',
        content: [{ type: 'text', text: `[WhatsApp] ${text}` }],
        timestamp: Date.now(),
      } as never;
      await sessionStore.appendMessage(sessionId, userMessage).catch(() => undefined);

      // Mark this contact as live while the run is active (relay sets the id).
      if (remoteJid && !this.pendingApprovals.has(remoteJid)) {
        this.pendingApprovals.set(remoteJid, '');
      }
      const completed = await runAgent([...history] as never, userMessage, {
        sessionId,
        cwd,
        provider,
        model,
        signal: ctrl.signal,
        onEvent: (e) => this.mirrorToDesktop(sessionId, e),
      });
      if (remoteJid) this.pendingApprovals.delete(remoteJid);
      for (const m of completed.slice(history.length + 1)) {
        await sessionStore.appendMessage(sessionId, m).catch(() => undefined);
      }
      const last = [...completed].reverse().find((m) => m.role === 'assistant');
      const blocks = (last?.content ?? []) as Array<{ type?: string; text?: string }>;
      const answer = blocks.filter((b) => b.type === 'text' && b.text).map((b) => b.text).join('\n\n').trim();
      log('[whatsapp-link] turn done, answer chars:', answer.length);
      return answer || '(The agent finished with no text answer.)';
    } finally {
      clearTimeout(timer);
      if (remoteJid) this.pendingApprovals.delete(remoteJid);
    }
  }

  /** Find or create the persisted session for a contact; returns a stable id. */
  private async resolvePersistentSession(jid: string): Promise<string> {
    const suffix = jid.replace(/[^a-zA-Z0-9]/g, '-').slice(0, 32);
    try {
      const sessions = await sessionStore.listSessions();
      const existing = sessions.find((s) => s.id === `whatsapp-${suffix}` || s.title === `WhatsApp: ${jid}`);
      if (existing) return existing.id;
      const created = await sessionStore.createSession({
        cwd: (settings.get('cwd') as string | undefined) || process.cwd(),
        model: settings.get<string>('model') ?? '',
        provider: settings.get<string>('provider') ?? '',
        title: `WhatsApp: ${jid}`,
      });
      return created.id;
    } catch {
      return `whatsapp-${suffix}-${Date.now()}`;
    }
  }

  /** Mirror phone-driven agent activity into the desktop chat stream. */
  private async mirrorToDesktop(sessionId: string, e: unknown): Promise<void> {
    try {
      const { BrowserWindow } = await import('electron');
      const win = BrowserWindow.getAllWindows()[0];
      win?.webContents.send(IPC.CHAT_STREAM_EVENT, { sessionId, ...(e as Record<string, unknown>) });
    } catch { /* mirroring is best-effort (also absent under tests) */ }
  }
}

export const whatsAppLink = new WhatsAppLink();
