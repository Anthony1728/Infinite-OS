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
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#0d0d0f">
<title>Infinite OS</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; -webkit-tap-highlight-color: transparent; }
  html, body { height: 100%; }
  body { background: #0d0d0f; color: #e4e4e7; font-family: -apple-system, 'Segoe UI', system-ui, sans-serif; display: flex; flex-direction: column; }
  header { flex: 0 0 auto; display: flex; align-items: center; gap: 9px; padding: calc(env(safe-area-inset-top) + 14px) 18px 12px; border-bottom: 1px solid rgba(255,255,255,.06); }
  .logo { width: 26px; height: 26px; border-radius: 7px; background: linear-gradient(135deg, #27272a, #18181b); display: grid; place-items: center; font-size: 13px; color: #a78bfa; font-weight: 700; }
  h1 { font-size: 15px; font-weight: 600; color: #fafafa; letter-spacing: -.01em; }
  .status { margin-left: auto; display: flex; align-items: center; gap: 6px; font-size: 11px; color: #71717a; }
  .dot { width: 7px; height: 7px; border-radius: 50%; background: #52525b; }
  .dot.live { background: #4ade80; }
  main { flex: 1 1 auto; overflow-y: auto; padding: 16px 14px 10px; -webkit-overflow-scrolling: touch; }
  .msg { max-width: 86%; margin-bottom: 10px; padding: 10px 13px; border-radius: 14px; font-size: 15px; line-height: 1.45; white-space: pre-wrap; word-break: break-word; }
  .user { margin-left: auto; background: #ececec; color: #18181b; border-bottom-right-radius: 4px; }
  .assistant { background: rgba(255,255,255,.055); border: 1px solid rgba(255,255,255,.06); border-bottom-left-radius: 4px; }
  .activity { display: flex; align-items: center; gap: 7px; margin: 0 auto 10px; width: fit-content; padding: 6px 12px; border-radius: 999px; background: rgba(255,255,255,.04); border: 1px solid rgba(255,255,255,.07); font-size: 11.5px; color: #a1a1aa; }
  .spinner { width: 10px; height: 10px; border: 1.5px solid #52525b; border-top-color: #e4e4e7; border-radius: 50%; animation: spin .8s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
  footer { flex: 0 0 auto; display: flex; gap: 9px; padding: 10px 12px calc(env(safe-area-inset-bottom) + 12px); border-top: 1px solid rgba(255,255,255,.06); background: #101013; }
  input { flex: 1; min-width: 0; background: rgba(255,255,255,.04); border: 1px solid rgba(255,255,255,.09); border-radius: 12px; padding: 12px 14px; color: #fafafa; font-size: 15px; outline: none; }
  input:focus { border-color: rgba(255,255,255,.2); }
  button { flex: 0 0 auto; width: 46px; height: 46px; border-radius: 12px; border: 1px solid rgba(255,255,255,.1); background: #ececec; color: #18181b; font-size: 18px; cursor: pointer; transition: background .15s ease; }
  button:disabled { background: #232327; color: #71717a; border-color: rgba(255,255,255,.07); }
  .empty { text-align: center; color: #52525b; font-size: 13px; margin-top: 38vh; line-height: 1.6; }
</style>
</head>
<body>
<header>
  <div class="logo">&#8734;</div>
  <h1>Infinite OS</h1>
  <div class="status"><span class="dot live" id="dot"></span><span id="conn">live</span></div>
</header>
<main id="log"><div class="empty">Connected to your Infinite AI.<br>Send a task — you'll see every step here.</div></main>
<footer>
  <input id="input" type="text" placeholder="Message your AI..." autocomplete="off" enterkeyhint="send">
  <button id="send" aria-label="Send">&#8593;</button>
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
