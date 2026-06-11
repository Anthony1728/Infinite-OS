# Infinite AI — Project Plan

> A free, open-source recreation of the Claude Desktop application that works with **any model from any provider**. Same feature set, same agentic workflow, no paywall.

---

## 1. Vision

| Claude Desktop | Infinite AI |
| --- | --- |
| Locked to Anthropic | Any provider: OpenRouter, Groq, Gemini, Mistral, Ollama, OpenAI, Anthropic, custom OpenAI-compatible |
| Paid subscription | Bring your own free-tier keys or run local models |
| Single vendor SDK | Unified provider adapter layer |
| Anthropic-managed infra | 100% local-first; nothing leaves your machine except what you send to the API you configured |
| `Claude` brand | `Infinite AI` brand |

**Goal:** feature-parity with Claude Desktop's Code tab (multi-turn chat, agentic tool use, file editing with diff view, bash, web search/fetch, project memory, MCP servers, subagents, permissions, hooks, skills).

---

## 2. Tech Stack

| Layer | Choice | Why |
| --- | --- | --- |
| Desktop shell | **Electron 32+** | Same shell as Claude Desktop; cross-platform (Win/macOS/Linux); mature |
| Language | **TypeScript 5.5+** strict | End-to-end type safety; matches Claude's stack |
| Renderer UI | **React 18 + Vite** | Fast HMR; same as Claude Desktop |
| Styling | **Tailwind CSS + Radix UI primitives** | shadcn/ui-style, matches Claude's visual language |
| State | **Zustand** + **TanStack Query** | Lightweight; matches Claude's client architecture |
| Code editor/diff | **Monaco Editor** | Same engine as VS Code; powers diff view |
| Markdown render | **react-markdown + remark-gfm + shiki** | GFM tables, code highlighting, math |
| Terminal output | **xterm.js** | For bash tool output |
| IPC | **@electron/typed-ipc** via `ipcMain.handle` / `ipcRenderer.invoke` + contextBridge | Type-safe preload bridge |
| Streaming | **Server-Sent Events / fetch streams** | Universal across all providers |
| MCP | **@modelcontextprotocol/sdk** | Official SDK — same one Anthropic publishes |
| Local models | **Ollama** HTTP API | OpenAI-compatible mode |
| Build | **electron-vite** + **electron-builder** | Standard Electron Vite setup |
| Package manager | **pnpm** | Fast, deterministic |
| Testing | **Vitest** (unit) + **Playwright** (e2e) | |
| Lint/format | **ESLint** + **Prettier** | |

---

## 3. High-Level Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                    Electron Main Process                     │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐ ┌──────────┐ │
│  │  Provider  │  │   Tool     │  │    MCP     │ │ Session  │ │
│  │  Registry  │  │  Registry  │  │   Manager  │ │   Store  │ │
│  │ (adapters) │  │  (built-in)│  │  (stdio)   │ │ (JSONL)  │ │
│  └─────┬──────┘  └─────┬──────┘  └─────┬──────┘ └────┬─────┘ │
│        │               │               │             │       │
│        └───────────────┴───────┬───────┴─────────────┘       │
│                                ▼                              │
│                      ┌──────────────────┐                     │
│                      │   Agent Loop     │  ◀── permissions     │
│                      │ (think → tool →  │                     │
│                      │  observe → …)    │                     │
│                      └────────┬─────────┘                     │
│                               │                               │
│                      ┌────────▼─────────┐                     │
│                      │  Settings Store  │                     │
│                      │  (~/.infinite-ai)│                     │
│                      └──────────────────┘                     │
└──────────────────────────────┬───────────────────────────────┘
                               │ IPC (typed)
┌──────────────────────────────▼───────────────────────────────┐
│                  Electron Preload Bridge                     │
│                contextBridge.exposeInMainWorld               │
│                (window.api.* — typed surface)                │
└──────────────────────────────┬───────────────────────────────┘
                               │
┌──────────────────────────────▼───────────────────────────────┐
│              Renderer (React + Zustand + Tailwind)           │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌──────────────────┐ │
│  │  Chat   │  │  Tools  │  │   Diff  │  │   Settings/      │ │
│  │  Pane   │  │  Cards  │  │  View   │  │   Providers      │ │
│  └─────────┘  └─────────┘  └─────────┘  └──────────────────┘ │
└──────────────────────────────────────────────────────────────┘
```

---

## 4. Model Provider System

### 4.1 Provider Interface (canonical)

```ts
interface ProviderAdapter {
  id: string;                       // "openrouter" | "groq" | …
  label: string;                    // "OpenRouter"
  requiresApiKey: boolean;
  baseUrl?: string;                 // for OpenAI-compatible
  defaultModel: string;
  freeModels: ModelInfo[];          // surfaced in UI

