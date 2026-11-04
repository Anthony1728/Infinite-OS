// Infinite AI Bridge v4.0 — High-performance background service worker.
// Features: WebSocket bridge with connection pooling, request batching,
// LRU response cache, compression-ready protocol (MessagePack), and fast content script delegation.

const DEFAULT_PORT = 8765;
const CACHE_TTL_MS = 3000;
const KEEPALIVE_INTERVAL_MS = 15000;
const MAX_CACHE_SIZE = 500;
const BATCH_WINDOW_MS = 16;
const RECONNECT_BASE_MS = 400;
const RECONNECT_MAX_MS = 8000;

let BRIDGE_PORT = DEFAULT_PORT;
let BRIDGE_TOKEN = '';
try {
  importScripts('config.js');
  if (typeof BRIDGE_CONFIG !== 'undefined') {
    BRIDGE_PORT = BRIDGE_CONFIG.port || DEFAULT_PORT;
    BRIDGE_TOKEN = BRIDGE_CONFIG.token || '';
  }
} catch (_e) {}

// config.js is written by the desktop app and can change after a token
// rotation. Re-read it before reconnecting so the extension never stays pinned
// to a stale port/token until the user manually reloads it.
let configLoadedAt = Date.now();
let configRefreshPromise = null;
async function refreshBridgeConfig(force) {
  const now = Date.now();
  if (!force && configLoadedAt && now - configLoadedAt < 2000) return;
  if (configRefreshPromise) return configRefreshPromise;
  configRefreshPromise = (async () => {
    try {
      const response = await fetch(chrome.runtime.getURL('config.js'), { cache: 'no-store' });
      if (!response.ok) return;
      const text = await response.text();
      const portMatch = text.match(/port\s*:\s*(\d+)/);
      const tokenMatch = text.match(/token\s*:\s*["']([^"']*)["']/);
      if (portMatch) {
        const port = Number(portMatch[1]);
        if (port > 0 && port < 65536) BRIDGE_PORT = port;
      }
      if (tokenMatch) BRIDGE_TOKEN = tokenMatch[1];
      status.port = BRIDGE_PORT;
      status.hasToken = Boolean(BRIDGE_TOKEN);
      configLoadedAt = Date.now();
      broadcastToPopup();
    } catch (_e) {
      // Keep the last known values; the reconnect loop will retry.
    } finally {
      configRefreshPromise = null;
    }
  })();
  return configRefreshPromise;
}

// ── MessagePack codec ─────────────────────────────────────────────────────────
// Spec-compliant (https://msgpack.org) so this codec and the Infinite OS bridge
// server always agree. The old subset tagged 16-bit ints as 0xd2 and 32-bit ints
// as 0xd3 while the reader only understood 0xd2-as-int32, so every value outside
// fixint range — every Date.now(), every tab id above 32767 — produced an
// undecodable frame that was silently dropped (that is why ping/latency and any
// timestamped payload never came back). Bytes are appended in blocks instead of
// spread, so megabyte screenshots no longer overflow the call stack.
const MSGPACK = {
  encode(obj) {
    const chunks = [];
    const textEncoder = new TextEncoder();
    let head = [];
    function flush() {
      if (head.length) {
        chunks.push(new Uint8Array(head));
        head = [];
      }
    }
    function byte(b) {
      head.push(b & 0xff);
      if (head.length >= 8192) flush();
    }
    function raw(src) {
      flush();
      chunks.push(src);
    }
    function u16(v) { byte(v >> 8); byte(v); }
    function u32(v) { byte(v >>> 24); byte((v >>> 16) & 0xff); byte((v >>> 8) & 0xff); byte(v & 0xff); }
    function u64(v) {
      const hi = Math.floor(v / 4294967296);
      u32(hi);
      u32(v >>> 0);
    }
    function f64(val) {
      const b = new ArrayBuffer(8);
      new DataView(b).setFloat64(0, val, false);
      raw(new Uint8Array(b));
    }
    function write(val) {
      if (val === null || val === undefined) { byte(0xc0); return; }
      if (typeof val === 'boolean') { byte(val ? 0xc3 : 0xc2); return; }
      if (typeof val === 'number') {
        if (Number.isInteger(val) && Number.isSafeInteger(val)) {
          if (val >= 0) {
            if (val <= 0x7f) { byte(val); return; }
            if (val <= 0xff) { byte(0xcc); byte(val); return; }
            if (val <= 0xffff) { byte(0xcd); u16(val); return; }
            if (val <= 0xffffffff) { byte(0xce); u32(val); return; }
            byte(0xcf); u64(val); return;
          }
          if (val >= -32) { byte(0xe0 | (val & 0x1f)); return; }
          if (val >= -0x80) { byte(0xd0); byte(val & 0xff); return; }
          if (val >= -0x8000) { byte(0xd1); u16(val & 0xffff); return; }
          if (val >= -0x80000000) { byte(0xd2); u32(val >>> 0); return; }
          byte(0xd3); u64(BigInt.asUintN(64, BigInt(val))); return;
        }
        byte(0xcb); f64(val); return;
      }
      if (typeof val === 'string') {
        const utf8 = textEncoder.encode(val);
        const len = utf8.length;
        if (len <= 31) byte(0xa0 | len);
        else if (len <= 0xff) { byte(0xd9); byte(len); }
        else if (len <= 0xffff) { byte(0xda); u16(len); }
        else { byte(0xdb); u32(len); }
        raw(utf8);
        return;
      }
      if (val instanceof Uint8Array || val instanceof ArrayBuffer) {
        const src = val instanceof ArrayBuffer ? new Uint8Array(val) : val;
        const len = src.length;
        if (len <= 0xff) { byte(0xc4); byte(len); }
        else if (len <= 0xffff) { byte(0xc5); u16(len); }
        else { byte(0xc6); u32(len); }
        raw(src);
        return;
      }
      if (Array.isArray(val)) {
        const len = val.length;
        if (len <= 15) byte(0x90 | len);
        else if (len <= 0xffff) { byte(0xdc); u16(len); }
        else { byte(0xdd); u32(len); }
        for (const item of val) write(item);
        return;
      }
      if (typeof val === 'object') {
        const keys = Object.keys(val);
        const len = keys.length;
        if (len <= 15) byte(0x80 | len);
        else if (len <= 0xffff) { byte(0xde); u16(len); }
        else { byte(0xdf); u32(len); }
        for (const key of keys) { write(key); write(val[key]); }
        return;
      }
      // Functions/symbols have no MessagePack form — nil keeps the stream sane.
      byte(0xc0);
    }
    write(obj);
    flush();
    if (chunks.length === 1) return chunks[0];
    let total = 0;
    for (const c of chunks) total += c.length;
    const out = new Uint8Array(total);
    let at = 0;
    for (const c of chunks) { out.set(c, at); at += c.length; }
    return out;
  },

  decode(bytes) {
    const buf = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    const textDecoder = new TextDecoder();
    let offset = 0;
    function need(n) { return offset + n <= buf.length; }
    function readStr(len) {
      const s = textDecoder.decode(buf.subarray(offset, offset + len));
      offset += len;
      return s;
    }
    function readBin(len) {
      const s = buf.slice(offset, offset + len);
      offset += len;
      return s;
    }
    function read() {
      if (offset >= buf.length) return undefined;
      const b = buf[offset++];
      if (b <= 0x7f) return b;
      if (b >= 0xe0) return b - 0x100;
      if ((b & 0xf0) === 0x80) {
        const obj = {};
        for (let i = 0; i < (b & 0x0f); i++) obj[read()] = read();
        return obj;
      }
      if ((b & 0xf0) === 0x90) {
        const arr = [];
        for (let i = 0; i < (b & 0x0f); i++) arr.push(read());
        return arr;
      }
      if ((b & 0xe0) === 0xa0) return readStr(b & 0x1f);
      switch (b) {
        case 0xc0: return null;
        case 0xc2: return false;
        case 0xc3: return true;
        case 0xc4: if (!need(1)) return undefined; return readBin(buf[offset++]);
        case 0xc5: if (!need(2)) return undefined; { const l = view.getUint16(offset); offset += 2; return readBin(l); }
        case 0xc6: if (!need(4)) return undefined; { const l = view.getUint32(offset); offset += 4; return readBin(l); }
        case 0xca: if (!need(4)) return undefined; { const v = view.getFloat32(offset); offset += 4; return v; }
        case 0xcb: if (!need(8)) return undefined; { const v = view.getFloat64(offset); offset += 8; return v; }
        case 0xcc: if (!need(1)) return undefined; { const v = view.getUint8(offset); offset += 1; return v; }
        case 0xcd: if (!need(2)) return undefined; { const v = view.getUint16(offset); offset += 2; return v; }
        case 0xce: if (!need(4)) return undefined; { const v = view.getUint32(offset); offset += 4; return v; }
        case 0xcf: if (!need(8)) return undefined; { const v = view.getBigUint64(offset); offset += 8; return Number(v); }
        case 0xd0: if (!need(1)) return undefined; { const v = view.getInt8(offset); offset += 1; return v; }
        case 0xd1: if (!need(2)) return undefined; { const v = view.getInt16(offset); offset += 2; return v; }
        case 0xd2: if (!need(4)) return undefined; { const v = view.getInt32(offset); offset += 4; return v; }
        case 0xd3: if (!need(8)) return undefined; { const v = view.getBigInt64(offset); offset += 8; return Number(v); }
        case 0xd9: if (!need(1)) return undefined; return readStr(buf[offset++]);
        case 0xda: if (!need(2)) return undefined; { const l = view.getUint16(offset); offset += 2; return readStr(l); }
        case 0xdb: if (!need(4)) return undefined; { const l = view.getUint32(offset); offset += 4; return readStr(l); }
        case 0xdc: if (!need(2)) return undefined; { const l = view.getUint16(offset); offset += 2; const arr = []; for (let i = 0; i < l; i++) arr.push(read()); return arr; }
        case 0xdd: if (!need(4)) return undefined; { const l = view.getUint32(offset); offset += 4; const arr = []; for (let i = 0; i < l; i++) arr.push(read()); return arr; }
        case 0xde: if (!need(2)) return undefined; { const l = view.getUint16(offset); offset += 2; const obj = {}; for (let i = 0; i < l; i++) obj[read()] = read(); return obj; }
        case 0xdf: if (!need(4)) return undefined; { const l = view.getUint32(offset); offset += 4; const obj = {}; for (let i = 0; i < l; i++) obj[read()] = read(); return obj; }
        default: return null;
      }
    }
    return read();
  },
};

