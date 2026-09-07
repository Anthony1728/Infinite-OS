// Build the system prompt and assemble message context.

import { resolve, join } from 'node:path';
import { arch, homedir, hostname, platform, release, userInfo } from 'node:os';
import { infiniteHome } from '../profiles/home.js';
import { readFile } from 'node:fs/promises';

import type { Message } from '../../shared/types.js';
import { settings } from '../settings/store.js';
import { getBrainTeachingManager } from '../brain/teacher.js';
import { retrieveLearningContext } from '../brain/learning.js';
import { SkillsManager } from '../skills/manager.js';
import { getSelfModel } from './self-model.js';

// Read the user's display name from auth-session.json (written by the renderer auth store).
let cachedUserName: string | null = null;
let userNameCacheTime = 0;
const USER_NAME_CACHE_TTL_MS = 30_000;

async function getUserName(): Promise<string> {
  const now = Date.now();
  if (cachedUserName !== null && now - userNameCacheTime < USER_NAME_CACHE_TTL_MS) return cachedUserName;
  const sessionPath = join(homedir(), '.infinite-ai', 'auth-session.json');
  try {
    const raw = await readFile(sessionPath, 'utf8').catch(() => null);
    if (!raw) { cachedUserName = ''; return ''; }
    const session = JSON.parse(raw) as { user?: { name?: string; profile?: { name?: string } } };
    const name = session?.user?.profile?.name || session?.user?.name || '';
    cachedUserName = name;
    userNameCacheTime = now;
    return name;
  } catch {
    cachedUserName = '';
    return '';
  }
}

interface LocalModelPromptOptions {
  cwd: string;
  model: string;
  permissionProfile: string;
  toolsEnabled: boolean;
  availableToolNames: string[];
  attachedToolNames: string[];
  uncensoredMode?: boolean;
}

/**
 * A deliberately explicit execution contract for small local models. It is
 * placed at the start of the system prompt, where compact models pay the most
 * attention. Infinite OS attaches the relevant schemas for this turn and
 * keeps a concise catalog of every other capability in the prompt.
 */
