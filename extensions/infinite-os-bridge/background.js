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

// ── MessagePack encoder/decoder (lightweight subset for our protocol) ───────────
const MSGPACK = {
  encode(obj) {
    const bytes = [];
    function write(val) {
      if (val === null) { bytes.push(0xc0); return; }
      if (val === undefined) { bytes.push(0xc0); return; }
      if (typeof val === 'boolean') { bytes.push(val ? 0xc3 : 0xc2); return; }
      if (typeof val === 'number') {
        if (Number.isInteger(val)) {
          if (val >= 0 && val <= 127) { bytes.push(val); return; }
          if (val >= -32 && val <= -1) { bytes.push(0xe0 | (val & 0x1f)); return; }
          if (val >= -32768 && val <= 32767) { bytes.push(0xd2, (val >> 8) & 0xff, val & 0xff); return; }
          if (val >= -2147483648 && val <= 2147483647) { bytes.push(0xd3, (val >> 24) & 0xff, (val >> 16) & 0xff, (val >> 8) & 0xff, val & 0xff); return; }
          bytes.push(0xcf); writeFloat64(val); return;
        }
        bytes.push(0xcb); writeFloat64(val); return;
      }
      if (typeof val === 'string') {
        const utf8 = new TextEncoder().encode(val);
        const len = utf8.length;
        if (len <= 31) { bytes.push(0xa0 | len); }
        else if (len <= 255) { bytes.push(0xd9, len); }
        else if (len <= 65535) { bytes.push(0xda, (len >> 8) & 0xff, len & 0xff); }
        else { bytes.push(0xdb, (len >> 24) & 0xff, (len >> 16) & 0xff, (len >> 8) & 0xff, len & 0xff); }
        bytes.push(...utf8);
        return;
      }
      if (Array.isArray(val)) {
        const len = val.length;
        if (len <= 15) { bytes.push(0x90 | len); }
        else if (len <= 65535) { bytes.push(0xdc, (len >> 8) & 0xff, len & 0xff); }
        else { bytes.push(0xdd, (len >> 24) & 0xff, (len >> 16) & 0xff, (len >> 8) & 0xff, len & 0xff); }
        for (const item of val) write(item);
        return;
      }
      if (typeof val === 'object') {
        const keys = Object.keys(val);
        const len = keys.length;
        if (len <= 15) { bytes.push(0x80 | len); }
        else if (len <= 65535) { bytes.push(0xde, (len >> 8) & 0xff, len & 0xff); }
        else { bytes.push(0xdf, (len >> 24) & 0xff, (len >> 16) & 0xff, (len >> 8) & 0xff, len & 0xff); }
        for (const key of keys) { write(key); write(val[key]); }
        return;
      }
      // Fallback to JSON
      const json = JSON.stringify(val);
      const utf8 = new TextEncoder().encode(json);
      bytes.push(0xdb, 0, 0, 0, 0, ...utf8); // placeholder, not exact
    }
    function writeFloat64(val) {
      const buf = new ArrayBuffer(8);
      new DataView(buf).setFloat64(0, val, false);
      bytes.push(...new Uint8Array(buf));
    }
    write(obj);
    return new Uint8Array(bytes);
  },

  decode(bytes) {
    let offset = 0;
    function read() {
      if (offset >= bytes.length) return undefined;
      const b = bytes[offset++];
      // nil
      if (b === 0xc0) return null;
      // boolean
      if (b === 0xc2) return false;
      if (b === 0xc3) return true;
      // positive fixint
      if ((b & 0x80) === 0x00) return b;
      // negative fixint
      if ((b & 0xe0) === 0xe0) return b - 0x100;
      // fixstr
      if ((b & 0xe0) === 0xa0) {
        const len = b & 0x1f;
        const str = new TextDecoder().decode(bytes.slice(offset, offset + len));
        offset += len;
        return str;
      }
      // fixarray
      if ((b & 0xf0) === 0x90) {
        const len = b & 0x0f;
        const arr = [];
        for (let i = 0; i < len; i++) arr.push(read());
        return arr;
      }
      // fixmap
      if ((b & 0xf0) === 0x80) {
        const len = b & 0x0f;
        const obj = {};
        for (let i = 0; i < len; i++) { const k = read(); obj[k] = read(); }
        return obj;
      }
      // str 8/16/32
      if (b === 0xd9 || b === 0xda || b === 0xdb) {
        let len = 0;
        if (b === 0xd9) len = bytes[offset++];
        else if (b === 0xda) { len = (bytes[offset] << 8) | bytes[offset + 1]; offset += 2; }
        else { len = (bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]; offset += 4; }
        const str = new TextDecoder().decode(bytes.slice(offset, offset + len));
        offset += len;
        return str;
      }
      // array 16/32
      if (b === 0xdc || b === 0xdd) {
        let len = 0;
        if (b === 0xdc) { len = (bytes[offset] << 8) | bytes[offset + 1]; offset += 2; }
        else { len = (bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]; offset += 4; }
        const arr = [];
        for (let i = 0; i < len; i++) arr.push(read());
        return arr;
      }
      // map 16/32
      if (b === 0xde || b === 0xdf) {
        let len = 0;
        if (b === 0xde) { len = (bytes[offset] << 8) | bytes[offset + 1]; offset += 2; }
        else { len = (bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]; offset += 4; }
        const obj = {};
        for (let i = 0; i < len; i++) { const k = read(); obj[k] = read(); }
        return obj;
      }
      // int 8/16/32
      if (b === 0xd0) return bytes[offset++]; // int8
      if (b === 0xd1) { const v = (bytes[offset] << 8) | bytes[offset + 1]; offset += 2; return v > 32767 ? v - 65536 : v; }
      if (b === 0xd2) { const v = (bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]; offset += 4; return v; }
      // float 32/64
      if (b === 0xca) { const buf = bytes.slice(offset, offset + 4); offset += 4; return new DataView(buf.buffer).getFloat32(0, false); }
      if (b === 0xcb) { const buf = bytes.slice(offset, offset + 8); offset += 8; return new DataView(buf.buffer).getFloat64(0, false); }
      // Fallback: try JSON
      try { return JSON.parse(new TextDecoder().decode(bytes)); } catch { return null; }
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
let connectionAttempts = 0;
let useBinaryProtocol = false;

const status = {
  connected: false,
  version: chrome.runtime.getManifest().version,
  browser: navigator.userAgent,
  extensionId: chrome.runtime.id,
  port: BRIDGE_PORT,
  hasToken: Boolean(BRIDGE_TOKEN),
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
    status.lastError = '';
    reconnectDelay = RECONNECT_BASE_MS;
    connectionAttempts = 0;
  } else if (errorText) {
    status.lastError = errorText;
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
    const url = `ws://127.0.0.1:${BRIDGE_PORT}/bridge?token=${encodeURIComponent(BRIDGE_TOKEN || '')}`;
    try {
      ws = new WebSocket(url);
      ws.binaryType = 'arraybuffer';
    } catch (e) {
      setConnected(false, String(e?.message || e));
      scheduleReconnect();
      return;
    }

    ws.onopen = () => {
      connectionAttempts = 0;
      latencyMs = 0;
      status.latencyMs = 0;
      pingPending = false;
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
      if (pingPending) { latencyMs = -1; status.latencyMs = latencyMs; }
    }, 3000);
  }, KEEPALIVE_INTERVAL_MS);
}
function stopKeepalive() {
  if (keepaliveTimer) { clearInterval(keepaliveTimer); keepaliveTimer = null; }
}