// ── Connection state ──────────────────────────────────────────────────────────
let ws = null;
let reconnectDelay = RECONNECT_BASE_MS;
let manualClose = false;
let lastPong = 0;
let latencyMs = 0;
let pingPending = false;
let pingMisses = 0;
let connectingSince = 0;
let connectionAttempts = 0;
let useBinaryProtocol = false;

const status = {
  connected: false,
  version: chrome.runtime.getManifest().version,
  browser: navigator.userAgent,
  extensionId: chrome.runtime.id,
  port: BRIDGE_PORT,
  hasToken: Boolean(BRIDGE_TOKEN),
  connectedAt: 0,
  lastError: '',
  latencyMs: 0,
  commandsServed: 0,
  cacheHits: 0,
  contentScriptsReady: 0,
};

// ── LRU Response cache ────────────────────────────────────────────────────────
const cache = new Map();
function cacheKey(command, params) { return command + ':' + JSON.stringify(params); }
function cacheGet(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL_MS) { cache.delete(key); return null; }
  // Move to end (most recently used)
  cache.delete(key);
  cache.set(key, entry);
  status.cacheHits++;
  return entry.data;
}
function cacheSet(key, data) {
  if (cache.size >= MAX_CACHE_SIZE) {
    // Delete oldest (first) entry
    const oldest = cache.keys().next().value;
    cache.delete(oldest);
  }
  cache.set(key, { data, ts: Date.now() });
}
const CACHEABLE = new Set([
  'list_tabs', 'get_active_tab', 'status', 'ping',
  'get_page_text', 'get_page_links', 'get_form_fields',
  'get_page_html', 'get_element', 'get_elements',
  'get_history', 'get_downloads', 'get_windows',
]);

// Anything that changes page/tab/browser state voids every cached read.
const MUTATING = new Set([
  'navigate', 'click', 'click_text', 'right_click', 'double_click',
  'fill', 'type', 'press', 'set_value', 'select_option', 'check', 'uncheck',
  'upload_file', 'drag', 'scroll', 'hover', 'context_menu',
  'new_tab', 'close_tab', 'switch_tab', 'reload', 'go_back', 'go_forward',
  'execute_js', 'fill_form', 'batch',
  'clear_cookies', 'set_cookie', 'clear_history', 'clear_downloads',
]);

function invalidateCache() {
  if (cache.size) cache.clear();
}

// ── Pending requests ──────────────────────────────────────────────────────────
const pending = new Map();
let nextId = 1;
const DEFAULT_TIMEOUT = 30000;

// ── Message batching ──────────────────────────────────────────────────────────
let batchQueue = [];
let batchTimer = null;

function flushBatch() {
  if (batchQueue.length === 0) return;
  const batch = batchQueue.splice(0);
  // Send individually but without awaiting each
  for (const item of batch) {
    sendSingleCommand(item.id, item.command, item.params);
  }
}

function sendSingleCommand(id, command, params) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ id, command, params }));
  }
}

// ── Connection management ─────────────────────────────────────────────────────
function setConnected(connected, errorText) {
  const changed = status.connected !== connected;
  status.connected = connected;
  if (connected) {
    status.connectedAt = Date.now();
    status.lastError = '';
    reconnectDelay = RECONNECT_BASE_MS;
    connectionAttempts = 0;
  } else {
    status.connectedAt = 0;
    if (errorText) {
      status.lastError = errorText;
    }
  }
  if (changed) {
    chrome.storage.local.set({ bridgeStatus: status });
    broadcastToPopup(status);
  }
}

function broadcastToPopup() {
  chrome.runtime.sendMessage({ type: 'bridge-status', status }).catch(() => {});
}

function connect() {
  if (manualClose || (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING))) return;
  void refreshBridgeConfig(false).finally(openSocket);
}

function openSocket() {
    if (manualClose || (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING))) return;
    const url = `ws://127.0.0.1:${BRIDGE_PORT}/bridge?token=${encodeURIComponent(BRIDGE_TOKEN || '')}`;
    try {
      ws = new WebSocket(url);
      ws.binaryType = 'arraybuffer';
      connectingSince = Date.now();
    } catch (e) {
      setConnected(false, String(e?.message || e));
      scheduleReconnect();
      return;
    }

    ws.onopen = () => {
      useBinaryProtocol = false;
      connectionAttempts = 0;
      latencyMs = 0;
      status.latencyMs = 0;
      pingPending = false;
      pingMisses = 0;
      connectingSince = 0;
      setConnected(true);
      send({
        type: 'hello',
        version: status.version,
        browser: status.browser,
        extensionId: status.extensionId,
        name: 'Infinite AI Bridge',
        binary: true, // Signal binary protocol support
      });
      startKeepalive();
    };

ws.onmessage = (ev) => {
      let msg;
      if (ev.data instanceof ArrayBuffer) {
        try {
          const bytes = new Uint8Array(ev.data);
          msg = MSGPACK.decode(bytes);
          if (msg?.type === 'binary-ack') {
            useBinaryProtocol = true;
            return;
          }
        } catch {
          return;
        }
      } else {
        try { msg = JSON.parse(ev.data); } catch { return; }
      }
      void handleIncoming(msg);
    };

  ws.onerror = () => setConnected(false, 'connection error');
  ws.onclose = () => {
    ws = null;
    setConnected(false, 'disconnected');
    scheduleReconnect();
  };
}

function scheduleReconnect() {
  if (manualClose) return;
  const jitter = Math.random() * 100;
  setTimeout(connect, reconnectDelay + jitter);
  reconnectDelay = Math.min(reconnectDelay * 1.4, RECONNECT_MAX_MS);
  connectionAttempts++;
}

// A half-open (zombie) socket stays readyState=OPEN locally while nothing
// flows over it: the server's /status shows connected with empty metadata and
// every command times out. Tear it down so the reconnect loop can replace it.
function forceReconnect(reason) {
  manualClose = false;
  stopKeepalive();
  const old = ws;
  ws = null;
  if (old) {
    old.onclose = null;
    old.onerror = null;
    try { old.close(); } catch {}
  }
  setConnected(false, reason || 'connection stalled');
  connect();
}

function send(obj) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      if (useBinaryProtocol) {
        ws.send(MSGPACK.encode(obj));
      } else {
        ws.send(JSON.stringify(obj));
      }
      return true;
    }
    return false;
  }

// ── Keepalive ─────────────────────────────────────────────────────────────────
let keepaliveTimer = null;
function startKeepalive() {
  stopKeepalive();
  keepaliveTimer = setInterval(() => {
    if (!ws || ws.readyState !== WebSocket.OPEN) { stopKeepalive(); return; }
    pingPending = true;
    send({ type: 'ping-server' });
    setTimeout(() => {
      if (pingPending) {
        pingMisses++;
        latencyMs = -1;
        status.latencyMs = latencyMs;
        // Two unanswered pings (~30s) = half-open socket. Tear it down so the
        // reconnect loop can replace it — otherwise the zombie stays "OPEN"
        // locally and every bridge command times out forever.
        if (pingMisses >= 2) forceReconnect('keepalive timeout');
      }
    }, 3000);
  }, KEEPALIVE_INTERVAL_MS);
}
function stopKeepalive() {
  if (keepaliveTimer) { clearInterval(keepaliveTimer); keepaliveTimer = null; }
}

// ── Incoming message handling ─────────────────────────────────────────────────
async function handleIncoming(msg) {
  if (msg?.type === 'refresh-config') {
    await refreshBridgeConfig(true);
    forceReconnect('config refreshed');
    return;
  }
  if (msg?.type === 'pong-server') {
    pingPending = false;
    pingMisses = 0;
    lastPong = Date.now();
    latencyMs = msg.time ? lastPong - msg.time : 0;
    status.latencyMs = latencyMs;
    return;
  }
  if (msg?.id != null && typeof msg.command === 'string') {
    let result;
    try {
      result = await handleCommand(msg.command, msg.params || {});
      send({ id: msg.id, ok: true, data: result });
    } catch (err) {
      send({ id: msg.id, ok: false, error: String(err?.message || err) });
    }
  }
}