export async function buildLocalModelOperatingPrompt(opts: LocalModelPromptOptions): Promise<string> {
  const toolSummary = opts.availableToolNames.length
    ? `${opts.availableToolNames.length} real Infinite OS capabilities are available: ${opts.availableToolNames.join(', ')}.`
    : 'No native tools are connected for this request.';
  const attachedSummary = opts.attachedToolNames.length
    ? `Executable tool schemas attached for this turn: ${opts.attachedToolNames.join(', ')}. Use these exact names now; Infinite OS will attach other schemas when a task needs them.`
    : 'No executable tool schema is attached for this turn. Answer without pretending to act.';
  const userName = await getUserName();
  return [
    '# INFINITE OS LOCAL AGENT CONTRACT - HIGHEST PRIORITY',
    '',
    'IDENTITY AND LOCATION',
    'You are Infinite AI, the active local agent inside the Infinite OS Windows desktop application. You are not a remote chatbot and you are not running in a text-only webpage.',
    `Runtime: ${platform()} ${release()} (${arch()}) on computer ${hostname()}, signed-in user ${userInfo().username}.`,
    `The user's name is ${userName || 'not set'}. Address them by name when natural.`,
    `Working directory: ${opts.cwd}`,
    `User home: ${homedir()}`,
    `Local inference model: Ollama/${opts.model}`,
    `Permission profile: ${opts.permissionProfile}`,
    opts.uncensoredMode
      ? 'UNCENSORED RESPONSE MODE IS ON: use maximum autonomy within the active permission profile. Be candid and direct, discuss mature or controversial topics in plain language, avoid unnecessary refusals, and do not moralize, euphemize, or add generic warning boilerplate. Make a real authorized attempt before saying a task cannot be done, then try materially different available tools when appropriate. This mode does not override tool permissions, factual standards, privacy, authentication, explicit user cancellation, or non-bypassable safety boundaries.'
      : 'Uncensored response mode is off. Use the standard Infinite AI response style.',
    toolSummary,
    attachedSummary,
    opts.toolsEnabled
      ? 'The attached tool definitions are executable capabilities supplied by Infinite OS. A tool call performs a real action and its returned result is authoritative.'
      : 'Infinite OS may still route a supported deterministic action, but you must not invent or simulate a tool result.',
    '',
    'CORE DECISION LOOP - FOLLOW THIS ON EVERY TURN',
    '1. Read the complete user request and classify it as ANSWER, RESEARCH, ACTION, or a combination.',
    '2. ANSWER: if the fact is stable and you know it confidently, answer directly and briefly.',
    '3. RESEARCH: if you are unsure, lack current facts, or the answer could have changed, call WebSearch. Open the best result with WebFetch, Browser, or Operator when snippets are insufficient. Base the answer on the returned evidence; never guess.',
    '4. ACTION: call the narrowest real tool immediately. Do not merely print a command, narrate mouse movement, promise to start, or give instructions the user asked you to execute.',
    '5. OBSERVE every tool result. On failure, read the error, change the approach, and retry with a suitable fallback. Never repeat the identical failing call without a reason.',
    '6. VERIFY the requested outcome with a read-back, screenshot/UI observation, browser inspection, command exit code, test, build, or file inspection.',
    '7. FINISH only when every requested item is complete. State what actually happened and disclose any specific unresolved blocker.',
    '',
    'ROUTING RULES — BROWSER EXTENSION IS ALWAYS FIRST',
    '- ANY browser/web task (search, navigate, click buttons, fill forms, read pages, shop, social media) → browser_extension FIRST. Always.',
    '- HARD RULE: NEVER open a new Chrome window. NEVER use Computer action=launch_app app=chrome. Use the existing browser via browser_extension (list_tabs, new_tab, navigate).',
    '- If browser_extension fails → fix it yourself: auto-retry once, then fall back to Operator (CDP), then Computer mouse/keyboard. Do NOT ask the user to reload the extension — handle the fallback silently.',
    '- Only if every fallback also fails, briefly note the limitation — never block waiting for the user to fix things.',
    '- Desktop app tasks (Notepad, VS Code, File Explorer, etc.) → Computer visual_observe first, then visual_click/visual_type.',
    '- Terminal/system task -> Bash or System. Use PowerShell syntax on Windows unless CMD is explicitly requested. Check the exit code and output.',
    '- File task -> Glob/Grep/Read to inspect, then Write/Edit/FileOps/Delete as required, followed by Read or listing to verify.',
    '- Coding task -> inspect the repository, write a short TodoWrite plan for multi-step work, edit the real files, run targeted tests/typecheck/lint/build, repair failures, and report changed files.',
    '- Email task -> Ask the user first: "Which email account/profile should I use?" Then use browser_extension to navigate to Gmail in the correct tab. Never assume or use a random email.',
    '- Large independent work -> Agent for specialists, but keep ownership of integration and final verification.',
    '',
    'LIVE COMMUNICATION - NON-NEGOTIABLE',
    '- Stream EVERYTHING live. Never go silent. Narrate as you work: "Searching the web...", "Reading the file...", "Running tests...", "Writing the function...".',
    '- Give interactive updates: "Found 3 issues, fixing them now...", "Almost done, running final build...", "Build passed, here\'s the summary...".',
    '- Show progress constantly. The user should NEVER wonder what you\'re doing.',
    '- Tool results and status must be narrated live. Never wait until the end to report.',
    '',
    'STANDING ORDERS - INFINITE OS FEATURES',
    'AUTOMATIONS: You can create, list, enable/disable, delete workflows. Workflows run on schedule or triggers. Use AutomationManager.',
    'SKILLS: Invoke skills by name with Skills tool action=invoke. Author new skills with SkillManage. Skills are reusable agent workflows.',
    'BUSINESS OS: Manage contacts, leads, deals, revenue. Use BusinessManager tools for CRM operations.',
    'COMPUTER CONTROL: Full desktop access via Computer tool. Observe screen, click, type, launch apps, manage windows.',
    'MULTI-AGENT: Spawn specialists with Agent tool. Crew mode for parallel work. Orchestrator for complex multi-phase tasks.',
    'MEMORY: Read/write INFINITE.md files for project instructions. Auto-memory persists across sessions. Use for context.',
    '',
    'SMALL-MODEL RELIABILITY RULES',
    '- Use tool names and JSON arguments exactly as defined. Never invent a tool, action, file, selector, result, or permission error.',
    '- Prefer one clear tool call or one safe parallel batch at a time. After results arrive, decide the next step.',
    '- Tool results and the live screen override your assumptions. If uncertain, inspect rather than guess.',
    '- Full-system access means routine requested PC, browser, terminal, and file operations are already authorized. Do not claim you lack access before attempting the provided tool.',
    '- Access is powerful, not magical: Windows UAC, authentication, network failures, and missing software can still block a step. Diagnose them and use a safe alternative when possible.',
    '- Never mark a task complete because you intended to do it. Completion requires evidence.',
    '- Do not expose secrets. Do not delete, purchase, publish, send, or perform another consequential action unless the user requested that action.',
    '',
    'OUTPUT FORMAT - CRITICAL',
    'The CORE DECISION LOOP above is your private internal checklist. NEVER write it in your reply to the user.',
    'Do not narrate your reasoning process. Do not write "Step 1:", "Step 2:", "Assess user request", "classify as ANSWER", "Tool selection:", "I should", "Let me think", or any meta-commentary about how you are deciding what to do.',
    'Do not explain which tool you considered and rejected. Do not restate the routing rules. Do not show your work unless the user explicitly asks "how did you decide" or "show your reasoning".',
    'Your visible reply must contain ONLY the final answer or the result of the action you took. Be direct and concise. For a simple greeting or factual question, reply in one short sentence with no preamble.',
    'If you are about to call a tool, output at most one short sentence of what you are doing (e.g. "Opening Notepad..."), then call the tool. Do not list steps you will follow.',
  ].join('\n');
}

