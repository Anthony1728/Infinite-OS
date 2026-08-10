#!/usr/bin/env node
// Infinite OS Bridge server — standalone runner.
// Same protocol as the in-app bridge (src/main/bridge/server.ts): a local HTTP +
// WebSocket server on 127.0.0.1:8765 that the "Infinite OS Bridge" extension
// connects to. Run with:  node scripts/bridge-server.mjs
// If the Infinite OS app is already running (its own bridge holds the port),
// this process simply stays idle and logs "already in use".

import { createServer } from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const PORT = Number(process.env.BRIDGE_PORT || 8765);
const MAX_MESSAGE_SIZE = 48 * 1024 * 1024;
const EXEC_TIMEOUT = Number(process.env.BRIDGE_TIMEOUT || 45000);

class WsConnection {
  constructor(socket) {
    this.socket = socket;
    this.buffer = Buffer.alloc(0);
    this.messageParts = [];
    this.messageOpcode = 0;
    this.fragmented = false;
    this.closed = false;
    this.onMessage = null;
    this.onClose = null;
    socket.on('data', (chunk) => this.handleData(chunk));
    socket.on('close', () => { this.closed = true; this.onClose?.(); });
    socket.on('error', () => { this.closed = true; this.onClose?.(); });
  }
  handleData(chunk) {
    this.buffer = this.buffer.length ? Buffer.concat([this.buffer, chunk]) : chunk;
    this.buffer = this.parseFrames(this.buffer);
  }
  parseFrames(data) {
    let offset = 0;
    while (data.length - offset >= 2) {
      const b0 = data[offset];
      const b1 = data[offset + 1];
      const fin = (b0 & 0x80) !== 0;
      const opcode = b0 & 0x0f;
      const masked = (b1 & 0x80) !== 0;
      let len = b1 & 0x7f;
      let headerLen = 2;
      if (len === 126) {
        if (data.length - offset < 4) break;
        len = data.readUInt16BE(offset + 2);
        headerLen = 4;
      } else if (len === 127) {
        if (data.length - offset < 10) break;
        len = data.readUInt32BE(offset + 2) * 0x100000000 + data.readUInt32BE(offset + 6);
        headerLen = 10;
      }
      let maskKey = null;
      if (masked) {
        if (data.length - offset < headerLen + 4) break;
        maskKey = data.subarray(offset + headerLen, offset + headerLen + 4);
        headerLen += 4;
      }
      if (len > MAX_MESSAGE_SIZE) { this.closeWithCode(1009, 'too large'); return data; }
      if (data.length - offset < headerLen + len) break;
      const start = offset + headerLen;
      const payload = Buffer.from(data.subarray(start, start + len));
      if (maskKey) for (let i = 0; i < payload.length; i++) payload[i] ^= maskKey[i % 4];
      offset = start + len;
      if (opcode === 0x8) { this.closeWithCode(1000, ''); return data.subarray(offset); }
      if (opcode === 0x9) { this.sendFrame(0xa, payload); continue; }
      if (opcode === 0xa) continue;
      if (opcode === 0x1 || opcode === 0x2) {
        this.fragmented = !fin;
        this.messageOpcode = opcode;
        this.messageParts = [payload];
        if (fin && opcode === 0x1) this.deliver(payload);
      } else if (opcode === 0x0) {
        if (!this.fragmented) { this.closeWithCode(1002, 'unexpected continuation'); return data.subarray(offset); }
        this.messageParts.push(payload);
        if (fin) {
          this.fragmented = false;
          if (this.messageOpcode === 0x1) this.deliver(Buffer.concat(this.messageParts));
        }
      } else {
        this.closeWithCode(1003, 'unsupported opcode');
        return data.subarray(offset);
      }
    }
    return data.subarray(offset);
  }
  deliver(payload) { this.onMessage?.(payload.toString('utf8')); }
  sendFrame(opcode, payload) {
    if (this.closed) return;
    const len = payload.length;
    let header;
    if (len <= 125) header = Buffer.from([0x80 | opcode, len]);
    else if (len <= 0xffff) {
      header = Buffer.alloc(4);
      header[0] = 0x80 | opcode;
      header[1] = 126;
      header.writeUInt16BE(len, 2);
    } else {
      header = Buffer.alloc(10);
      header[0] = 0x80 | opcode;
      header[1] = 127;
      header.writeUInt32BE(Math.floor(len / 0x100000000), 2);
      header.writeUInt32BE(len % 0x100000000, 6);
    }
    try { this.socket.write(Buffer.concat([header, payload])); } catch {}
  }
  sendText(text) { this.sendFrame(0x1, Buffer.from(text, 'utf8')); }
  closeWithCode(code, reason) {
    if (this.closed) return;
    this.closed = true;
    const payload = Buffer.alloc(2 + Buffer.byteLength(reason, 'utf8'));
    payload.writeUInt16BE(code, 0);
    payload.write(reason, 2, 'utf8');
    try { this.sendFrame(0x8, payload); } catch {}
    this.socket.end();
  }
  close() { this.closeWithCode(1000, ''); }
}

