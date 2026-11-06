# Otto Parity Report

**Reference:** `C:\Users\acer\Desktop\otto-reference` at commit `ab96a7c` (Apache-2.0)
**Target:** Infinite OS (React 19 + Electron + TypeScript)
**Report date:** 2026-11-05
**Scope:** all 126 Swift files under `Sources/OttoApp`, the Otto design language, and the interaction models that fit a desktop AI workspace.

---

## 1. Why this report exists

Otto is a mature macOS AI workspace. Infinite OS should meet or exceed it without becoming a copy of it. This report does three things:

1. Records what was studied, so future work does not have to re-reverse-engineer the reference.
2. States exactly what has been rebuilt, what is partial, and what is still missing.
3. Documents the clean-room boundary: no Otto source, assets, strings, or branding are shipped in Infinite OS.

**Status legend**

| Status | Meaning |
| --- | --- |
| **Ported** | The behaviour exists in Infinite OS and is reachable in normal use. |
| **Partial** | A meaningful part exists, but an important capability is still absent. |
| **Missing** | No equivalent yet. |
| **Different** | Infinite OS solves the same need with a different structure; parity by outcome, not by layout. |

---

## 2. Clean-room and licence notes

Otto is Apache-2.0. Its **name, logo, and brand assets are trademarked** and are not covered by the code licence. Infinite OS therefore:

- **Does not copy** Swift source, comments, identifiers, literals, or view hierarchies.
- **Does not copy** Otto icons, logos, illustrations, sounds, or marketing copy.
- **Does not use** the Otto name or marks in the product, repository, or store listing.
- Reimplements **ideas and interaction patterns** in React/Electron using Infinite OS's own components, tokens, copy, and state model.
- Uses Otto only as a behavioural reference: what a surface does, what information it shows, and which decisions it asks the person to make.

Design ideas adopted (rebuilt, not copied):

- A nine-slot semantic palette: `ink`, `surface`, `raised`, `paper`, `muted`, `signal`, `amber`, `red`, `cyan`.
- Translucent glass over a live backdrop, **without blur**, so text stays crisp.
- Mono micro-labels for metadata, sentence case everywhere else.
- Quiet buttons; one accent per screen; no gradient soup.
- A daily Home that answers "what happened, what needs me, what did I pin".
- Approvals that block a run rather than decorate it.

Infinite OS keeps its own identity: name, mark, copy, orbital Home map, violet/cyan accent, and icon set.

---

## 3. Summary scorecard

| Domain | Status | Notes |
| --- | --- | --- |
| Home daily brief + reviews | **Ported** | Brief, needs-you set, quick capture, getting-started tour. |
| Pinned Home cards | **Ported** | Live file previews, reorder, compact/tall, per profile + workspace. |
| Blocking approvals | **Ported** | Approve / Comment / Reject; comment re-runs the agent and keeps the run pending. |
| Automations | **Ported** | Multi-step editor, per-step provider/model/account, conditions, approval gates. |
| Activity inbox | **Ported** | Digest one line per source, needs-you aggregation, raw stream, 5s refresh. |
| Memory graph | **Ported** | Real SQLite store: search, layers, relationship filters, neighbourhood focus, list/graph, detail panel, create/forget. |
| Chat queue / no double answer | **Ported** | Enter queues while streaming; auto-flush; "Send now" is the only interjection. |
| Browser | **Partial** | Navigation, tabs, live desktop strip; password vault and import are missing. |
| Documents / office | **Partial** | Editor, pages, artifacts, journal; no sheets/slides deck engine. |
| Dashboards | **Partial** | Dashboard surface exists; template/deck breadth is smaller. |
| Marketplace / plugins | **Ported** | Plugin store and install flow. |
| Voice | **Partial** | Voice views and session store; push-to-talk parity is incomplete. |
| Connectors / providers | **Ported** | Connectors, model providers, accounts, messaging surfaces. |
| Profiles / isolation | **Ported** | Password-gated profiles, per-profile storage, stale-session rejection. |
| Backups | **Partial** | Cloud sync + backup/restore view; no scheduled local snapshots yet. |
| First-run tour | **Ported** | Self-checking "Getting started" card on Home. |
| Mobile pairing | **Partial** | Pairing modal exists; full mobile companion is out of scope. |
| Design system | **Ported** | Semantic palette, glass, mono labels, quiet controls, one accent per screen. |

---

## 4. Full Otto source inventory