// ── Incoming message handling ─────────────────────────────────────────────────
async function handleIncoming(msg) {
  if (msg?.type === 'pong-server') {
    pingPending = false;
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
async function handleCommand(command, params) {
  // Fast-path: cached commands
  if (CACHEABLE.has(command)) {
    const key = cacheKey(command, params);
    const cached = cacheGet(key);
    if (cached) return cached;
  }

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
      result = await screenshotActiveTab();
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

    case 'cookie_get': {
      const cookies = await chrome.cookies.getAll({ url: params.url || '', name: params.name });
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
      const [active] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      if (!active) throw new Error('No active tab');
      await chrome.tabs.highlightText(active.id, { text: params.text });
      result = { found: true, text: params.text };
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
      try {
        const canvas = document.createElement('canvas');
        const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
        if (!gl) {
          result = { error: 'WebGL not available' };
          break;
        }
        const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
        result = {
          vendor: debugInfo ? gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR),
          renderer: debugInfo ? gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
          version: gl.getParameter(gl.VERSION),
          shadingLanguageVersion: gl.getParameter(gl.SHADING_LANGUAGE_VERSION),
          maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE),
          maxViewportDims: gl.getParameter(gl.MAX_VIEWPORT_DIMS),
        };
      } catch {
        result = { error: 'WebGL info not available' };
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
async function contentScriptOp(op, params) {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab?.id) throw new Error('No active tab available');
  if (!/^(https?|file):/.test(String(tab.url || ''))) throw new Error(`Cannot automate protected page: ${tab.url}`);

  // Try content script first (fastest path)
  try {
    const response = await chrome.tabs.sendMessage(tab.id, {
      type: 'bridge-content-op',
      op,
      params,
    });
    if (response?.ok) return response.data;
    if (response?.error) throw new Error(response.error);
  } catch {
    // Content script not injected — fall back to script injection
  }

  // Fallback: inject PAGE_EXEC via scripting API
  return pageOp(op, params);
}

// ── Page automation helpers (fallback — script injection) ──────────────────────
async function pageOp(op, params) {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab?.id) throw new Error('No active tab available');
  if (!/^(https?|file):/.test(String(tab.url || ''))) throw new Error(`Cannot automate protected page: ${tab.url}`);
  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id, allFrames: false },
    func: PAGE_EXEC,
    args: [op, params],
  });
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

