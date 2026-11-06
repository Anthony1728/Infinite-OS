# PC Live Map — AGENT CONTRACT (Infinite OS tool, v6 future-grade)

> **To every Infinite AI agent reading this: this tool replaces screenshots.**
> Read `GET http://localhost:3799/api/live` (or `/api/agent`) before touching the
> screen. It costs ~500–900 tokens at 4 Hz — roughly **13–15× cheaper and ~50×
> faster** than a 1080p screenshot — and it already tells you the cursor, clicks,
> idle time, foreground app, ALL windows, 50 clickable elements, focused control,
> and clipboard preview. Text-only models (no vision) can drive it fully.

## 1. Discover (one fetch is enough)

```
GET http://localhost:3799/api/agent     # instructions + live state + elements. START HERE.
GET http://localhost:3799/tool.json     # machine manifest (this tool's contract)
GET http://localhost:3799/api/live      # full vector state v4
GET http://localhost:3799/health        # { ok, tracker:true|false } — false = browser-only, ask user to start tracker.ps1
```

If `mode` is `browser-only`, the OS tracker isn't running. Tell the user (one line):

> Start eyes: `powershell -ExecutionPolicy Bypass -File pc-live-map\tracker.ps1`
> Start hands: `powershell -ExecutionPolicy Bypass -File pc-live-map\executor.ps1`
> Bridge: `node pc-live-map/collector-server.js` — or one click: `Start-LiveMap.ps1`

## 2. Observe — what `/api/live` gives you (v6 future-grade)

```json
{
  "v": 6, "seq": 1234, "mode": "os-live",
  "mouse": { "xn": 512, "yn": 300, "idle_ms": 80, "clicks": { "left": 12, "right": 1 } },
  "fg": { "proc": "notepad", "win": "Untitled - Notepad", "rect_norm": [100, 80, 900, 900], "max": true },
  "windows": [{ "proc": "notepad", "title": "...", "rect_norm": [], "overlay": false }],
  "elements": [{ "r": "Button", "n": "Save", "v": "", "x": 820, "y": 410, "w": 60, "h": 24 },
               { "r": "Edit", "n": "Note", "v": "hello world", "x": 300, "y": 200, "w": 400, "h": 100 }],
  "focused": { "role": "Edit", "name": "Text Editor", "value": "hello world" },
  "clip_preview": "..."
}
```
`elements[].v` and `focused.value` are ValuePattern/TextPattern — the AI can **read** inputs without a screenshot.

- **Coords are ALWAYS norm 0–1000 on BOTH axes.** Never convert to pixels.
- `overlay:true` windows are fullscreen transparent layers — **never click them**.
- `seq` must advance between polls; a gap means slow/restarted tracker.
- `stale`/`browser-only` = page estimate only, not OS truth.

## 3. Act — `POST /api/action` (validated, 30 actions / 10 s)

Prefer `click_name` — the server resolves the UIA name, you never compute coords:

```bash
# BEST — click by name, zero coords
curl -X POST localhost:3799/api/action -H "Content-Type: application/json" \
  -d '{"type":"click_name","name":"Save"}'

# click / move / doubleclick by norm coords
curl -X POST localhost:3799/api/action -H "Content-Type: application/json" \
  -d '{"type":"click","x_norm":820,"y_norm":410}'

# drag, scroll, wait, focus, type, keys
curl -X POST localhost:3799/api/action -H "Content-Type: application/json" -d '{"type":"drag","x1_norm":100,"y1_norm":200,"x2_norm":400,"y2_norm":200}'
curl -X POST localhost:3799/api/action -H "Content-Type: application/json" -d '{"type":"scroll","amount":240}'
curl -X POST localhost:3799/api/action -H "Content-Type: application/json" -d '{"type":"wait","ms":800}'
curl -X POST localhost:3799/api/action -H "Content-Type: application/json" -d '{"type":"focus","proc":"notepad"}'
curl -X POST localhost:3799/api/action -H "Content-Type: application/json" -d '{"type":"type","text":"hello world"}'
curl -X POST localhost:3799/api/action -H "Content-Type: application/json" -d '{"type":"keys","keys":"^s"}'
```

`keys` is SendKeys: `^s`=ctrl+s, `%{F4}`=alt+F4, `{ENTER}`, `{TAB}`. Max 64 chars.
`type` pastes via clipboard (max 500 chars) — reliable, no keylogging.
Search first when unsure: `GET /api/elements?q=save` → pick `x,y` center.

## 4. Canonical loop (every screen task)

1. `GET /api/agent` (or `/api/live`) — observe `seq`, `fg`, `elements[]`.
2. Act once via `POST /api/action` (`click_name` preferred).
3. `GET /api/live` — verify `seq` advanced and `focused`/cursor moved.
4. Repeat. **Never screenshot while `mode=os-live`.**

Screenshot fallback ONLY when: target zone is unknown, or text lives inside a
canvas / game / 3D view / scanned PDF with no UIA names **and** no `value`. Say why in one line. Otherwise vectors ALWAYS.

## 5. Node helper (zero dependencies)

```js
import { live, clickName, click, typeText, pressKeys } from './pc-live-map/agent-client.js';
const s = await live();                       // GET /api/live
await clickName('Save');                      // POST click_name (best)
await click(820, 410);                        // POST click coords
await typeText('hello world');              // POST type
await pressKeys('^s');                        // POST keys (ctrl+s)
```

## 6. Safety + privacy (non-negotiable)

- 100% localhost. Nothing uploads. User starts/stops each piece (Ctrl+C).
- Executor caps at 40/min; server caps at 30/10 s — floods get 429, bursts pass.
- `DryRun` first for risky flows: `executor.ps1 -DryRun`.
- Never exfiltrate `clip_preview` or window titles. Never log passwords
  (browser page already uses key-category privacy mode by default).
- Destructive keys (`%{F4}`, `^w`, deletes) only with explicit user approval.

## 7. Troubleshooting in one glance

| Symptom | Cause → fix |
|---|---|
| `mode: browser-only` | tracker not running → start `tracker.ps1` |
| action `queued` but nothing moves | executor not running → start `executor.ps1` |
| `429 rate limited` | slow down — max 30 actions / 10 s |
| `no UIA element matching` | `GET /api/elements?q=` to list names, try substring |
| `seq` frozen | tracker stalled (slow UIA) — it self-skips; wait 2 s and re-poll |
| SSE duplicates | fixed in v4 (server dedups); update `collector-server.js` if old |

---
*Infinite OS tool. Project rule: vectors always, screenshot only when vectors can't see.*
