// Minimal standalone bridge server — pure JS, no TypeScript imports.
// Matches the protocol the Infinite OS Bridge extension expects.
import { createServer } from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const PORT = 8765;
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const TOKEN_PATH = join(homedir(), '.infinite-ai', 'bridge-token');
const CONFIG_DIRS = [
  join(process.cwd(), 'extensions', 'infinite-os-bridge'),
  join(homedir(), '.infinite-ai', 'extensions', 'infinite-os-bridge'),
];

// ── Token management ─────────────────────────────────────────────────────────
function loadOrCreateToken() {
  try {
    if (existsSync(TOKEN_PATH)) {
      const existing = readFileSync(TOKEN_PATH, 'utf8').trim();
      if (existing) return existing;
    }
  } catch {}
  mkdirSync(join(homedir(), '.infinite-ai'), { recursive: true });
  const fresh = randomBytes(32).toString('base64url');
  writeFileSync(TOKEN_PATH, fresh, 'utf8');
  return fresh;
}

function syncTokenToExtensions(token) {
  const configContent = `const BRIDGE_CONFIG = { port: ${PORT}, token: "${token}" };\n`;
  for (const dir of CONFIG_DIRS) {
    try {
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'config.js'), configContent, 'utf8');
    } catch {}
  }
}

// ── WebSocket frame parser ──────────────────────────────────────────────────
class WsConn {
  constructor(socket) {
    this.socket = socket;
    this.buffer = Buffer.alloc(0);
    this.onMessage = null;
    this.onClose = null;
    this.closed = false;
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
      const b0 = data[offset], b1 = data[offset + 1];
      const opcode = b0 & 0x0f;
      const masked = (b1 & 0x80) !== 0;
      let len = b1 & 0x7f, headerLen = 2;
      if (len === 126) { if (data.length - offset < 4) break; len = data.readUInt16BE(offset + 2); headerLen = 4; }
      else if (len === 127) { if (data.length - offset < 10) break; len = data.readUInt32BE(offset + 2) * 0x100000000 + data.readUInt32BE(offset + 6); headerLen = 10; }
      if (masked) headerLen += 4;
      if (data.length - offset < headerLen + len) break;
      let payload = Buffer.from(data.subarray(offset + headerLen, offset + headerLen + len));
      if (masked) { const mk = data.subarray(offset + headerLen - 4, offset + headerLen); for (let i = 0; i < payload.length; i++) payload[i] ^= mk[i % 4]; }
      offset = headerLen + len;
      if (opcode === 0x8) { this.close(); return data.subarray(offset); }
      if (opcode === 0x9) { this.sendFrame(0xa, payload); continue; }
      if (opcode === 0xa) continue;
      if (opcode === 0x1 || opcode === 0x2) {
        try { this.onMessage?.(JSON.parse(payload.toString('utf8'))); } catch {}
      }
    }
    return data.subarray(offset);
  }

  sendFrame(opcode, payload) {
    if (this.closed) return;
    const len = payload.length;
    let header;
    if (len <= 125) header = Buffer.from([0x80 | opcode, len]);
    else if (len <= 0xffff) { header = Buffer.alloc(4); header[0] = 0x80 | opcode; header[1] = 126; header.writeUInt16BE(len, 2); }
    else { header = Buffer.alloc(10); header[0] = 0x80 | opcode; header[1] = 127; header.writeUInt32BE(len >>> 0, 6); }
    try { this.socket.write(Buffer.concat([header, payload])); } catch {}
  }

  sendJson(obj) { this.sendFrame(0x1, Buffer.from(JSON.stringify(obj), 'utf8')); }

  close() {
    if (this.closed) return;
    this.closed = true;
    try { this.socket.end(); } catch {}
  }
}

// ── Main ────────────────────────────────────────────────────────────────────
const token = loadOrCreateToken();
syncTokenToExtensions(token);
console.log(`[bridge] Token: ${token.slice(0, 8)}...`);
console.log(`[bridge] Config synced to: ${CONFIG_DIRS.join(', ')}`);

let wsConn = null;
let cmdCount = 0;
const pending = new Map();
let nextId = 1;

function handleCommand(command, params) {
  // Minimal command handling — just enough for browser_extension to detect connection
  if (command === 'ping') return { pong: Date.now(), connected: true };
  if (command === 'status') return { connected: true, port: PORT, commandsServed: cmdCount };
  return { error: 'Command received but full handler requires the Electron app' };
}

const server = createServer((req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  if (url.pathname === '/healthz') {
    res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }
  res.writeHead(404, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ error: 'not found' }));
});

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  if (!url.pathname.startsWith('/bridge')) { socket.destroy(); return; }
  const providedToken = url.searchParams.get('token') || '';
  if (providedToken !== token) {
    console.log('[bridge] Rejected connection: token mismatch');
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    socket.destroy();
    return;
  }
  const key = req.headers['sec-websocket-key'];
  if (!key) { socket.write('HTTP/1.1 400 Bad Request\r\n\r\n'); socket.destroy(); return; }
  const accept = createHash('sha1').update(key + WS_GUID).digest('base64');
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n'
  );
  if (head && head.length) socket.unshift(head);

  const conn = new WsConn(socket);
  wsConn = conn;
  console.log('[bridge] Extension connected!');

  conn.onMessage = (msg) => {
    if (msg?.type === 'hello') {
      console.log('[bridge] Extension hello:', msg.name, msg.version);
      conn.sendJson({ type: 'hello', ok: true, version: '3.0.0' });
      return;
    }
    if (msg?.type === 'ping-server') { conn.sendJson({ type: 'pong-server', time: Date.now() }); return; }
    if (msg?.id != null) {
      cmdCount++;
      const result = handleCommand(msg.command, msg.params || {});
      conn.sendJson({ id: msg.id, ok: true, data: result });
    }
  };

  conn.onClose = () => {
    if (wsConn === conn) { wsConn = null; console.log('[bridge] Extension disconnected'); }
  };
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[bridge] Server listening on ws://127.0.0.1:${PORT}/bridge`);
  console.log(`[bridge] Extension should connect with token: ${token}`);
  console.log(`[bridge] Waiting for extension...`);
});

// Keep alive
process.on('SIGINT', () => { server.close(); process.exit(0); });
