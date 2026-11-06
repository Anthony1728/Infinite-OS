/**
 * Phone Remote — LAN companion server
 *
 * Serves a single-file mobile chat page and an SSE event stream so the user
 * can talk to their Infinite AI from their phone and watch the agent work in
 * real time. Auth is a shared token (also embedded in the QR code URL), the
 * same trust model as the local browser bridge.
 */

import http from 'node:http';
import { timingSafeEqual, randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir, networkInterfaces } from 'node:os';
import { join } from 'node:path';
import QRCode from 'qrcode';
import { runAgent } from '../agent/loop.js';
import { appendMessage, loadMessages } from '../session/store.js';
import { resolveActiveModel, NoActiveModelError, type SettingsGetter } from '../agent/active-model.js';
import { settings } from '../settings/store.js';
import type { ContentBlock, Message } from '../../shared/types.js';

const PORT = Number(process.env.INFINITE_REMOTE_PORT ?? 8766);
const REMOTE_SESSION_ID = 'phone-remote';
const MAX_BODY_BYTES = 64 * 1024;

interface RemoteClient {
  res: http.ServerResponse;
}

class PhoneRemoteServer {
  private server: http.Server | null = null;
  private token = '';
  private clients = new Set<RemoteClient>();
  private busy = false;
  private abortController: AbortController | null = null;
  private startedAt = 0;
  private port = PORT;
  private listening = false;
  private listenError = '';

  start(): void {
    if (this.server) return;
    this.token = this.loadToken();
    this.createServer(PORT);
  }

  private createServer(port: number): void {
    const server = http.createServer((req, res) => void this.handle(req, res));
    this.server = server;
    server.on('error', (err: NodeJS.ErrnoException) => {
      this.listening = false;
      // Prefer the configured port, but never leave the phone feature dead just
      // because 8766 is taken — fall back to an ephemeral port and report the
      // actual one through getInfo() so the QR/link stay correct.
      if (err.code === 'EADDRINUSE' && port === PORT) {
        console.warn(`[remote] port ${PORT} in use — using an ephemeral port instead`);
        try { server.close(); } catch { /* not listening yet */ }
        this.server = null;
        this.createServer(0);
        return;
      }
      this.listenError = err.message || String(err);
      console.error('[remote] server error:', this.listenError);
    });
    server.on('listening', () => {
      this.listening = true;
      this.listenError = '';
      const addr = server.address();
      this.port = typeof addr === 'object' && addr ? addr.port : port;
      this.startedAt = Date.now();
      console.log(`[remote] phone companion listening on 0.0.0.0:${this.port}`);
    });
    server.listen(port, '0.0.0.0');
  }

  stop(): void {
    this.abortController?.abort();
    for (const client of this.clients) client.res.end();
    this.clients.clear();
    if (this.server) {
      this.server.close();
      this.server = null;
      this.listening = false;
    }
  }

  async getInfo(): Promise<{
    running: boolean;
    url: string;
    qrDataUrl: string;
    lanIp: string;
    addresses: string[];
    port: number;
    connections: number;
    busy: boolean;
    error: string;
  }> {
    const addresses = this.lanAddresses();
    const lanIp = addresses[0] ?? '127.0.0.1';
    const url = `http://${lanIp}:${this.port}/?token=${this.token}`;
    let qrDataUrl = '';
    try {
      qrDataUrl = await QRCode.toDataURL(url, { margin: 1, width: 320, color: { dark: '#18181b', light: '#fafafa' } });
    } catch (err) {
      console.error('[remote] QR generation failed:', err);
    }
    return {
      running: this.listening,
      url,
      qrDataUrl,
      lanIp,
      addresses,
      port: this.port,
      connections: this.clients.size,
      busy: this.busy,
      error: this.listenError,
    };
  }

  private loadToken(): string {
    const dir = join(homedir(), '.infinite-ai');
    const path = join(dir, 'remote-token');
    try {
      if (existsSync(path)) {
        const existing = readFileSync(path, 'utf-8').trim();
        if (existing.length >= 16) return existing;
      }
      mkdirSync(dir, { recursive: true });
      const token = randomBytes(24).toString('base64url');
      writeFileSync(path, token);
      return token;
    } catch (err) {
      console.error('[remote] could not persist remote token:', err);
      return randomBytes(24).toString('base64url');
    }
  }

  // Rank every usable IPv4 candidate so the QR points at an adapter the phone
  // can actually reach. Virtual/VPN adapters (vEthernet, WSL, Tailscale, …)
  // usually come first from os.networkInterfaces() but are unreachable from the
  // LAN, which is why "same Wi-Fi" phones sometimes cannot connect.
  private lanAddresses(): string[] {
    const candidates: { name: string; address: string }[] = [];
    const ifaces = networkInterfaces() as unknown as Record<string, { family: string | number; internal: boolean; address: string }[] | undefined>;
    for (const [name, list] of Object.entries(ifaces)) {
      for (const ni of list ?? []) {
        const family = String(ni.family);
        if ((family === 'IPv4' || family === '4') && !ni.internal) {
          candidates.push({ name: name.toLowerCase(), address: ni.address });
        }
      }
    }
    const score = ({ name, address }: { name: string; address: string }): number => {
      let s = 0;
      if (/(wi-?fi|wlan|wireless|ethernet|eth\d|lan)/.test(name)) s += 50;
      if (/(vethernet|virtual|vmware|vbox|hyper-v|docker|wsl|tailscale|zerotier|vpn|tap|tun|hamachi|radmin|loopback|bluetooth)/.test(name)) s -= 100;
      if (address.startsWith('192.168.')) s += 30;
      else if (address.startsWith('10.')) s += 20;
      else if (/^172\.(1[6-9]|2\d|3[01])\./.test(address)) s += 5;
      return s;
    };
    candidates.sort((a, b) => score(b) - score(a));
    const seen = new Set<string>();
    const ranked: string[] = [];
    for (const c of candidates) {
      if (seen.has(c.address)) continue;
      seen.add(c.address);
      ranked.push(c.address);
    }
    return ranked.length ? ranked : ['127.0.0.1'];
  }

