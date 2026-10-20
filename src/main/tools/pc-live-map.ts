import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
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

/**
 * Files the collector actually needs at runtime. Used both to locate the
 * shipped copy and to decide whether a previously mirrored copy is stale.
 */
const LIVEMAP_RUNTIME_FILES = ['collector-server.js', 'tracker.ps1', 'executor.ps1'] as const;

export interface LivemapSource {
  /** Directory that contains collector-server.js. */
  dir: string;
  /** Parent of `dir` — the collector computes its own ROOT as `<parent>/..`. */
  root: string;
  /** True when this copy came from an installed app rather than the repo. */
  packaged: boolean;
}

/** Join for user-facing hint strings. Separate from resolveLivemapSource so a
 *  hint can be produced even when nothing was found on disk. */
function joinForHint(dir: string, file: string): string {
  return `${dir}\\${file}`;
}

/**
 * Locate the Live Map runtime.
 *
 * The old code walked three directories up from this module, which is correct
 * in the repo (`src/main/tools` -> repo root) but wrong in a packaged build:
 * this module lives inside `app.asar`, so the walk lands inside the archive
 * where there are no loose files to spawn. Auto-start therefore found nothing
 * and every shipped installer had the feature dead — it only appeared to work
 * in development, where the bridge happened to be running already and the
 * launch path was never reached.
 *
 * electron-builder copies the folder to `resources/pc-live-map` via
 * extraResources, so `process.resourcesPath` is where it really is once
 * installed. Both are tried and the first one that actually contains the
 * files wins, rather than trusting a path computed from a directory layout
 * that differs between dev and packaged.
 */
export function livemapCandidates(): LivemapSource[] {
  const candidates: LivemapSource[] = [];
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    // Dev: src/main/tools -> repo root -> Infinite OS/pc-live-map
    const repoRoot = join(here, '..', '..', '..');
    candidates.push({ dir: join(repoRoot, 'Infinite OS', 'pc-live-map'), root: join(repoRoot, 'Infinite OS'), packaged: false });
  } catch { /* import.meta unavailable in some test harnesses */ }

  // Packaged: copied next to app.asar by extraResources.
  const resourcesPath = process.resourcesPath;
  if (resourcesPath) {
    candidates.push({ dir: join(resourcesPath, 'pc-live-map'), root: resourcesPath, packaged: true });
  }
  return candidates;
}

export function resolveLivemapSource(): LivemapSource | null {
  for (const c of livemapCandidates()) {
    if (LIVEMAP_RUNTIME_FILES.every((f) => existsSync(join(c.dir, f)))) return c;
  }
  return null;
}

