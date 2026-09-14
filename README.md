# Infinite OS — the AI operating workspace

Infinite OS is an AI-powered desktop workspace that puts chat, code, files,
terminal, browser + PC automation, builders, and business tools in one native app.
Infinite AI is the brain inside it.

> Why best: keyboard-first and instant (~270ms startup splash), local-first and
> private (Ollama + encrypted store + per-account isolation), and build-oriented
> (App Builder, Website Builder, Canvas, Automations — ship from a prompt).

## Quick start

```powershell
npm install
npm run dev        # Electron + Vite dev (window opens, hot reload)
npm run typecheck  # tsc node + web — must stay clean
npm test           # vitest run
npm run build      # typecheck + electron-vite build
npm run build:win  # + electron-builder Windows (nsis + portable)
```

Requirements: Node >= 20. Ollama optional but recommended for local models
(`minicpm-v4.6:latest`, `qwen3:4b`, `llama3.1:8b` auto-detected as local primary).

## Power Center (home)

`src/renderer/components/views/PowerCenterView.tsx` is the home screen:

- Spotlight filters **actions + recent chats + automations** live; `⌘K` opens everything.
- Quick Capture saves a thought offline in one keystroke (`Ctrl+Shift+Y` / `⌘⇧Y`).
- Focus toggle sets `html[data-focus]` and genuinely dims marketing/pulse/sidebar
  noise via `src/renderer/styles/globals.css` — chat + editor stay dominant.
- Hero greeting is pure/offline (`src/renderer/lib/greeting.ts` + `greeting.test.ts`):
  time-aware, Monday-reset, Friday-ship, weekend-build, late-night care,
  live-agent acknowledgement. Deterministic per day-of-year.

## Keyboard map

| Keys | Action |
|---|---|
| `Ctrl/⌘ K` | Command palette (recent-first, grouped) |
| `Ctrl/⌘ N` | New chat |
| `Ctrl/⌘ \`` | Terminal (idle-prefetched) |
| `Ctrl/⌘ B` | Toggle sidebar |
| `Ctrl/⌘ .` | Activity panel |
| `Ctrl/⌘ /` | Shortcuts |
| `Ctrl/⌘ Shift Y` | Quick Capture append |

## Architecture

```
src/main/       Electron main: brain/, agent/, automation/, builders/,
                business/, providers/, tools/, bridge/, messaging/,
                orchestrator/, guard/, heartbeat/, ipc/
src/renderer/   React: App.tsx shell, views/ (36 lazy modules), layout/
                (Sidebar/MainView/TopBar/RightPanel/StatusBar), stores/
                (zustand: chat/session/auth/agents/brain/automation),
                lib/greeting.ts, theme/, styles/globals.css
src/preload/    contextIsolation bridge (window.api)
src/shared/     ipc.ts contract, types.ts, owner.ts
```

Main entry `src/main/index.ts`: single-instance lock, frameless window with
`ready-to-show` + 8s failsafe, bridge server `:8765`, phone companion, Telegram
inbound, model pre-warm, settings + MCP background init, 60s health loop,
5min self-improvement loop, screenshot cleanup.

Renderer entry `src/renderer/App.tsx`: auth → onboarding → OS shell.
`MainView.tsx` lazy-loads every heavy view; `ChatView` stays eager (default route).

## Conventions

- Smallest targeted edit wins. Prefer `Edit` over rewrites, mimic existing style.
- Never commit unless asked. Never `Remove-Item -Recurse` project dirs.
- Secrets stay in OS store / `.env` — never in git (`git log -p` check).
- Validate with project commands, not invented ones:
  `npm run typecheck`, `npm test`, `npm run lint`.
- No placeholders, no TODOs in shipped code. Verify: re-read edited files,
  report "Typecheck clean" / "All tests passing" only after running.

## Testing

- `vitest run` — unit (greeting rotation, brain teaching, paths, agents, chat).
- `npm run test:e2e` — Playwright.
- Focus/Spotlight changes are covered by existing greeting tests + manual:
  Home → type in Spotlight → chats + automations filter; toggle Focus → dims.

## Security model

- `contextIsolation: true`, `nodeIntegration: false`, external URLs denied
  (`will-navigate` guard + `setWindowOpenHandler` → `shell.openExternal`).
- Microphone gated to trusted window only.
- Source guard warns on external edits — only Infinite AI edits OS source.
- Netflix-style account isolation: device storage wiped on account switch,
  files + secrets re-homed in main.

## Version

`v0.1.1` — `com.infiniteai.os` / `Infinite OS`.