  streamChat(req: ChatRequest, signal: AbortSignal): AsyncIterable<StreamChunk>;
  listModels(apiKey: string): Promise<ModelInfo[]>;
  countTokens?(messages: Message[]): Promise<number>;
}
```

### 4.2 Supported providers (MVP)

| Provider | Free tier | Adapter strategy |
| --- | --- | --- |
| **OpenRouter** | Many `:free` models (Llama 3.3 70B, Qwen 2.5 72B, DeepSeek V3, Gemini 2.0 Flash, Mistral, Gemma) | OpenAI-compatible SDK → single key unlocks 30+ free models |
| **Groq** | Llama 3.3 70B, Mixtral 8x7B, Gemma2 9B | OpenAI-compatible |
| **Google Gemini** | Gemini 2.0 Flash, 1.5 Flash/Pro | `@google/generative-ai` SDK |
| **Mistral** | Mistral Small | OpenAI-compatible |
| **OpenAI** | None free, but supported | OpenAI SDK |
| **Anthropic** | None free, but supported (BYO key) | `@anthropic-ai/sdk` |
| **Ollama** | 100% free, local | OpenAI-compatible at `http://localhost:11434/v1` |
| **Custom OpenAI-compatible** | Depends | User supplies `baseUrl` + key |

### 4.3 Model routing

- Each session remembers its `(provider, model)` pair.
- Mid-session switch via `/model` command or picker.
- Provider keys stored in OS keychain via Electron `safeStorage` — never in plaintext settings.

---

## 5. Tool System

### 5.1 Tool interface (mirrors Claude Code)

```ts
interface Tool {
  name: string;                     // "Bash" | "Read" | "Edit" | …
  description: string;
  inputSchema: JSONSchema;
  permission: "none" | "ask" | "allow" | "deny";

  execute(args: any, ctx: ToolContext): Promise<ToolResult>;
  //              ▲
  //              └── streaming results via AsyncIterable
}
```

### 5.2 Built-in tools (MVP parity with Claude Code)

| Tool | Description | Mirrors Claude Code |
| --- | --- | --- |
| `Bash` | Run shell command in project working directory, with timeout + 30k char output cap | ✓ |
| `Read` | Read file with offset/limit; image/PDF support | ✓ |
| `Write` | Create/overwrite file (read-before-write enforced) | ✓ |
| `Edit` | Exact-string replacement (old_string → new_string), with read-before-edit check | ✓ |
| `Glob` | Find files by pattern (powered by `tinyglobby`) | ✓ |
| `Grep` | Search file contents (powered by `ripgrep` via `@vscode/ripgrep`) | ✓ |
| `WebFetch` | HTTP GET, convert HTML→Markdown, prompt to extract answer | ✓ |
| `WebSearch` | Web search; default backend DuckDuckGo HTML (free, no key); pluggable | ✓ |
| `TodoWrite` | Session-scoped task checklist | ✓ |
| `ListMcpResources` | List resources from connected MCP servers | ✓ |
| `ReadMcpResource` | Read a specific MCP resource by URI | ✓ |

### 5.3 Tool execution flow

```
Model emits tool_use
        │
        ▼
Permission gate ──▶ ask user (modal)  /  auto-allow /  auto-deny
        │
        ▼
Tool.execute(args, ctx)
        │
        ├── streams partial result to renderer (ToolCallCard)
        │
        ▼
Append tool_result to message log
        │
        ▼
Loop back to model
```

### 5.4 Permission system

Mirrors Claude Code exactly:
- `permissions.allow` / `permissions.deny` arrays in settings.
- Pattern syntax: `Bash(npm run *)`, `Read(./.env)`, `Edit(/src/**)`, `WebFetch(domain:*)`.
- Permission modes: `default` | `acceptEdits` | `plan` | `bypassPermissions`.
- Per-tool `ask` modal in renderer.

---

## 6. MCP (Model Context Protocol) Support