// ── Content script delegation (fast path) ─────────────────────────────────────
async function execOnContentScript(tabId, op, params) {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId, allFrames: false },
      func: (op, params) => {
        return new Promise((resolve) => {
          chrome.runtime.sendMessage({ type: 'bridge-content-op', op, params }, (response) => {
            resolve(response?.ok ? response.data : null);
          });
        });
      },
      args: [op, params],
    });
    return results?.[results.length - 1]?.result || null;
  } catch {
    return null;
  }
}

// ── Command dispatch ──────────────────────────────────────────────────────────
// Infinite AI has historically sent some commands in camelCase. Accept both
// spellings so no action can ever die on a naming mismatch.
const COMMAND_ALIASES = {
  setValue: 'set_value',
  getValue: 'get_value',
  getElement: 'get_element',
  getElements: 'get_elements',
  getPageText: 'get_page_text',
  getPageHtml: 'get_page_html',
  getPageLinks: 'get_page_links',
  getFormFields: 'get_form_fields',
  listTabs: 'list_tabs',
  getActiveTab: 'get_active_tab',
  newTab: 'new_tab',
  closeTab: 'close_tab',
  switchTab: 'switch_tab',
  clickText: 'click_text',
  rightClick: 'right_click',
  getCookies: 'get_cookies',
  clearCookies: 'clear_cookies',
  getHistory: 'get_history',
  clearHistory: 'clear_history',
  getDownloads: 'get_downloads',
  fillForm: 'fill_form',
  runScript: 'execute_js',
  executeJs: 'execute_js',
};