async function screenshotActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab) throw new Error('No active tab');
  if (!/^(https?|file):/.test(String(tab.url || ''))) throw new Error(`Cannot capture: ${tab.url}`);
  const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'jpeg', quality: 80 });
  return { base64: dataUrl.replace(/^data:image\/jpeg;base64,/, ''), format: 'jpeg' };
}

async function runInPage(code) {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab?.id) throw new Error('No active tab available');
  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: (src) => {
      const clone = (v) => {
        try { return JSON.parse(JSON.stringify(v)); }
        catch { return typeof v === 'string' ? v.slice(0, 200000) : { __unserializable: typeof v }; }
      };
      try { return { ok: true, value: clone(new Function(src)()) }; }
      catch (e) { return { ok: false, error: String(e?.message || e) }; }
    },
    args: [code],
  });
  return results?.[0]?.result || { ok: false, error: 'no result' };
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
      const ops = (params.ops || []);
      const results = [];
      for (const item of ops) {
        if (item && typeof item.op === 'string') {
          try { results.push({ op: item.op, ...PAGE_EXEC(item.op, item.params || {}) }); }
          catch (e) { results.push({ op: item.op, __error: String(e?.message || e) }); }
        }
      }
      return out({ results });
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
  if (!ws || ws.readyState !== WebSocket.OPEN) connect();
});

chrome.runtime.onStartup.addListener(() => { ensureAlarm(); connect(); });
chrome.runtime.onInstalled.addListener(() => { ensureAlarm(); connect(); });
chrome.runtime.onSuspend.addListener(() => { ensureAlarm(); });

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
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
  if (msg?.type === 'exec') {
    handleCommand(msg.command, msg.params || {})
      .then(data => sendResponse({ ok: true, data }))
      .catch(err => sendResponse({ ok: false, error: String(err?.message || err) }));
    return true;
  }
  return false;
});

connect();