Every file in `Sources/OttoApp` is listed. Files are grouped by the surface they serve; a group may map to one or several Infinite OS surfaces.

### 4.1 Home, start, and first run

| Otto files | Infinite OS status | Infinite OS implementation |
| --- | --- | --- |
| `MorningHome`, `HomeBriefView`, `HomeCardsView`, `HomeConversationTarget`, `PersonalHomeView` | **Ported** | `PowerCenterView.tsx`: daily brief, live counters, quick capture, needs-you set. |
| `HomePinnedCards`, `HomePinsStore` | **Ported** | `components/home/HomePins.tsx` + `stores/homePins.ts`: live 12k-char previews, reorder, compact/tall, unpin, per-profile + workspace keys. |
| `HomeReviewsView` | **Ported** | `AutomationReviewCard` + the Home "Needs you" section; approvals are real blocking runs. |
| `HomeTour`, `FirstRunWelcomeView` | **Ported** | Self-checking "Getting started" card in `PowerCenterView.tsx`; hides when complete. |
| `OttoStartSurface`, `ChatWelcomeView` | **Different** | `ChatView` welcome/greeting plus the Home brief; Infinite OS keeps its orbital map instead of a start sheet. |
| `ChatWorkspaceView` | **Ported** | `ChatView` + `ChatWorkspaceHeader` + workspace side panel. |

### 4.2 Chat, messages, and assistants

| Otto files | Infinite OS status | Infinite OS implementation |
| --- | --- | --- |
| `ChatResult`, `ChatResultCards`, `AssistantResponsePresentation`, `MarkdownMessageView`, `MermaidDiagramView` | **Ported** | Markdown + GFM + KaTeX rendering, `CodeBlock`, tool cards, mermaid support. |
| `ConversationRenderPolicy` | **Ported** | Stream batching in `stores/chat.ts`, live transcript + final-message replacement. |
| `AssistantPanel` | **Ported** | Right panel / activity panel. |
| `AgentChildrenPanel`, `AgentConversationBody`, `AgentChoiceCard` | **Ported** | `MultiAgentView`, `AgentsView`, orchestration events. |
| `AgentManagerView`, `CustomAgentCreationView` | **Ported** | `AgentsView` + agent store. |
| `BotAvatarView`, `BotCreationAccountPicker`, `BotSubagentsEditor`, `AgentProviderLogo` | **Partial** | Bots view and subagents exist; provider logos are simplified. |
| `ComposerContextChips`, `ComposerDrafts`, `ComposerScroll` | **Ported** | Context chips, per-session composer drafts, scroll management. |
| `ChatImageAttachments`, `ChatPastedText`, `ChatDocumentLink`, `ChatBrowserPlace`, `ChatTerminalViews`, `EmulatedTerminalView` | **Partial** | Images and pasted text are supported; document links, browser place, and emulated terminal are not yet first-class chat places. |
| `MessageQueuePreview` | **Ported** | Queued-message banner in `ChatView` with remove + "Send now". |
| `TeamApprovalPreview`, `TeamApprovalView` | **Ported** | `AutomationReviewCard` and the review queues in Home, Automations, and Activity. |
| `CompletionNotifications` | **Ported** | Notification store + toasts; completion notifies once. |
| `TurnStatsText` | **Ported** | Session stats strip. |
| `WorkingContextMonitor`, `WindowVisibilityObserver` | **Ported** | Watchdog + visibility-aware timers. |

### 4.3 Automations, routines, playbooks, skills

| Otto files | Infinite OS status | Infinite OS implementation |
| --- | --- | --- |
| `AutomationsView`, `AutomationFlowView`, `AutomationFlowBuilder`, `AutomationFlowStyle` | **Ported** | `AutomationView.tsx` multi-step editor, chain conditions, step types, on-error policy. |
| `RoutineManagerView`, `RoutineAccountPicker` | **Ported** | Per-step provider/model/account selection; scheduled runs use the selected model and refuse silent local fallback. |
| `PlaybookManagerView` | **Partial** | Automations cover the workflow; a distinct playbook library is not built. |
| `SkillsView` | **Ported** | `CapabilitiesView` tools & skills surface. |

### 4.4 Activity and observability