  private tokenOk(url: URL, req?: http.IncomingMessage): boolean {
    // Prefer the Authorization header — a token in the URL query leaks into
    // browser history, referer headers, and proxy logs on anything between
    // the phone and this machine. The query param stays as a fallback so the
    // served page's own fetches keep working during a rolling update.
    const header = String(req?.headers?.authorization ?? '').replace(/^Bearer\s+/i, '').trim();
    const given = Buffer.from(header || (url.searchParams.get('token') ?? ''));
    const expected = Buffer.from(this.token);
    return given.length > 0 && given.length === expected.length && timingSafeEqual(given, expected);
  }

  private sse(res: http.ServerResponse): void {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    res.write(': connected\n\n');
    const client: RemoteClient = { res };
    this.clients.add(client);
    const heartbeat = setInterval(() => res.write(': ping\n\n'), 25_000);
    res.on('close', () => {
      clearInterval(heartbeat);
      this.clients.delete(client);
    });
  }

  private broadcast(event: Record<string, unknown>): void {
    const payload = `data: ${JSON.stringify(event)}\n\n`;
    for (const client of this.clients) {
      try {
        client.res.write(payload);
      } catch {
        this.clients.delete(client);
      }
    }
  }

  // Brute-force guard: a token is 192 bits, but an unthrottled 401 endpoint
  // on the LAN is still an invitation. After AUTH_FAIL_LIMIT failures inside
  // the window, every request is rejected for AUTH_PENALTY_MS — real users
  // scanning a fresh QR never hit it; a guessing loop stalls out.
  private static readonly AUTH_FAIL_LIMIT = 10;
  private static readonly AUTH_FAIL_WINDOW_MS = 5 * 60_000;
  private static readonly AUTH_PENALTY_MS = 15 * 60_000;
  private authFailures: number[] = [];
  private authPenaltyUntil = 0;

  private recordAuthFailure(): void {
    const now = Date.now();
    this.authFailures = this.authFailures.filter((t) => now - t < PhoneRemoteServer.AUTH_FAIL_WINDOW_MS);
    this.authFailures.push(now);
    if (this.authFailures.length >= PhoneRemoteServer.AUTH_FAIL_LIMIT) {
      this.authPenaltyUntil = now + PhoneRemoteServer.AUTH_PENALTY_MS;
      this.authFailures = [];
      console.warn('[remote] auth brute-force guard engaged — rejecting requests for 15 minutes');
    }
  }

  private async handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const now = Date.now();
    if (now < this.authPenaltyUntil) {
      res.writeHead(429, { 'Content-Type': 'text/plain' });
      res.end('Infinite OS phone remote: too many invalid attempts — try again later.');
      return;
    }
    if (!this.tokenOk(url, req)) {
      this.recordAuthFailure();
      res.writeHead(401, { 'Content-Type': 'text/plain' });
      res.end('Infinite OS phone remote: invalid or missing token.');
      return;
    }