Full parity — uses Anthropic's official `@modelcontextprotocol/sdk`:
- **stdio** transport: spawn child process per server (default).
- Config in `~/.infinite-ai.json` (user scope) and `.mcp.json` (project scope).
- Servers auto-connect on session start; tools merged into the tool registry.
- Resource listing + reading supported.
- `enabledMcpServers` / `disabledMcpjsonServers` allow/deny lists.

Example `.mcp.json`:
```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "."]
    },
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": { "GITHUB_TOKEN": "${env:GITHUB_TOKEN}" }
    }
  }
}
```

---

## 7. Agent Loop

```ts
async function* agentLoop(messages, tools, ctx) {
  while (true) {
    const stream = provider.streamChat({ messages, tools, system });
    const assistant = await accumulate(stream);   // yields chunks to UI

    if (!assistant.toolUses.length) return;       // done

    for (const tu of assistant.toolUses) {
      const ok = await permissions.check(tu);
      if (!ok) { appendSyntheticResult(tu, "denied"); continue; }

      const result = await toolRegistry.execute(tu, ctx);
      messages.push({ role: "user", content: [{ type: "tool_result", tool_use_id: tu.id, content: result }] });

      // yield event so renderer can update ToolCallCard live
      yield { type: "tool_result", tool_use_id: tu.id, result };
    }
  }
}
```

Bounded by `maxTurns` (default 100) to prevent runaway loops.

---

## 8. Memory & Context

| Source | File | Scope |
| --- | --- | --- |
| Global instructions | `~/.infinite-ai/INFINITE.md` | User |
| Project instructions | `./INFINITE.md` or `./.infinite/INFINITE.md` | Project |
| Project local | `./INFINITE.local.md` | Local (gitignored) |
| Auto memory | `~/.infinite-ai/memory/<project-hash>/` | Per-project, auto-saved |
| Session transcript | `~/.infinite-ai/sessions/<id>.jsonl` | Per-session |

Auto memory writes a short, dated note when the model discovers a non-obvious fact (build command, debugging insight, file layout).

---

## 9. Settings

Scopes (mirrors Claude Code):

| Scope | Path | Use |
| --- | --- | --- |
| Managed | OS-level MDM | Enterprise lockdown |
| User | `~/.infinite-ai/settings.json` | Personal defaults |
| Project | `./.infinite/settings.json` | Committed to repo |
| Local | `./.infinite/settings.local.json` | Gitignored personal overrides |

Precedence: Managed → CLI flags → Local → Project → User.

Key settings exposed in `/config`:
- Default provider & model
- Permission mode
- Editor mode (normal / vim)
- Theme (light / dark / system)
- Auto memory on/off
- Auto-scroll on/off
- Effort level (when supported by provider)
- MCP server allow/deny lists
- Hooks configuration
- Provider API keys (encrypted via `safeStorage`)

---

## 10. Renderer UI

### 10.1 Layout (mirrors Claude Desktop's Code tab)

```
┌────────────┬───────────────────────────────────────────┐
│            │ ┌─ Header: session title · model · status │
│  Sidebar   │ ├─────────────────────────────────────────┤
│            │ │                                         │
│ • New chat │ │   Message stream (auto-scroll)          │
│ • Sessions │ │   ┌──────────────────────────────┐      │
│   history  │ │   │ User: …                       │      │
│ • Projects │ │   └──────────────────────────────┘      │
│            │ │   ┌──────────────────────────────┐      │
│            │   │ Assistant: …                  │      │
│            │   │ ┌──────────────────────────┐  │      │
│            │   │ │ 🔧 Edit src/foo.ts        │  │      │
│            │   │ │   - old line              │  │      │
│            │   │ │   + new line        [✓][✗]│  │      │
│            │   │ └──────────────────────────┘  │      │
│            │   └──────────────────────────────┘      │
│            │                                         │
│            │ ┌─ Input: multiline, shift+enter, ↑/↓ ─┐ │
│            │ │                              [Send ▸]│ │
│            │ └─────────────────────────────────────┘ │
└────────────┴───────────────────────────────────────────┘
```

### 10.2 Key components