| Otto files | Infinite OS status | Infinite OS implementation |
| --- | --- | --- |
| `ActivityInboxView` | **Ported** | `components/activity/ActivityInbox.tsx`: digest, needs-you, raw stream, 5s refresh. |
| `TurnStatsText`, `CompletionNotifications` | **Ported** | Stats strip, completion toasts. |
| `OttoDevProbe`, `DevelopmentAutoReloader` | **Different** | Dev tooling exists in the build; no in-app probe. |

### 4.5 Memory

| Otto files | Infinite OS status | Infinite OS implementation |
| --- | --- | --- |
| `MemoryGraphView`, `MemoryGraphSurface`, `MemoryInspectorView` | **Ported** | `ActiveMemoryView.tsx`: search, all/personal/operating layers, relationship chips, neighbourhood-only, SVG graph, list mode, detail panel, create/forget. Reads and writes the main-process SQLite memory store through IPC; the legacy `MemoryPanel` and the duplicate `active-memory` route/nav entry were removed. |

### 4.6 Browser

| Otto files | Infinite OS status | Infinite OS implementation |
| --- | --- | --- |
| `BrowserBody`, `OttoBrowserChrome`, `OttoBrowserCompactChrome`, `BrowserNavigationShortcut` | **Ported** | `BrowserControlView` + browser store: tabs, navigation, compact chrome. |
| `BrowserHistoryStore` | **Partial** | History is tracked in session; persistent history UI is not complete. |
| `BrowserImportView` | **Missing** | No bookmark/history import from Chrome/Edge/Safari yet. |
| `BrowserPasswords` | **Missing** | No password vault. Deliberately deferred until OS keychain integration is designed. |
| `BrowserPopupWindows`, `BrowserSignInDiagnostics` | **Partial** | Popups handled by Electron; sign-in diagnostics are not surfaced. |
| `WebsiteAccountsView` | **Partial** | Connectors/account list exists; per-site account mapping is not built. |

### 4.7 Documents, sheets, slides

| Otto files | Infinite OS status | Infinite OS implementation |
| --- | --- | --- |
| `DocumentsView`, `DocEditorView` | **Partial** | `PagesView`, `ArtifactsView`, `editor` store, markdown editing. |
| `SheetEditorView`, `SheetGrid`, `SheetTabs` | **Missing** | No spreadsheet engine. |
| `SlidesEditorView`, `DeckEngine`, `DeckTemplates` | **Missing** | No slide editor/deck engine. |
| `MarkdownMessageView`, `MermaidDiagramView` | **Ported** | Markdown and mermaid rendering in chat/documents. |

### 4.8 Dashboards

| Otto files | Infinite OS status | Infinite OS implementation |
| --- | --- | --- |
| `DashboardsView` | **Partial** | `DashboardsView` exists with live widgets; template breadth and deck composition are smaller than Otto's. |

### 4.9 Marketplace, apps, updates

| Otto files | Infinite OS status | Infinite OS implementation |
| --- | --- | --- |
| `MarketplaceView`, `MarketplaceCatalogStore` | **Ported** | `PluginStoreView` + plugin store and install flow. |
| `PluginLogo`, `AppInstallLocation`, `AppUpdateController`, `AppUpdateViews` | **Partial** | Plugin install/location handled; a dedicated app-update centre is not surfaced. |

### 4.10 Voice

| Otto files | Infinite OS status | Infinite OS implementation |
| --- | --- | --- |
| `VoiceController`, `VoiceShortcut`, `VoicePushToTalkMonitor`, `VoiceSettingsView` | **Partial** | `VoiceView` + `voice-session` store; push-to-talk and system shortcut parity are incomplete. |
| `OttoBuddy`, `OttoBuddyViews`, `OttoFamilyFace` | **Different** | Infinite OS uses its own assistant presence; no character system. |

### 4.11 Connectors and providers

| Otto files | Infinite OS status | Infinite OS implementation |
| --- | --- | --- |
| `ConnectorsSettingsView`, `AppConnectionsView` | **Ported** | `ConnectorsView` + connectors settings. |
| `ModelProviderSettingsView`, `ProviderAccountViews`, `ProviderModelCatalogStore` | **Ported** | Settings model providers, accounts, model catalog. |
| `MessagingPreview`, `MessagingSettingsView` | **Ported** | `MessagingView` + messaging settings. |
| `CommunityLinks` | **Different** | In-app help/community links; no copied copy. |

### 4.12 Profiles, settings, backups, feedback