async function handleCommand(rawCommand, params) {
  const command = COMMAND_ALIASES[rawCommand] || rawCommand;
  // Fast-path: cached commands. The cache is dropped by every mutating
  // command below (see MUTATING), so a click can never be followed by a
  // read of the pre-click DOM.
  if (CACHEABLE.has(command)) {
    const key = cacheKey(command, params);
    const cached = cacheGet(key);
    if (cached) return cached;
  }
  if (MUTATING.has(command)) invalidateCache();

  let result;
  switch (command) {
    case 'ping':
      result = { pong: Date.now(), connected: true, version: status.version, latencyMs };
      break;

    case 'status':
      result = { ...status };
      break;

    case 'list_tabs': {
      const tabs = await chrome.tabs.query({});
      result = {
        tabs: tabs.map(t => ({
          id: t.id, url: t.url, title: t.title, active: t.active,
          windowId: t.windowId, pinned: t.pinned,
          favIconUrl: t.favIconUrl || '', index: t.index,
        })),
      };
      break;
    }

    case 'get_active_tab': {
      const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      result = tab
        ? { id: tab.id, url: tab.url, title: tab.title, windowId: tab.windowId, active: tab.active }
        : { error: 'no active tab' };
      break;
    }

    case 'activate_tab': {
      let tabId = params.tabId;
      if (!tabId && params.url) {
        const tabs = await chrome.tabs.query({});
        const match = tabs.find(t => t.url?.includes(params.url));
        if (match) tabId = match.id;
      }
      if (tabId == null) throw new Error('activate_tab requires tabId or url');
      await chrome.tabs.update(tabId, { active: true });
      const info = await chrome.tabs.get(tabId);
      await chrome.windows.update(info.windowId, { focused: true });
      result = { id: info.id, url: info.url, title: info.title };
      break;
    }

    case 'new_tab': {
      const tab = await chrome.tabs.create({
        url: params.url || 'about:blank',
        active: params.active !== false,
      });
      result = { id: tab.id, url: tab.url, title: tab.title };
      break;
    }

    case 'close_tab': {
      if (params.tabId == null) throw new Error('close_tab requires tabId');
      await chrome.tabs.remove(params.tabId);
      result = { closed: true };
      break;
    }

    case 'navigate': {
      if (!params.url) throw new Error('navigate requires url');
      let tab;
      if (params.tabId != null) {
        tab = await chrome.tabs.update(params.tabId, { url: params.url });
      } else {
        const [active] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
        tab = await chrome.tabs.update(active?.id, { url: params.url });
      }
      result = { id: tab.id, url: tab.url, title: tab.title, started: Date.now() };
      break;
    }

    case 'reload': {
      const [active] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      if (active) await chrome.tabs.reload(active.id, { bypassCache: params.bypassCache === true });
      result = { reloaded: true };
      break;
    }

    case 'back':
      await executeOnActiveTab(function () { history.back(); });
      result = { back: true };
      break;

    case 'forward':
      await executeOnActiveTab(function () { history.forward(); });
      result = { forward: true };
      break;

    case 'wait': {
      const ms = Math.max(0, Number(params.ms) || Number(params.duration) || 0);
      await new Promise(r => setTimeout(r, ms));
      result = { waited: ms };
      break;
    }

    case 'inspect':
      result = await inspectActiveTab();
      break;

    case 'screenshot':
      result = await screenshotActiveTab(params.forceDebugger === true);
      break;

    case 'execute_js':
      result = await runInPage(params.script || params.code);
      break;

    case 'highlight':
      result = await contentScriptOp('highlight', { selector: params.selector, text: params.text });
      break;

    case 'click':
    case 'click_text': {
      result = await contentScriptOp('click', {
        selector: params.selector,
        text: params.text || (command === 'click_text' ? params.value : undefined),
      });
      break;
    }

    case 'type': {
      if (!params.selector) throw new Error('type requires selector');
      result = await contentScriptOp('type', { selector: params.selector, text: String(params.text ?? '') });
      break;
    }

    case 'press_key':
    case 'press': {
      const key = params.key || params.value || params.keyName;
      if (!key) throw new Error('press requires key');
      result = await contentScriptOp('pressKey', { key: key.toLowerCase() === 'enter' ? 'Enter' : key });
      break;
    }

    case 'press_enter':
      result = await contentScriptOp('pressKey', { key: 'Enter' });
      break;

    case 'fill': {
      const fields = params.fields || params.data || {};
      if (!Object.keys(fields).length) throw new Error('fill requires fields map');
      result = await contentScriptOp('fill', { fields });
      break;
    }

    case 'select': {
      if (!params.selector || params.value == null) throw new Error('select requires selector and value');
      result = await contentScriptOp('select', { selector: params.selector, value: String(params.value) });
      break;
    }

    case 'scroll': {
      result = await contentScriptOp('scroll', {
        direction: params.direction,
        delta: params.delta,
        pixels: params.pixels,
      });
      break;
    }

    case 'get_page_text':
    case 'extract_text': {
      const res = await contentScriptOp('getState', { textOnly: true });
      result = { text: (res?.text || '').slice(0, 60000) };
      break;
    }

    case 'get_page_html': {
      const res = await contentScriptOp('getHtml', {});
      result = { html: String(res?.html || '').slice(0, 500000) };
      break;
    }

    case 'get_page_links':
    case 'extract_links': {
      const res = await contentScriptOp('getLinks', {});
      result = { links: res?.links || [] };
      break;
    }

    case 'get_form_fields':
    case 'extract_forms': {
      const res = await contentScriptOp('getFormFields', {});
      result = { fields: res?.fields || [] };
      break;
    }

    case 'get_element': {
      result = await contentScriptOp('getElement', { selector: params.selector, text: params.text });
      break;
    }

    case 'get_elements': {
      result = await contentScriptOp('getElements', { selector: params.selector });
      break;
    }

    case 'hover': {
      result = await contentScriptOp('hover', { selector: params.selector, text: params.text });
      break;
    }

    case 'focus': {
      result = await contentScriptOp('focus', { selector: params.selector });
      break;
    }

    case 'clear': {
      result = await contentScriptOp('clear', { selector: params.selector });
      break;
    }

    case 'set_value': {
      result = await contentScriptOp('setValue', { selector: params.selector, value: params.value });
      break;
    }

    case 'get_value': {
      result = await contentScriptOp('getValue', { selector: params.selector });
      break;
    }

    case 'drag': {
      result = await contentScriptOp('drag', { from: params.from, to: params.to });
      break;
    }

    case 'right_click':
    case 'context_menu': {
      result = await contentScriptOp('rightClick', { selector: params.selector, text: params.text });
      break;
    }

    case 'double_click':
    case 'doubleclick': {
      result = await contentScriptOp('doubleClick', { selector: params.selector, text: params.text });
      break;
    }

    case 'cookie_get': {
      // An empty `url` is rejected by Chrome — the key must be omitted instead.
      const cookieQuery = { ...(params.url ? { url: params.url } : params.domain ? { domain: params.domain } : {}) };
      if (params.name) cookieQuery.name = params.name;
      const cookies = await chrome.cookies.getAll(cookieQuery);
      result = {
        cookies: cookies.map(c => ({
          name: c.name, value: c.value, domain: c.domain,
          path: c.path, expires: c.expirationDate,
          httpOnly: c.httpOnly, secure: c.secure,
        })),
      };
      break;
    }

    case 'cookie_set': {
      await chrome.cookies.set({
        url: params.url, name: params.name, value: params.value,
        domain: params.domain, path: params.path || '/',
        secure: params.secure !== false, httpOnly: params.httpOnly || false,
      });
      result = { set: true };
      break;
    }

    case 'storage_get': {
      const keys = params.keys || [];
      const data = await chrome.storage.local.get(keys);
      result = { data };
      break;
    }

    case 'storage_set': {
      await chrome.storage.local.set(params.data || {});
      result = { set: true };
      break;
    }

    case 'clipboard_read': {
      const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      if (!tab?.id) throw new Error('No active tab');
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => navigator.clipboard.readText().then(t => t).catch(() => ''),
      });
      result = { text: results?.[0]?.result || '' };
      break;
    }

    case 'clipboard_write': {
      const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      if (!tab?.id) throw new Error('No active tab available');
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: (text) => navigator.clipboard.writeText(text).catch(() => {}),
        args: [params.text || ''],
      });
      result = { written: true };
      break;
    }

    case 'batch': {
      const ops = Array.isArray(params.ops) ? params.ops : [];
      if (!ops.length) throw new Error('batch requires ops array');
      const results = [];
      for (const item of ops) {
        if (item && typeof item.op === 'string') {
          try {
            const r = await handleCommand(item.op, item.params || {});
            results.push({ op: item.op, ...r });
          } catch (e) {
            results.push({ op: item.op, error: String(e?.message || e) });
          }
        }
      }
      result = { results };
      break;
    }

    case 'console_log': {
      const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      if (!tab?.id || !tab.windowId) throw new Error('No active tab available');
      const duration = Math.min(Math.max(Number(params.duration) || 2000, 100), 10000);
      const logs = [];
      let eventListener = null;
      try {
        await new Promise((resolve, reject) => {
          chrome.debugger.attach({ tabId: tab.id }, '1.3', () => {
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message));
              return;
            }
            eventListener = (source, method, params) => {
              if (source.tabId !== tab.id) return;
              if (method === 'Runtime.consoleAPICalled' && params?.args) {
                const level = params.level || 'log';
                const text = params.args.map((a) => (a?.value != null ? String(a.value) : a?.preview || JSON.stringify(a))).join(' ');
                logs.push({ level, text: text || '', url: params.url || '', lineNumber: 0 });
              } else if (method === 'Runtime.exceptionThrown' && params?.exceptionDetails) {
                const details = params.exceptionDetails;
                logs.push({ level: 'error', text: details.text || '', url: details.url || '', lineNumber: details.lineNumber || 0 });
              }
            };
            chrome.debugger.onEvent.addListener(eventListener);
            chrome.debugger.sendCommand({ tabId: tab.id }, 'Runtime.enable');
            resolve();
          });
        });
        await new Promise((r) => setTimeout(r, duration));
        if (eventListener) chrome.debugger.onEvent.removeListener(eventListener);
        try { await new Promise((r) => chrome.debugger.detach({ tabId: tab.id }, r)); } catch {}
      } catch (e) {
        if (eventListener) {
          try { chrome.debugger.onEvent.removeListener(eventListener); } catch {}
        }
        if (/already attached/i.test(String(e))) {
          return { logs: logs.slice(0, 200), warn: 'debugger already attached to this tab' };
        }
        return { logs: logs.slice(0, 200), captured: false, warn: String((e).message || e) };
      }
      result = { logs: logs.slice(0, 200), captured: true };
      break;
    }

    case 'get_page_performance': {
      const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      if (!tab?.id) throw new Error('No active tab');
      const perfResult = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          const perf = performance;
          const timing = perf.timing;
          return {
            loadTime: timing.loadEventEnd - timing.navigationStart,
            domReady: timing.domContentLoadedEventEnd - timing.navigationStart,
            ttfb: timing.responseStart - timing.navigationStart,
            resources: perf.getEntriesByType('resource').length,
            transferSize: perf.getEntriesByResourceTiming?.()?.reduce((sum, r) => sum + (r.transferSize || 0), 0) || 0,
          };
        },
      });
      result = perfResult?.[0]?.result || {};
      break;
    }

    // ── NEW COMMANDS (v4.0) ────────────────────────────────────────────────────

    case 'get_history': {
      const items = await chrome.history.search({
        text: params.query || '',
        maxResults: params.maxResults || 100,
        startTime: params.startTime || 0,
      });
      result = {
        history: items.map(item => ({
          id: item.id,
          url: item.url,
          title: item.title,
          lastVisitTime: item.lastVisitTime,
          visitCount: item.visitCount,
          typedCount: item.typedCount,
        })),
      };
      break;
    }

    case 'clear_history': {
      await chrome.history.deleteAll();
      result = { cleared: true };
      break;
    }

    case 'get_downloads': {
      const items = await chrome.downloads.search({
        query: params.query || [],
        limit: params.limit || 100,
        orderBy: params.orderBy || ['-startTime'],
      });
      result = {
        downloads: items.map(item => ({
          id: item.id,
          url: item.url,
          filename: item.filename,
          state: item.state,
          startTime: item.startTime,
          endTime: item.endTime,
          fileSize: item.fileSize,
          totalBytes: item.totalBytes,
          bytesReceived: item.bytesReceived,
          error: item.error,
          estimatedCompletionTime: item.estimatedCompletionTime,
        })),
      };
      break;
    }

    case 'download': {
      if (!params.url) throw new Error('download requires url');
      const download = await chrome.downloads.download({
        url: params.url,
        filename: params.filename,
        conflictAction: params.conflictAction || 'uniquify',
        saveAs: params.saveAs || false,
      });
      result = { downloadId: download.id, url: params.url };
      break;
    }

    case 'get_windows': {
      const windows = await chrome.windows.getAll({ populate: true });
      result = {
        windows: windows.map(w => ({
          id: w.id,
          focused: w.focused,
          type: w.type,
          state: w.state,
          tabs: w.tabs?.map(t => ({
            id: t.id,
            url: t.url,
            title: t.title,
            active: t.active,
          })) || [],
        })),
      };
      break;
    }

    case 'focus_window': {
      if (params.windowId == null) throw new Error('focus_window requires windowId');
      await chrome.windows.update(params.windowId, { focused: true });
      result = { focused: params.windowId };
      break;
    }

    case 'minimize_window': {
      const [active] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      if (active) {
        await chrome.windows.update(active.windowId, { state: 'minimized' });
      }
      result = { minimized: true };
      break;
    }

    case 'maximize_window': {
      const [active] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      if (active) {
        const win = await chrome.windows.get(active.windowId);
        const newState = win.state === 'maximized' ? 'normal' : 'maximized';
        await chrome.windows.update(active.windowId, { state: newState });
        result = { state: newState };
      }
      break;
    }

    case 'create_window': {
      const win = await chrome.windows.create({
        url: params.url || 'about:blank',
        type: params.type || 'normal',
        focused: params.focused !== false,
        state: params.state || 'normal',
        width: params.width,
        height: params.height,
        left: params.left,
        top: params.top,
      });
      result = { windowId: win.id, url: params.url };
      break;
    }

    case 'get_extensions': {
      const extensions = await chrome.management.getAll();
      result = {
        extensions: extensions.map(ext => ({
          id: ext.id,
          name: ext.name,
          version: ext.version,
          enabled: ext.enabled,
          type: ext.type,
          description: ext.description,
        })),
      };
      break;
    }

    case 'toggle_extension': {
      if (!params.extensionId) throw new Error('toggle_extension requires extensionId');
      const ext = await chrome.management.get(params.extensionId);
      if (ext) {
        await chrome.management.setEnabled(ext.id, !ext.enabled);
        result = { toggled: true, enabled: !ext.enabled };
      } else {
        throw new Error('Extension not found');
      }
      break;
    }

    case 'get_permissions': {
      result = {
        permissions: chrome.runtime.getManifest().permissions || [],
        host_permissions: chrome.runtime.getManifest().host_permissions || [],
      };
      break;
    }

    case 'get_tab_info': {
      if (params.tabId == null) throw new Error('get_tab_info requires tabId');
      const tab = await chrome.tabs.get(params.tabId);
      result = {
        id: tab.id,
        url: tab.url,
        title: tab.title,
        active: tab.active,
        windowId: tab.windowId,
        pinned: tab.pinned,
        favIconUrl: tab.favIconUrl,
        index: tab.index,
        status: tab.status,
        width: tab.width,
        height: tab.height,
      };
      break;
    }

    case 'move_tab': {
      if (params.tabId == null || params.index == null) throw new Error('move_tab requires tabId and index');
      const tab = await chrome.tabs.move(params.tabId, { index: params.index });
      result = { moved: true, index: tab.index };
      break;
    }

    case 'pin_tab': {
      if (params.tabId == null) throw new Error('pin_tab requires tabId');
      await chrome.tabs.update(params.tabId, { pinned: params.pinned !== false });
      result = { pinned: true };
      break;
    }

    case 'duplicate_tab': {
      if (params.tabId == null) throw new Error('duplicate_tab requires tabId');
      const tab = await chrome.tabs.duplicate(params.tabId);
      result = { id: tab.id, url: tab.url, title: tab.title };
      break;
    }

    case 'zoom': {
      const [active] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      if (!active) throw new Error('No active tab');
      if (params.factor) {
        await chrome.tabs.setZoom(active.id, params.factor);
      } else if (params.action === 'in') {
        const currentZoom = await chrome.tabs.getZoom(active.id);
        await chrome.tabs.setZoom(active.id, Math.min(currentZoom + 0.1, 5));
      } else if (params.action === 'out') {
        const currentZoom = await chrome.tabs.getZoom(active.id);
        await chrome.tabs.setZoom(active.id, Math.max(currentZoom - 0.1, 0.25));
      } else if (params.action === 'reset') {
        await chrome.tabs.setZoom(active.id, 1);
      }
      const newZoom = await chrome.tabs.getZoom(active.id);
      result = { zoom: newZoom };
      break;
    }

    case 'find_in_page': {
      if (!params.text) throw new Error('find_in_page requires text');
      result = await contentScriptOp('findInPage', { text: String(params.text), index: params.index });
      break;
    }

    case 'get_browser_info': {
      result = {
        name: navigator.userAgent,
        version: status.version,
        platform: navigator.platform,
        language: navigator.language,
        cookieEnabled: navigator.cookieEnabled,
        onLine: navigator.onLine,
      };
      break;
    }

    case 'get_network_info': {
      const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
      result = {
        onLine: navigator.onLine,
        type: connection?.type || 'unknown',
        effectiveType: connection?.effectiveType || 'unknown',
        downlink: connection?.downlink || 0,
        rtt: connection?.rtt || 0,
        saveData: connection?.saveData || false,
      };
      break;
    }

    case 'get_battery': {
      try {
        const battery = await navigator.getBattery();
        result = {
          charging: battery.charging,
          chargingTime: battery.chargingTime,
          dischargingTime: battery.dischargingTime,
          level: battery.level,
        };
      } catch {
        result = { error: 'Battery API not available' };
      }
      break;
    }

    case 'get_media_devices': {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        result = {
          devices: devices.map(d => ({
            deviceId: d.deviceId,
            kind: d.kind,
            label: d.label,
            groupId: d.groupId,
          })),
        };
      } catch {
        result = { error: 'Media devices not available' };
      }
      break;
    }

    case 'get_geolocation': {
      try {
        const position = await new Promise((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(resolve, reject, {
            enableHighAccuracy: true,
            timeout: 10000,
            maximumAge: 0,
          });
        });
        result = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
          altitude: position.coords.altitude,
          heading: position.coords.heading,
          speed: position.coords.speed,
          timestamp: position.timestamp,
        };
      } catch (e) {
        result = { error: 'Geolocation not available: ' + (e?.message || e) };
      }
      break;
    }

    case 'get_webgl_info': {
      // There is no DOM in a service worker, so this has to run in the page.
      // Delegating makes the command actually work instead of always answering
      // "not available".
      try {
        result = await pageOp('getWebglInfo', {});
      } catch (err) {
        result = { error: String(err?.message || err) };
      }
      break;
    }

    case 'get_cpu_info': {
      const cores = navigator.hardwareConcurrency || 0;
      const memory = navigator.deviceMemory || 0;
      result = {
        cores,
        memory: memory + ' GB',
        platform: navigator.platform,
        userAgent: navigator.userAgent,
      };
      break;
    }

    case 'get_storage_info': {
      try {
        if (navigator.storage && navigator.storage.estimate) {
          const estimate = await navigator.storage.estimate();
          result = {
            usage: estimate.usage,
            quota: estimate.quota,
            usageInMB: (estimate.usage / 1024 / 1024).toFixed(2),
            quotaInMB: (estimate.quota / 1024 / 1024).toFixed(2),
            percentUsed: ((estimate.usage / estimate.quota) * 100).toFixed(2),
          };
        } else {
          result = { error: 'Storage API not available' };
        }
      } catch {
        result = { error: 'Storage API not available' };
      }
      break;
    }

    case 'get_performance_metrics': {
      const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      if (!tab?.id) throw new Error('No active tab');
      const metrics = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          const perf = performance;
          const entries = perf.getEntriesByType('resource');
          const paint = perf.getEntriesByType('paint');
          const navigation = perf.getEntriesByType('navigation')[0];
          return {
            timing: {
              navigationStart: perf.timing.navigationStart,
              domContentLoaded: perf.timing.domContentLoadedEventEnd - perf.timing.navigationStart,
              loadComplete: perf.timing.loadEventEnd - perf.timing.navigationStart,
              ttfb: perf.timing.responseStart - perf.timing.navigationStart,
              dnsLookup: perf.timing.domainLookupEnd - perf.timing.domainLookupStart,
              tcpConnect: perf.timing.connectEnd - perf.timing.connectStart,
              serverResponse: perf.timing.responseStart - perf.timing.requestStart,
              domInteractive: perf.timing.domInteractive - perf.timing.navigationStart,
              domComplete: perf.timing.domComplete - perf.timing.navigationStart,
            },
            paint: paint.map(p => ({ name: p.name, startTime: p.startTime })),
            resources: entries.length,
            totalTransferSize: entries.reduce((sum, e) => sum + (e.transferSize || 0), 0),
            resourceTypes: entries.reduce((acc, e) => {
              const type = e.initiatorType || 'other';
              acc[type] = (acc[type] || 0) + 1;
              return acc;
            }, {}),
            memory: perf.memory ? {
              usedJSHeapSize: perf.memory.usedJSHeapSize,
              totalJSHeapSize: perf.memory.totalJSHeapSize,
              jsHeapSizeLimit: perf.memory.jsHeapSizeLimit,
            } : null,
          };
        },
      });
      result = metrics?.[0]?.result || {};
      break;
    }

    case 'get_cookies': {
      const cookies = await chrome.cookies.getAll({});
      result = {
        cookies: cookies.map(c => ({
          name: c.name,
          value: c.value,
          domain: c.domain,
          path: c.path,
          expires: c.expirationDate,
          httpOnly: c.httpOnly,
          secure: c.secure,
          sameSite: c.sameSite,
        })),
        count: cookies.length,
      };
      break;
    }

    case 'clear_cookies': {
      await chrome.browsingData.remove({}, { cookies: true });
      result = { cleared: true };
      break;
    }

    case 'get_form_data': {
      const res = await contentScriptOp('getFormData', {});
      result = res || { forms: [] };
      break;
    }

    case 'submit_form': {
      if (!params.selector) throw new Error('submit_form requires selector');
      result = await contentScriptOp('submitForm', { selector: params.selector });
      break;
    }

    case 'get_table_data': {
      const res = await contentScriptOp('getTableData', { selector: params.selector });
      result = res || { tables: [] };
      break;
    }

    case 'get_page_meta': {
      const res = await contentScriptOp('getPageMeta', {});
      result = res || {};
      break;
    }

    case 'get_page_structured': {
      const res = await contentScriptOp('getStructuredContent', {});
      result = res || {};
      break;
    }

    case 'take_screenshot_area': {
      const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      if (!tab) throw new Error('No active tab');
      const screenshot = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'jpeg', quality: 80 });
      result = { base64: screenshot.replace(/^data:image\/jpeg;base64,/, ''), format: 'jpeg' };
      break;
    }

    case 'create_notification': {
      chrome.notifications.create(params.id || 'infinite-ai-' + Date.now(), {
        type: params.type || 'basic',
        title: params.title || 'Infinite AI',
        message: params.message || '',
        iconUrl: params.iconUrl || 'icons/icon128.png',
        priority: params.priority || 0,
      });
      result = { created: true };
      break;
    }

    case 'get_idle_state': {
      const state = await chrome.idle.queryState(params.interval || 60);
      result = { state };
      break;
    }

    case 'get_tab_tree': {
      const tabs = await chrome.tabs.query({});
      const windows = await chrome.windows.getAll({ populate: false });
      result = {
        windows: windows.map(w => ({
          id: w.id,
          focused: w.focused,
          type: w.type,
          state: w.state,
          tabs: tabs.filter(t => t.windowId === w.id).map(t => ({
            id: t.id,
            url: t.url,
            title: t.title,
            active: t.active,
            pinned: t.pinned,
            favIconUrl: t.favIconUrl,
          })),
        })),
        totalTabs: tabs.length,
      };
      break;
    }

    default:
      throw new Error(`Unknown command: ${command}`);
  }

  // Cache cacheable results
  if (CACHEABLE.has(command)) {
    cacheSet(cacheKey(command, params), result);
  }
  status.commandsServed++;
  return result;
}