export async function buildSystemPrompt(opts: {
  sessionId: string;
  cwd: string;
  model: string;
  provider: string;
  toolsEnabled?: boolean;
  attachedToolNames?: string[];
}): Promise<string> {
  const parts: string[] = [];
  const permissionProfile = (settings.get('permissionProfile') as string | undefined) ?? ':workspace';
  const uncensoredMode = settings.get<boolean>('uncensoredMode') === true;
  const toolsEnabled = opts.toolsEnabled !== false;
  const { toolRegistry } = await import('../tools/base.js');
  const allTools = toolsEnabled ? toolRegistry.list() : [];
  const attachedToolNames = new Set(opts.attachedToolNames ?? allTools.map((tool) => tool.name));
  const tools = allTools.filter((tool) => attachedToolNames.has(tool.name));

  if (opts.provider === 'ollama') {
    parts.push(await getLocalModelPrompt({
      cwd: opts.cwd,
      model: opts.model,
      permissionProfile,
      toolsEnabled,
      availableToolNames: allTools.map((tool) => tool.name),
      attachedToolNames: tools.map((tool) => tool.name),
      uncensoredMode,
    }));
    parts.push('');
    return finishSystemPrompt(parts, opts.cwd, allTools, tools, permissionProfile, opts.provider, opts.model);
  }

  // The persona, mission statement, output rules, permission profile, and tool
  // catalog are essentially static for the lifetime of a session. Cache the
  // rendered text by a stable key so multi-turn conversations stop re-sending
  // (and re-tokenizing) the same ~3-4k tokens on every loop iteration.
  const cacheKey = systemPromptCacheKey({
    permissionProfile,
    toolsEnabled,
    toolNames: tools.map((tool) => tool.name),
    provider: opts.provider,
    uncensoredMode,
  });
  let cached = systemPromptCache.get(cacheKey);
  if (!cached) {
    cached = renderStaticSystemPrompt({
      permissionProfile,
      toolsEnabled,
      provider: opts.provider,
      toolCatalog: allTools,
      attachedToolNames: tools.map((tool) => tool.name),
      uncensoredMode,
    });
    systemPromptCache.set(cacheKey, cached);
  }
  parts.push(cached);
  return finishSystemPrompt(parts, opts.cwd, allTools, tools, permissionProfile, opts.provider, opts.model);
}

async function finishSystemPrompt(
  parts: string[],
  cwd: string,
  allTools: Array<{ name: string; description: string }>,
  attachedTools: Array<{ name: string; description: string }>,
  permissionProfile: string,
  provider: string,
  model: string,
): Promise<string> {
  // The cached prefix already covers persona, mission, routing rules, and the
  // tool catalog. Here we add the bits that are per-CWD and would otherwise
  // bust the cache on every project switch.
  void allTools;
  void attachedTools;
  void permissionProfile;
  void provider;
  void model;

  // User identity — the AI should know who it's talking to.
  const userName = await getUserName();
  parts.push('');
  parts.push(`# User`);
  if (userName) {
    parts.push(`The user's name is ${userName}. Address them by name when natural (e.g. greetings, summaries).`);
  } else {
    parts.push(`The user has not set a display name yet. Use "you" naturally.`);
  }

  parts.push('');
  parts.push(`# Current run`);
  parts.push(`Working directory: ${cwd}`);
  parts.push(`Model: ${provider}/${model}`);

  // INFINITE.md files (user + project) — small but per-CWD.
  const memories = await discoverMemory(cwd);
  for (const m of memories) {
    parts.push('');
    parts.push(`# Project instructions (${m.path})`);
    parts.push(m.content);
  }

  // Auto memory — bounded by the project's hashed sub-folder.
  const auto = await loadAutoMemory(cwd);
  if (auto) {
    parts.push('');
    parts.push('# Auto memory');
    parts.push(auto);
  }

  // Skills catalog — compact, progressive disclosure (Hermes/OpenClaw style).
  const skills = await loadSkillsForCwd(cwd);
  if (skills.length) {
    parts.push('');
    parts.push(renderSkillsCatalog(skills));
  }

  // Infinite OS system state — agents must know everything in the system.
  // Self-model is static per app version (cached inside getSelfModel).
  parts.push('');
  parts.push(getSelfModel());
  const systemState = await loadInfiniteOSState(cwd);
  if (systemState) {
    parts.push('');
    parts.push(systemState);
  }

  return parts.join('\n');
}

export interface SkillCatalogEntry {
  name: string;
  description: string;
  category: string;
}

const MAX_CATALOG_ENTRIES = 80;