const tokenFile = join(homedir(), '.infinite-ai', 'bridge-token');
let token = '';
function loadOrCreateToken() {
  try {
    if (existsSync(tokenFile)) {
      const existing = readFileSync(tokenFile, 'utf8').trim();
      if (existing) { token = existing; return; }
    }
    mkdirSync(join(homedir(), '.infinite-ai'), { recursive: true });
    token = randomBytes(32).toString('base64url');
    writeFileSync(tokenFile, token, 'utf8');
  } catch { token = ''; }
}
function tokensMatch(provided) {
  if (!token) return true;
  if (!provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(token);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}
function requestToken(req) {
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const q = url.searchParams.get('token');
    if (q) return q;
  } catch {}
  if (typeof req.headers['x-bridge-token'] === 'string') return req.headers['x-bridge-token'];
  const auth = req.headers['authorization'];
  if (typeof auth === 'string' && auth.startsWith('Bearer ')) return auth.slice(7);
  return '';
}

let ws = null;
let nextId = 1;
let commandsServed = 0;
const pending = new Map();
const status = {
  connected: false,
  port: PORT,
  tokenConfigured: false,
  extensionId: '',
  extensionVersion: '',
  browser: '',
  name: '',
  lastError: '',
  connectedAt: null,
  commandsServed: 0,
};

function log(msg) { console.log(`[bridge] ${new Date().toISOString().slice(11, 19)} ${msg}`); }

function rejectAll(err) {
  for (const [, p] of pending) { clearTimeout(p.timer); p.resolve({ ok: false, error: err.message }); }
  pending.clear();
}

function setConnected(conn, info = {}) {
  if (ws && ws !== conn) { try { ws.close(); } catch {} }
  ws = conn;
  status.connected = true;
  status.extensionId = info.extensionId || '';
  status.extensionVersion = info.version || '';
  status.browser = info.browser || '';
  status.name = info.name || '';
  status.lastError = '';
  status.connectedAt = Date.now();
  log(`Extension connected (${status.extensionId || 'unknown id'})`);
  conn.onMessage = (data) => {
    let msg;
    try { msg = JSON.parse(data); } catch { return; }
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === 'hello') {
      setConnected(conn, { extensionId: msg.extensionId, version: msg.version, browser: msg.browser, name: msg.name });
      return;
    }
    if (msg.type === 'pong-server') return;
    if (msg.type === 'ping-server') {
      if (ws) {
        try { ws.sendText(JSON.stringify({ type: 'pong-server', time: Date.now() })); } catch {}
      }
      return;
    }
    if (msg.id != null) {
      const p = pending.get(String(msg.id));
      if (p) {
        clearTimeout(p.timer);
        pending.delete(String(msg.id));
        p.resolve(msg.ok === true ? { ok: true, data: msg.data } : { ok: false, error: String(msg.error || 'unknown bridge error') });
      }
    }
  };
  conn.onClose = () => {
    if (ws === conn) {
      ws = null;
      status.connected = false;
      status.lastError = 'extension disconnected';
      log('Extension disconnected');
      rejectAll(new Error('Browser bridge disconnected while a command was running'));
    }
  };
}