    try {
      if (req.method === 'GET' && url.pathname === '/') {
        this.servePage(res);
      } else if (req.method === 'GET' && url.pathname === '/api/status') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, app: 'Infinite OS', busy: this.busy, uptimeMs: Date.now() - this.startedAt }));
      } else if (req.method === 'GET' && url.pathname === '/api/history') {
        const messages = await loadMessages(REMOTE_SESSION_ID);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ messages: historyForClient(messages) }));
      } else if (req.method === 'GET' && url.pathname === '/api/stream') {
        this.sse(res);
      } else if (req.method === 'POST' && url.pathname === '/api/chat') {
        await this.handleChat(req, res);
      } else if (req.method === 'POST' && url.pathname === '/api/stop') {
        this.abortController?.abort();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } else {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not found');
      }
    } catch (err) {
      console.error('[remote] request error:', err);
      if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Internal error' }));
    }
  }

  private handleChat(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    return new Promise((resolve) => {
      let body = '';
      let oversized = false;
      req.on('data', (chunk: string) => {
        body += chunk;
        if (body.length > MAX_BODY_BYTES) {
          oversized = true;
          req.destroy();
        }
      });
      req.on('end', async () => {
        if (oversized) {
          res.writeHead(413, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Message too long' }));
          return resolve();
        }
        let text = '';
        let providerOverride = '';
        let modelOverride = '';
        try {
          const parsed = JSON.parse(body || '{}') as { message?: unknown; provider?: unknown; model?: unknown };
          text = typeof parsed.message === 'string' ? parsed.message.trim() : '';
          if (typeof parsed.provider === 'string') providerOverride = parsed.provider.trim();
          if (typeof parsed.model === 'string') modelOverride = parsed.model.trim();
        } catch {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid JSON body' }));
          return resolve();
        }
        if (!text) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Missing message' }));
          return resolve();
        }
        if (this.busy) {
          res.writeHead(409, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'The agent is already working on a task. Try again shortly.' }));
          return resolve();
        }

        res.writeHead(202, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
        resolve();
        await this.runTurn(text, providerOverride, modelOverride);
      });
      req.on('error', () => {
        if (!res.headersSent) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Request failed' }));
        }
        resolve();
      });
    });
  }

  private async runTurn(text: string, providerOverride: string, modelOverride: string): Promise<void> {
    this.busy = true;
    this.abortController = new AbortController();
    const userMessage: Message = {
      id: randomUUID(),
      role: 'user',
      content: [{ type: 'text', text }] satisfies ContentBlock[],
      timestamp: Date.now(),
    };

    // The phone must answer with the same model Infinite OS is set to use,
    // not a hardcoded fallback — it is the same assistant.
    let active: { provider: string; model: string; cwd: string };
    try {
      if (providerOverride && modelOverride) {
        active = { provider: providerOverride, model: modelOverride, cwd: process.cwd() };
      } else {
        const getSetting: SettingsGetter = ((key: string) => settings.get(key)) as SettingsGetter;
        active = resolveActiveModel(getSetting);
      }
    } catch (err) {
      this.busy = false;
      this.abortController = null;
      const message = err instanceof NoActiveModelError
        ? err.message
        : 'Could not resolve the AI provider selected in Infinite OS. Open Settings → AI Provider and pick one.';
      this.broadcast({ type: 'error', message });
      return;
    }
    const { provider, model, cwd } = active;

    try {
      const history = await loadMessages(REMOTE_SESSION_ID);
      await appendMessage(REMOTE_SESSION_ID, userMessage);
      this.broadcast({ type: 'user_message', text });

      const completed = await runAgent(history, userMessage, {
        sessionId: REMOTE_SESSION_ID,
        cwd,
        provider,
        model,
        signal: this.abortController.signal,
        onEvent: (ev) => {
          switch (ev.type) {
            case 'message_start':
              this.broadcast({ type: 'assistant_start', message_id: ev.message_id });
              break;
            case 'message_discard':
              this.broadcast({ type: 'message_discard', message_id: ev.message_id });
              break;
            case 'provider_start':
              this.broadcast({
                type: 'provider_start',
                message_id: ev.message_id,
                provider: ev.provider,
                model: ev.model,
                turn: typeof ev.turn === 'number' ? ev.turn : 0,
              });
              break;
            case 'provider_status':
              this.broadcast({
                type: 'provider_status',
                status: ev.status,
                provider: ev.provider,
                model: ev.model,
                from: ev.from,
                to: ev.to,
                reason: ev.reason,
              });
              break;
            case 'thinking_delta':
              if (typeof ev.text === 'string' && ev.text) {
                this.broadcast({ type: 'thinking_delta', message_id: ev.message_id, text: ev.text });
              }
              break;
            case 'text_delta':
              this.broadcast({ type: 'text_delta', message_id: ev.message_id, text: ev.text });
              break;
            case 'tool_use_start':
              this.broadcast({ type: 'tool_start', message_id: ev.message_id, tool_use_id: ev.tool_use_id, name: ev.name });
              break;
            case 'tool_use_end':
              this.broadcast({ type: 'tool_end', message_id: ev.message_id, tool_use_id: ev.tool_use_id, name: ev.name, input: ev.input });
              break;
            case 'tool_result':
              this.broadcast({
                type: 'tool_result',
                tool_use_id: ev.tool_use_id,
                isError: ev.is_error === true,
                preview: typeof ev.content === 'string' ? ev.content.slice(0, 300) : '',
              });
              break;
            case 'message_end':
              this.broadcast({ type: 'message_end', message_id: ev.message_id, stop_reason: ev.stop_reason });
              break;
            case 'done':
              this.broadcast({ type: 'done', success: ev.success !== false, reason: typeof ev.reason === 'string' ? ev.reason : undefined });
              break;
            case 'error':
              this.broadcast({ type: 'error', message: String(ev.error ?? 'Unknown error') });
              break;
            default:
              break;
          }
        },
      });

      for (const msg of completed) {
        if (msg.role === 'assistant') await appendMessage(REMOTE_SESSION_ID, msg);
      }
      const finalText = [...completed].reverse().find((m) => m.role === 'assistant');
      const answer = finalText?.content.filter((b) => b.type === 'text').map((b) => (b as { text: string }).text).join('') ?? '';
      this.broadcast({ type: 'final', text: answer });
    } catch (err) {
      console.error('[remote] run turn failed:', err);
      this.broadcast({ type: 'error', message: err instanceof Error ? err.message : String(err) });
    } finally {
      this.busy = false;
      this.abortController = null;
    }
  }

  private servePage(res: http.ServerResponse): void {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(mobilePage());
  }
}

/**
 * Flatten a transcript for the phone page: the client renders text, an
 * optional collapsed thinking panel, and one chip per tool call.
 */
function historyForClient(messages: Message[]): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  for (const m of messages) {
    if (m.role !== 'user' && m.role !== 'assistant') continue;
    const textParts: string[] = [];
    const thinkingParts: string[] = [];
    const tools: Array<Record<string, unknown>> = [];
    for (const block of m.content ?? []) {
      if (block.type === 'text') textParts.push(block.text);
      else if (block.type === 'thinking') thinkingParts.push(block.text);
      else if (block.type === 'tool_use') tools.push({ id: block.id, name: block.name });
    }
    const text = textParts.join('').trim();
    const thinking = thinkingParts.join('').trim();
    if (!text && !thinking && tools.length === 0) continue;
    out.push({
      id: m.id,
      role: m.role,
      text,
      thinking,
      tools,
      provider: m.provider,
      model: m.model,
      timestamp: m.timestamp,
    });
  }
  return out;
}