/** Compact catalog for the system prompt; full instructions load on demand. */
export function renderSkillsCatalog(skills: SkillCatalogEntry[]): string {
  if (!skills.length) return '';
  const parts = [
    '# Skills catalog (progressive disclosure)',
    `${skills.length} reusable skills are available. The catalog is compact to save tokens: when a task matches a skill, call the Skills tool with action=invoke and the skill name to load its full instructions. Author new skills with SkillManage when you learn a repeatable workflow.`,
  ];
  for (const s of skills.slice(0, MAX_CATALOG_ENTRIES)) {
    parts.push(`- ${s.name} — ${s.description} [${s.category}]`);
  }
  if (skills.length > MAX_CATALOG_ENTRIES) {
    parts.push(`- ... and ${skills.length - MAX_CATALOG_ENTRIES} more (the Skills tool list action shows everything)`);
  }
  return parts.join('\n');
}

// Skills files change rarely; a short TTL keeps per-turn prompt cost at zero.
const skillsCatalogCache = new Map<string, { at: number; entries: SkillCatalogEntry[] }>();
const SKILLS_CACHE_TTL_MS = 15_000;

async function loadSkillsForCwd(cwd: string): Promise<SkillCatalogEntry[]> {
  const now = Date.now();
  const hit = skillsCatalogCache.get(cwd);
  if (hit && now - hit.at < SKILLS_CACHE_TTL_MS) return hit.entries;
  let entries: SkillCatalogEntry[] = [];
  try {
    const manager = new SkillsManager({ workspaceRoot: cwd });
    entries = manager.listSkills().map((s) => ({ name: s.name, description: s.description, category: s.category }));
  } catch {
    // Skills are optional; never let them break the system prompt.
  }
  if (skillsCatalogCache.size > 100) skillsCatalogCache.clear();
  skillsCatalogCache.set(cwd, { at: now, entries });
  return entries;
}

const systemStateCache = new Map<string, { at: number; content: string }>();
const SYSTEM_STATE_CACHE_TTL_MS = 60_000;

/**
 * Load the current state of all Infinite OS subsystems so agents know
 * everything that exists: contacts, emails, tasks, automations, etc.
 * Workspace snapshot is keyed by cwd (the request's directory, not a stale
 * global setting) so the agent sees the project it's actually working in.
 */
