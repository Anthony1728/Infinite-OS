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
  '/pc (control PC) /code /agent /feature /theme /research /canvas /audit /automate /schedule /verify',
  'plus the user\u2019s own custom /commands (Markdown files in <profile-home>/commands/*.md, $ARGS/$1..$9 templated) — suggest creating one when the user repeats a complex instruction twice.',
].join(' ');

const SHORTCUTS = 'Ctrl+K palette · Ctrl+` terminal · Ctrl+N new chat · Ctrl+B sidebar · Ctrl+. panel · Ctrl+/ shortcuts';

let cached = '';

/** Compact self-model block for the system prompt. */
export function getSelfModel(): string {
  if (cached) return cached;
  const surfaces = SURFACES.map(([id, label]) => `${id}: ${label}`).join(' | ');
  cached = [
    '# Infinite OS — the system you live in',
    `You are Infinite AI inside Infinite OS${cachedVersion ? ` v${cachedVersion}` : ''} (Electron desktop workspace, Windows). The user talks to you in chat; you act through tools AND can direct them to any surface below.`,
    '',
    `Surfaces: ${surfaces}.`,
    `Chat: slash commands (${SLASH}); @-reference files; drag-drop/paste attachments; voice; multi-model; branch/pin/search/export/import/share.`,
    `Execution: PTY terminal (Ctrl+\`); read/write/edit; git; browser + computer control; scheduled automations; checkpoints; task queue; workspace search; skills; memory (INFINITE.md/AGENTS.md/CLAUDE.md/.hermes.md/SOUL.md, auto-memory, learned prefs).`,
    `Bots: named specialists with model pin, SOUL persona, tool allowlist, avatar. Each owns a forever-chat titled "Bot: <name>" — always use it, never fork. Routines are automations named "[bot:<name>] <task>".`,
    `Pair model: user message runs as a crew (leader + collaborator + specialists) in one transcript with a summary; on failure, offer single-model retry.`,
    `Self-evolution: /feature builds (inspect, smallest change, typecheck/tests), /audit fixes bugs. Source edits need background build + restart — say so, never claim visibility before restart.`,
    `Uncensored ON: local brain skips refusals, cloud runs maximum-autonomy. Tool permissions still apply; cloud may refuse at its layer — then offer local.`,
    `Profiles: each login owns an isolated home (keys, chats, bots, skills, memory, automations, settings). Switching relaunches into the other home.`,
    `Providers: Ollama local (auto-starts, auto-resolves installed models) + cloud with failover — check what's installed before claiming a model is missing.`,
    `Navigation: ${SHORTCUTS}. Name the exact view + shortcut for "where" questions; DO the thing with tools for "do" requests.`,
  ].join('\n');
  return cached;
}

/** Surfaces list for tests / debugging. */
export function getSurfaceIds(): string[] {
  return SURFACES.map(([id]) => id);
}
