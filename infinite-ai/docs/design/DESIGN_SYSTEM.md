# Infinity AI — Design Reference

> The mockup the user shared (saved to `docs/design/`) defines the target UI for Infinite AI. This doc captures the design system so we can rebuild the renderer to match.

## Brand

- **Name**: Infinity AI (with infinity-loop logo `∞`)
- **Tone**: Premium, dark, gradient-accented, "everything in one place"
- **Differentiator vs Claude Desktop**: Multi-agent system, Infinite Canvas (node editor), Projects with frontend/backend/database, Workspace split modes, Computer Control, Browse Mode, 6+ native integrations

## Layout (3-column dashboard)

```
┌─────────────────────────────────────────────────────────────┐
│  TopBar: [search ⌘K] [CPU] [RAM] [Agents] [Tasks] [profile]│
├──────────┬──────────────────────────────────────┬───────────┤
│ Sidebar  │  Main content                        │ Right     │
│          │                                       │ Panel     │
│ Logo     │  Greeting                            │           │
│ + New    │  Tab pills (AI Chat/Canvas/Code/...)  │ Agents    │
│ Chats    │  Chat thread                          │ ━━━━━━━━  │
│ Agents   │  Project cards                        │ Workspace │
│ Projects │  Smart input bar                      │ ━━━━━━━━  │
│ Docs     │                                       │ Tasks     │
│ Memory   │                                       │           │
│ Settings │                                       │           │
│          │                                       │           │
│ Starred  │                                       │           │
│ ───────  │                                       │           │
│ Model    │                                       │           │
│ Usage    │                                       │           │
│ Connected│                                       │           │
│ ───────  │                                       │           │
│ Profile  │                                       │           │
└──────────┴──────────────────────────────────────┴───────────┘
```

## Design tokens

| Token | Value |
| --- | --- |
| Background base | `hsl(240 10% 4%)` — near black, slight purple tint |
| Background elevated | `hsl(240 8% 7%)` — sidebar / right panel |
| Card surface | `hsl(240 7% 9%)` with `1px border hsl(240 6% 14%)` |
| Accent gradient | `from-violet-500 via-purple-500 to-blue-500` |
| Accent solid | `hsl(262 90% 65%)` |
| Text primary | `hsl(0 0% 98%)` |
| Text muted | `hsl(240 5% 65%)` |
| Text subtle | `hsl(240 5% 45%)` |
| Border | `hsl(240 6% 14%)` |
| Success | `hsl(142 70% 50%)` |
| Warning | `hsl(38 92% 55%)` |
| Danger | `hsl(0 75% 60%)` |
| Info | `hsl(217 91% 60%)` |

## Sidebar

- Width: `w-64` collapsed to `w-16` (icon-only)
- Logo + "INFINITY AI" wordmark at top
- "+ New Chat" CTA, full width, gradient background, ⌘N hint
- Nav items: Chats, Agents, Projects, Documents, Automations, Memory, Workspace, Settings
  - Each has an icon, label, optional badge
  - Active item: gradient background or left accent bar
- "STARRED" section with 4 entries (E-commerce Platform, Marketing Strategy, Financial Analysis, Website Redesign) with colored status dots
- Model card: "Model: Infinity Ultra", "Usage This Month: 87%", progress bar (gradient)
- "CONNECTED" status: Local PC, Browser, Files (with green dots)
- User profile: avatar + "Alex Johnson" + "Pro Plan" + chevron

## TopBar

- Sticky, `h-12`
- Center: search input with `⌘K` hint, glassmorphism
- Right: status pill group
  - CPU: 14% + sparkline
  - RAM: 6.2 GB + sparkline
  - Agents: 12 + bar chart icon
  - Tasks: 47 + waveform icon
- Profile menu (right)

## Main content

### Greeting header
- "Good morning, Alex" — `text-3xl font-semibold`
- Subtitle: "Infinity is ready to build, analyze and automate anything for you." — `text-fg-muted`

### Tab pills (quick action switcher)
- 6 tabs: AI Chat, Infinite Canvas, Code, Analyze, Automate, Research, Design
- Each: icon + label, pill shape
- Active: gradient background, others ghost

### Chat thread
- User message: right-aligned, avatar "You", timestamp right
- AI message: left-aligned, gradient avatar "∞", timestamp + `...` menu
- AI response: checklist of completed items (✓ checkboxes), dashboard preview screenshot, action button row (Preview, Edit Code, Deploy, Add to Project)
- Suggestion chips: "Add dark mode", "Add email notifications", "Integrate Stripe", "Add team settings" with refresh/share icons

### Smart input bar
- Glassmorphic, rounded-2xl
- Left: attachment, web, gallery, mic icons
- Center: "Ask Infinity anything..."
- Right: "Agent Mode" dropdown + gradient send button (▸)
- Floating above content, `max-w-4xl`

### Project cards (bottom of main)
- "Project Infinity" title + avatar group + actions
- 4 cards: Frontend, Backend, Database, Docs, Deploy
- Each shows folder tree with `app/`, `components/`, `package.json` etc.
- Deploy card: Vercel logo, "Production" badge, "Visit Site" button

## Right panel

### Agents
- Header: "Agents" + "+ New Agent" button
- Tabs: ACTIVE (12), IDLE (4), ALL (16)
- 5 visible agent cards:
  - Avatar (icon in colored bg)
  - Name + status text
  - Right side: "Working" (with bolt ⚡) or "Active" (green dot) or "Idle" (gray dot)
- "View all agents →" link

### Workspace
- Tab group: Chat | Code Editor (split-mode icons above)
- Code preview: monospace, syntax highlighted, line numbers

### Tasks
- 4 task items:
  - Circular checkbox (✓ when done)
  - Task name
  - Right: progress bar + percentage + checkmark/x
  - Colors: green (done), purple (in progress)

## Features to build (per design map)

### Tier 1 (core MVP - build first)
- [x] Chat with streaming
- [x] Tools (bash/read/write/edit/glob/grep/web)
- [ ] Sidebar with nav, starred, model card, profile
- [ ] TopBar with search + status indicators
- [ ] Greeting + tab pills
- [ ] Smart input bar with Agent Mode
- [ ] Right panel: Agents, Workspace, Tasks
- [ ] Project cards at bottom of main

### Tier 2 (next)
- [ ] Infinite Canvas — node-based editor (React Flow)
- [ ] Multi-agent system (orchestrator + subagents)
- [ ] Workspace split modes (chat/code editor side-by-side)
- [ ] Computer Control tool
- [ ] Browse Mode (headless browser integration)
- [ ] File Manager view
- [ ] Automations builder
- [ ] Analytics dashboard
- [ ] Memory view

### Tier 3 (later)
- [ ] Splash + Onboarding flow
- [ ] Integrations: GitHub, Slack, Notion, Google Drive, Stripe, Zapier
- [ ] Theme toggle (dark/light/system)
- [ ] Responsive (tablet/mobile)
- [ ] Notifications center
- [ ] Command palette (⌘K) with all actions
- [ ] Profile & billing
- [ ] Deploy flow

## Animation system (from design spec)

- Entrance: fade-in, slide-up, scale-in (100-300ms)
- Micro: hover glow, button press, icon bounce, pulse dot, skeleton load, progress fill
- Transitions: page slide, cross-fade, zoom in/out, morph
- Gestures: click, double-click, long-press, drag, swipe
- Background processes (always running): auto-save, real-time sync, agent processing, memory indexing, file watcher, task scheduler, security scan, cloud backup

## Status states

- Idle, Loading, Thinking, Working, Success, Warning, Error, Offline, Syncing
