import type { Tool, ToolResult } from './base.js';

const BASE = process.env.PC_LIVE_MAP || 'http://localhost:3799';
const TIMEOUT_MS = 3500;

async function fetchJson(path: string, init?: RequestInit): Promise<{ ok: boolean; status: number; json: unknown; text: string }> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(BASE.replace(/\/$/, '') + path, { ...init, signal: ctrl.signal } as RequestInit);
    const text = await r.text();
    let json: unknown = null;
    try { json = JSON.parse(text); } catch { /* text */ }
    return { ok: r.ok, status: r.status, json, text };
  } finally { clearTimeout(t); }
}

function bad(msg: string, hint?: string): ToolResult {
  return { content: hint ? `${msg}\n\nHint: ${hint}` : msg, is_error: true };
}
function ok(msg: string): ToolResult { return { content: msg }; }
function pretty(v: unknown): string { try { return JSON.stringify(v, null, 2); } catch { return String(v); } }

export const pcLiveMapTool: Tool = {
  name: 'PCLiveMap',
  description:
    'PC Live Map — screenshot-free eyes + hands: live vectors of all windows, 50 UIA elements WITH values, clipboard, idle. ACT via click_name/click/drag/scroll/type/keys/wait/focus (norm 0-1000). ALWAYS prefer over Computer screenshots: 13-15x cheaper, 50x faster, works with text-only models. Use live/agent before acting; verify seq advanced. Screenshot fallback only when vectors cannot see (canvas/game/scanned PDF) — say why.',
  inputSchema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['status', 'live', 'agent', 'elements', 'health', 'events', 'click', 'click_name', 'move', 'doubleclick', 'drag', 'scroll', 'type', 'keys', 'wait', 'focus', 'start'],
        description: 'What to do. observe: status|live|agent. search: elements. act: click|click_name|move|doubleclick|drag|scroll|type|keys|wait|focus. start: auto-launch bridge+tracker. health/events for diagnostics.',
      },
      q: { type: 'string', description: 'Search query for elements (action=elements), substring of UIA name.' },
      name: { type: 'string', description: 'UIA element name to click (action=click_name), e.g. Save' },
      role: { type: 'string', description: 'Optional UIA role filter for click_name, e.g. Button' },
      x_norm: { type: 'number', description: 'Norm X 0-1000 (actions click/move/doubleclick)' },
      y_norm: { type: 'number', description: 'Norm Y 0-1000' },
      x1_norm: { type: 'number', description: 'Drag start X 0-1000' },
      y1_norm: { type: 'number', description: 'Drag start Y 0-1000' },
      x2_norm: { type: 'number', description: 'Drag end X 0-1000' },
      y2_norm: { type: 'number', description: 'Drag end Y 0-1000' },
      amount: { type: 'number', description: 'Scroll amount (-1200..1200, default 120)' },
      text: { type: 'string', description: 'Text to type (action=type) or keys string (action=keys). keys: ^s=ctrl+s, %{F4}=alt+F4, {ENTER}, {TAB}.' },
      keys: { type: 'string', description: 'SendKeys string for action=keys' },
      proc: { type: 'string', description: 'Process name for action=focus' },
      ms: { type: 'number', description: 'Wait milliseconds for action=wait (50-10000)' },
      button: { type: 'string', enum: ['left', 'right'], description: 'Mouse button for click' },
    },
    required: ['action'],
  },
  permission: 'allow',
  async execute(args, ctx): Promise<ToolResult> {
    const a = args as Record<string, unknown>;
    const action = String(a.action || '').toLowerCase();
    const baseHint = 'Is the Live Map running? One-click: powershell -ExecutionPolicy Bypass -File "Infinite OS/pc-live-map/Start-LiveMap.ps1"  (from Infinite OS repo root)  or  PCLiveMap action=start  to auto-launch. Manual: node "Infinite OS/pc-live-map/collector-server.js" + powershell -File "Infinite OS/pc-live-map/tracker.ps1" + powershell -File "Infinite OS/pc-live-map/executor.ps1". Bridge: http://localhost:3799/health';
    // Claude Code-style live narration: stream a brief intent before the fetch so the user sees "eyes opening" instantly
    const liveActions = new Set(['live', 'agent', 'elements', 'health', 'status', 'events', 'start']);
    const actLabels: Record<string, string> = { live: 'Reading live vectors (no screenshot)…', agent: 'Reading agent entry + live vectors…', elements: 'Searching UIA elements…', health: 'Checking health…', status: 'Checking health…', events: 'Reading last actions…', start: 'Starting Live Map bridge…' };
    if (liveActions.has(action) && ctx?.onUpdate) ctx.onUpdate({ content: actLabels[action] || `PCLiveMap ${action}…` });
    const clickLabels: Record<string, string> = { click: 'Clicking…', click_name: `Clicking "${String(a.name || '').slice(0, 30)}"…`, move: 'Moving cursor…', doubleclick: 'Double-clicking…', drag: 'Dragging…', scroll: 'Scrolling…', type: `Typing ${String(a.text || '').slice(0, 20)}…`, keys: `Pressing keys ${String(a.keys || a.text || '').slice(0, 16)}…`, wait: 'Waiting…', focus: `Focusing ${String(a.proc || '').slice(0, 20)}…` };
    if (!liveActions.has(action) && ctx?.onUpdate && clickLabels[action]) ctx.onUpdate({ content: clickLabels[action] });

    // ---- START (self-healing: try to launch bridge if down) ----
    if (action === 'start') {
      try {
        const h = await fetchJson('/health');
        if (h.ok) {
          const j = h.json as Record<string, unknown>;
          return ok(`PCLiveMap already live: v=${j.v} tracker=${j.tracker ? 'live' : 'waiting'} mode=${j.mode || '?'} stale_ms=${(j as Record<string, unknown>).stale_ms ?? '?'} seq=${(j as Record<string, unknown>).seq ?? '?'}\nNo restart needed — use live/agent next.`);
        }
      } catch { /* bridge down — try to launch */ }
      try {
        const { spawn } = await import('node:child_process');
        const { join, dirname } = await import('node:path');
        const { fileURLToPath } = await import('node:url');
        const here = dirname(fileURLToPath(import.meta.url));
        // src/main/tools -> repo root -> Infinite OS/pc-live-map/collector-server.js
        const repoRoot = join(here, '..', '..', '..');
        const collector = join(repoRoot, 'Infinite OS', 'pc-live-map', 'collector-server.js');
        const { existsSync } = await import('node:fs');
        if (!existsSync(collector)) return bad(`PCLiveMap collector not found at ${collector}. ${baseHint}`);
        const nodeExe = process.execPath;
        const child = spawn(nodeExe, [collector], { cwd: join(repoRoot, 'Infinite OS'), detached: true, stdio: 'ignore', windowsHide: true, env: { ...process.env, PORT: '3799' } });
        child.unref?.();
        await new Promise((r) => setTimeout(r, 1200));
        const verify = await fetchJson('/health').catch(() => null);
        if (verify?.ok) {
          const j = verify.json as Record<string, unknown>;
          return ok(`PCLiveMap bridge auto-started at ${BASE} (v=${j.v} tracker=${j.tracker ? 'live' : 'waiting'}). Next: PCLiveMap action=live. If tracker=waiting, also start eyes: powershell -ExecutionPolicy Bypass -File "Infinite OS/pc-live-map/tracker.ps1"`);
        }
        return bad(`PCLiveMap bridge launched but /health still unreachable at ${BASE}.`, baseHint);
      } catch (e) { return bad(`PCLiveMap auto-start failed: ${(e as Error).message}`, baseHint); }
    }

    // ---- OBSERVE ----
    if (action === 'status' || action === 'health') {
      try {
        const r = await fetchJson('/health');
        if (!r.ok) return bad(`PCLiveMap /health failed (${r.status}): ${r.text.slice(0, 400)}`, baseHint);
        const j = r.json as Record<string, unknown>;
        const stale = (j.stale_ms as number | undefined) ?? 999999;
        const seq = (j.seq as number | undefined) ?? 0;
        const mode = (j.mode as string | undefined) || (j.tracker ? 'os-live' : 'browser-only');
        const tracker = j.tracker ? `live (os-live, seq=${seq}, stale=${stale}ms)` : 'waiting (browser-only) — start tracker.ps1 for full OS vectors';
        return ok(`PCLiveMap health: ok=${j.ok} v=${j.v} tracker=${tracker} mode=${mode} clients=${j.clients}\nBase: ${BASE}\n\nRule: if tracker is live, NEVER screenshot — use live/agent + click_name.\nIf waiting, vectors are browser-only estimates. Try PCLiveMap action=start to auto-launch bridge.`);
      } catch (e) { return bad(`PCLiveMap unreachable at ${BASE}/health: ${(e as Error).message}`, baseHint); }
    }
    if (action === 'live') {
      try {
        const r = await fetchJson('/api/live');
        if (!r.ok) return bad(`PCLiveMap /api/live failed (${r.status}): ${r.text.slice(0, 600)}`, baseHint);
        const j = r.json as Record<string, unknown>;
        const seq = (j as Record<string, unknown>).seq ?? '?';
        const mode = (j as Record<string, unknown>).mode ?? '?';
        const stale = (j as Record<string, unknown>).stale_ms ?? '?';
        return ok(`PCLiveMap LIVE state (vectors, no screenshot) mode=${mode} seq=${seq} stale_ms=${stale}:\n${pretty(j)}\n\nNext: act with click_name (no coords) or click/move with norm 0-1000. Verify by calling live again and checking seq advanced.`);
      } catch (e) { return bad(`PCLiveMap unreachable at ${BASE}/api/live: ${(e as Error).message}`, baseHint); }
    }
    if (action === 'agent') {
      try {
        const r = await fetchJson('/api/agent');
        if (!r.ok) return bad(`PCLiveMap /api/agent failed (${r.status}): ${r.text.slice(0, 600)}`, baseHint);
        return ok(`PCLiveMap AGENT entry (one fetch = instructions + live state + element index):\n${pretty(r.json)}`);
      } catch (e) { return bad(`PCLiveMap unreachable at ${BASE}/api/agent: ${(e as Error).message}`, baseHint); }
    }
    if (action === 'elements') {
      const q = String(a.q ?? '');
      try {
        const r = await fetchJson('/api/elements?q=' + encodeURIComponent(q));
        if (!r.ok) return bad(`PCLiveMap /api/elements failed (${r.status}): ${r.text.slice(0, 400)}`, baseHint);
        const j = r.json as { count: number; elements: unknown[] };
        if (!j.elements?.length) return ok(`No UIA elements matching "${q}". Try broader query or call live to see all 50. Tip: use click_name with substring — server does prefix/contains matching.`);
        return ok(`PCLiveMap elements matching "${q}" (${j.count}):\n${pretty(j.elements)}\n\nEach has x,y,w,h norm 0-1000. Prefer click_name; or compute center: x_norm=x+w/2, y_norm=y+h/2.`);
      } catch (e) { return bad(`PCLiveMap unreachable at ${BASE}/api/elements: ${(e as Error).message}`, baseHint); }
    }
    if (action === 'events') {
      // Last 20 actions for debug
      try {
        const r = await fetchJson('/api/actions');
        if (!r.ok) return bad(`PCLiveMap /api/actions failed (${r.status}): ${r.text.slice(0, 400)}`, baseHint);
        return ok(`PCLiveMap last actions:\n${pretty(r.json)}`);
      } catch (e) { return bad(`PCLiveMap unreachable: ${(e as Error).message}`, baseHint); }
    }

    // ---- ACT ----
    const actMap: Record<string, Record<string, unknown>> = {
      click: { type: 'click', x_norm: a.x_norm, y_norm: a.y_norm, ...(a.button ? { button: a.button } : {}) },
      move: { type: 'move', x_norm: a.x_norm, y_norm: a.y_norm },
      doubleclick: { type: 'doubleclick', x_norm: a.x_norm, y_norm: a.y_norm },
      drag: { type: 'drag', x1_norm: a.x1_norm, y1_norm: a.y1_norm, x2_norm: a.x2_norm, y2_norm: a.y2_norm },
      scroll: { type: 'scroll', amount: a.amount ?? 120 },
      type: { type: 'type', text: a.text },
      keys: { type: 'keys', keys: a.keys ?? a.text },
      wait: { type: 'wait', ms: a.ms ?? 500 },
      focus: { type: 'focus', proc: a.proc },
      click_name: { type: 'click_name', name: a.name, ...(a.role ? { role: a.role } : {}) },
    };
    const payload = actMap[action];
    if (!payload) return bad(`Unknown PCLiveMap action: ${action}. Use status|live|agent|elements|click|click_name|move|doubleclick|drag|scroll|type|keys|wait|focus|start.`);
    // Minimal validation (coords ALWAYS norm 0-1000 both axes)
    const inRange = (v: unknown) => Number.isFinite(+String(v)) && +String(v) >= 0 && +String(v) <= 1000;
    if (payload.type === 'click_name' && !String(payload.name || '').trim()) return bad('click_name requires name (UIA element name, e.g. Save). Try elements action first: PCLiveMap action=elements q=save');
    if (['click', 'move', 'doubleclick'].includes(String(payload.type)) && (payload.x_norm == null || payload.y_norm == null)) return bad(`${payload.type} requires x_norm and y_norm (0-1000 both axes). Got ${pretty(payload)}`);
    if (['click', 'move', 'doubleclick'].includes(String(payload.type)) && (!inRange(payload.x_norm) || !inRange(payload.y_norm))) return bad(`${payload.type} coords must be 0-1000 both axes. Got x=${payload.x_norm} y=${payload.y_norm}. Use elements to list valid x,y,w,h.`);
    if (payload.type === 'drag' && (payload.x1_norm == null || payload.y1_norm == null || payload.x2_norm == null || payload.y2_norm == null)) return bad('drag requires x1_norm,y1_norm,x2_norm,y2_norm (0-1000)');
    if (payload.type === 'type' && !String(payload.text || '').length) return bad('type requires text');
    if (payload.type === 'type' && String(payload.text || '').length > 500) return bad('type max 500 chars (paste via clipboard). Split longer text into chunks.');
    if (payload.type === 'keys' && !String(payload.keys || '').length) return bad('keys requires keys (SendKeys string)');
    if (payload.type === 'keys' && String(payload.keys || '').length > 64) return bad('keys max 64 chars. SendKeys: ^s=ctrl+s, %{F4}=alt+F4, {ENTER}, {TAB}.');
    if (payload.type === 'focus' && !String(payload.proc || '').length) return bad('focus requires proc (process name)');

    try {
      const r = await fetchJson('/api/action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      if (!r.ok) {
        const err = (r.json as Record<string, unknown>)?.error ?? r.text;
        if (r.status === 429) return bad(`PCLiveMap rate limited (30/10s): ${err}. Slow down, batch less.`, undefined);
        return bad(`PCLiveMap action rejected (${r.status}): ${err}. For click_name: use elements to list names first.`, undefined);
      }
      const j = r.json as Record<string, unknown>;
      const queued = j.queued as Record<string, unknown> | undefined;
      const via = queued?.via ? ` via ${queued.via}` : '';
      return ok(`PCLiveMap action queued: ${pretty(j.queued)}${via}\nExecutor will run in ~0.3s (cap 30/10s server, 40/min executor). Verify by calling PCLiveMap action=live again and checking seq/mouse advanced.`);
    } catch (e) { return bad(`PCLiveMap action failed at ${BASE}/api/action: ${(e as Error).message}`, baseHint); }
  },
};