- `MessageList` — virtualized list of messages; auto-scroll; copy/retry/branch.
- `Message` — user or assistant; markdown + syntax highlight + math.
- `StreamingText` — token-by-token reveal with shimmer effect.
- `ToolCallCard` — collapsible card per tool call showing args, live output, and result.
- `DiffView` — side-by-side Monaco diff editor with `accept` / `reject` buttons.
- `BashOutput` — xterm.js terminal rendering live output.
- `FilePreview` — image/PDF/code preview with line numbers.
- `SessionList` — search + filter past sessions.
- `SettingsModal` — tabbed (Providers, Models, Permissions, MCP, Hooks, Appearance).
- `PermissionDialog` — modal for `ask` prompts with remember-this-rule checkbox.
- `ProviderConfig` — paste key → "Test connection" → fetches free model list.

### 10.3 Keyboard shortcuts (parity)

| Shortcut | Action |
| --- | --- |
| `Cmd/Ctrl+N` | New session |
| `Cmd/Ctrl+K` | Command palette |
| `Cmd/Ctrl+/` | Toggle sidebar |
| `Cmd/Ctrl+Shift+P` | Settings |
| `Enter` | Send message |
| `Shift+Enter` | Newline in input |
| `↑` (empty) | Recall last prompt |
| `Esc` | Stop generation |
| `Cmd/Ctrl+R` | Retry last assistant turn |
| `Cmd/Ctrl+B` | Branch from message |

---

## 11. Session & Persistence

- Session format: append-only JSONL.
- Each line is `{type, …}` (`user`, `assistant`, `tool_use`, `tool_result`, `system`, `summary`).
- Resume: `infinite-ai --resume <session-id>` (CLI parity) or click in UI.
- Cleanup: sessions older than `cleanupPeriodDays` (default 30) pruned at startup.
- Search: full-text search across session transcripts via SQLite FTS5 index.

---

## 12. Skills, Hooks, Subagents

- **Skills** = markdown files in `~/.infinite-ai/skills/` or `./.infinite/skills/` with YAML frontmatter; invoked as `/skill-name`.
- **Hooks** = shell commands in settings that fire on `PreToolUse` / `PostToolUse` / `SessionStart` / `SessionEnd` / `ConfigChange`.
- **Subagents** = named agent definitions (markdown + frontmatter) that the main `Agent` tool can spawn with a restricted tool list.

---

## 13. Distribution

| Channel | Command |
| --- | --- |
| Source | `git clone … && pnpm install && pnpm dev` |
| Windows installer | `pnpm build:win` → NSIS `.exe` |
| macOS | `pnpm build:mac` → universal `.dmg` (Intel + Apple Silicon) |
| Linux | `pnpm build:linux` → AppImage + `.deb` + `.rpm` |
| Auto-update | `electron-updater` with GitHub Releases |

Code-signing setup documented in `docs/SIGNING.md` (placeholder; not required for personal builds).

---

## 14. Roadmap (suggested)

### Phase 0 — Skeleton (week 1)
- [ ] Electron + Vite + React + Tailwind scaffold
- [ ] Window + tray + basic menu
- [ ] `window.api` IPC contract
- [ ] Settings store (JSON) with scopes

### Phase 1 — Chat core (week 2-3)
- [ ] Provider registry + OpenAI-compatible adapter
- [ ] OpenRouter + Groq + Ollama + Gemini providers
- [ ] Streaming chat with abort
- [ ] Message list, input box, markdown render
- [ ] Session JSONL store

### Phase 2 — Built-in tools (week 4-5)
- [ ] Read / Write / Edit (with diff view)
- [ ] Bash (with permission gate)
- [ ] Glob / Grep
- [ ] WebFetch / WebSearch
- [ ] ToolCallCard UI

### Phase 3 — MCP + Permissions (week 6)
- [ ] MCP stdio manager
- [ ] Permission system (ask/allow/deny, pattern rules)
- [ ] Permission modal UI
- [ ] `.mcp.json` loading

### Phase 4 — Memory + Skills + Hooks (week 7)
- [ ] `INFINITE.md` discovery
- [ ] Auto memory
- [ ] Skills framework
- [ ] Hooks engine

### Phase 5 — Polish (week 8)
- [ ] Subagents
- [ ] Session search
- [ ] Command palette
- [ ] Themes
- [ ] Auto-update
- [ ] Packaging + signing

---

## 15. What is *not* in scope (yet)

- Mobile/tablet surfaces (web parity is sufficient for v1).
- Cloud sync of sessions.
- Team-shared remote sessions (Claude Code's `/remote`).
- Routine/background-task scheduling.
- Voice mode.

These can be added later without changing the core architecture.