export const pcLiveMapTool: Tool = {
  name: 'PCLiveMap',
  description: [
    'PC Live Map - screenshot-free eyes + hands: live vectors of all windows, 50 UIA elements WITH values, clipboard, idle.',
    'Cheapest loop: action=changes with the id from your last call tells you only what HAPPENED since - focus, clicks, cursor, text, windows. If nothing changed you already know the state.',
    'ACT via click_name/click/drag/scroll/type/keys/wait/focus (norm 0-1000). ALWAYS prefer over screenshots: cheaper, faster, works with text-only models.',
    'Screenshot only when vectors cannot see (canvas/game/PDF) - say why.',
  ].join(' '),
  inputSchema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['status', 'live', 'changes', 'agent', 'elements', 'health', 'events', 'click', 'click_name', 'move', 'doubleclick', 'drag', 'scroll', 'type', 'keys', 'wait', 'focus', 'start'],
        description: 'observe: status|live|changes|agent. changes = what happened since the id you pass back. search: elements. act: click|click_name|move|doubleclick|drag|scroll|type|keys|wait|focus. start: auto-launch bridge+tracker. health/events for diagnostics.',
      },
      q: { type: 'string', description: 'For elements: substring of UIA name.' },
      since: { type: 'number', description: 'For changes: only what changed after this id (use next_since from last call).' },
      name: { type: 'string', description: 'UIA element name to click, e.g. Save' },
      role: { type: 'string', description: 'UIA role filter, e.g. Button' },
      x_norm: { type: 'number', description: 'Norm X 0-1000' },
      y_norm: { type: 'number', description: 'Norm Y 0-1000' },
      x1_norm: { type: 'number', description: 'Drag start X 0-1000' },
      y1_norm: { type: 'number', description: 'Drag start Y 0-1000' },
      x2_norm: { type: 'number', description: 'Drag end X 0-1000' },
      y2_norm: { type: 'number', description: 'Drag end Y 0-1000' },
      amount: { type: 'number', description: 'Scroll amount (-1200..1200, default 120)' },
      text: { type: 'string', description: 'Text to type. keys: ^s=ctrl+s, %{F4}=alt+F4, {ENTER}.' },
      keys: { type: 'string', description: 'SendKeys string for keys' },
      proc: { type: 'string', description: 'Process name for focus' },
      ms: { type: 'number', description: 'Wait ms (50-10000)' },
      button: { type: 'string', enum: ['left', 'right'], description: 'Mouse button for click' },
    },
    required: ['action'],
  },
  permission: 'allow',
  async execute(args, ctx): Promise<ToolResult> {
    const a = args as Record<string, unknown>;
    const action = String(a.action || '').toLowerCase();
    // Point at the copy that actually exists on this machine. Telling an
    // installed user to run a path inside the repo they do not have is the
    // same mistake as looking for the collector there in the first place.
    const src = resolveLivemapSource();
    const baseHint = `Is the Live Map running? Run PCLiveMap action=start to auto-launch it, or start it by hand: powershell -ExecutionPolicy Bypass -File "${src ? joinForHint(src.dir, 'Start-LiveMap.ps1') : '<live-map>/Start-LiveMap.ps1'}". Bridge: ${BASE}/health`;
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
        const source = resolveLivemapSource();
        if (!source) return bad(`PCLiveMap runtime files not found. Looked in the repo (Infinite OS/pc-live-map) and next to the app (resources/pc-live-map). ${baseHint}`);
        const collector = join(source.dir, 'collector-server.js');

        // In a packaged build `process.execPath` is the Infinite OS executable,
        // whose entry point is baked into app.asar. Handing it a script path
        // would start another copy of the app rather than the collector.
        // ELECTRON_RUN_AS_NODE makes that same binary execute the argument as
        // plain node, which needs no bundled runtime and behaves identically in
        // dev and in an installed build.
        const child = spawn(process.execPath, [collector], {
          cwd: source.root,
          detached: true,
          stdio: 'ignore',
          windowsHide: true,
          env: { ...process.env, PORT: '3799', ELECTRON_RUN_AS_NODE: '1' },
        });
        child.unref?.();
        await new Promise((r) => setTimeout(r, 1200));
        const verify = await fetchJson('/health').catch(() => null);
        if (verify?.ok) {
          const j = verify.json as Record<string, unknown>;
          return ok(`PCLiveMap bridge auto-started at ${BASE} (v=${j.v} tracker=${j.tracker ? 'live' : 'waiting'}). Next: PCLiveMap action=live. If tracker=waiting, also start eyes: powershell -ExecutionPolicy Bypass -File "${joinForHint(source.dir, 'tracker.ps1')}"`);
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
    if (action === 'changes') {
      // The timeline: what happened since the last time you looked.
      //
      // A snapshot says what the screen looks like now. This says what CHANGED,
      // which is the difference between a photo and a video. It is also far
      // cheaper — a few lines instead of re-reading every element — and it is
      // the only way to tell "nothing happened" from "happened and changed back".
      try {
        const since = Math.max(0, Math.floor(Number(a.since ?? 0) || 0));
        const r = await fetchJson('/api/changes?since=' + since);
        if (!r.ok) return bad(`PCLiveMap /api/changes failed (${r.status}): ${r.text.slice(0, 400)}`, baseHint);
        const j = (r.json ?? {}) as {
          newest?: number; count?: number; gap?: boolean;
          changes?: { id: number; t: string; changes: string[]; where: string }[];
        };
        const changes = j.changes ?? [];
        const newest = j.newest ?? since;
        if (changes.length === 0) {
          return ok(
            `Nothing changed since id ${since}. Cursor and window state are unchanged.\n` +
            `next_since=${newest}`,
          );
        }
        const lines = changes.map((c) => `  #${c.id} ${c.t} in ${c.where}\n` + c.changes.map(x => `    - ${x}`).join('\n'));
        return ok(
          `PCLiveMap CHANGES since id ${since} (${changes.length} event${changes.length === 1 ? '' : 's'}):\n` +
          lines.join('\n') +
          (j.gap ? '\n\nNOTE: the buffer rolled past id ' + since + '; earlier events are gone. Ask for live for the current state.' : '') +
          `\n\nnext_since=${newest}\n\nCall action=changes with since=${newest} next time to see only what is new.`,
        );
      } catch (e) { return bad(`PCLiveMap unreachable at ${BASE}/api/changes: ${(e as Error).message}`, baseHint); }
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
