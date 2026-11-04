// PC Live Map — collector server v6 (zero dependencies, Node 20+).
// Infinite OS future-grade tool: screenshot-free eyes + hands, vectors always.
// Serves pc-live-map.html + live OS state + SSE bridge + AI live JSON + action queue.
// v6: focused.value + element value surfaces, health v6, virtual screen aware, stable dedup.
// Run: node pc-live-map/collector-server.js  (then open http://localhost:3799)
// Or one click: powershell -ExecutionPolicy Bypass -File pc-live-map\Start-LiveMap.ps1
// Tracker: powershell -ExecutionPolicy Bypass -File pc-live-map\tracker.ps1
// Executor: powershell -ExecutionPolicy Bypass -File pc-live-map\executor.ps1
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3799);
const ROOT = path.join(__dirname, '..');
const clients = new Set();

function sysState() {
  const cpus = os.cpus();
  const total = os.totalmem(), free = os.freemem();
  return {
    t: new Date().toISOString(),
    host: os.hostname(), platform: os.platform(), release: os.release(),
    cpu_cores: cpus.length, cpu_model: cpus[0] ? cpus[0].model : 'unknown',
    ram_total_gb: +(total / 1e9).toFixed(1), ram_used_pct: Math.round((1 - free / total) * 100),
    uptime_s: Math.round(os.uptime()),
  };
}

// Tail the PowerShell tracker JSONL (if running) and rebroadcast over SSE.
// v4 lines carry cursor + clicks + idle + window rect + ALL windows + UIA + focused + clipboard + seq.
const TAIL_FILE = path.join(ROOT, 'pc-live-map-events.jsonl');
const ACTION_FILE = path.join(ROOT, 'pc-actions.jsonl');
let tailSize = 0;
let latestOS = null;
let lastSentLine = '';
let lastUpdateMs = 0;

// --- change timeline --------------------------------------------------------
// The snapshot says what the screen looks like now. This says what HAPPENED
// since the AI last looked, which is what makes it a video rather than a photo.
//
// Without it the agent re-reads the whole element list every turn to work out
// whether anything moved. That is slow, costs a lot of tokens, and is often
// wrong: in a snapshot, "nothing changed" and "changed and changed back" look
// identical.
//
// Bounded, because this is a log of activity and must not grow without limit
// while the tracker runs unattended.
const CHANGELOG_MAX = 400;
let changeLog = [];
let changeSeq = 0;
setInterval(() => {
  try {
    if (!fs.existsSync(TAIL_FILE)) return;
    const st = fs.statSync(TAIL_FILE);
    if (st.size < tailSize) { tailSize = 0; lastSentLine = ''; } // rotated
    if (st.size > tailSize) {
      const fd = fs.openSync(TAIL_FILE, 'r');
      const buf = Buffer.alloc(st.size - tailSize);
      fs.readSync(fd, buf, 0, buf.length, tailSize);
      fs.closeSync(fd);
      tailSize = st.size;
      // FIX v4: only broadcast genuinely NEW lines (v3 re-sent last 3 -> duplicates in UI)
      const lines = buf.toString('utf8').split('\n').filter(Boolean);
      for (const line of lines) {
        if (line === lastSentLine) continue;
        lastSentLine = line;
        try { latestOS = JSON.parse(line); lastUpdateMs = Date.now(); } catch {}
        // Record what changed, tagged with the tracker's own seq so the agent
        // can ask "what happened after the thing I saw" precisely.
        try {
          const parsed = JSON.parse(line);
          const changes = Array.isArray(parsed.chg) ? parsed.chg : [];
          if (changes.length) {
            changeLog.push({
              id: ++changeSeq,
              t: parsed.t || new Date().toISOString(),
              os_seq: parsed.seq || 0,
              changes,
              where: (parsed.proc || 'unknown') + ' :: ' + (parsed.win || ''),
            });
            if (changeLog.length > CHANGELOG_MAX) changeLog = changeLog.slice(-CHANGELOG_MAX);
          }
        } catch {}
        const payload = 'data: ' + line + '\n\n';
        for (const res of clients) { try { res.write(payload); } catch {} }
      }
    }
  } catch { /* tracker not running — browser-only mode still works */ }
}, 400);