function exec(command, params = {}, timeoutMs = EXEC_TIMEOUT) {
  if (!ws || !status.connected) {
    return Promise.resolve({ ok: false, error: 'Browser bridge not connected. Load the Infinite OS Bridge extension in Chrome and keep Chrome running.' });
  }
  const id = String(nextId++);
  const promise = new Promise((resolve) => {
    const timer = setTimeout(() => { pending.delete(id); resolve({ ok: false, error: `Bridge command "${command}" timed out after ${timeoutMs}ms` }); }, timeoutMs);
    pending.set(id, { resolve, timer });
  });
  try { ws.sendText(JSON.stringify({ id, command, params })); } catch (err) {
    pending.delete(id);
    return Promise.resolve({ ok: false, error: String(err?.message || err) });
  }
  return promise.then((r) => {
    if (r.ok) commandsServed++;
    status.commandsServed = commandsServed;
    return r;
  });
}

const server = createServer((req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const path = url.pathname;
  const json = (code, body) => {
    const data = JSON.stringify(body);
    res.writeHead(code, {
      'content-type': 'application/json; charset=utf-8',
      'content-length': Buffer.byteLength(data),
      'cache-control': 'no-store',
      'access-control-allow-origin': '*',
    });
    res.end(data);
  };
  if (path === '/healthz') return json(200, { ok: true, ts: Date.now() });
  if (path === '/status') {
    if (!tokensMatch(requestToken(req))) return json(401, { ok: false, error: 'unauthorized' });
    return json(200, { ok: true, status });
  }
  if (path === '/exec' && req.method === 'POST') {
    if (!tokensMatch(requestToken(req))) return json(401, { ok: false, error: 'unauthorized' });
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > 1024 * 1024) req.destroy(); });
    req.on('end', async () => {
      let parsed;
      try { parsed = JSON.parse(body || '{}'); } catch { return json(400, { ok: false, error: 'invalid JSON body' }); }
      if (!parsed.command) return json(400, { ok: false, error: 'missing "command"' });
      const result = await exec(parsed.command, parsed.params || {}, parsed.timeoutMs || EXEC_TIMEOUT);
      return json(result.ok ? 200 : 502, { ok: result.ok, ...result });
    });
    return;
  }
  return json(404, { ok: false, error: 'not found' });
});

server.on('upgrade', (req, socket, head) => {
  if (!req.url?.startsWith('/bridge')) { socket.destroy(); return; }
  if (!tokensMatch(requestToken(req))) { socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n'); socket.destroy(); return; }
  const key = req.headers['sec-websocket-key'];
  if (!key) { socket.write('HTTP/1.1 400 Bad Request\r\n\r\n'); socket.destroy(); return; }
  const accept = createHash('sha1').update(key + WS_GUID).digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n');
  if (head && head.length) socket.unshift(head);
  setConnected(new WsConnection(socket), {});
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    log(`Port ${PORT} already in use — the Infinite OS app is likely running its own bridge. Idle mode (API unavailable).`);
    return;
  }
  console.error('[bridge] Server error:', err);
});

loadOrCreateToken();

// Sync token to extension config.js files so the extension always has the correct token
function syncTokenToExtensions() {
  if (!token) return;
  const configContent = `const BRIDGE_CONFIG = { port: ${PORT}, token: "${token}" };\n`;
  const dirs = [
    join(process.cwd(), 'extensions', 'infinite-os-bridge'),
    join(homedir(), '.infinite-ai', 'extensions', 'infinite-os-bridge'),
  ];
  for (const dir of dirs) {
    try {
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'config.js'), configContent, 'utf8');
    } catch {}
  }
  log(`Token synced to extension config.js files`);
}
syncTokenToExtensions();

server.listen(PORT, '127.0.0.1', () => {
  log(`Bridge server ready on ws://127.0.0.1:${PORT} (token ${token ? 'set' : 'unset'})`);
  log('Load the Infinite OS Bridge extension in Chrome to enable browser control.');
});

process.on('SIGINT', () => { rejectAll(new Error('Bridge server stopped')); process.exit(0); });
process.on('SIGTERM', () => { rejectAll(new Error('Bridge server stopped')); process.exit(0); });