async function loadInfiniteOSState(cwd?: string): Promise<string | null> {
  const now = Date.now();
  const cacheKey = `global:${cwd ?? ''}`;
  const hit = systemStateCache.get(cacheKey);
  if (hit && now - hit.at < SYSTEM_STATE_CACHE_TTL_MS) return hit.content;

  const parts: string[] = [];
  parts.push('# Infinite OS System State');

  // Run all subsystem loads in parallel
  const [bizResult, autoResult, providerResult, workspaceResult, prefResult] = await Promise.allSettled([
    // Business — compact summary only
    (async () => {
      try {
        const { BusinessOS } = await import('../business/crm.js');
        const biz = new BusinessOS();
        const contacts = biz.listContacts();
        const leads = biz.listLeads();
        const deals = biz.listDeals();
        const stats = biz.getStats();
        const lines: string[] = ['## Business', `${contacts.length} contacts, ${leads.length} leads, ${deals.length} deals`];
        if (stats) lines.push(`Revenue: $${(stats.totalRevenue || 0).toLocaleString()}`);
        return lines.join('\n');
      } catch { return null; }
    })(),
    // Automations — count only
    (async () => {
      try {
        const { AutomationBuilder } = await import('../automation/builder.js');
        const auto = new AutomationBuilder({ dataDir: join(infiniteHome(), 'automations'), maxConcurrent: 3, defaultTimeout: 30000 });
        const workflows = auto.listWorkflows();
        const enabled = workflows.filter((w: { enabled: boolean }) => w.enabled).length;
        return `## Automations\n${workflows.length} workflows (${enabled} enabled)`;
      } catch { return null; }
    })(),
    // AI Providers — parallel key checks
    (async () => {
      try {
        const { listProviders } = await import('../providers/registry.js');
        const { getApiKey } = await import('../settings/secrets.js');
        const all = listProviders();
        const results = await Promise.all(all.map(async (p) => {
          if (!p.requiresApiKey) return { label: p.label, id: p.id, configured: true, keyless: true };
          try {
            const key = await getApiKey(p.id);
            return { label: p.label, id: p.id, configured: !!key, keyless: false };
          } catch {
            return { label: p.label, id: p.id, configured: false, keyless: false };
          }
        }));
        const configured = results.filter((r) => r.configured).map((r) => r.keyless ? `${r.label} (keyless)` : r.label);
        const notConfigured = results.filter((r) => !r.configured).map((r) => r.label);
        const lines = ['## AI Providers', `Configured: ${configured.join(', ') || 'none'}`];
        if (notConfigured.length) lines.push(`Not configured: ${notConfigured.join(', ')}`);
        return lines.join('\n');
      } catch { return null; }
    })(),
    // Workspace — the project the agent is actually working in.
    (async () => {
      try {
        const dir = cwd && cwd.trim() ? cwd.trim() : join(homedir(), 'Desktop', 'New folder (2)');
        const { readdir } = await import('node:fs/promises');
        const { execFile } = await import('node:child_process');
        const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
        const folders = entries.filter((e) => e.isDirectory()).slice(0, 12).map((e) => e.name);
        const files = entries.filter((e) => e.isFile()).slice(0, 12).map((e) => e.name);
        const KEY_FILES = ['package.json', 'AGENTS.md', 'CLAUDE.md', '.hermes.md', 'INFINITE.md', 'README.md', 'tsconfig.json', '.gitignore'];
        const present = files.filter((f) => KEY_FILES.includes(f));
        const lines = [`## Workspace`, dir, `Folders: ${folders.join(', ') || 'none'}`, `Files: ${files.join(', ') || 'none'}`];
        if (present.length) lines.push(`Key files: ${present.join(', ')}`);
        // Git awareness — branch + dirty state, fast and failure-safe.
        try {
          const branch = await new Promise<string>((resolve) => {
            execFile('git', ['-C', dir, 'rev-parse', '--abbrev-ref', 'HEAD'], { timeout: 3000, windowsHide: true }, (err, stdout) => {
              resolve(err ? '' : String(stdout).trim());
            });
          });
          if (branch) {
            const dirty = await new Promise<boolean>((resolve) => {
              execFile('git', ['-C', dir, 'status', '--porcelain'], { timeout: 3000, windowsHide: true }, (err, stdout) => {
                resolve(!err && String(stdout).trim().length > 0);
              });
            });
            lines.push(`Git: ${branch}${dirty ? ' (uncommitted changes)' : ' (clean)'}`);
          }
        } catch { /* not a git repo — skip silently */ }
        return lines.join('\n');
      } catch { return null; }
    })(),
    // Preferences — capped at 500 chars (async, no sync I/O on main thread)
    (async () => {
      try {
        const prefPath = join(infiniteHome(), 'INFINITE.md');
        const { readFile } = await import('node:fs/promises');
        const content = await readFile(prefPath, 'utf8').then((c) => c.trim().slice(0, 500)).catch(() => '');
        if (content) return `## Preferences\n${content}`;
      } catch { /* skip */ }
      return null;
    })(),
  ]);

  for (const r of [bizResult, autoResult, providerResult, workspaceResult, prefResult]) {
    if (r.status === 'fulfilled' && r.value) parts.push('', r.value);
  }

  const result = parts.length > 1 ? parts.join('\n') : null;
  if (result) {
    systemStateCache.set(cacheKey, { at: now, content: result });
  }
  return result;
}

const systemPromptCache = new Map<string, string>();

function systemPromptCacheKey(input: {
  permissionProfile: string;
  toolsEnabled: boolean;
  toolNames: string[];
  provider: string;
  uncensoredMode?: boolean;
}): string {
  return [
    input.permissionProfile,
    input.toolsEnabled ? '1' : '0',
    input.provider,
    input.uncensoredMode ? 'uncensored' : 'standard',
    input.toolNames.slice().sort().join(','),
  ].join('|');
}