// Heartbeat so EventSource stays alive + carries sys state.
setInterval(() => {
  const payload = 'data: ' + JSON.stringify({ msg: 'sys ' + sysState().ram_used_pct + '% ram', sys: sysState() }) + '\n\n';
  for (const res of clients) { try { res.write(payload); } catch {} }
}, 5000);

function rotateIfNeeded(p, maxBytes) {
  try {
    if (fs.existsSync(p) && fs.statSync(p).size > maxBytes) {
      fs.renameSync(p, p + '.bak');
      if (p === TAIL_FILE) { tailSize = 0; lastSentLine = ''; }
    }
  } catch {}
}

// Compile the screenshot-free AI state: everything on screen as ~500-950 tokens.
// v6 includes element value + focused value so AI can read inputs without screenshots.
function aiLive() {
  const o = latestOS;
  const sys = sysState();
  if (!o) {
    return {
      v: 6, t: new Date().toISOString(), mode: 'browser-only',
      hint: 'start tracker.ps1 v6 for full OS truth (cursor+windows+UIA+values+idle+clipboard)',
      sys,
      mouse: null, os: null,
      tokens_est: 120,
      actions: 'POST /api/action {type:click,x_norm,y_norm} | {type:click_name,name} | {type:move,x_norm,y_norm} | {type:doubleclick,x_norm,y_norm} | {type:drag,x1_norm,y1_norm,x2_norm,y2_norm} | {type:type,text} | {type:keys,keys:"^s"} | {type:scroll,amount} | {type:wait,ms} | {type:focus,proc}',
    };
  }
  const els = (o.elements || []).slice(0, 50).map((e) => ({ r: e.role, n: (e.name || '').slice(0, 32), v: (e.value || '').slice(0, 40), x: e.x, y: e.y, w: e.w, h: e.h }));
  const wins = (o.tops || []).slice(0, 20);
  const json = {
    v: 6, t: o.t || new Date().toISOString(), mode: 'os-live',
    seq: o.seq || 0,
    screen: o.screen || o.vscreen || null,
    mouse: { x: o.x, y: o.y, xn: o.xn, yn: o.yn, clicks: o.clicks || null, idle_ms: o.idle_ms || 0 },
    fg: { proc: o.proc, win: o.win, pid: o.pid, rect_norm: o.rect_norm || [], max: !!o.max },
    windows: wins,
    elements: els,
    focused: o.focused || null,
    clip_preview: (o.clip || '').slice(0, 120),
    msg: o.msg || '',
    sys: { ram_used_pct: sys.ram_used_pct, uptime_s: sys.uptime_s },
  };
  json.tokens_est = Math.round(JSON.stringify(json).length / 4);
  json.stale_ms = lastUpdateMs ? Date.now() - lastUpdateMs : 999999;
  json.act = 'POST /api/action to click/type without screenshots. coords are norm 0-1000. click_name resolves a UIA name to coords server-side. Prefer click_name.';
  return json;
}

function readBody(req) {
  return new Promise((resolve) => {
    let b = '';
    req.on('data', (c) => { b += c; if (b.length > 20000) { try { req.destroy(); } catch {} } });
    req.on('end', () => resolve(b));
  });
}

const ALLOWED_TYPES = new Set(['click', 'move', 'doubleclick', 'scroll', 'type', 'keys', 'drag', 'wait', 'click_name', 'focus']);
const clampN = (v) => (Number.isFinite(+v) ? Math.min(1000, Math.max(0, Math.round(+v))) : null);
// Sliding-window rate limit: 30 actions / 10s (executor runs ~3/s, bursts OK, floods get 429)
const actionTimes = [];
function rateLimited() {
  const now = Date.now();
  while (actionTimes.length && now - actionTimes[0] > 10000) actionTimes.shift();
  if (actionTimes.length >= 30) return true;
  actionTimes.push(now);
  return false;
}

