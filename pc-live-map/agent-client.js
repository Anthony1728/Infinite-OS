// PC Live Map — agent-client.js (zero dependencies, Node 20+).
// Tiny helper so Infinite AI / scripts drive the PC in 5 lines, no screenshots.
// import { live, agent, elements, clickName, click, move, typeText, pressKeys, scrollBy, waitMs, focusProc } from './agent-client.js';
const BASE = (process.env.PC_LIVE_MAP || 'http://localhost:3799').replace(/\/$/, '');

async function jget(p) {
  const r = await fetch(BASE + p);
  if (!r.ok) throw new Error('GET ' + p + ' -> HTTP ' + r.status);
  return r.json();
}

async function jpost(action) {
  const r = await fetch(BASE + '/api/action', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(action),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.ok) throw new Error('action rejected: ' + (j.error || r.status));
  return j.queued;
}

export const live = () => jget('/api/live');
export const agent = () => jget('/api/agent');
export const health = () => jget('/health');
export const toolManifest = () => jget('/tool.json');
export const elements = (q = '') => jget('/api/elements?q=' + encodeURIComponent(q));
export const actions = () => jget('/api/actions');

const clampN = (v) => Math.min(1000, Math.max(0, Math.round(Number(v))));

export const clickName = (name, role) => jpost(role ? { type: 'click_name', name, role } : { type: 'click_name', name });
export const click = (x_norm, y_norm, button) => jpost(button ? { type: 'click', x_norm: clampN(x_norm), y_norm: clampN(y_norm), button } : { type: 'click', x_norm: clampN(x_norm), y_norm: clampN(y_norm) });
export const move = (x_norm, y_norm) => jpost({ type: 'move', x_norm: clampN(x_norm), y_norm: clampN(y_norm) });
export const doubleclick = (x_norm, y_norm) => jpost({ type: 'doubleclick', x_norm: clampN(x_norm), y_norm: clampN(y_norm) });
export const drag = (x1, y1, x2, y2) => jpost({ type: 'drag', x1_norm: clampN(x1), y1_norm: clampN(y1), x2_norm: clampN(x2), y2_norm: clampN(y2) });
export const typeText = (text) => jpost({ type: 'type', text: String(text).slice(0, 500) });
export const pressKeys = (keys) => jpost({ type: 'keys', keys: String(keys).slice(0, 64) });
export const scrollBy = (amount = 120) => jpost({ type: 'scroll', amount });
export const waitMs = (ms = 500) => jpost({ type: 'wait', ms });
export const focusProc = (proc) => jpost({ type: 'focus', proc });

// Convenience: observe -> act by name -> verify (the canonical agent loop).
export async function clickNameAndVerify(name, { wait = 700 } = {}) {
  const before = await live().catch(() => null);
  const queued = await clickName(name);
  await new Promise((r) => setTimeout(r, wait));
  const after = await live().catch(() => null);
  return {
    queued,
    seqAdvanced: !!(before && after && (after.seq || 0) > (before.seq || 0)),
    before: before ? { seq: before.seq, fg: before.fg } : null,
    after: after ? { seq: after.seq, fg: after.fg, focused: after.focused } : null,
  };
}

// CLI: node agent-client.js live | node agent-client.js click Save | node agent-client.js type "hi"
if (process.argv[1] && /agent-client\.js$/.test(process.argv[1])) {
  const [, , cmd, ...rest] = process.argv;
  (async () => {
    try {
      if (!cmd || cmd === 'live') console.log(JSON.stringify(await live(), null, 1));
      else if (cmd === 'agent') console.log(JSON.stringify(await agent(), null, 1));
      else if (cmd === 'health') console.log(JSON.stringify(await health(), null, 1));
      else if (cmd === 'elements') console.log(JSON.stringify(await elements(rest.join(' ')), null, 1));
      else if (cmd === 'click') console.log(JSON.stringify(await clickName(rest.join(' ')), null, 1));
      else if (cmd === 'type') console.log(JSON.stringify(await typeText(rest.join(' ')), null, 1));
      else if (cmd === 'keys') console.log(JSON.stringify(await pressKeys(rest.join(' ')), null, 1));
      else if (cmd === 'focus') console.log(JSON.stringify(await focusProc(rest.join(' ')), null, 1));
      else { console.error('usage: node agent-client.js [live|agent|health|elements <q>|click <name>|type <text>|keys <sendkeys>|focus <proc>]'); process.exit(2); }
    } catch (e) { console.error(String(e.message || e)); process.exit(1); }
  })();
}