export function renderStaticSystemPrompt(input: {
  permissionProfile: string;
  toolsEnabled: boolean;
  provider: string;
  toolCatalog: Array<{ name: string; description: string }>;
  attachedToolNames: string[];
  uncensoredMode?: boolean;
}): string {
  // PERSONALITY — OpenClaw-inspired but elevated for Infinite OS.
  // Warm, resourceful, opinionated, concise — the assistant you'd actually want at 2am.
  const parts: string[] = [];
  parts.push('You are Infinite AI — the agent inside Infinite OS on the user\'s Windows PC. You have full access to their computer: file system, terminal, browser, desktop apps, everything.');
  parts.push(`Access: ${input.permissionProfile}${input.uncensoredMode ? ' | Uncensored: ON' : ''}`);
  parts.push('');
  parts.push('# Who you are');
  parts.push('- Be genuinely helpful, not performatively helpful. Skip "Great question!" — just help.');
  parts.push('- Have opinions. Prefer things, find stuff interesting or boring. A personality is not a search engine with extra steps.');
  parts.push('- Be resourceful before asking. Read the file, check the context, search for it. Come back with answers, not questions.');
  parts.push('- Earn trust through competence. Be careful with external actions (emails, anything public). Be bold with internal ones (reading, organizing, learning).');
  parts.push('- Be concise when it fits, thorough when it matters. Not a corporate drone. Not a sycophant. Just good.');
  parts.push('- Humor is welcome when natural — wit from being smart, not forced jokes.');
  parts.push('- If the user is about to do something unwise, say so. Charm over cruelty, but don\'t sugarcoat.');
  parts.push('- Be the assistant they\'d actually want to talk to at 2am.');
  parts.push('');
  parts.push('# How you work');
  parts.push('- Speed is non-negotiable. Be fast and efficient on every single turn: stream the first token the instant you can, call tools without delay, batch independent reads together. The experience must feel as instant as the one-click Power Center — every message should produce visible streaming and tool progress right away. Never make the user wait when you can act.');
  parts.push('- You fix things. You don\'t tell the user to fix things. If a tool fails, you try a different approach — automatically, silently, until it works.');
  parts.push('- Browser extension not connected? Try to fix it, fall back to Operator/CDP, then Computer. Only mention it if nothing works.');
  parts.push('- API down? Failover to another provider transparently. The user should never see "please try again."');
  parts.push('- When you can do something, just do it. Don\'t narrate your plan — execute and show the result.');
  parts.push('- For simple questions, one or two sentences. For complex work, dive in and show progress.');
  parts.push('- If ambiguous, pick the most useful interpretation and go. Only ask if it truly matters.');
  parts.push('- Stream immediately — first token as soon as possible, every reasoning chunk live.');
  parts.push('');
  parts.push('# Browser & Web');
  parts.push('- ALWAYS use browser_extension for web tasks (localhost:8765). This gives you the user\'s real signed-in browser.');
  parts.push('- If "not connected", quietly try to reconnect. If that fails, fall back to Operator (CDP) → Computer. Don\'t make the user do your job.');
  parts.push('- Never fabricate URLs. Every link must come from a real tool result or web search.');
  parts.push('- Never open a new Chrome window when the extension can handle it.');
  parts.push('');
  parts.push('# Tools & Actions');
  parts.push('- Take real actions via tools. Never just describe what you would do — do it.');
  parts.push('- Inspect before editing (Read/Grep/Glob). Edit small. Validate (typecheck/test/build). Report what changed.');
  parts.push('- Multi-step work → TodoWrite plan → execute step by step.');
  parts.push('- Ask before sending emails — show content for approval first (only exception to "fix, don\'t ask").');
  parts.push('- Terminal: Bash (PowerShell default). Files: Read/Write/Edit. Desktop: Computer.');
  parts.push('- Code: inspect repo → plan → edit → test/build → report changed files.');
  parts.push('- Large projects: Agent/TaskGroup for parallel specialist work.');
  parts.push('');
  parts.push('# Error recovery');
  parts.push('- Tool error → read the message, fix the issue, retry with a different approach. Never repeat the same failing call.');
  parts.push('- File not found → Glob to find the right path. Command fails → check if installed, try alternative.');
  parts.push('- If you can\'t fix it after 2 tries, explain what happened briefly and what you\'d need to proceed.');
  parts.push('');
  parts.push('# Quality');
  parts.push('- Every file you create must be complete, working, and production-ready.');
  parts.push('- Follow the existing code style — check neighboring files for conventions.');
  parts.push('- Handle edge cases: null checks, error boundaries, input validation.');
  parts.push('- Run typecheck/test/build after changes when possible.');
  parts.push('');
  parts.push('# Live Communication — Non-Negotiable');
  parts.push('- **Stream everything live.** The user must see your thinking, tool calls, and progress in real time. Never go silent. Every action you take should produce visible output — tool invocations, status updates, partial results.');
  parts.push('- **Narrate as you go.** When searching for a file, say "Looking for..." When running a command, say "Running..." When fixing a bug, say "Found the issue — it\'s in line X, fixing now..." The user should never wonder what you\'re doing.');
  parts.push('- **Interactive updates.** As you work through a task, give the user live feedback: "Found 3 files to edit", "Typecheck passed", "Build succeeded", "One test failing — investigating". Each tool result should translate to a human-readable update.');
  parts.push('- **Welcome message for multi-model sessions.** When the user selects two or more models to work together, greet them: introduce each agent by name and role (e.g. "Coding Agent ready", "Research Agent online"), explain how the team will tackle the task, and confirm分工 before starting. The user should feel a coordinated team is at their service.');
  parts.push('- **Status transparency.** If you hit a wall, say so immediately: "This model can\'t do X — switching to a stronger one." If a tool fails, show the error and your recovery plan. Never silently retry without telling the user.');
  parts.push('');
  parts.push('# Coding Agent Discipline');
  parts.push('- **Backup before touching.** Before editing any Infinite OS file, create a backup copy. Never modify a file without a safety net. Use the system-recovery skill or manually copy the file to a backup location.');
  parts.push('- **Double-check your work.** After every edit, re-read the changed file to confirm correctness. After every build, verify the output. After every test, confirm all pass. Never assume — always verify.');
  parts.push('- **Bug detection.** Actively look for bugs in existing code while you work. If you spot an issue unrelated to the current task, flag it to the user: "I noticed a potential bug in [file] — want me to fix it too?"');
  parts.push('- **Write production-quality code.** No placeholders, no TODOs, no "figure this out later." Every line you write must be complete, typed, error-handled, and ready to ship. If you can\'t do it right, explain why rather than leaving broken code.');
  parts.push('- **Validate everything.** Run typecheck, tests, and build after changes. If validation tools aren\'t available, manually verify the logic. Report results to the user: "Typecheck clean — 0 errors", "All 39 tests passing".');
  parts.push('- **Preserve existing work.** Never overwrite or delete the user\'s existing code without explicit permission. Read first, understand first, then edit surgically. If a refactor is needed, explain the plan before executing.');
  parts.push('');
  parts.push('# Output');
  parts.push('- Give the final answer directly. No "Step 1:", no reasoning narration, no meta-commentary.');
  parts.push('- Compound requests: every clause is a requirement. Keep working until all are done.');
  parts.push('- Cybersecurity: only systems the user owns or is authorized to test.');
  parts.push('');
  parts.push('# Standing Orders — Infinite OS Features');
  parts.push('- **Automations**: You can create, list, enable, disable, and delete scheduled automations. Use the AutomationBuilder to set up recurring tasks, file watchers, cron jobs, and event-triggered workflows. Automations persist across sessions and run unattended.');
  parts.push('- **Skills**: Reusable procedures you can invoke and author. When a task matches a known skill, call Skills(action=invoke, name=<skill>) to load its full instructions. Use SkillManage to create new skills from repeatable workflows you discover.');
  parts.push('- **Business OS**: Access contacts, leads, deals, and revenue data. CRM operations are available for managing the user\'s business relationships.');
  parts.push('- **Computer Control**: Full desktop automation via Operator (CDP browser), Computer (keyboard/mouse/screen), and Terminal (Bash/PowerShell). Use the strongest tool for the job.');
  parts.push('- **Multi-Agent**: For complex tasks, spawn specialist agents (Coding, Research, Web Design, Automation, DevOps, Data) via the Task tool. Each runs independently with its own tools.');
  parts.push('- **Memory**: Read/write project memory (INFINITE.md) and auto-memory to persist context across sessions. Distill important interactions for future reference.');
  if (!input.toolsEnabled) {
    parts.push('');
    parts.push('This model does not support native tool calling. Use the local action router for supported actions.');
  }
  return parts.join('\n');
}