// ── Content script operations (fast path — no script injection) ────────────────
// Browser-internal pages (chrome://, edge://, the web store, other extensions)
// genuinely cannot be scripted. about:blank is allowed through: it is what a
// freshly opened tab is, and the navigate/click that follows takes over.
const SCRIPTABLE_URL = /^(https?|file|about):/i;
function assertScriptable(url) {
  const raw = String(url || '');
  if (!raw) throw new Error('That tab has no address yet — navigate it first.');
  if (!SCRIPTABLE_URL.test(raw)) {
    const scheme = raw.split(':')[0] || 'this';
    throw new Error(`Infinite AI cannot drive ${scheme}: pages (the browser protects them). Open a normal web page and try again.`);
  }
}

async function contentScriptOp(op, params, frameId) {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab?.id) throw new Error('No active tab available');
  assertScriptable(tab.url);

  // Try the content script first (fastest path). The frame is explicit rather
  // than broadcast: without it Chrome answers from every frame, so one click
  // would also fire inside ad/news/recaptcha iframes and the reply could come
  // from any of them. Callers can still target a subframe on purpose.
  // Callers can target a subframe on purpose by passing params.frameId; the
  // top frame is the default so a broadcast never happens by accident.
  const frame = Number.isInteger(frameId)
    ? frameId
    : params && Number.isInteger(params.frameId)
      ? params.frameId
      : 0;
  const target = { frameId: frame };
  try {
    const response = await chrome.tabs.sendMessage(
      tab.id,
      { type: 'bridge-content-op', op, params },
      target,
    );
    if (response?.ok) return response.data;
    if (response?.error) throw new Error(response.error);
  } catch (err) {
    // A real failure inside the page is reported as-is; only a missing content
    // script (no receiver / detached frame) falls through to injection.
    if (err instanceof Error && /Cannot drive|No active tab/.test(err.message)) throw err;
  }

  // Fallback: inject PAGE_EXEC via scripting API
  return pageOp(op, params, frame);
}

