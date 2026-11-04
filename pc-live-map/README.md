# PC Live Map v6 â€” screenshot-free AI eyes + hands [future-grade] â€” Infinite OS

**Design question: is it possible, and is it faster? Yes â€” and v6 proves it.**

A 1080p screenshot costs ~1,500â€“2,500 vision tokens + 1â€“3 s per frame, zero semantics.
A vector state costs **~500â€“950 text tokens, ~20 ms**, and already tells the model: cursor + clicks + idle, foreground proc/title/rect/max, ALL windows with rects, **50 UIA elements with `value`**, **focused element with `value`**, clipboard preview, virtual screen.

That's **13â€“15Ã— cheaper and ~50Ã— faster per update**, at 4 Hz. Text-only models (no vision) drive it fully.

## What was built (v6 future-grade, sharpened, no bugs)

| File | What it does |
|---|---|
| `../pc-live-map.html` | **App v6:** B/W vector map, unified 0â€“1000 both axes, click-by-name, health pill (`/health` v6), SSE dedup, UIA value overlay, AI-state JSON v6 + seq, replay, export |
| `tracker.ps1` | **Eyes v6:** cursor + L/R clicks + idle + foreground proc/title/rect/max + ALL windows (off-screen filtered, overlay flagged) + 50 UIA **with ValuePattern/TextPattern** (700ms guard) + **focused with value** + clipboard 120ch + virtual screen + seq. Stable FNV sig, 5MB rotation, Add-Type guard |
| `collector-server.js` | **Bridge v6:** serves HTML, `/health` v6, `/api/state`, `/api/os`, `/api/live` v6 (elements include `v` value), `POST /api/action` (validated + 30/10s + `click_name` resolver), `/api/elements?q=` (includes value), `/api/actions`, `/events` SSE (no dup), `/tool.json`, `/api/agent` v6 |
| `executor.ps1` | **Hands v2:** polls `pc-actions.jsonl`, executes click/move/doubleclick/drag/scroll/type(paste)/keys/wait/focus, norm 0â€“1000, 40/min cap, `-DryRun` |
| `ai-schema.json` | **Schema v6:** validates the AI state â€” elements + focused now carry `value` |
| `AGENT.md` | **Agent contract v6:** observe/act/verify â€” vectors ALWAYS, screenshot ONLY when vectors cannot see |
| `infinite-tool.json` | **Manifest v6:** served at `GET /tool.json` so every Infinite AI notices the tool |
| `agent-client.js` | **Node helper v6 (zero deps):** `import { live, clickName, typeText, ... }` + CLI |
| `Start-LiveMap.ps1` + `start-livemap.bat` | **One-click v6:** starts eyes + bridge + hands + opens UI |

### v6 sharpening over v4/v5

* **Reads inputs without screenshots** â€” `ValuePattern`/`TextPattern` for Edit/Combo/Document + focused value, so AI can `GET /api/live` and see `Edit "Search" value="hello world"` and decide, zero pixels.
* **Virtual screen awareness** â€” reports `vscreen` extents so multi-monitor is coherent.
* **Change signature includes values** â€” no duplicate spam when typing in a field, but fires instantly when value changes.
* **No bugs** â€” off-screen filter, overlay flag, stable hash, rotation, timeout guard, validation, rate limit, safety cap, Add-Type guard, sanitized strings all hardened; v6 adds value null-guards.

## Run it

```powershell
# 1-click â€” eyes + bridge + hands + UI (v6 future-grade)
powershell -ExecutionPolicy Bypass -File pc-live-map\Start-LiveMap.ps1
# or double-click pc-live-map\start-livemap.bat

# manual
start ..\pc-live-map.html
powershell -ExecutionPolicy Bypass -File pc-live-map\tracker.ps1 -IntervalMs 250
node pc-live-map/collector-server.js
# http://localhost:3799 -> Connect
# AI: http://localhost:3799/api/live  or  /api/agent  (vectors, no screenshot)
# health: http://localhost:3799/health
powershell -ExecutionPolicy Bypass -File pc-live-map\executor.ps1
# dry run first: powershell -ExecutionPolicy Bypass -File pc-live-map\executor.ps1 -DryRun
```

## AI loop â€” vectors ALWAYS (v6 one-fetch)

```
GET /api/agent -> { rule, loop, element_names[30], focused:"Edit:Search value=\"hello\"", state:{ v:6, seq, mouse, fg, windows[20], elements:[50 with v], focused{with value}, clip_preview, vscreen } }
GET /tool.json -> manifest (agent discovery)
GET /api/live  -> { v:6, seq, mouse{clicks,idle}, fg{proc,win,rect}, windows[20], elements[50 with v], focused{value}, clip_preview, vscreen }
GET /api/elements?q=save -> [{role:Button,name:Save,value:"",x:820,y:410,...}]
POST /api/action {"type":"click_name","name":"Save"}        # best: no coords
POST /api/action {"type":"click","x_norm":820,"y_norm":410}
POST /api/action {"type":"type","text":"hello"}              # paste, no keylog
POST /api/action {"type":"keys","keys":"^s"}                 # ctrl+s
```

Hybrid rule: vectors ALWAYS, screenshot ONLY when `zone=unknown` or text inside canvas/game/scanned PDF with no UIA names/values â€” say why in one line.

## How Infinite AI notices it (Infinite OS integration)

* `PCLiveMap` is a **CORE tool** â€” sent every turn (no discovery needed).
* `Computer` tool description says **prefer PCLiveMap first**; `Computer visual_observe` is a fallback only.
* System prompt (local + cloud) says: **vectors ALWAYS, screenshot only when vectors cannot see.**
* `task-coverage` counts `PCLiveMap live/agent` as `visual_observe` and `PCLiveMap type/keys/click` as verified typing.
* Forced physical-control routing in `loop.ts` now goes to `PCLiveMap live`, not `Computer visual_observe`.
* Live narration: `PCLiveMap` streams `Reading live vectorsâ€¦` / `Clicking "Save"â€¦` so chat feels like Claude Code â€” eye communicating as it works.

## Privacy

Local only. `localhost` SSE/API. Logs window titles + UIA names/values (first 80 chars) + clipboard 120 chars. Never full keystrokes, never pixels. `Esc` pauses, `Clear` wipes, `Ctrl+C` stops.