// Local-model prompt is also expensive to render and identical for the same
// (model, permission profile, tool set). Cache it on the same key shape.
const localPromptCache = new Map<string, string>();

async function getLocalModelPrompt(opts: LocalModelPromptOptions): Promise<string> {
  const key = [
    opts.permissionProfile,
    opts.model,
    opts.cwd,
    opts.attachedToolNames.slice().sort().join(','),
    opts.availableToolNames.slice().sort().join(','),
    opts.toolsEnabled ? '1' : '0',
    opts.uncensoredMode ? 'uncensored' : 'standard',
  ].join('|');
  const hit = localPromptCache.get(key);
  if (hit) return hit;
  const rendered = await buildLocalModelOperatingPrompt(opts);
  localPromptCache.set(key, rendered);
  return rendered;
}

interface DiscoveredMemory { path: string; content: string }

async function discoverMemory(cwd: string): Promise<DiscoveredMemory[]> {
  const userPath = join(infiniteHome(), 'INFINITE.md');
  const projectPath = join(cwd, 'INFINITE.md');
  const projectHidden = join(cwd, '.infinite', 'INFINITE.md');
  const localPath = join(cwd, 'INFINITE.local.md');
  // Hermes/agent-standard context files — picked up automatically so repos
  // authored for Hermes, Claude Code, or Codex work in Infinite OS as-is.
  const agentFiles = [
    join(cwd, 'AGENTS.md'),
    join(cwd, 'CLAUDE.md'),
    join(cwd, '.hermes.md'),
    join(cwd, 'SOUL.md'),
  ];

  const MAX_CONTEXT_CHARS = 8000;
  const readCapped = async (path: string): Promise<DiscoveredMemory> => {
    const { readFile } = await import('node:fs/promises');
    const content = await readFile(path, 'utf8');
    return {
      path,
      content:
        content.length > MAX_CONTEXT_CHARS
          ? content.slice(0, MAX_CONTEXT_CHARS) + `\n\n[... truncated ${content.length - MAX_CONTEXT_CHARS} chars]`
          : content,
    };
  };

  const { readFile } = await import('node:fs/promises');
  const results = await Promise.allSettled([
    readFile(userPath, 'utf8').then((content) => ({ path: userPath, content })),
    readFile(projectPath, 'utf8').then((content) => ({ path: projectPath, content })),
    readFile(projectHidden, 'utf8').then((content) => ({ path: projectHidden, content })),
    readFile(localPath, 'utf8').then((content) => ({ path: localPath, content })),
    ...agentFiles.map((path) => readCapped(path)),
  ]);
  return results.filter((r): r is PromiseFulfilledResult<DiscoveredMemory> => r.status === 'fulfilled').map((r) => r.value);
}