// ── Page automation helpers (fallback — script injection) ──────────────────────
async function pageOp(op, params, frameId) {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab?.id) throw new Error('No active tab available');
  assertScriptable(tab.url);
  let results;
  try {
    results = await chrome.scripting.executeScript({
      target: Number.isInteger(frameId) ? { tabId: tab.id, frameIds: [frameId] } : { tabId: tab.id, allFrames: false },
      func: PAGE_EXEC,
      args: [op, params],
    });
  } catch (err) {
    // A blank tab cannot host an injected script until it has a real origin.
    if (/Cannot access|frame with ID|Cannot script|about:blank/i.test(String(err?.message || err))) {
      throw new Error('That tab has no page loaded yet — navigate it first, then run the command again.');
    }
    throw err;
  }
  const last = results?.[results.length - 1];
  if (!last) throw new Error('No execution result');
  if (last.result?.__error) throw new Error(last.result.__error);
  return last.result;
}

async function executeOnActiveTab(func) {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab?.id) return;
  await chrome.scripting.executeScript({ target: { tabId: tab.id }, func });
}

async function inspectActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab) throw new Error('No active tab');
  const state = await contentScriptOp('getState', {});
  const screenshot = await screenshotActiveTab().catch(() => null);
  return {
    url: state?.url || tab.url,
    title: state?.title || tab.title,
    text: (state?.text || '').slice(0, 60000),
    snapshot: state?.snapshot || [],
    forms: state?.forms || [],
    links: state?.links || [],
    readyState: state?.readyState,
    screenshot: screenshot?.base64 || null,
    performance: state?.performance || {},
  };
}

async function screenshotActiveTab(forceDebugger = false) {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab) throw new Error('No active tab');
  if (!/^(https?|file):/.test(String(tab.url || ''))) throw new Error(`Cannot capture: ${tab.url}`);
  if (!forceDebugger) {
    try {
      const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
      return { base64: dataUrl.replace(/^data:image\/png;base64,/, ''), format: 'png' };
    } catch (err) {
      // captureVisibleTab fails with "image readback failed" on some Windows GPU
      // paths and whenever the tab's window is occluded or minimized. The
      // debugger screenshot reads the renderer directly and keeps the agent
      // working while the user has another app in front.
      return await captureViaDebugger(tab, err);
    }
  }
  // Explicit fallback request (used by diagnostics and when a user chooses the
  // reliable path after a repeat captureVisibleTab failure).
  return await captureViaDebugger(tab, new Error('forced debugger screenshot'));
}

async function captureViaDebugger(tab, cause) {
  const target = { tabId: tab.id };
  let attached = false;
  try {
    await new Promise((resolve, reject) => {
      chrome.debugger.attach(target, '1.3', () => {
        const err = chrome.runtime.lastError;
        if (err) reject(new Error(err.message));
        else resolve();
      });
    });
    attached = true;
  } catch (err) {
    if (!/already attached|another debugger/i.test(String(err?.message || err))) {
      throw new Error(
        `Failed to capture tab: ${cause?.message || cause}; debugger fallback failed: ${err?.message || err}`,
      );
    }
  }
  try {
    const response = await new Promise((resolve, reject) => {
      chrome.debugger.sendCommand(
        target,
        'Page.captureScreenshot',
        { format: 'png', fromSurface: true, captureBeyondViewport: false },
        (result) => {
          const err = chrome.runtime.lastError;
          if (err) reject(new Error(err.message));
          else resolve(result);
        },
      );
    });
    if (!response?.data) throw new Error('empty screenshot');
    return { base64: response.data, format: 'png', source: 'debugger' };
  } catch (err) {
    throw new Error(
      `Failed to capture tab: ${cause?.message || cause}; debugger fallback failed: ${err?.message || err}`,
    );
  } finally {
    if (attached) {
      try {
        await new Promise((resolve) => chrome.debugger.detach(target, () => resolve()));
      } catch {
        /* tab may have closed */
      }
    }
  }
}

async function runInPage(code) {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab?.id) throw new Error('No active tab available');
  const target = { tabId: tab.id };

  // Content-script isolated worlds enforce an extension CSP that blocks
  // new Function()/eval, so the old implementation failed on every page. The
  // debugger Runtime.evaluate path is the same one DevTools uses and is not
  // subject to the page or isolated-world CSP.
  let attached = false;
  try {
    await new Promise((resolve, reject) => {
      chrome.debugger.attach(target, '1.3', () => {
        const err = chrome.runtime.lastError;
        if (err) reject(new Error(err.message));
        else resolve();
      });
    });
    attached = true;
  } catch (err) {
    // If this extension (e.g. console_log) or DevTools already holds the
    // target, try to reuse the existing session instead of failing outright.
    if (!/already attached|another debugger/i.test(String(err?.message || err))) throw err;
  }

  try {
    const response = await new Promise((resolve, reject) => {
      chrome.debugger.sendCommand(
        target,
        'Runtime.evaluate',
        {
          expression: code,
          returnByValue: true,
          awaitPromise: true,
          userGesture: true,
        },
        (result) => {
          const err = chrome.runtime.lastError;
          if (err) reject(new Error(err.message));
          else resolve(result);
        },
      );
    });

    if (response?.exceptionDetails) {
      const details = response.exceptionDetails;
      const message =
        details.exception?.description ||
        details.text ||
        'JavaScript evaluation failed';
      throw new Error(message);
    }
    return {
      ok: true,
      value: response?.result?.value ?? null,
      type: response?.result?.type || 'undefined',
    };
  } finally {
    if (attached) {
      try {
        await new Promise((resolve) => chrome.debugger.detach(target, () => resolve()));
      } catch {
        /* tab may have closed */
      }
    }
  }
}