function findByName(name, role) {
  const els = (latestOS && latestOS.elements) || [];
  const q = String(name || '').toLowerCase().trim();
  if (!q) return null;
  const scored = [];
  for (const e of els) {
    const n = String(e.name || '').toLowerCase();
    if (!n) continue;
    if (role && String(e.role || '').toLowerCase() !== String(role).toLowerCase()) continue;
    if (n === q) scored.push({ e, s: 0 });
    else if (n.startsWith(q)) scored.push({ e, s: 1 });
    else if (n.includes(q)) scored.push({ e, s: 2 });
  }
  scored.sort((a, b) => a.s - b.s);
  return scored.length ? scored[0].e : null;
}

function validateAction(a) {
  if (!a || typeof a !== 'object') return 'body must be a JSON object';
  if (!a.type || !ALLOWED_TYPES.has(a.type)) return 'missing/invalid type (click|move|doubleclick|scroll|type|keys|drag|wait|click_name|focus)';
  if (['click', 'move', 'doubleclick'].includes(a.type)) {
    if (clampN(a.x_norm) === null || clampN(a.y_norm) === null) return 'x_norm/y_norm must be 0-1000';
    a.x_norm = clampN(a.x_norm); a.y_norm = clampN(a.y_norm);
    if (a.button && !['left', 'right'].includes(a.button)) return 'button must be left|right';
  }
  if (a.type === 'drag') {
    for (const k of ['x1_norm', 'y1_norm', 'x2_norm', 'y2_norm']) {
      if (clampN(a[k]) === null) return k + ' must be 0-1000';
      a[k] = clampN(a[k]);
    }
  }
  if (a.type === 'scroll') {
    a.amount = Number.isFinite(+a.amount) ? Math.min(1200, Math.max(-1200, Math.round(+a.amount))) : 120;
  }
  if (a.type === 'type') {
    if (typeof a.text !== 'string' || !a.text.length) return 'text must be a non-empty string';
    if (a.text.length > 500) a.text = a.text.slice(0, 500);
  }
  if (a.type === 'keys') {
    if (typeof a.keys !== 'string' || !a.keys.length) return 'keys must be a non-empty SendKeys string';
    if (a.keys.length > 64) return 'keys max 64 chars';
    // eslint-disable-next-line no-control-regex
    if (/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(a.keys)) return 'keys contains control characters';
  }
  if (a.type === 'wait') {
    a.ms = Number.isFinite(+a.ms) ? Math.min(10000, Math.max(50, Math.round(+a.ms))) : 500;
  }
  if (a.type === 'click_name') {
    if (typeof a.name !== 'string' || !a.name.trim()) return 'name must be a non-empty UIA element name';
    a.name = a.name.slice(0, 60);
    const hit = findByName(a.name, a.role);
    if (!hit) return 'no UIA element matching "' + a.name + '" (GET /api/elements?q= to list)';
    a._resolved = { x_norm: hit.x + Math.round((hit.w || 4) / 2), y_norm: hit.y + Math.round((hit.h || 4) / 2), role: hit.role, matched: hit.name };
  }
  if (a.type === 'focus') {
    if (typeof a.proc !== 'string' || !a.proc.trim()) return 'proc must be a process name to focus';
    a.proc = a.proc.slice(0, 40);
  }
  return null;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };
  if (req.method === 'OPTIONS') { res.writeHead(204, cors); res.end(); return; }
  if (url.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json', ...cors });
    const staleMs = lastUpdateMs ? Date.now() - lastUpdateMs : 999999;
    res.end(JSON.stringify({ ok: true, v: 6, tracker: !!latestOS, stale_ms: staleMs, seq: (latestOS && latestOS.seq) || 0, mode: latestOS ? 'os-live' : 'browser-only', clients: clients.size, time: new Date().toISOString(), hint: latestOS ? 'vectors live' : 'run tracker.ps1 v6' }));
    return;
  }
  if (url.pathname === '/events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', ...cors });
    res.write(': connected v6\n\n');
    clients.add(res);
    const drop = () => clients.delete(res);
    req.on('close', drop); res.on('close', drop);
    return;
  }
  if (url.pathname === '/api/state') {
    res.writeHead(200, { 'Content-Type': 'application/json', ...cors });
    res.end(JSON.stringify({ ...sysState(), os: latestOS }));
    return;
  }
  if (url.pathname === '/api/os') {
    res.writeHead(200, { 'Content-Type': 'application/json', ...cors });
    res.end(JSON.stringify(latestOS || { waiting: true, hint: 'start tracker.ps1 v6 from the repo root: powershell -ExecutionPolicy Bypass -File pc-live-map/tracker.ps1' }));
    return;
  }
  if (url.pathname === '/api/live') {
    res.writeHead(200, { 'Content-Type': 'application/json', ...cors });
    res.end(JSON.stringify(aiLive()));
    return;
  }
  if (url.pathname === '/api/changes') {
    // "What happened since change id N" — the timeline the agent asks for
    // between turns. `since` is a change id, not a wall-clock time, because an
    // id is exact and a clock reading is not.
    const since = Number(url.searchParams.get('since') || 0);
    const after = Number.isFinite(since) ? changeLog.filter((c) => c.id > since) : changeLog;
    const newest = changeLog.length ? changeLog[changeLog.length - 1].id : 0;
    res.writeHead(200, { 'Content-Type': 'application/json', ...cors });
    res.end(JSON.stringify({
      since,
      newest,
      // When the buffer has already rolled past what was asked for, say so
      // instead of returning a partial history that looks complete. An agent
      // that believes it has seen everything would silently miss events.
      gap: Number.isFinite(since) && since > 0 && newest > 0 && changeLog.length > 0 && changeLog[0].id > since + 1,
      count: after.length,
      changes: after,
      hint: 'Pass the returned `newest` as `since` next time.',
    }));
    return;
  }
  if (url.pathname === '/api/elements') {
    const q = (url.searchParams.get('q') || '').toLowerCase();
    const els = ((latestOS && latestOS.elements) || []).filter((e) => !q || String(e.name || '').toLowerCase().includes(q)).slice(0, 50);
    res.writeHead(200, { 'Content-Type': 'application/json', ...cors });
    res.end(JSON.stringify({ count: els.length, elements: els }));
    return;
  }
  if (url.pathname === '/api/action' && req.method === 'POST') {
    try {
      if (rateLimited()) {
        res.writeHead(429, { 'Content-Type': 'application/json', ...cors });
        res.end(JSON.stringify({ ok: false, error: 'rate limited: max 30 actions / 10s' }));
        return;
      }
      const body = await readBody(req);
      let a;
      try { a = JSON.parse(body); } catch { throw new Error('invalid JSON body'); }
      const err = validateAction(a);
      if (err) throw new Error(err);
      // click_name is resolved server-side so the model never computes coords
      if (a.type === 'click_name' && a._resolved) {
        const r = a._resolved;
        delete a._resolved;
        a.type = 'click';
        a.x_norm = Math.min(1000, Math.max(0, r.x_norm));
        a.y_norm = Math.min(1000, Math.max(0, r.y_norm));
        a.via = 'click_name:' + r.matched;
      }
      rotateIfNeeded(ACTION_FILE, 2 * 1024 * 1024);
      const rec = { t: new Date().toISOString(), ...a };
      fs.appendFileSync(ACTION_FILE, JSON.stringify(rec) + '\n', 'utf8');
      const payload = 'data: ' + JSON.stringify({ action_queued: rec }) + '\n\n';
      for (const c of clients) { try { c.write(payload); } catch {} }
      res.writeHead(200, { 'Content-Type': 'application/json', ...cors });
      res.end(JSON.stringify({ ok: true, queued: rec }));
    } catch (e) {
      res.writeHead(400, { 'Content-Type': 'application/json', ...cors });
      res.end(JSON.stringify({ ok: false, error: String(e.message || e) }));
    }
    return;
  }
  if (url.pathname === '/api/actions') {
    let lines = [];
    try {
      if (fs.existsSync(ACTION_FILE)) lines = fs.readFileSync(ACTION_FILE, 'utf8').split('\n').filter(Boolean).slice(-20);
    } catch {}
    res.writeHead(200, { 'Content-Type': 'application/json', ...cors });
    res.end(JSON.stringify({ actions: lines.map((l) => { try { return JSON.parse(l); } catch { return { raw: l }; } }) }));
    return;
  }
  // v6: Infinite OS tool manifest — lets AI agents discover this tool with one fetch.
  if (url.pathname === '/tool.json') {
    const manifestPath = path.join(__dirname, 'infinite-tool.json');
    try {
      const raw = fs.readFileSync(manifestPath, 'utf8');
      res.writeHead(200, { 'Content-Type': 'application/json', ...cors });
      res.end(raw);
    } catch {
      res.writeHead(404, { 'Content-Type': 'application/json', ...cors });
      res.end(JSON.stringify({ ok: false, error: 'infinite-tool.json not found' }));
    }
    return;
  }
  // v6: one-fetch agent entry — condensed instructions + live state + element index (with values).
  // Infinite AI should GET this first instead of screenshotting. Vectors ALWAYS, screenshot only when vectors cannot see.
  if (url.pathname === '/api/agent') {
    const state = aiLive();
    const els = ((latestOS && latestOS.elements) || []).slice(0, 30).map((e) => String(e.name || '').slice(0, 32)).filter(Boolean);
    const focusedLine = latestOS && latestOS.focused ? `${latestOS.focused.role || ''}:${(latestOS.focused.name || '').slice(0, 32)}${latestOS.focused.value ? ` value="${String(latestOS.focused.value).slice(0, 40)}"` : ''}` : 'none';
    res.writeHead(200, { 'Content-Type': 'application/json', ...cors });
    res.end(JSON.stringify({
      tool: 'pc-live-map',
      v: 6,
      rule: 'Read this state before acting on screen. NEVER screenshot while mode=os-live. Prefer click_name (no coords). Coords are norm 0-1000 both axes. Vectors ALWAYS — screenshot ONLY when vectors cannot see (canvas/game/scanned PDF with no UIA names).',
      loop: ['GET /api/agent observe', 'POST /api/action act once (click_name preferred)', 'GET /api/live verify seq advanced', 'repeat'],
      actions_doc: 'POST /api/action {type:click_name,name} | {type:click,x_norm,y_norm} | {type:move,x_norm,y_norm} | {type:drag,x1_norm,y1_norm,x2_norm,y2_norm} | {type:type,text} | {type:keys,keys:"^s"} | {type:scroll,amount} | {type:wait,ms} | {type:focus,proc}',
      fallback: 'Screenshot ONLY when zone=unknown or text is inside canvas/game/scanned PDF with no UIA names — say why in one line.',
      element_names: els,
      focused: focusedLine,
      state,
    }));
    return;
  }
  // static: serve pc-live-map.html at / and ../ files
  let file = url.pathname === '/' ? '/pc-live-map.html' : decodeURIComponent(url.pathname);
  if (file.includes('\0')) { res.writeHead(400); res.end('bad path'); return; }
  const safe = path.normalize(path.join(ROOT, file));
  if (!safe.startsWith(ROOT) || !fs.existsSync(safe) || fs.statSync(safe).isDirectory()) {
    res.writeHead(404); res.end('not found'); return;
  }
  const ext = path.extname(safe).toLowerCase();
  const type = ext === '.html' ? 'text/html; charset=utf-8' : ext === '.js' ? 'text/javascript; charset=utf-8' : ext === '.json' ? 'application/json; charset=utf-8' : ext === '.ps1' ? 'text/plain; charset=utf-8' : 'text/plain; charset=utf-8';
  res.writeHead(200, { 'Content-Type': type });
  fs.createReadStream(safe).pipe(res);
});

server.listen(PORT, () => console.log('PC Live Map collector v6 on http://localhost:' + PORT + '  (/events SSE, /api/agent AI entry, /api/live AI JSON, /api/action POST, /tool.json manifest, /health)'));