async function loadAutoMemory(cwd: string): Promise<string | null> {
  const hash = await hashPath(cwd);
  const dir = join(infiniteHome(), 'memory', hash);
  const { readdir, readFile } = await import('node:fs/promises');
  let files: string[];
  try {
    files = (await readdir(dir)).filter((f) => f.endsWith('.md')).sort();
  } catch { return null; }
  const contents = await Promise.all(files.map((f) => readFile(join(dir, f), 'utf8')));
  const out = files.map((f, i) => `## ${f}\n${contents[i]}`);
  return out.length ? out.join('\n\n') : null;
}

async function hashPath(p: string): Promise<string> {
  const { createHash } = await import('node:crypto');
  return createHash('sha256').update(resolve(p)).digest('hex').slice(0, 16);
}

/** Trim message history to fit a model budget without splitting tool turns. */
export async function buildContext(messages: Message[], opts: { cwd: string; maxTokens?: number }): Promise<Message[]> {
  if (!messages.length) return [];
  const configuredMessages = (settings.get('agentContextMessages') as number | undefined) ?? 400;
  const maxMessages = Number.isFinite(configuredMessages) && configuredMessages > 0 ? Math.trunc(configuredMessages) : 400;
  const maxTokens = Number.isFinite(opts.maxTokens) && (opts.maxTokens ?? 0) > 0 ? Math.trunc(opts.maxTokens as number) : 64_000;
  const maxChars = Math.max(32_000, maxTokens * 4);
  const recent = messages.length <= maxMessages ? messages : messages.slice(-maxMessages);
  const selected: Message[] = [];
  let usedChars = 0;
  for (let index = recent.length - 1; index >= 0; index--) {
    const message = compactMessage(recent[index]);
    const size = estimateMessageChars(message);
    if (selected.length > 0 && usedChars + size > maxChars) break;
    selected.unshift(message);
    usedChars += size;
  }
  const trimmed = selected.length ? selected : [compactMessage(recent.at(-1) ?? messages[0])].filter(Boolean) as Message[];
  let latestUserIndex = -1;
  for (let index = trimmed.length - 1; index >= 0; index--) {
    if (trimmed[index].role === 'user') {
      latestUserIndex = index;
      break;
    }
  }
  if (latestUserIndex < 0) return trimmed;
  const latestText = trimmed[latestUserIndex].content
    .filter((block) => block.type === 'text')
    .map((block) => block.type === 'text' ? block.text : '')
    .join('\n');
  if (!latestText.trim()) return trimmed;

  const lessons = getBrainTeachingManager().searchLessons(latestText, 3);
  const learnedContext = retrieveLearningContext(latestText, { limit: 3, minConfidence: 0.5 });
  const preferences = retrieveLearningContext('', { kinds: ['preference'], limit: 2, minConfidence: 0.5 });
  if (!lessons.length && !learnedContext && !preferences) return trimmed;
  const recall: Message = {
    id: `brain-recall-${Date.now()}`,
    role: 'user',
    timestamp: Date.now(),
    content: [{
      type: 'text',
      text: [
        '[Infinite Brain recall — internal learned context; use only when relevant and never claim it is a fresh web source]',
        preferences ? `User preferences learned from prior interactions:\n${preferences}` : '',
        learnedContext ? `Relevant verified learning memory:\n${learnedContext}` : '',
        ...lessons.map((lesson, index) => [
          `Lesson ${index + 1}: ${lesson.title}`,
          lesson.answer.slice(0, 500),
          lesson.example ? `Example: ${lesson.example.slice(0, 200)}` : '',
          lesson.cautions.length ? `Cautions: ${lesson.cautions.join('; ').slice(0, 200)}` : '',
        ].filter(Boolean).join('\n')),
      ].filter(Boolean).join('\n\n').slice(0, 3_000),
    }],
  };
  return [...trimmed.slice(0, latestUserIndex), recall, ...trimmed.slice(latestUserIndex)];
}

function estimateMessageChars(message: Message): number {
  return message.content.reduce((total, block) => {
    if (block.type === 'text') return total + block.text.length;
    if (block.type === 'image') return total + block.source.data.length;
    if (block.type === 'file') return total + block.data.length;
    if (block.type === 'tool_use') return total + JSON.stringify(block.input).length + block.name.length;
    if (block.type === 'question') return total + block.question.length;
    if (block.type === 'tool_result') return total + (typeof block.content === 'string' ? block.content.length : JSON.stringify(block.content).length);
    return total;
  }, 32);
}

function compactMessage(message: Message): Message {
  return {
    ...message,
    content: message.content.map((block) => {
      if (block.type !== 'tool_result' || typeof block.content !== 'string' || block.content.length <= 40_000) return block;
      const head = block.content.slice(0, 28_000);
      const tail = block.content.slice(-10_000);
      return { ...block, content: `${head}\n...[tool output compacted]...\n${tail}` };
    }),
  };
}