// ── PAGE_EXEC — DOM automation (runs in isolated content world) ────────────────
const PAGE_EXEC = function (op, params) {
  const out = (v) => ({ __error: undefined, ...(v || {}) });
  const fail = (m) => ({ __error: m });
  const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();

  function cssPath(el) {
    if (!el || el.nodeType !== 1) return '';
    if (el.id) return '#' + CSS.escape(el.id);
    const parts = [];
    let node = el;
    while (node && node.nodeType === 1 && node !== document.documentElement) {
      let sel = node.tagName.toLowerCase();
      if (node.id) { sel = '#' + CSS.escape(node.id); parts.unshift(sel); break; }
      if (node.classList?.length) sel += '.' + Array.from(node.classList).slice(0, 3).map(c => CSS.escape(c)).join('.');
      const parent = node.parentElement;
      if (parent) {
        const same = Array.from(parent.children).filter(c => c.tagName === node.tagName);
        if (same.length > 1) sel += ':nth-of-type(' + (same.indexOf(node) + 1) + ')';
      }
      parts.unshift(sel);
      node = parent;
    }
    return parts.join(' > ');
  }

  function visible(el) {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return false;
    const cs = getComputedStyle(el);
    return cs.display !== 'none' && cs.visibility !== 'hidden' && Number(cs.opacity) !== 0;
  }

  const INTERACTIVE = 'a, button, input, textarea, select, summary, [role="button"], [role="link"], [role="menuitem"], [role="checkbox"], [role="radio"], [role="tab"], [role="option"], [onclick], label[for], details summary';
  const TEXT_ATTRS = ['aria-label', 'title', 'placeholder', 'alt', 'name', 'value'];

  function findCandidate(selector, text) {
    let el = null;
    if (selector) { try { el = document.querySelector(selector); } catch {} }
    if (!el && text) {
      const q = norm(text);
      const candidates = Array.from(document.querySelectorAll(INTERACTIVE));
      const scored = [];
      for (const c of candidates) {
        if (!visible(c)) continue;
        let label = norm((c.innerText || c.textContent || '').slice(0, 200));
        if (!label) { for (const attr of TEXT_ATTRS) { const v = c.getAttribute(attr); if (v) { label = norm(v); break; } } }
        if (!label) continue;
        let score = -1;
        if (label === q) score = 100;
        else if (label.startsWith(q)) score = 60;
        else if (label.includes(q)) score = 40;
        if (score > 0) scored.push({ el: c, score });
      }
      scored.sort((a, b) => b.score - a.score);
      el = scored.length ? scored[0].el : null;
    }
    return el;
  }

  function describe(el) {
    if (!el) return null;
    const role = el.getAttribute('role') || (el.tagName === 'A' ? 'link' : el.tagName === 'BUTTON' ? 'button' : el.tagName.toLowerCase());
    return {
      tag: el.tagName.toLowerCase(), role,
      text: (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 200),
      aria: el.getAttribute('aria-label') || '', title: el.getAttribute('title') || '',
      placeholder: el.getAttribute('placeholder') || '', name: el.getAttribute('name') || '',
      value: (el.value != null ? String(el.value) : '') || (el.tagName === 'SELECT' ? el.options[el.selectedIndex]?.text || '' : ''),
      href: el.getAttribute('href') || '', selector: cssPath(el), visible: visible(el),
      rect: (() => { const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) }; })(),
    };
  }

  function dispatch(el, type, detail) {
    const evt = new Event(type, { bubbles: true, cancelable: true });
    if (detail) Object.assign(evt, detail);
    el.dispatchEvent(evt);
  }

  function setNativeValue(input, value) {
    const proto = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype
      : input instanceof HTMLSelectElement ? HTMLSelectElement.prototype
      : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    if (setter) setter.call(input, value); else input.value = value;
  }

  switch (op) {
    case 'getState': {
      const snapshot = []; const seen = new Set();
      const all = Array.from(document.querySelectorAll(INTERACTIVE));
      for (const el of all) {
        if (!visible(el) || snapshot.length >= 300) continue;
        const d = describe(el);
        if (seen.has(d.selector)) continue;
        seen.add(d.selector);
        snapshot.push(d);
      }
      const forms = Array.from(document.forms).map(f => ({
        action: f.action || '', method: f.method || '',
        fields: Array.from(f.elements).filter(e => ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(e.tagName)).slice(0, 40).map(e => describe(e)),
      }));
      const links = Array.from(document.querySelectorAll('a[href]')).map(a => ({
        text: (a.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 150), href: a.href,
      })).slice(0, 300);
      return out({ url: location.href, title: document.title, readyState: document.readyState,
        text: (document.body?.innerText || '').slice(0, 60000), snapshot, forms, links });
    }
    case 'getHtml': return out({ html: document.documentElement.outerHTML });
    case 'getLinks': return out({ links: Array.from(document.querySelectorAll('a[href]')).map(a => ({ text: (a.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 150), href: a.href, title: a.title || '' })).slice(0, 300) });
    case 'getFormFields': return out({ fields: Array.from(document.forms).flatMap(f => Array.from(f.elements).filter(e => ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.tagName)).map(e => describe(e))) });
    case 'getElement': {
      const el = findCandidate(params.selector, params.text);
      return el ? out(describe(el)) : fail('Element not found');
    }
    case 'getElements': {
      const els = params.selector ? Array.from(document.querySelectorAll(params.selector)).slice(0, 100) : [];
      return out({ elements: els.map(describe) });
    }
    case 'click': case 'click_text': {
      const el = findCandidate(params.selector, params.text);
      if (!el) return fail('No clickable element found for ' + (params.selector ? 'selector "' + params.selector + '"' : 'text "' + params.text + '"'));
      el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
      const r = el.getBoundingClientRect();
      const target = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) || el;
      target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2 }));
      target.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2 }));
      target.click();
      if (el.tagName === 'SUMMARY' && el.parentElement) {
        const details = el.parentElement.closest('details');
        if (details) details.open = !details.open;
      }
      return out({ clicked: true, selector: cssPath(target), text: (target.innerText || '').slice(0, 120) });
    }
    case 'type': {
      const el = findCandidate(params.selector);
      if (!el) return fail('No element found for selector "' + params.selector + '"');
      el.focus();
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el.isContentEditable) {
        if (el.isContentEditable) { el.textContent = params.text; dispatch(el, 'input'); }
        else { setNativeValue(el, params.text); dispatch(el, 'input'); dispatch(el, 'change'); }
      }
      return out({ typed: params.text.length, selector: cssPath(el) });
    }
    case 'fill': {
      const results = [];
      for (const [sel, value] of Object.entries(params.fields || {})) {
        const el = findCandidate(sel);
        if (!el) { results.push({ selector: sel, ok: false, error: 'not found' }); continue; }
        el.focus();
        if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el.isContentEditable) {
          if (el.isContentEditable) { el.textContent = String(value); dispatch(el, 'input'); }
          else { setNativeValue(el, String(value)); dispatch(el, 'input'); dispatch(el, 'change'); }
        } else if (el instanceof HTMLSelectElement) {
          const opt = Array.from(el.options).find(o => o.value === String(value) || o.text === String(value));
          if (opt) { el.value = opt.value; dispatch(el, 'change'); }
        }
        results.push({ selector: sel, ok: true });
      }
      return out({ filled: results.filter(r => r.ok).length, results });
    }
    case 'select': {
      const el = findCandidate(params.selector);
      if (!el || !(el instanceof HTMLSelectElement)) return fail('No <select> found for "' + params.selector + '"');
      const value = String(params.value);
      const opt = Array.from(el.options).find(o => o.value === value || norm(o.text) === norm(value));
      if (!opt) return fail('Option "' + value + '" not found');
      el.value = opt.value; dispatch(el, 'change');
      return out({ selected: opt.value, text: opt.text });
    }
    case 'scroll': {
      const dir = params.direction || 'down';
      const delta = Number(params.delta || params.pixels || 0);
      let x = 0, y = 0;
      if (dir === 'down') y = delta || window.innerHeight * 0.8;
      else if (dir === 'up') y = -(delta || window.innerHeight * 0.8);
      else if (dir === 'left') x = -(delta || window.innerWidth * 0.8);
      else if (dir === 'right') x = delta || window.innerWidth * 0.8;
      else if (dir === 'top') y = -document.body.scrollHeight;
      else if (dir === 'bottom') y = document.body.scrollHeight;
      window.scrollBy({ top: y, left: x, behavior: 'instant' });
      return out({ direction: dir, x: window.scrollX, y: window.scrollY });
    }
    case 'pressKey': {
      const key = params.key || 'Enter';
      const el = document.activeElement || document.body;
      const codes = { Enter: 13, Tab: 9, Escape: 27, ' ': 32, ArrowDown: 40, ArrowUp: 38, ArrowLeft: 37, ArrowRight: 39, Backspace: 8, Delete: 46, Home: 36, End: 35, PageDown: 34, PageUp: 33 };
      const keyCode = codes[key] ?? 0;
      el.dispatchEvent(new KeyboardEvent('keydown', { key, code: key, keyCode, bubbles: true, cancelable: true }));
      el.dispatchEvent(new KeyboardEvent('keyup', { key, code: key, keyCode, bubbles: true, cancelable: true }));
      return out({ key });
    }
    case 'highlight': {
      const el = findCandidate(params.selector, params.text);
      if (!el) return fail('highlight: element not found');
      el.scrollIntoView({ block: 'center', behavior: 'instant' });
      const oldOutline = el.style.outline; const oldBg = el.style.backgroundColor;
      el.style.outline = '3px solid #22c55e'; el.style.backgroundColor = 'rgba(34,197,94,0.25)';
      setTimeout(() => { el.style.outline = oldOutline; el.style.backgroundColor = oldBg; }, 2200);
      return out({ highlighted: cssPath(el) });
    }
    case 'findInPage': {
      const query = String(params.text || '');
      if (!query) return fail('findInPage: no search text provided');
      const requested = Number(params.index ?? 0);
      // Collect visible text nodes and their offsets in a '\n'-joined haystack.
      const nodes = [];
      let total = 0;
      const walker = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_TEXT);
      let current;
      while ((current = walker.nextNode())) {
        const value = current.nodeValue || '';
        const parent = current.parentElement;
        if (!value.trim() || !parent || /^(SCRIPT|STYLE|NOSCRIPT|TEXTAREA)$/.test(parent.tagName)) continue;
        const cs = getComputedStyle(parent);
        if (cs.display === 'none' || cs.visibility === 'hidden') continue;
        nodes.push({ node: current, start: total });
        total += value.length + 1; // +1 accounts for the '\n' join below
      }
      if (!nodes.length) return out({ count: 0, index: -1 });
      const haystack = nodes.map(n => n.node.nodeValue).join('\n');
      const lower = haystack.toLowerCase();
      const needle = query.toLowerCase();
      const positions = [];
      let pos = lower.indexOf(needle);
      while (pos !== -1 && positions.length < 5000) {
        positions.push(pos);
        pos = lower.indexOf(needle, pos + Math.max(needle.length, 1));
      }
      const count = positions.length;
      if (!count) return out({ count: 0, index: -1 });
      const index = ((requested % count) + count) % count; // wrap like Ctrl+G
      const at = positions[index];
      const entry = nodes.find(n => at >= n.start && at < n.start + n.node.nodeValue.length + 1);
      if (!entry) return out({ count, index });
      try {
        const localStart = at - entry.start;
        const range = document.createRange();
        range.setStart(entry.node, localStart);
        range.setEnd(entry.node, Math.min(localStart + query.length, entry.node.nodeValue.length));
        const rect = range.getBoundingClientRect();
        window.scrollTo({ top: Math.max(0, window.scrollY + rect.top - window.innerHeight / 3), left: 0, behavior: 'instant' });
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        const r2 = range.getBoundingClientRect();
        const marker = document.createElement('div');
        marker.style.cssText = 'position:absolute;left:' + (r2.left + window.scrollX - 2) + 'px;top:' + (r2.top + window.scrollY - 2) + 'px;width:' + (r2.width + 4) + 'px;height:' + (r2.height + 4) + 'px;pointer-events:none;z-index:2147483647;background:rgba(255,220,0,0.35);outline:2px solid rgba(255,160,0,0.9);border-radius:2px;';
        (document.body || document.documentElement).appendChild(marker);
        setTimeout(() => { try { marker.remove(); sel.removeAllRanges(); } catch {} }, 1500);
      } catch {}
      return out({ count, index });
    }
    case 'hover': {
      const el = findCandidate(params.selector, params.text);
      if (!el) return fail('hover: element not found');
      el.scrollIntoView({ block: 'center', behavior: 'instant' });
      const r = el.getBoundingClientRect();
      el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2 }));
      el.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2 }));
      return out({ hovered: cssPath(el) });
    }
    case 'focus': {
      const el = findCandidate(params.selector);
      if (!el) return fail('focus: element not found');
      el.focus();
      return out({ focused: cssPath(el) });
    }
    case 'clear': {
      const el = findCandidate(params.selector);
      if (!el) return fail('clear: element not found');
      el.focus();
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) { setNativeValue(el, ''); dispatch(el, 'input'); dispatch(el, 'change'); }
      return out({ cleared: cssPath(el) });
    }
    case 'setValue': {
      const el = findCandidate(params.selector);
      if (!el) return fail('setValue: element not found');
      el.focus();
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el.isContentEditable) {
        if (el.isContentEditable) { el.textContent = params.value; dispatch(el, 'input'); }
        else { setNativeValue(el, params.value); dispatch(el, 'input'); dispatch(el, 'change'); }
      }
      return out({ setValue: true, selector: cssPath(el) });
    }
    case 'getValue': {
      const el = findCandidate(params.selector);
      if (!el) return fail('getValue: element not found');
      return out({ value: el.value || el.textContent || '' });
    }
    case 'batch': {
      // Batching is owned by the service worker (handleCommand runs each op
      // through the fastest available path). A page-context batch could not
      // recurse into itself here — executeScript serializes this function body
      // only, so the name PAGE_EXEC does not exist inside the page.
      return out({ __error: 'batch runs in the extension worker, not the page context' });
    }
    case 'getFormData': {
      const forms = Array.from(document.forms).map(f => {
        const data = {};
        const elements = Array.from(f.elements);
        for (const el of elements) {
          if (el.name || el.id) {
            const key = el.name || el.id;
            if (el.type === 'checkbox' || el.type === 'radio') {
              data[key] = el.checked;
            } else if (el.tagName === 'SELECT') {
              data[key] = el.value;
            } else {
              data[key] = el.value;
            }
          }
        }
        return {
          action: f.action,
          method: f.method,
          id: f.id,
          name: f.name,
          data,
          fields: elements.filter(e => ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.tagName)).map(describe),
        };
      });
      return out({ forms });
    }
    case 'submitForm': {
      const el = findCandidate(params.selector);
      if (!el) return fail('submitForm: element not found');
      const form = el instanceof HTMLFormElement ? el : el.closest('form');
      if (!form) return fail('submitForm: no form found');
      form.submit();
      return out({ submitted: true });
    }
    case 'getTableData': {
      const tables = Array.from(document.querySelectorAll(params.selector || 'table'));
      const data = tables.map(table => {
        const rows = Array.from(table.querySelectorAll('tr'));
        const headers = Array.from(rows[0]?.querySelectorAll('th') || []).map(th => th.textContent?.trim() || '');
        const body = rows.slice(1).map(row => {
          const cells = Array.from(row.querySelectorAll('td'));
          if (headers.length) {
            const obj = {};
            cells.forEach((cell, i) => { obj[headers[i] || 'col' + i] = cell.textContent?.trim() || ''; });
            return obj;
          }
          return cells.map(cell => cell.textContent?.trim() || '');
        });
        return { headers, rows: body, rowCount: rows.length - 1 };
      });
      return out({ tables: data });
    }
    case 'getWebglInfo': {
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
      if (!gl) return fail('WebGL is not available on this page');
      const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
      return out({
        vendor: debugInfo ? gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR),
        renderer: debugInfo ? gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
        version: gl.getParameter(gl.VERSION),
        shadingLanguageVersion: gl.getParameter(gl.SHADING_LANGUAGE_VERSION),
        maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE),
        maxViewportDims: Array.from(gl.getParameter(gl.MAX_VIEWPORT_DIMS) || []),
      });
    }
    case 'getPageMeta': {
      const meta = {};
      document.querySelectorAll('meta').forEach(m => {
        const name = m.getAttribute('name') || m.getAttribute('property') || m.getAttribute('http-equiv');
        const content = m.getAttribute('content');
        if (name && content) meta[name] = content;
      });
      return out({
        title: document.title,
        meta,
        canonical: document.querySelector('link[rel="canonical"]')?.href || '',
        description: meta.description || meta['og:description'] || '',
        keywords: meta.keywords || '',
        author: meta.author || '',
        ogTitle: meta['og:title'] || '',
        ogImage: meta['og:image'] || '',
        ogUrl: meta['og:url'] || '',
        twitterCard: meta['twitter:card'] || '',
        viewport: meta.viewport || '',
      });
    }
    case 'getStructuredContent': {
      const headings = Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, h6')).map(h => ({
        level: parseInt(h.tagName[1]),
        text: h.textContent?.trim() || '',
        id: h.id || '',
      }));
      const images = Array.from(document.querySelectorAll('img')).slice(0, 50).map(img => ({
        src: img.src,
        alt: img.alt || '',
        title: img.title || '',
        width: img.naturalWidth,
        height: img.naturalHeight,
      }));
      const videos = Array.from(document.querySelectorAll('video, iframe[src*="youtube"], iframe[src*="vimeo"]')).slice(0, 20).map(v => ({
        tag: v.tagName.toLowerCase(),
        src: v.src || '',
        title: v.title || '',
      }));
      const lists = Array.from(document.querySelectorAll('ul, ol')).slice(0, 20).map(list => ({
        type: list.tagName.toLowerCase(),
        items: Array.from(list.querySelectorAll(':scope > li')).slice(0, 50).map(li => li.textContent?.trim() || ''),
      }));
      return out({ headings, images, videos, lists });
    }
    default: return fail('Unknown page op: ' + op);
  }
};

