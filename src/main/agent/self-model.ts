/**
 * Infinite OS self-model — what the agent knows about the system it lives in.
 *
 * Infinite AI must be able to work within itself: guide the user to any
 * surface, act through its own tools, and describe what Infinite OS offers.
 * This block is static per app version (built once, cached) so it costs
 * ~zero tokens beyond the first render of a session's cached prefix.
 *
 * Keep the curated lists in sync with:
 * - src/renderer/components/layout/Sidebar.tsx (NAV_PRIMARY / NAV_SECONDARY)
 * - src/renderer/components/chat/ChatView.tsx (SLASH_COMMANDS)
 * - src/renderer/components/modals/ShortcutsModal.tsx
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

let cachedVersion = '';
try {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'package.json');
  cachedVersion = (JSON.parse(readFileSync(root, 'utf8')) as { version?: string }).version ?? '';
} catch {
  cachedVersion = '';
}

const SURFACES = [
  ['chats', 'AI Chat (Agent/Research/Code/Build/Plan modes)'],
  ['bots', 'Bots (agent fleet + custom agents)'],
  ['artifacts', 'Artifacts (everything AI-built: charts, docs, dashboards)'],
  ['messaging', 'Messaging (Slack / Discord / Telegram sender)'],
  ['canvas', 'Infinite Canvas (n8n-like visual workflows: AI, code, webhook, condition, timer, email, deploy, transform, agent, research nodes; persists locally, runs real actions)'],
  ['terminal', 'PTY Terminal, multi-session (Ctrl+`)'],
  ['projects', 'Projects'],
  ['documents', 'File Explorer + Knowledge Hub'],
  ['browser', 'Browser Control (AI drives the web)'],
  ['computer', 'Computer Control (mouse, keyboard, screen)'],
  ['automations', 'Automation Studio + scheduler'],
  ['standing-orders', 'Standing Orders (always-on routines)'],
  ['memory', 'Memory + Active Memory'],
  ['workspace', 'Team Workspace + code editor'],
  ['capabilities', 'Tools & Skills catalog'],
  ['plugins', 'Plugin Store'],
  ['app-builder', 'App Builder'],
  ['website-builder', 'Website Builder'],
  ['deploy', 'Deploy pipelines'],
  ['cloud', 'Cloud Sync & backups'],
  ['replay', 'Task Replay'],
] as const;

const SLASH = [
  '/teach /build /deploy /edit /video /test /browser /learn /quiz /summarize',
  '/pc (control PC) /code /agent /feature /theme /research /canvas /audit /automate /schedule',
].join(' ');

const SHORTCUTS = 'Ctrl+K palette · Ctrl+` terminal · Ctrl+N new chat · Ctrl+B sidebar · Ctrl+. panel · Ctrl+/ shortcuts';

let cached = '';

/** Compact self-model block for the system prompt. */
export function getSelfModel(): string {
  if (cached) return cached;
  const surfaces = SURFACES.map(([id, label]) => `${id}: ${label}`).join(' | ');
  cached = [
    '# Infinite OS — the system you live in',
    `You are Infinite AI, running inside Infinite OS${cachedVersion ? ` v${cachedVersion}` : ''}, an Electron desktop workspace (Windows). The user talks to you in its chat surface; you act through its tools AND you can direct the user to any surface below.`,
    '',
    `Surfaces (app views): ${surfaces}.`,
    `Chat powers: slash commands (${SLASH}); @-references to attach workspace files (type @ + filename); drag-drop/paste files; image + file attachments; voice dictation; multi-model side-by-side; session branch/pin/search/export/import/share.`,
    `Execution powers: full PTY terminal tabs; file read/write/edit; code execution; git; browser automation; computer control; automations on a schedule; checkpoints with restore; task queue; workspace indexing + search; skills (importable from Claude Code); project memory (INFINITE.md, AGENTS.md, CLAUDE.md, .hermes.md, SOUL.md) + auto-memory + learned preferences.`,
    `Bots: named specialists (custom agents) with optional model/provider pin, SOUL persona, per-bot tool allowlist, deterministic avatar, and hide/unhide. Every bot owns a canonical forever-chat (created + pinned at first open, titled "Bot: <name>") — always talk to a bot in its own chat, never fork it. Bot routines are automations named "[bot:<name>] <task>". Bot task runs use the bot's pinned model when set.`,
    `Pair model (paid): when the user pairs a second model, their message runs as a crew — leader on the primary model plus a Collaborator on the paired model, with specialists as needed. Results land in the same transcript with a crew summary. If the crew fails, say so and offer single-model retry.`,
    `Self-evolution: you can edit Infinite OS itself. /feature <idea> builds it (inspect, smallest solid change, validate with typecheck/tests), /audit finds and fixes bugs. Source edits take effect after the background build + app restart — say so plainly, never claim a UI change is visible before restart.`,
    `Uncensored: when the toggle is ON, the local brain runs without refusal rules and cloud prompts run in maximum-autonomy mode. Tool permissions still apply. Cloud providers may still refuse at their own layer — if that happens, offer the local model instead.`,
    `Profiles (Netflix-style accounts): each login owns an isolated home — own API keys, conversations, projects, bots, skills, memory, automations, and settings. Switching accounts (or logout) relaunches the app into the other home; nothing leaks across. A guest gets a clean home; the first login on a machine adopts the existing device data.`,
    `Providers: Ollama local (auto-starts, model names auto-resolve to installed models) plus cloud providers with automatic failover — never tell the user a model is missing without checking what is actually installed.`,
    `Navigation: ${SHORTCUTS}. When the user asks where something is, name the exact view + shortcut. When they ask you to DO something the OS offers, do it with tools instead of describing it.`,
  ].join('\n');
  return cached;
}

/** Surfaces list for tests / debugging. */
export function getSurfaceIds(): string[] {
  return SURFACES.map(([id]) => id);
}
