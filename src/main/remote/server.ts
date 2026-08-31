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
import type { ContentBlock, Message } from '../../shared/types.js';

const PORT = Number(process.env.INFINITE_REMOTE_PORT ?? 8766);
const REMOTE_SESSION_ID = 'phone-remote';
const MAX_BODY_BYTES = 64 * 1024;
// Same fallback pair the multi-agent orchestrator uses when no explicit
// provider/model is supplied.
const DEFAULT_PROVIDER = 'openrouter';
const DEFAULT_MODEL = 'meta-llama/llama-3.3-70b-instruct:free';

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

  start(): void {
    if (this.server) return;
    this.token = this.loadToken();
    this.server = http.createServer((req, res) => void this.handle(req, res));
    this.server.on('error', (err) => console.error('[remote] server error:', err.message));
    this.server.listen(PORT, '0.0.0.0', () => {
      this.startedAt = Date.now();
      console.log(`[remote] phone companion listening on 0.0.0.0:${PORT}`);
    });
  }

  stop(): void {
    this.abortController?.abort();
    for (const client of this.clients) client.res.end();
    this.clients.clear();
    if (this.server) {
      this.server.close();
      this.server = null;
    }
  }

  async getInfo(): Promise<{
    running: boolean;
    url: string;
    qrDataUrl: string;
    lanIp: string;
    port: number;
    connections: number;
    busy: boolean;
  }> {
    const lanIp = this.lanAddress();
    const url = `http://${lanIp}:${PORT}/?token=${this.token}`;
    let qrDataUrl = '';
    try {
      qrDataUrl = await QRCode.toDataURL(url, { margin: 1, width: 320, color: { dark: '#18181b', light: '#fafafa' } });
    } catch (err) {
      console.error('[remote] QR generation failed:', err);
    }
    return {
      running: this.server !== null,
      url,
      qrDataUrl,
      lanIp,
      port: PORT,
      connections: this.clients.size,
      busy: this.busy,
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

  private lanAddress(): string {
    for (const list of Object.values(networkInterfaces())) {
      for (const ni of list ?? []) {
        if (ni.family === 'IPv4' && !ni.internal) return ni.address;
      }
    }
    return '127.0.0.1';
  }

  private tokenOk(url: URL): boolean {
    const given = Buffer.from(url.searchParams.get('token') ?? '');
    const expected = Buffer.from(this.token);
    return given.length === expected.length && timingSafeEqual(given, expected);
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
    for (const client of this.clients) client.res.write(payload);
  }

  private async handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    if (!this.tokenOk(url)) {
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
        try {
          const parsed = JSON.parse(body || '{}') as { message?: unknown; provider?: unknown; model?: unknown };
          text = typeof parsed.message === 'string' ? parsed.message.trim() : '';
          var provider = typeof parsed.provider === 'string' ? parsed.provider : DEFAULT_PROVIDER; // eslint-disable-line no-var
          var model = typeof parsed.model === 'string' ? parsed.model : DEFAULT_MODEL; // eslint-disable-line no-var
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
        await this.runTurn(text, provider, model); // eslint-disable-line @typescript-eslint/no-use-before-define
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

  private async runTurn(text: string, provider: string, model: string): Promise<void> {
    this.busy = true;
    this.abortController = new AbortController();
    const userMessage: Message = {
      id: randomUUID(),
      role: 'user',
      content: [{ type: 'text', text }] satisfies ContentBlock[],
      timestamp: Date.now(),
    };

    try {
      const history = await loadMessages(REMOTE_SESSION_ID);
      await appendMessage(REMOTE_SESSION_ID, userMessage);
      this.broadcast({ type: 'user_message', text });

      const completed = await runAgent(history, userMessage, {
        sessionId: REMOTE_SESSION_ID,
        cwd: process.cwd(),
        provider,
        model,
        signal: this.abortController.signal,
        onEvent: (ev) => {
          switch (ev.type) {
            case 'message_start':
              this.broadcast({ type: 'assistant_start' });
              break;
            case 'text_delta':
              this.broadcast({ type: 'text_delta', text: ev.text });
              break;
            case 'tool_use_start':
              this.broadcast({ type: 'tool_start', name: ev.name });
              break;
            case 'tool_result':
              this.broadcast({
                type: 'tool_result',
                isError: ev.is_error === true,
                preview: typeof ev.content === 'string' ? ev.content.slice(0, 300) : '',
              });
              break;
            case 'done':
              this.broadcast({ type: 'done', success: ev.success !== false });
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
  <button id="send" class="send" aria-label="Send">↑</button>
</footer>
<script>
(function () {
  var log = document.getElementById('log');
  var input = document.getElementById('input');
  var send = document.getElementById('send');
  var dot = document.getElementById('dot');
  var conn = document.getElementById('conn');
  var busy = false;
  var assistantEl = null;

  function scroll() { window.scrollTo(0, document.body.scrollHeight); }
  function clearEmpty() { var e = log.querySelector('.empty'); if (e) e.remove(); }
  function addMsg(cls, text) {
    clearEmpty();
    var el = document.createElement('div');
    el.className = 'msg ' + cls;
    el.textContent = text || '';
    log.appendChild(el);
    scroll();
    return el;
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

  fetch('/api/status?token=' + location.search.slice(1)).catch(function(){});

  new EventSource('/api/stream?token=' + location.search.slice(1)).onmessage = function (ev) {
    try { handle(JSON.parse(ev.data)); } catch (e) {}
  };

  function workingLabel() {
    return busy ? 'Working...' : 'Live';
  }

  function handle(ev) {
    if (ev.type === 'user_message') {
      busy = true; send.disabled = true;
      addMsg('user', ev.text);
      setActivity('Thinking...');
    } else if (ev.type === 'assistant_start') {
      assistantEl = addMsg('assistant', '');
      setActivity('Responding...');
    } else if (ev.type === 'text_delta') {
      if (!assistantEl) assistantEl = addMsg('assistant', '');
      assistantEl.textContent += ev.text;
      scroll();
    } else if (ev.type === 'tool_start') {
      if (!assistantEl) assistantEl = addMsg('assistant', '');
      setActivity('Using tool: ' + ev.name);
    } else if (ev.type === 'tool_result') {
      setActivity(busy ? 'Continuing...' : null);
    } else if (ev.type === 'done' || ev.type === 'final') {
      busy = false; send.disabled = false;
      setActivity(null);
      if (ev.type === 'final' && ev.text && !assistantEl) addMsg('assistant', ev.text);
      assistantEl = null;
    } else if (ev.type === 'error') {
      busy = false; send.disabled = false;
      setActivity(null);
      addMsg('assistant', 'Error: ' + (ev.message || 'something went wrong'));
      assistantEl = null;
    }
  }

  function submit() {
    var text = input.value.trim();
    if (!text || busy) return;
    input.value = '';
    busy = true; send.disabled = true;
    addMsg('user', text);
    setActivity('Sending...');
    fetch('/api/chat?token=' + location.search.slice(1), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: text })
    }).then(function (res) {
      if (res.status === 409) { return res.json().then(function (j) { throw new Error(j.error || 'busy'); }); }
      if (!res.ok) throw new Error('Request failed (' + res.status + ')');
      setActivity('Thinking...');
    }).catch(function (err) {
      busy = false; send.disabled = false;
      setActivity(null);
      addMsg('assistant', 'Could not send: ' + err.message);
    });
  }

  send.addEventListener('click', submit);
  input.addEventListener('keydown', function (e) { if (e.key === 'Enter') submit(); });
})();
</script>
</body>
</html>`;
}

export const phoneRemoteServer = new PhoneRemoteServer();