// ── Lifecycle ─────────────────────────────────────────────────────────────────
const ALARM_NAME = 'bridge-keepalive';
const ALARM_PERIOD_MIN = 0.5;

function ensureAlarm() {
  chrome.alarms.get(ALARM_NAME, (alarm) => {
    if (!alarm) {
      chrome.alarms.create(ALARM_NAME, { periodInMinutes: ALARM_PERIOD_MIN });
    }
  });
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm?.name !== ALARM_NAME) return;
  // A stuck CONNECTING socket blocks connect()'s early-return forever, so a
  // handshake that never completes used to wedge the bridge until Chrome
  // restarted. Replace it; otherwise just ensure we are connected.
  if (ws && ws.readyState === WebSocket.CONNECTING && connectingSince && Date.now() - connectingSince > 15000) {
    forceReconnect('handshake stalled');
    return;
  }
  if (!ws || ws.readyState !== WebSocket.OPEN) connect();
});

chrome.runtime.onStartup.addListener(() => { ensureAlarm(); connect(); });
chrome.runtime.onInstalled.addListener(() => { ensureAlarm(); connect(); });
chrome.runtime.onSuspend.addListener(() => { ensureAlarm(); });

// ── Detach helpers ────────────────────────────────────────────────────────────
// Module scope on purpose: these used to live inside the `reconnect` branch of
// the message listener, so `detach-debugger` (the popup's Emergency Stop) threw
// "not a function" on any service-worker start that had not handled `reconnect`
// first — the stop button silently did nothing.
async function detachAllDebuggedTabs() {
  try {
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
      if (!tab?.id) continue;
      await new Promise((resolve) => {
        try {
          chrome.debugger.detach({ tabId: tab.id }, () => resolve());
        } catch {
          resolve();
        }
      });
    }
  } catch {}
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // Only this extension may drive the bridge. Without this guard any other
  // installed extension could read cookies/history, run script in your pages and
  // attach the debugger by sending {type:'exec'}.
  if (sender?.id && sender.id !== chrome.runtime.id) return false;

  if (msg?.type === 'get-status') { sendResponse(status); return false; }
  if (msg?.type === 'content-script-ready') {
    status.contentScriptsReady++;
    return false;
  }
  if (msg?.type === 'reconnect') {
    connect();
    sendResponse({ ok: true });
    return false;
  }
  if (msg?.type === 'detach-debugger') {
    void detachAllDebuggedTabs();
    // Stay down: without this the close below immediately reconnected, so
    // "Emergency Stop" could never hold.
    manualClose = true;
    setConnected(false, 'detached by user');
    if (ws) { try { ws.close(); } catch {} }
    invalidateCache();
    sendResponse({ ok: true });
    return false;
  }
  if (msg?.type === 'agent:abort') {
    // Tell the host the run was aborted (goes out in whichever wire format is
    // active — a raw JSON frame on a binary socket is undecodable).
    send({
      type: 'agent:abort',
      reason: msg.reason || 'emergency-stop',
    });
    sendResponse({ ok: true });
    return false;
  }
  if (msg?.type === 'resume-bridge') {
    // Undo Emergency Stop: allow the reconnect loop to run again.
    manualClose = false;
    connect();
    sendResponse({ ok: true });
    return false;
  }
  if (msg?.type === 'exec') {
    handleCommand(msg.command, msg.params || {})
      .then(data => sendResponse({ ok: true, data }))
      .catch(err => sendResponse({ ok: false, error: String(err?.message || err) }));
    return true;
  }
  return false;
});

connect();