| Otto files | Infinite OS status | Infinite OS implementation |
| --- | --- | --- |
| `ProfileViews`, `ProfileKeyboardSwitcher` | **Ported** | Password-gated profile menu, per-profile storage, session guards. |
| `ProductSettingsViews`, `ShortcutsSettingsView`, `ThemeBackgroundView` | **Ported** | `SettingsView`, shortcut settings, theme colour + backdrop controls. |
| `BackupSettingsView`, `BoatCloudView` | **Partial** | `CloudSyncView` with devices, backups, restore; no scheduled local snapshot policy editor. |
| `FeedbackSheet` | **Different** | Feedback goes through the project issue template. |

### 4.13 Shell, design system, and window chrome

| Otto files | Infinite OS status | Infinite OS implementation |
| --- | --- | --- |
| `OttoPalette`, `OttoButtonStyles`, `OttoToggleStyles`, `OttoTooltip`, `OttoToast`, `OttoMotion`, `OttoFluidHover`, `OttoScrollChrome` | **Ported** | Semantic palette, quiet buttons, toasts, motion, scroll styling, tooltips. |
| `CommandPaletteOverlay`, `CommandPaletteNavigation` | **Ported** | `components/command/CommandPalette.tsx`; label/category/id/keyword search with label matches ranked first, flat ranked list while searching, Activity Inbox entry, reset on close. |
| `OttoSpaceController`, `WorkspaceUIState`, `WorkspaceView`, `WorkPanelResizeHandle` | **Ported** | App shell, view routing, workspace view, resizable panels. |
| `OttoMark`, `OttoApp`, `OttoAppResources` | **Different** | Infinite OS name/mark and own resources. No Otto branding is shipped. |
| `LandscapeScenes` | **Different** | Live backdrop and theme colour replace the scene library. |
| `OttoHarnessLaunchReadiness` | **Different** | Provider readiness and failover live in settings/chat. |

---

## 5. What was actually rebuilt in this pass

### 5.1 Blocking approvals (not decorative)

- `PendingApproval` registry with a real `waitForApproval` promise. A run **stops** at an approval step.
- Three decisions: **Approve**, **Comment**, **Reject**.
- Comment does **not** unblock the run. It stores the reviewer note, re-runs the agent with the draft and the note, and emits a revised draft as a new pending approval.
- Reject and cancel end the run with `ApprovalRejectedError` / `RunAbortedError`; nothing continues silently.
- Events (`approval_requested`, `approval_updated`, `approval_resolved`) drive the UI live.
- Review queues appear on Home, Automations, and Activity.
- Every automation step carries its own provider/model. Scheduled runs resolve the selected model and throw `NoActiveModelError` rather than falling back to a local model.

**Files:** `src/main/automation/builder.ts`, `src/main/ipc/automation.ts`, `src/renderer/stores/automation.ts`, `src/renderer/components/automation/AutomationReviewCard.tsx`, `src/renderer/components/views/AutomationView.tsx`.
**Tests:** `src/main/automation/builder.test.ts` — 10 passing, including four blocking-approval cases.

### 5.2 Queued chat (no double answers)

- Enter while streaming **queues** the message instead of racing the live run.
- The queue is per session and flushes in order after the run ends.
- Each queued item can be removed or sent immediately with **Send now** (the only explicit interjection).
- The composer keeps drafts per session.

**Files:** `src/renderer/stores/chat.ts`, `src/renderer/components/chat/ChatView.tsx`.

### 5.3 Pinned Home cards

- A pin references a file and never mutates it.
- Live preview refreshes on focus and every 25 seconds; previews stop at 12,000 characters.
- Reorder earlier/later, compact/tall, unpin.
- Pins are keyed by profile **and** workspace, so two accounts on one machine cannot see each other's Home.
- Quick Capture can save and pin in one action.

**Files:** `src/renderer/stores/homePins.ts`, `src/renderer/components/home/HomePins.tsx`, `src/renderer/components/views/PowerCenterView.tsx`.

### 5.4 Activity inbox

- Digest of today's finished runs, one line per source.
- Failures sort first, then cancellations, then completions; newest first within a state.
- “Needs you” aggregates pending approvals, watchdog findings, and failed runs.
- Raw-stream toggle exposes every run.
- Refreshes every 5 seconds; the Desktop tracker is the second tab.

**Files:** `src/renderer/components/activity/ActivityInbox.tsx`, `src/renderer/components/views/ActivityTrackerView.tsx`, `src/shared/ipc.ts`, `src/main/ipc/automation.ts`, `src/preload/index.ts`.