function mobilePage(): string {
  // Premium Infinite OS aesthetic — matches desktop globals.css / globals-classic.css
  // Logo is the real infinite loop (same ORBIT_PATH as InfiniteLogo.tsx) with spectrum gradient.
  const ORBIT_PATH = 'M18 50C18 29 32 16 50 16c21 0 34 18 50 34s29 34 50 34c18 0 32-13 32-34s-14-34-32-34c-21 0-34 18-50 34S71 84 50 84C32 84 18 71 18 50Z';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#080a10">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<title>Infinite OS — Phone</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; -webkit-tap-highlight-color: transparent; }
  html, body { height: 100%; }
  html { background: #080a10; }
  body {
    min-height: 100%;
    background:
      radial-gradient(1200px 600px at 18% -10%, rgba(139,92,246,.14), transparent 55%),
      radial-gradient(900px 500px at 88% -6%, rgba(34,211,238,.10), transparent 50%),
      radial-gradient(700px 400px at 70% 110%, rgba(236,72,153,.08), transparent 60%),
      #080a10;
    color: #e4e4e7; font-family: Inter, -apple-system, 'Segoe UI', system-ui, sans-serif;
    display: flex; flex-direction: column;
    -webkit-font-smoothing: antialiased;
  }
  header {
    flex: 0 0 auto;
    position: sticky; top: 0; z-index: 10;
    display: flex; align-items: center; gap: 10px;
    padding: calc(env(safe-area-inset-top) + 12px) 14px 12px;
    background: rgba(12,16,24,.72);
    backdrop-filter: blur(16px) saturate(1.2);
    -webkit-backdrop-filter: blur(16px) saturate(1.2);
    border-bottom: 1px solid rgba(255,255,255,.06);
  }
  .brand { display: flex; align-items: center; gap: 10px; min-width: 0; }
  .logo-wrap {
    width: 32px; height: 32px; border-radius: 9px;
    background: rgba(255,255,255,.04);
    border: 1px solid rgba(255,255,255,.07);
    display: grid; place-items: center; flex: 0 0 auto;
    box-shadow: 0 4px 16px rgba(0,0,0,.35), inset 0 1px 0 rgba(255,255,255,.06);
  }
  .logo-wrap svg { width: 22px; height: 11px; overflow: visible; }
  .brand-text { line-height: 1; }
  .brand-text b { display: block; font-size: 13px; font-weight: 700; letter-spacing: -.02em; color: #fafafa; }
  .brand-text span { display: block; font-size: 10px; font-weight: 500; letter-spacing: .08em; text-transform: uppercase; color: #71717a; margin-top: 2px; }
  .hdr-actions { margin-left: auto; display: flex; align-items: center; gap: 8px; }
  .status-pill {
    display: inline-flex; align-items: center; gap: 6px;
    padding: 6px 10px; border-radius: 999px;
    background: rgba(255,255,255,.04); border: 1px solid rgba(255,255,255,.07);
    font-size: 11px; font-weight: 500; color: #a1a1aa; letter-spacing: .02em;
  }
  .dot { width: 7px; height: 7px; border-radius: 50%; background: #52525b; box-shadow: 0 0 0 2px rgba(82,82,91,.25); }
  .dot.live { background: #22c55e; box-shadow: 0 0 8px rgba(34,197,94,.55), 0 0 0 2px rgba(34,197,94,.18); }
  /* Infinite loop runners — same as InfiniteLogo.tsx spectrum */
  .infinite-runner { fill: none; stroke-linecap: round; stroke-linejoin: round; }
  .runner-violet { stroke: #8b5cf6; stroke-width: 3; opacity: .95; stroke-dasharray: 18 82; animation: dash 1.35s linear infinite; }
  .runner-cyan { stroke: #22d3ee; stroke-width: 3; opacity: .95; stroke-dasharray: 18 82; animation: dash 1.35s linear infinite .22s; }
  .runner-pink { stroke: #ec4899; stroke-width: 3; opacity: .95; stroke-dasharray: 18 82; animation: dash 1.35s linear infinite .44s; }
  @keyframes dash { from { stroke-dashoffset: 0; } to { stroke-dashoffset: -100; } }
  @keyframes spin { to { transform: rotate(360deg); } }
  main { flex: 1 1 auto; overflow-y: auto; padding: 18px 14px 12px; -webkit-overflow-scrolling: touch; }
  .empty {
    max-width: 340px; margin: 18vh auto 0; text-align: center;
    padding: 24px 18px; border-radius: 16px;
    background: rgba(255,255,255,.035); border: 1px solid rgba(255,255,255,.06);
    backdrop-filter: blur(12px);
  }
  .empty .hero-logo { width: 120px; height: 60px; margin: 0 auto 14px; display: block; filter: drop-shadow(0 8px 20px rgba(139,92,246,.25)); }
  .empty h2 { font-size: 14px; font-weight: 600; color: #fafafa; letter-spacing: -.01em; }
  .empty p { font-size: 12.5px; line-height: 1.55; color: #a1a1aa; margin-top: 8px; }
  .empty .hint { margin-top: 14px; display: inline-flex; align-items: center; gap: 6px; font-size: 11px; color: #71717a; background: rgba(255,255,255,.04); border: 1px solid rgba(255,255,255,.06); padding: 6px 10px; border-radius: 999px; }
  .msg { max-width: 86%; margin-bottom: 10px; padding: 11px 13px; border-radius: 14px; font-size: 15px; line-height: 1.5; white-space: pre-wrap; word-break: break-word; border: 1px solid transparent; }
  .user { margin-left: auto; background: linear-gradient(135deg, #ececec, #f4f4f5); color: #18181b; border-bottom-right-radius: 4px; border-color: rgba(255,255,255,.6); }
  .assistant { background: rgba(255,255,255,.05); border-color: rgba(255,255,255,.06); backdrop-filter: blur(8px); border-bottom-left-radius: 4px; color: #e4e4e7; }
  .activity {
    display: flex; align-items: center; gap: 8px; margin: 6px auto 10px; width: fit-content;
    padding: 7px 12px; border-radius: 999px;
    background: rgba(139,92,246,.08); border: 1px solid rgba(139,92,246,.14);
    font-size: 11.5px; font-weight: 500; color: #c4b5fd; letter-spacing: .01em;
  }
  .spinner { width: 10px; height: 10px; border: 1.5px solid rgba(196,181,253,.35); border-top-color: #c4b5fd; border-radius: 50%; animation: spin .8s linear infinite; }
  footer {
    flex: 0 0 auto; display: flex; gap: 10px;
    padding: 12px 12px calc(env(safe-area-inset-bottom) + 14px);
    background: rgba(12,16,24,.78); border-top: 1px solid rgba(255,255,255,.06);
    backdrop-filter: blur(16px) saturate(1.2);
  }
  .input-wrap {
    flex: 1; min-width: 0; display: flex; align-items: center; gap: 8px;
    background: rgba(255,255,255,.05); border: 1px solid rgba(255,255,255,.09);
    border-radius: 14px; padding: 6px 6px 6px 14px;
    transition: border-color .15s, background .15s;
  }
  .input-wrap:focus-within { border-color: rgba(139,92,246,.35); background: rgba(255,255,255,.06); }
  input {
    flex: 1; min-width: 0; background: transparent; border: 0;
    color: #fafafa; font-size: 15px; outline: none; padding: 6px 0;
  }
  input::placeholder { color: #71717a; }
  .send {
    flex: 0 0 auto; width: 42px; height: 42px; border-radius: 11px;
    border: 1px solid rgba(255,255,255,.08);
    background: linear-gradient(135deg, #8b5cf6, #22d3ee);
    color: white; font-size: 18px; cursor: pointer;
    display: grid; place-items: center;
    box-shadow: 0 6px 16px rgba(139,92,246,.25);
    transition: transform .08s, opacity .15s;
  }
  .send:active { transform: scale(.98); }
  .send:disabled { background: rgba(255,255,255,.06); color: #71717a; border-color: rgba(255,255,255,.06); box-shadow: none; }
  .corner-watermark {
    position: fixed; right: 10px; bottom: calc(env(safe-area-inset-bottom) + 72px);
    opacity: .04; pointer-events: none; user-select: none;
  }
  .corner-watermark svg { width: 140px; height: 70px; }
  .bubble-text { white-space: pre-wrap; word-break: break-word; }
  .bubble-text + .bubble-text { margin-top: 8px; }
  .thinking {
    margin: 0 0 8px; border: 1px solid rgba(255,255,255,.07); border-radius: 10px;
    background: rgba(255,255,255,.03); overflow: hidden;
  }
  .thinking summary {
    list-style: none; cursor: pointer; padding: 7px 10px;
    font-size: 11px; font-weight: 600; letter-spacing: .03em; color: #a5b4fc;
    display: flex; align-items: center; gap: 8px; user-select: none;
  }
  .thinking summary::-webkit-details-marker { display: none; }
  .thinking summary .think-dot { width: 6px; height: 6px; border-radius: 50%; background: #818cf8; animation: pulse 1.2s ease-in-out infinite; }
  .thinking[open] summary .think-dot { animation: none; opacity: .4; }
  .thinking-body {
    padding: 0 10px 10px; font-size: 11.5px; line-height: 1.55; color: #8b8bd0;
    max-height: 220px; overflow-y: auto; white-space: pre-wrap; word-break: break-word;
    border-top: 1px solid rgba(255,255,255,.05); padding-top: 8px;
  }
  @keyframes pulse { 0%, 100% { opacity: .35; } 50% { opacity: 1; } }
  .chip {
    display: inline-flex; align-items: center; gap: 6px;
    margin: 6px 6px 0 0; padding: 4px 9px; border-radius: 999px;
    font-size: 11px; font-weight: 600; color: #cbd5e1;
    background: rgba(139,92,246,.10); border: 1px solid rgba(139,92,246,.22);
    max-width: 100%;
  }
  .chip .chip-spinner { width: 8px; height: 8px; border: 1.5px solid rgba(203,213,225,.35); border-top-color: #cbd5e1; border-radius: 50%; animation: spin .8s linear infinite; flex: 0 0 auto; }
  .chip.done { background: rgba(34,197,94,.08); border-color: rgba(34,197,94,.22); color: #a7f3d0; }
  .chip.done .chip-spinner { display: none; }
  .chip.done::before { content: '✓'; font-size: 10px; color: #34d399; }
  .chip.error { background: rgba(248,113,113,.08); border-color: rgba(248,113,113,.25); color: #fecaca; }
  .chip.error .chip-spinner { display: none; }
  .chip.error::before { content: '✕'; font-size: 10px; color: #f87171; }
  .chip .chip-detail { font-weight: 400; color: #94a3b8; max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .stop {
    flex: 0 0 auto; width: 42px; height: 42px; border-radius: 11px;
    border: 1px solid rgba(248,113,113,.35);
    background: rgba(248,113,113,.12); color: #fca5a5;
    font-size: 15px; line-height: 1; cursor: pointer;
    display: grid; place-items: center;
    transition: transform .08s, opacity .15s;
  }
  .stop:active { transform: scale(.98); }
  .stop::before { content: ''; width: 12px; height: 12px; border-radius: 2px; background: #fca5a5; }
  .stop[hidden] { display: none; }
</style>
</head>
<body>
<header>
  <div class="brand">
    <div class="logo-wrap" aria-hidden="true">
      <svg viewBox="0 0 200 100" fill="none" role="img" aria-label="Infinite OS">
        <defs>
          <linearGradient id="g-phone" x1="18" y1="16" x2="182" y2="84" gradientUnits="userSpaceOnUse">
            <stop stop-color="#8b5cf6"/><stop offset=".5" stop-color="#22d3ee"/><stop offset="1" stop-color="#ec4899"/>
          </linearGradient>
        </defs>
        <path d="${ORBIT_PATH}" stroke="url(#g-phone)" stroke-width="7" stroke-linecap="round" stroke-linejoin="round" opacity=".95"/>
        <path class="infinite-runner runner-violet" d="${ORBIT_PATH}" pathLength="100"/>
        <path class="infinite-runner runner-cyan" d="${ORBIT_PATH}" pathLength="100"/>
        <path class="infinite-runner runner-pink" d="${ORBIT_PATH}" pathLength="100"/>
      </svg>
    </div>
    <div class="brand-text"><b>Infinite OS</b><span>Phone — Control your PC</span></div>
  </div>
  <div class="hdr-actions">
    <div class="status-pill" title="Secure LAN connection"><span class="dot live" id="dot"></span><span id="conn">live</span></div>
  </div>
</header>
<main id="log">
  <div class="empty" id="empty">
    <svg class="hero-logo" viewBox="0 0 200 100" fill="none" aria-hidden="true">
      <defs>
        <linearGradient id="g-hero" x1="18" y1="16" x2="182" y2="84" gradientUnits="userSpaceOnUse">
          <stop stop-color="#8b5cf6"/><stop offset=".5" stop-color="#22d3ee"/><stop offset="1" stop-color="#ec4899"/>
        </linearGradient>
      </defs>
      <path d="${ORBIT_PATH}" stroke="url(#g-hero)" stroke-width="7" stroke-linecap="round" stroke-linejoin="round" opacity=".92"/>
      <path class="infinite-runner runner-violet" d="${ORBIT_PATH}" pathLength="100"/>
      <path class="infinite-runner runner-cyan" d="${ORBIT_PATH}" pathLength="100"/>
      <path class="infinite-runner runner-pink" d="${ORBIT_PATH}" pathLength="100"/>
    </svg>
    <h2>Connected to your Infinite AI</h2>
    <p>Control Infinite OS from your phone — chat, build, automate, and see every step live. Matches your desktop perfectly.</p>
    <div class="hint">▸ Type below to start</div>
  </div>
</main>
<div class="corner-watermark" aria-hidden="true">
  <svg viewBox="0 0 200 100" fill="none">
    <path d="${ORBIT_PATH}" stroke="rgba(255,255,255,.9)" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>
</div>
<footer>
  <label class="input-wrap" for="input">
    <input id="input" type="text" placeholder="Message your AI — control your PC..." autocomplete="off" enterkeyhint="send">
  </label>
  <button id="stop" class="stop" aria-label="Stop the agent" hidden></button>
  <button id="send" class="send" aria-label="Send">↑</button>
</footer>
<script>
(function () {
  var token = new URLSearchParams(location.search).get('token') || '';
  var log = document.getElementById('log');
  var input = document.getElementById('input');
  var send = document.getElementById('send');
  var stop = document.getElementById('stop');
  var dot = document.getElementById('dot');
  var conn = document.getElementById('conn');
  var busy = false;
  var pendingEcho = null;
  var stickToBottom = true;
  var turnHadVisibleContent = false;
  var currentTurnId = null;
  var turns = {};
  var toolChips = {};

  // Auth rides in the Authorization header — NOT the URL. Query-string tokens
  // leak into browser history, referer headers, and proxy logs; a header
  // never leaves the request. (The server still accepts ?token= for the very
  // first page load itself.)
  var authHeaders = { 'Authorization': 'Bearer ' + token };
  function api(path) { return path; }
  function scroll() {
    if (stickToBottom) log.scrollTop = log.scrollHeight;
  }
  log.addEventListener('scroll', function () {
    stickToBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 80;
  });
  function clearEmpty() { var e = log.querySelector('.empty'); if (e) e.remove(); }

  function shortModel(provider, model) {
    var m = typeof model === 'string' && model ? model : '';
    var p = typeof provider === 'string' ? provider : '';
    if (p && m.indexOf(p + '/') === 0) m = m.slice(p.length + 1);
    var label = p ? p + ':' + m : m;
    return label.length > 42 ? label.slice(0, 41) + '…' : label;
  }

  function toolDetail(input) {
    if (!input || typeof input !== 'object') return '';
    var keys = ['command', 'cmd', 'file_path', 'path', 'file', 'url', 'query', 'pattern', 'script'];
    for (var i = 0; i < keys.length; i++) {
      var v = input[keys[i]];
      if (typeof v === 'string' && v.trim()) {
        var one = v.replace(/\s+/g, ' ').trim();
        return one.length > 48 ? one.slice(0, 47) + '…' : one;
      }
    }
    return '';
  }

  function addMsg(cls, text) {
    clearEmpty();
    var el = document.createElement('div');
    el.className = 'msg ' + cls;
    el.textContent = text || '';
    log.appendChild(el);
    scroll();
    return el;
  }

  function setBusy(value) {
    busy = !!value;
    send.disabled = busy;
    if (stop) stop.hidden = !busy;
  }

  function setActivity(text) {
    var existing = document.getElementById('act');
    if (!text) { if (existing) existing.remove(); return; }
    if (!existing) {
      existing = document.createElement('div');
      existing.id = 'act';
      existing.className = 'activity';
      existing.innerHTML = '<div class="spinner"></div><span></span>';
      log.appendChild(existing);
    }
    existing.querySelector('span').textContent = text;
    scroll();
  }

  function setConn(state) {
    if (state === 'live') { dot.className = 'dot live'; conn.textContent = 'live'; }
    else if (state === 'reconnecting') { dot.className = 'dot'; conn.textContent = 'reconnecting…'; }
    else { dot.className = 'dot'; conn.textContent = 'offline'; }
  }

  function showFatal(message) {
    clearEmpty();
    var el = document.createElement('div');
    el.className = 'empty';
    el.innerHTML = '<h2>Can&#39;t connect</h2><p></p>';
    el.querySelector('p').textContent = message;
    log.appendChild(el);
    input.disabled = true;
    setBusy(false);
    setConn('offline');
  }

  function getTurn(id) {
    var key = id || currentTurnId || 'pending';
    if (!turns[key]) {
      turns[key] = { id: key, bubble: null, contentHost: null, currentTextDiv: null, thinkingEl: null, thinkingTextEl: null, sawContent: false };
    }
    currentTurnId = key;
    return turns[key];
  }

  function ensureBubble(t) {
    if (!t.bubble) {
      clearEmpty();
      var el = document.createElement('div');
      el.className = 'msg assistant';
      var host = document.createElement('div');
      host.className = 'bubble-host';
      el.appendChild(host);
      log.appendChild(el);
      t.bubble = el;
      t.contentHost = host;
    }
    return t;
  }

  function ensureTextDiv(t) {
    if (!t.currentTextDiv) {
      var d = document.createElement('div');
      d.className = 'bubble-text';
      t.contentHost.appendChild(d);
      t.currentTextDiv = d;
    }
    return t.currentTextDiv;
  }

  function ensureThinking(t) {
    if (!t.thinkingEl) {
      ensureBubble(t);
      var d = document.createElement('details');
      d.className = 'thinking';
      d.open = true;
      d.innerHTML = '<summary><span class="think-dot"></span>Reasoning…</summary>';
      var body = document.createElement('div');
      body.className = 'thinking-body';
      d.appendChild(body);
      t.contentHost.appendChild(d);
      t.contentHost.insertBefore(d, t.contentHost.firstChild);
      t.thinkingEl = d;
      t.thinkingTextEl = body;
      t.currentTextDiv = null;
    }
    return t.thinkingEl;
  }

  function renderToolChip(t, ev, done) {
    var container = t.contentHost || ensureBubble(t).contentHost;
    var key = ev.tool_use_id || ev.name;
    var chip = toolChips[key];
    if (!chip) {
      chip = document.createElement('div');
      chip.className = 'chip';
      chip.innerHTML = '<span class="chip-spinner"></span><span class="chip-name"></span><span class="chip-detail"></span>';
      chip.querySelector('.chip-name').textContent = ev.name || 'tool';
      container.appendChild(chip);
      toolChips[key] = chip;
    }
    return chip;
  }

  function renderHistoryMessage(m) {
    if (m.role === 'user') { addMsg('user', m.text || ''); return; }
    if (m.role !== 'assistant') return;
    clearEmpty();
    var el = document.createElement('div');
    el.className = 'msg assistant';
    var host = document.createElement('div');
    host.className = 'bubble-host';
    el.appendChild(host);
    if (m.thinking) {
      var d = document.createElement('details');
      d.className = 'thinking';
      d.innerHTML = '<summary><span class="think-dot" style="opacity:.4;animation:none"></span>Reasoning</summary>';
      var body = document.createElement('div');
      body.className = 'thinking-body';
      body.textContent = m.thinking;
      d.appendChild(body);
      host.appendChild(d);
    }
    if (Array.isArray(m.tools)) {
      for (var i = 0; i < m.tools.length; i++) {
        var t = document.createElement('span');
        t.className = 'chip done';
        t.textContent = m.tools[i].name || 'tool';
        host.appendChild(t);
      }
    }
    if (m.text) {
      var td = document.createElement('div');
      td.className = 'bubble-text';
      td.textContent = m.text;
      host.appendChild(td);
    }
    log.appendChild(el);
    scroll();
  }

  function loadHistory() {
    return fetch(api('/api/history'), { headers: authHeaders }).then(function (res) {
      if (!res.ok) return null;
      return res.json();
    }).then(function (data) {
      if (!data || !Array.isArray(data.messages)) return;
      if (data.messages.length === 0) return;
      clearEmpty();
      for (var i = 0; i < data.messages.length; i++) renderHistoryMessage(data.messages[i]);
    }).catch(function () { /* offline history is fine */ });
  }

  fetch(api('/api/status'), { headers: authHeaders }).then(function (res) {
    if (res.status === 401) {
      showFatal('This link is invalid or expired. Open Infinite OS on the PC → Settings → Connect Your Phone and scan the new code.');
      return;
    }
    return loadHistory();
  }).catch(function () { setConn('offline'); });

  // EventSource cannot set custom headers, so the stream keeps the one-time
  // page-load token via the URL — same as the initial document request.
  var source = new EventSource(api('/api/stream'));
  source.onopen = function () { setConn('live'); };
  source.onerror = function () { setConn('reconnecting'); };
  source.onmessage = function (ev) {
    try { handle(JSON.parse(ev.data)); } catch (e) {}
  };

  function markTurnVisible() {
    turnHadVisibleContent = true;
  }

  function handle(ev) {
    if (ev.type === 'user_message') {
      setBusy(true);
      turnHadVisibleContent = false;
      if (pendingEcho === ev.text) { pendingEcho = null; setActivity('Thinking…'); return; }
      addMsg('user', ev.text);
      setActivity('Thinking…');
      return;
    }
    if (ev.type === 'assistant_start') {
      var t = getTurn(ev.message_id);
      t.sawContent = false;
      setActivity('Preparing…');
      return;
    }
    if (ev.type === 'provider_start') {
      var label = shortModel(ev.provider, ev.model);
      setActivity('Calling ' + label + (ev.turn > 0 ? ' · attempt ' + (ev.turn + 1) : '') + '…');
      return;
    }
    if (ev.type === 'provider_status') {
      var s = ev.status;
      var label2 = shortModel(ev.provider, ev.model || ev.to || ev.from);
      if (s === 'connecting' || s === 'cold_start') setActivity('Connecting to ' + label2 + '…');
      else if (s === 'streaming') setActivity('Responding…');
      else if (s === 'failover' || s === 'retrying') setActivity('Switching to ' + label2 + '…');
      else if (s === 'rate_limited') setActivity('Rate limited, switching…');
      return;
    }
    if (ev.type === 'thinking_delta') {
      var tt = getTurn(ev.message_id);
      ensureThinking(tt);
      markTurnVisible();
      if (tt.thinkingTextEl) tt.thinkingTextEl.textContent += ev.text || '';
      setActivity('Reasoning…');
      scroll();
      return;
    }
    if (ev.type === 'text_delta') {
      var t2 = getTurn(ev.message_id);
      var chunk = String(ev.text == null ? '' : ev.text);
      if (!t2.sawContent) chunk = chunk.replace(/^\s+/, '');
      if (!chunk) return;
      ensureBubble(t2);
      markTurnVisible();
      t2.sawContent = true;
      ensureTextDiv(t2).textContent += chunk;
      setActivity('Responding…');
      scroll();
      return;
    }
    if (ev.type === 'tool_start') {
      var t3 = getTurn(ev.message_id);
      ensureBubble(t3);
      markTurnVisible();
      t3.currentTextDiv = null;
      var chip = renderToolChip(t3, ev, false);
      chip.title = ev.name || 'tool';
      setActivity('Using tool: ' + (ev.name || 'tool'));
      scroll();
      return;
    }
    if (ev.type === 'tool_end') {
      var key = ev.tool_use_id || ev.name;
      var chip2 = toolChips[key];
      if (chip2) {
        chip2.classList.add('done');
        var detail = toolDetail(ev.input);
        if (detail) chip2.querySelector('.chip-detail').textContent = detail;
      }
      setActivity('Continuing…');
      scroll();
      return;
    }
    if (ev.type === 'tool_result') {
      var key2 = ev.tool_use_id;
      var chip3 = key2 ? toolChips[key2] : null;
      if (chip3) {
        if (ev.isError) { chip3.classList.remove('done'); chip3.classList.add('error'); chip3.title = ev.preview || 'Tool failed'; }
        else chip3.classList.add('done');
      }
      setActivity(busy ? 'Continuing…' : null);
      scroll();
      return;
    }
    if (ev.type === 'message_end') {
      var t4 = getTurn(ev.message_id);
      if (t4.thinkingEl) {
        t4.thinkingEl.open = false;
        var sum = t4.thinkingEl.querySelector('summary');
        if (sum) sum.innerHTML = '<span class="think-dot" style="opacity:.4;animation:none"></span>Reasoning';
      }
      return;
    }
    if (ev.type === 'message_discard') {
      var t5 = getTurn(ev.message_id);
      if (t5.bubble && t5.bubble.parentNode === log) log.removeChild(t5.bubble);
      delete turns[t5.id];
      if (currentTurnId === t5.id) currentTurnId = null;
      scroll();
      return;
    }
    if (ev.type === 'done' || ev.type === 'final') {
      setBusy(false);
      pendingEcho = null;
      setActivity(null);
      if (ev.type === 'final' && ev.text && !turnHadVisibleContent) addMsg('assistant', ev.text);
      return;
    }
    if (ev.type === 'error') {
      setBusy(false);
      pendingEcho = null;
      setActivity(null);
      addMsg('assistant', 'Error: ' + (ev.message || 'something went wrong'));
      return;
    }
  }

  function submit() {
    var text = input.value.trim();
    if (!text || busy) return;
    input.value = '';
    setBusy(true);
    pendingEcho = text;
    turnHadVisibleContent = false;
    addMsg('user', text);
    setActivity('Sending…');
    fetch(api('/api/chat'), {
      method: 'POST',
      headers: Object.assign({ 'Content-Type': 'application/json' }, authHeaders),
      body: JSON.stringify({ message: text })
    }).then(function (res) {
      if (res.status === 401) {
        showFatal('This link is invalid or expired. Open Infinite OS on the PC → Settings → Connect Your Phone and scan the new code.');
        return null;
      }
      if (res.status === 409) { return res.json().then(function (j) { throw new Error(j.error || 'busy'); }); }
      if (!res.ok) throw new Error('Request failed (' + res.status + ')');
      setActivity('Thinking…');
      return null;
    }).catch(function (err) {
      setBusy(false);
      pendingEcho = null;
      setActivity(null);
      addMsg('assistant', 'Could not send: ' + err.message);
    });
  }

  send.addEventListener('click', submit);
  if (stop) stop.addEventListener('click', function () {
    setActivity('Stopping…');
    fetch(api('/api/stop'), { method: 'POST', headers: authHeaders }).catch(function () {});
  });
  input.addEventListener('keydown', function (e) { if (e.key === 'Enter') submit(); });
})();
</script>
</body>
</html>`;
}

export const phoneRemoteServer = new PhoneRemoteServer();
