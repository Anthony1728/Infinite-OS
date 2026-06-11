# Infinite AI — File Structure

```
infinite-ai/
│
├── package.json                       # pnpm workspace root, scripts, deps
├── pnpm-workspace.yaml                # (optional, for monorepo split)
├── tsconfig.json                      # base TS config (paths, strict)
├── tsconfig.node.json                 # main/preload TS config
├── tsconfig.web.json                  # renderer TS config
├── electron.vite.config.ts            # Vite + Electron build config
├── electron-builder.yml               # Packager config (win/mac/linux)
├── tailwind.config.ts
├── postcss.config.js
├── .eslintrc.cjs
├── .prettierrc
├── .gitignore
├── .editorconfig
├── LICENSE                            # MIT
│
├── README.md                          # Project overview + quickstart
├── PLAN.md                            # Full architecture & roadmap
├── STRUCTURE.md                       # This file
├── CONTRIBUTING.md
│
├── docs/
│   ├── ARCHITECTURE.md                # Sequence diagrams
│   ├── PROVIDERS.md                   # How to add a new provider
│   ├── TOOLS.md                       # How to add a new tool
│   ├── MCP.md                         # MCP integration guide
│   ├── PERMISSIONS.md                 # Permission rule syntax
│   ├── SIGNING.md                     # Code-signing for distros
│   └── CHANGELOG.md
│
├── resources/                         # Static assets bundled in app
│   ├── icon.png
│   ├── icon.ico                       # Windows
│   ├── icon.icns                      # macOS
│   ├── tray.png
│   └── sample.mcp.json
│
├── scripts/
│   ├── build.mjs                      # CI build wrapper
│   ├── dev.mjs                        # Spawn vite + electron with HMR
│   ├── postinstall.mjs                # Rebuild native deps for electron
│   └── verify.mjs                     # Smoke test packaged build
│
└── src/
    │
    ├── shared/                        # Types shared main↔renderer
    │   ├── types.ts                   # Message, Session, ToolCall, etc.
    │   ├── ipc.ts                     # IPC channel names + payload types
    │   ├── tools.ts                   # ToolDefinition schema
    │   ├── providers.ts               # ProviderInfo, ModelInfo
    │   ├── settings.ts                # Settings shape + scopes
    │   └── errors.ts
    │
    ├── main/                          # Electron main process
    │   ├── index.ts                   # App entry, BrowserWindow, lifecycle
    │   ├── window.ts                  # Window manager (size, position, multi-window)
    │   ├── menu.ts                    # Application menu
    │   ├── tray.ts                    # System tray
    │   ├── shortcuts.ts               # Global shortcuts
    │   ├── updater.ts                 # electron-updater
    │   │
    │   ├── ipc/                       # IPC handlers (ipcMain.handle)
    │   │   ├── index.ts               # registers all handlers
    │   │   ├── chat.ts                # sendMessage, abort, stream events
    │   │   ├── session.ts             # list, create, resume, delete sessions
    │   │   ├── settings.ts            # get/set settings at any scope
    │   │   ├── providers.ts           # list providers, test connection, listModels
    │   │   ├── tools.ts               # tool catalog + permission state
    │   │   ├── mcp.ts                 # MCP server CRUD + status
    │   │   ├── files.ts               # workspace read/write helpers for renderer
    │   │   ├── permissions.ts         # prompt user for permission (open dialog)
    │   │   └── dialog.ts              # native open/save dialogs
    │   │
    │   ├── providers/                 # LLM provider adapters
    │   │   ├── base.ts                # ProviderAdapter interface + helpers
    │   │   ├── openai-compatible.ts   # base for OpenAI-shaped APIs
    │   │   ├── openrouter.ts          # OpenRouter
    │   │   ├── groq.ts                # Groq
    │   │   ├── mistral.ts             # Mistral
    │   │   ├── ollama.ts              # Ollama (local)
    │   │   ├── openai.ts              # OpenAI
    │   │   ├── anthropic.ts           # Anthropic Messages API
    │   │   ├── gemini.ts              # Google Gemini
    │   │   ├── custom.ts              # user-supplied OpenAI-compatible URL
    │   │   └── registry.ts            # registers all, key resolution
    │   │
    │   ├── tools/                     # Built-in tool implementations
    │   │   ├── base.ts                # Tool interface, ToolContext, registry
    │   │   ├── bash.ts                # spawn child_process, stream stdout/stderr
    │   │   ├── read.ts                # file read with offset/limit
    │   │   ├── write.ts               # file write
    │   │   ├── edit.ts                # exact string replacement
    │   │   ├── glob.ts                # tinyglobby wrapper
    │   │   ├── grep.ts                # @vscode/ripgrep wrapper
    │   │   ├── webfetch.ts            # fetch + readability → markdown + extract
    │   │   ├── websearch.ts           # DuckDuckGo HTML scrape (default) + pluggable
    │   │   ├── todowrite.ts           # in-session checklist
    │   │   ├── list-mcp-resources.ts
    │   │   ├── read-mcp-resource.ts
    │   │   └── registry.ts
    │   │
    │   ├── mcp/                       # MCP client
    │   │   ├── manager.ts             # spawn/connect/refresh servers
    │   │   ├── client.ts              # wraps SDK Client
    │   │   ├── transport-stdio.ts
    │   │   ├── config.ts              # parse ~/.infinite-ai.json + .mcp.json
    │   │   └── resources.ts           # list/read MCP resources
    │   │
    │   ├── agent/                     # The core agentic loop
    │   │   ├── loop.ts                # main think→tool→observe loop
    │   │   ├── stream.ts              # event emitter for renderer updates
    │   │   ├── permissions.ts         # rule matching, ask/allow/deny
    │   │   ├── system-prompt.ts       # build system prompt + tool list
    │   │   ├── context.ts             # assemble INFINITE.md + memory + history
    │   │   ├── subagent.ts            # spawn subagents (foreground/background)
    │   │   ├── hooks.ts               # PreToolUse / PostToolUse / etc.
    │   │   └── turn-limit.ts          # maxTurns enforcement
    │   │
    │   ├── session/                   # Session storage
    │   │   ├── store.ts               # JSONL append + load
    │   │   ├── index.ts               # SQLite FTS5 for search
    │   │   ├── transcript.ts          # read/write transcript entries
    │   │   └── cleanup.ts             # delete sessions older than N days
    │   │
    │   ├── memory/                    # Memory system
    │   │   ├── claude-md.ts           # INFINITE.md discovery
    │   │   ├── auto-memory.ts         # write/read auto-memory
    │   │   └── store.ts               # ~/.infinite-ai/memory/ helpers
    │   │
    │   ├── skills/                    # Skills framework
    │   │   ├── loader.ts              # parse markdown + frontmatter
    │   │   ├── registry.ts            # list + invoke
    │   │   └── runner.ts              # expand $ARGUMENTS, run with tool access
    │   │
    │   ├── settings/                  # Settings manager
    │   │   ├── store.ts               # CRUD with scope merge
    │   │   ├── scopes.ts              # precedence resolver
    │   │   ├── watcher.ts             # chokidar file watcher
    │   │   ├── schema.ts              # zod schemas
    │   │   └── secrets.ts             # safeStorage encryption for API keys
    │   │
    │   ├── workspace/                 # Workspace/project helpers
    │   │   ├── discover.ts            # find package.json, git root
    │   │   ├── trust.ts               # workspace trust dialog
    │   │   └── env.ts                 # env var propagation
    │   │
    │   └── util/
    │       ├── logger.ts              # pino
    │       ├── path.ts                # path utils
    │       ├── stream.ts              # SSE/JSONL stream parsing
    │       ├── os.ts                  # platform detection
    │       └── shell.ts               # detect pwsh vs bash
    │
    ├── preload/                       # Preload script (contextBridge)
    │   ├── index.ts                   # exposes window.api.*
    │   └── api/
    │       ├── chat.ts
    │       ├── session.ts
    │       ├── settings.ts
    │       ├── providers.ts
    │       ├── tools.ts
    │       ├── mcp.ts
    │       ├── files.ts
    │       ├── events.ts              # onStream, onPermission, onToolResult
    │       └── index.ts
    │
    └── renderer/                      # React UI
        ├── index.html
        ├── main.tsx                   # React root
        ├── App.tsx
        ├── router.tsx                 # session / settings / new
        │
        ├── components/
        │   ├── layout/
        │   │   ├── AppShell.tsx
        │   │   ├── Sidebar.tsx
        │   │   ├── TitleBar.tsx        # custom title bar
        │   │   └── StatusBar.tsx
        │   │
        │   ├── chat/
        │   │   ├── ChatView.tsx
        │   │   ├── MessageList.tsx    # virtualized
        │   │   ├── Message.tsx
        │   │   ├── UserMessage.tsx
        │   │   ├── AssistantMessage.tsx
        │   │   ├── StreamingText.tsx
        │   │   ├── InputBox.tsx
        │   │   ├── CommandAutocomplete.tsx
        │   │   ├── Attachments.tsx     # drag-drop files
        │   │   └── EmptyState.tsx
        │   │
        │   ├── tools/
        │   │   ├── ToolCallCard.tsx
        │   │   ├── BashOutput.tsx     # xterm.js
        │   │   ├── FilePreview.tsx    # Monaco read-only
        │   │   ├── DiffView.tsx       # Monaco diff editor
        │   │   ├── GlobResult.tsx
        │   │   ├── GrepResult.tsx
        │   │   ├── WebFetchCard.tsx
        │   │   ├── WebSearchCard.tsx
        │   │   ├── TodoList.tsx
        │   │   └── McpResourceCard.tsx
        │   │
        │   ├── sidebar/
        │   │   ├── SessionList.tsx
        │   │   ├── SessionItem.tsx
        │   │   ├── ProjectPicker.tsx
        │   │   └── NewSessionButton.tsx
        │   │
        │   ├── settings/
        │   │   ├── SettingsModal.tsx
        │   │   ├── Tabs.tsx
        │   │   ├── ProvidersTab.tsx
        │   │   ├── ProviderCard.tsx
        │   │   ├── ModelsTab.tsx
        │   │   ├── PermissionsTab.tsx
        │   │   ├── McpTab.tsx
        │   │   ├── HooksTab.tsx
        │   │   ├── SkillsTab.tsx
        │   │   ├── AppearanceTab.tsx
        │   │   ├── MemoryTab.tsx
        │   │   └── AboutTab.tsx
        │   │
        │   ├── permissions/
        │   │   ├── PermissionDialog.tsx
        │   │   └── PermissionRulePreview.tsx
        │   │
        │   ├── welcome/
        │   │   ├── Onboarding.tsx
        │   │   └── ProviderQuickstart.tsx
        │   │
        │   └── ui/                    # shadcn-style primitives
        │       ├── Button.tsx
        │       ├── Input.tsx
        │       ├── Textarea.tsx
        │       ├── Select.tsx
        │       ├── Dialog.tsx
        │       ├── Tabs.tsx
        │       ├── Switch.tsx
        │       ├── Tooltip.tsx
        │       ├── Toast.tsx
        │       ├── DropdownMenu.tsx
        │       ├── ScrollArea.tsx
        │       └── …                    # ~20 primitives total
        │
        ├── hooks/
        │   ├── useChat.ts             # stream + abort
        │   ├── useSession.ts
        │   ├── useSettings.ts
        │   ├── useProviders.ts
        │   ├── useModels.ts
        │   ├── useMcp.ts
        │   ├── usePermissions.ts
        │   ├── useShortcuts.ts
        │   └── useTheme.ts
        │
        ├── stores/                    # zustand
        │   ├── chat.ts                # messages, streaming state
        │   ├── session.ts             # current session, history
        │   ├── settings.ts            # mirror of main settings
        │   ├── ui.ts                  # sidebar, theme, modals
        │   └── permissions.ts         # pending prompts
        │
        ├── lib/
        │   ├── api.ts                 # typed wrapper over window.api
        │   ├── ipc.ts                 # re-exports from preload
        │   ├── format.ts              # token counts, timestamps
        │   ├── markdown.ts            # markdown components map
        │   ├── diff.ts                # compute + render diffs
        │   ├── cn.ts                  # classname helper
        │   └── constants.ts
        │
        ├── styles/
        │   ├── globals.css
        │   ├── themes.css
        │   └── monaco-overrides.css
        │
        └── assets/
            └── logo.svg
│
└── test/
    ├── unit/
    │   ├── providers/
    │   ├── tools/
    │   ├── agent/
    │   └── permissions/
    ├── integration/
    │   ├── ipc.test.ts
    │   └── mcp.test.ts
    └── e2e/
        ├── chat.spec.ts
        ├── diff.spec.ts
        └── permissions.spec.ts
```

---

## Build artifacts (gitignored)

```
node_modules/
dist/
out/
release/
.vite/
*.log
.DS_Store
```

---

## Runtime data (created on first run, gitignored)

| Path | Purpose |
| --- | --- |
| `~/.infinite-ai/settings.json` | User settings |
| `~/.infinite-ai/INFINITE.md` | Global instructions |
| `~/.infinite-ai/memory/<project-hash>/` | Auto memory |
| `~/.infinite-ai/sessions/<id>.jsonl` | Session transcripts |
| `~/.infinite-ai/sessions/index.db` | SQLite FTS5 search index |
| `~/.infinite-ai/skills/` | User skills |
| `~/.infinite-ai/agents/` | User subagent definitions |
| `~/.infinite-ai/secrets.bin` | Encrypted API keys (safeStorage) |
| `~/.infinite-ai.json` | MCP config (user scope) |
| `~/.infinite-ai/logs/` | Pino logs |
| `./INFINITE.md` | Project instructions |
| `./.infinite/settings.json` | Project settings |
| `./.mcp.json` | Project MCP config |
| `./.infinite/settings.local.json` | Local-only settings |