### 5.5 Memory graph

- One surface: `memory` and `active-memory` both route to `ActiveMemoryView`; the weak legacy `MemoryPanel` was deleted and the duplicate navigation entries were removed.
- Reads and writes the **real** main-process SQLite memory store (`~/.infinite-ai/<profile>/memory.db`) through `listMemories`, `createMemory`, and `deleteMemory` IPC. No seed data and no `localStorage` shadow store.
- Honest empty, loading, and error states; "Add the first memory" creates through the same store chat recall uses.
- Search keys and values.
- Layers: all / personal (preferences, patterns) / operating (context, facts, workflows), mapped from the stored `type`, `tier`, and tags.
- Relationship chips filter by category.
- Neighbourhood-only focus around the selected node.
- Graph and list modes share one detail panel: relevance, connections, access count, created, last used, forget.
- Edges are derived only from shared category or shared meaningful words; the graph never invents links.

**Files:** `src/renderer/components/views/ActiveMemoryView.tsx`, `src/preload/index.ts`, `src/main/memory/store.ts`.
**Test:** `e2e/otto-surfaces.spec.ts` seeds the store via IPC and verifies graph and list rendering against it.

---

## 6. Deliberate differences

These are not gaps; they are product decisions.

1. **Identity.** Infinite OS keeps its own name, mark, orbital Home, and violet/cyan accent. Otto's name and logo are never used.
2. **Home structure.** Otto centres a daily brief; Infinite OS keeps the orbital map and adds the brief, needs-you set, pins, and tour beneath it.
3. **Approvals.** Infinite OS requires a blocking promise and a comment-revision loop; approvals cannot be dismissed into a "maybe later" state.
4. **Models.** No silent local fallback. A missing model is a visible error, not a degraded answer.
5. **Chat.** A message typed during a run always waits by default. Interjection is an explicit per-message action.
6. **Memory.** The graph is explainable (shared words / shared layer), not an opaque embedding visualisation.
7. **Platform.** Infinite OS targets Windows, macOS, and Linux through Electron; Otto's macOS-only integrations (Keychain-only flows, native window scenes) are replaced or deferred rather than imitated.

---

## 7. Remaining gaps and next steps

Priority order:

1. **Browser passwords/import** — needs OS keychain design before implementation; do not store secrets in localStorage.
2. **Browser history** — a persistent, searchable history UI on top of the existing navigation store.
3. **Sheets/slides** — a real grid engine and deck model are multi-week work; keep documents/editor until then.
4. **Voice push-to-talk** — global shortcut + hold-to-talk monitor; current voice session is manual.
5. **Scheduled local backups** — policy editor (frequency, retention, location) on top of `CloudSyncView`.
6. **Dashboards breadth** — add deck templates and more widget types.
7. **Docs refresh** — README feature list now mentions approvals, queue, pins, inbox, and memory graph; keep it current as surfaces land.

Theme presets already exist: `src/renderer/stores/ui.ts` defines eleven templates, including Otto-inspired `shorelight`, `ringfall`, `velvet`, and `graphite`. The command palette now searches labels, categories, ids, and keywords, ranks label matches first, shows a flat ranked result list while searching, and includes the Activity Inbox.

---

## 8. Verification log

Run on 2026-11-05 from the repository root:

| Check | Result |
| --- | --- |
| `npm run typecheck` (node, web, e2e) | Pass |
| `npm test` | 1666 passed, 31 skipped |
| `npx vitest run src/main/automation/builder.test.ts src/renderer/stores/chat.test.ts src/main/profiles/home.test.ts` | 32/32 pass |
| `npx eslint` on all changed files | Pass |
| `npm run build` | Pass (Vite chunk-size advisory only) |
| `npx playwright test e2e/app-smoke.spec.ts e2e/layering-check.spec.ts e2e/toolbar-collapse-check.spec.ts e2e/otto-surfaces.spec.ts` | 4/4 pass |
| `e2e/otto-surfaces.spec.ts` coverage | Pinned card, activity inbox digest/raw stream, real-store memory graph (graph + list), command-palette keyword search |

---

## 9. Attribution

Otto is an Apache-2.0 project. This report records behavioural study only. Infinite OS ships no Otto source, assets, or trademarks. If any future contribution is derived from Otto code rather than reimplemented, it must carry the Apache-2.0 notice and be reviewed for trademark separation before merge.
