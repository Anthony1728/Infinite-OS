// Permission system — mirrors Claude Code's pattern-based allow/deny/ask rules.
//
// Rule format: `ToolName(specifier)`
//   Bash(npm run *)
//   Edit(/src/**)
//   Read(./.env)
//   WebFetch(domain:example.com)

import type { ContentBlock } from '../../shared/types.js';
import { isAbsolute, relative, resolve, sep, join } from 'node:path';
import { dirname } from 'node:path';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { realpath } from 'node:fs/promises';
import { settings } from '../settings/store.js';
import { requestPermission } from './permission-prompt.js';
import { toolRegistry } from '../tools/base.js';

export type PermissionMode =
  | 'default'
  | 'acceptEdits'
  | 'plan'
  | 'bypassPermissions'
  | 'auto'
  | 'readOnly'
  | 'workspace'
  | 'fullSystemAccess';

type PermissionProfile = ':read-only' | ':workspace' | ':accept-edits' | ':full-system-access';

type ToolUse = Extract<ContentBlock, { type: 'tool_use' }>;

/**
 * Project-scoped rules, committed next to the code at `.infinite/permissions.json`:
 *   { "allow": ["Bash(npm run *)"], "deny": ["Edit(./secrets/**)"], "ask": ["WebFetch(domain:example.com)"] }
 *
 * Unlike the global settings these travel with the repository, so a team can
 * encode "never touch prod credentials" once instead of asking every member to
 * configure their machine. The file is advisory input, never executable code.
 */
export interface ScopedPermissionRules {
  allow: string[];
  deny: string[];
  ask: string[];
}

const MAX_PROJECT_RULES = 80;
const MAX_RULE_LENGTH = 240;
const EMPTY_RULES: ScopedPermissionRules = { allow: [], deny: [], ask: [] };
let projectRulesCache: { path: string; mtimeMs: number; size: number; rules: ScopedPermissionRules } | null = null;

export function projectRulesPath(cwd: string): string {
  return join(cwd, '.infinite', 'permissions.json');
}

function cleanRuleList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((rule): rule is string => typeof rule === 'string')
    .map((rule) => rule.trim())
    .filter((rule) => rule.length > 2 && rule.length <= MAX_RULE_LENGTH)
    .filter((rule) => /^[A-Za-z][A-Za-z0-9_-]*\(.+\)$/.test(rule))
    .slice(0, MAX_PROJECT_RULES);
}

/** Read and validate project rules. A missing or malformed file means "no extra rules". */
export function loadProjectRules(cwd: string): ScopedPermissionRules {
  if (!cwd.trim()) return EMPTY_RULES;
  const path = projectRulesPath(cwd);
  try {
    const stat = statSync(path);
    if (projectRulesCache && projectRulesCache.path === path && projectRulesCache.mtimeMs === stat.mtimeMs && projectRulesCache.size === stat.size) {
      return projectRulesCache.rules;
    }
    if (stat.size > 64_000) return EMPTY_RULES;
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
    const rules: ScopedPermissionRules = {
      allow: cleanRuleList(parsed.allow),
      deny: cleanRuleList(parsed.deny),
      ask: cleanRuleList(parsed.ask),
    };
    projectRulesCache = { path, mtimeMs: stat.mtimeMs, size: stat.size, rules };
    return rules;
  } catch {
    return EMPTY_RULES;
  }
}

/** Test hook: forces the next load to hit disk. */
export function clearProjectRulesCache(): void {
  projectRulesCache = null;
}

export async function checkPermission(tu: ToolUse, opts: { sessionId: string; cwd: string; signal?: AbortSignal }): Promise<boolean> {
  const perms = (settings.get('permissions') ?? {}) as { allow?: string[]; deny?: string[]; ask?: string[] };
  const project = loadProjectRules(opts.cwd);
  const allow = [...project.allow, ...(perms.allow ?? [])];
  const deny = [...project.deny, ...(perms.deny ?? [])];
  const ask = perms.ask ?? [];
  const tool = toolRegistry.get(tu.name);

  // Resolve to canonical name so permission checks match registered tool
  // names regardless of how the model spelled the tool (e.g. `bash` vs `Bash`).
  const canonicalName = tool?.name ?? tu.name;
  const canonicalTu: ToolUse = { ...tu, name: canonicalName };

  // Full system access: NO restrictions whatsoever — can do anything and everything.
  // This is checked before any deny/ask logic so that explicit deny rules, tool
  // permission declarations, and workspace guards are all bypassed in this mode.
  // Other modes (:read-only, :workspace, :accept-edits) remain enforced as designed.
  const profile = resolvePermissionProfile();
  if (profile === ':full-system-access') return true;
  // Headless exec run-scoping (set only by `npm run exec` for its own process,
  // never persisted): --yes bypasses prompts for the run; --review forces
  // read-only. Without --yes, prompts fail closed (no window can answer).
  if (process.env.INFINITE_EXEC_YES === '1') return true;
  if (process.env.INFINITE_EXEC_READONLY === '1') return checkReadOnlyPermission(canonicalTu, opts);
  // For restricted modes, deny rules and disabled tools remain authoritative
  if (tool?.permission === 'deny' || deny.some((rule) => matchRule(rule, canonicalTu, opts.cwd))) return false;
  if (profile === ':read-only') return checkReadOnlyPermission(canonicalTu, opts);
  // A project "ask" rule forces a prompt even in modes that would otherwise
  // auto-approve (workspace edits, acceptEdits). Read-only is stricter and
  // already returned above, so a project file can never widen it.
  if (project.ask.some((rule) => matchRule(rule, canonicalTu, opts.cwd))) {
    return await requestPermission(canonicalTu, opts);
  }
  if (profile === ':workspace') return checkWorkspacePermission(canonicalTu, opts);

  const mode = profile === ':accept-edits'
    ? 'acceptEdits'
    : (settings.get('permissionMode') as PermissionMode | undefined) ?? 'workspace';
  if (mode === 'fullSystemAccess') return true;
  if (mode === 'readOnly') return checkReadOnlyPermission(canonicalTu, opts);
  if (mode === 'workspace') return checkWorkspacePermission(canonicalTu, opts);

  // Self-modifying feature transactions require an explicit user decision unless
  // a full-system profile was selected above.
  if (canonicalName === 'BuildFeature' || canonicalName === 'RollbackFeature') {
    return await requestPermission(canonicalTu, opts);
  }
  if (mode === 'bypassPermissions') return true;
  if (mode === 'acceptEdits') {
    if (canonicalName === 'Edit' || canonicalName === 'Write' || canonicalName === 'NotebookEdit') return true;
  }

  for (const rule of allow) {
    if (matchRule(rule, canonicalTu, opts.cwd)) return true;
  }
  for (const rule of ask) {
    if (matchRule(rule, canonicalTu, opts.cwd)) {
      return await requestPermission(canonicalTu, opts);
    }
  }

  if (tool?.permission === 'ask') return await requestPermission(canonicalTu, opts);
  return true;
}

/**
 * Human-readable name of the permission profile currently in effect.
 * Used by the action audit log to record under what authority an action ran.
 */
export function currentPermissionProfile(): string {
  return resolvePermissionProfile() ?? 'default';
}

function resolvePermissionProfile(): PermissionProfile | null {
  const explicit = settings.get('permissionProfile') as string | undefined;
  if (explicit === ':full-system-access' || explicit === 'fullSystemAccess' || explicit === 'full-system-access' || explicit === 'full_system_access') return ':full-system-access';
  if (explicit === ':read-only' || explicit === 'readOnly') return ':read-only';
  if (explicit === ':workspace' || explicit === 'workspace') return ':workspace';
  if (explicit === ':accept-edits' || explicit === 'acceptEdits') return ':accept-edits';
  const mode = settings.get('permissionMode') as PermissionMode | undefined;
  if (mode === 'readOnly' || mode === 'plan') return ':read-only';
  if (mode === 'workspace') return ':workspace';
  if (mode === 'acceptEdits') return ':accept-edits';
  if (mode === 'fullSystemAccess' || mode === 'bypassPermissions') return ':full-system-access';
  return null;
}

async function checkReadOnlyPermission(tu: ToolUse, opts: { sessionId: string; cwd: string; signal?: AbortSignal }): Promise<boolean> {
  if (tu.name === 'TodoWrite') return true;
  if (tu.name === 'Read' || tu.name === 'Grep' || tu.name === 'Glob') return isToolPathInsideWorkspace(tu, opts.cwd);
  if (tu.name === 'WebSearch' || tu.name === 'WebFetch') return true;
  if (tu.name === 'Bash' || tu.name === 'PowerShell') {
    const cmd = (tu.input as { command?: string }).command ?? '';
    return isReadOnlyCommand(cmd);
  }
  return false;
}

async function checkWorkspacePermission(tu: ToolUse, opts: { sessionId: string; cwd: string; signal?: AbortSignal }): Promise<boolean> {
  if (tu.name === 'TodoWrite') return true;
  if (tu.name === 'Read' || tu.name === 'Grep' || tu.name === 'Glob') return isToolPathInsideWorkspace(tu, opts.cwd);
  if (tu.name === 'Edit' || tu.name === 'Write' || tu.name === 'Delete' || tu.name === 'NotebookEdit') {
    const filePath = getToolPath(tu);
    if (filePath && await isInsideWorkspace(filePath, opts.cwd)) return true;
    return await requestPermission(tu, opts);
  }
  if (tu.name === 'Bash' || tu.name === 'PowerShell') {
    const cmd = (tu.input as { command?: string }).command ?? '';
    if (isReadOnlyCommand(cmd) || isWorkspaceRoutineCommand(cmd)) return true;
    return await requestPermission(tu, opts);
  }

  // Network self-help: read-only diagnostics (list profiles, status, gateway, ping,
  // DNS test, traceroute, port probe) run without prompting; password reveal
  // (get_password) and system changes (dns_set/dns_flush) fall through to the
  // permission === 'ask' prompt below so the user always consents to them.
  if (tu.name === 'Network' && isReadOnlyNetworkAction(tu)) return true;
  const tool = toolRegistry.get(tu.name);
  if (tool?.permission === 'ask') return await requestPermission(tu, opts);
  return true;
}


const READONLY_NETWORK_ACTIONS = new Set([
  'list_profiles', 'status', 'gateway', 'ping', 'dns_test', 'traceroute', 'ports',
]);

function isReadOnlyNetworkAction(tu: ToolUse): boolean {
  return READONLY_NETWORK_ACTIONS.has((tu.input as { action?: string }).action ?? '');
}

function getToolPath(tu: ToolUse): string {
  return (
    (tu.input as { file_path?: string; path?: string }).file_path ??
    (tu.input as { path?: string }).path ??
    (tu.input as { cwd?: string }).cwd ??
    ''
  );
}

async function isToolPathInsideWorkspace(tu: ToolUse, cwd: string): Promise<boolean> {
  const input = tu.input as { file_path?: string; path?: string; cwd?: string };
  const path = tu.name === 'Glob' ? input.cwd ?? cwd : input.file_path ?? input.path ?? cwd;
  return isInsideWorkspace(path, cwd);
}

// Cache for realpath resolution to avoid repeated filesystem syscalls
const realpathCache = new Map<string, string>();
const REALPATH_CACHE_MAX = 200;

async function isInsideWorkspace(filePath: string, cwd: string): Promise<boolean> {
  if (!filePath.trim() || !cwd.trim()) return false;
  const lexicalWorkspace = resolve(cwd);
  const lexicalTarget = resolve(lexicalWorkspace, filePath);
  // Test/dry-run workspaces may not exist yet. Preserve lexical containment
  // there; real workspaces get the stronger symlink/junction-aware check.
  if (!existsSync(lexicalWorkspace)) {
    const lexicalChild = relative(lexicalWorkspace, lexicalTarget);
    return lexicalChild === '' || (!lexicalChild.startsWith(`..${sep}`) && lexicalChild !== '..' && !isAbsolute(lexicalChild));
  }
  const workspace = await cachedRealPath(lexicalWorkspace);
  const target = await cachedRealPath(lexicalTarget);
  const childPath = relative(workspace, target);
  return childPath === '' || (!childPath.startsWith(`..${sep}`) && childPath !== '..' && !isAbsolute(childPath));
}

async function cachedRealPath(target: string): Promise<string> {
  const cached = realpathCache.get(target);
  if (cached) return cached;
  const resolved = await existingRealPath(target);
  if (realpathCache.size > REALPATH_CACHE_MAX) realpathCache.clear();
  realpathCache.set(target, resolved);
  return resolved;
}

async function existingRealPath(target: string): Promise<string> {
  const missing: string[] = [];
  let current = target;
  while (current) {
    try {
      const resolved = await realpath(current);
      return missing.reduceRight((path, part) => resolve(path, part), resolved);
    } catch {
      const parent = dirname(current);
      if (parent === current) return target;
      missing.push(current.slice(parent.length + 1));
      current = parent;
    }
  }
  return target;
}

function isReadOnlyCommand(command: string): boolean {
  const trimmed = command.trim();
  if (!trimmed) return false;
  // A pipeline is read-only when every stage is read-only (e.g.
  // `Get-ChildItem | Select-Object`), so a safe pipe no longer forces an
  // interactive permission prompt.
  const stages = trimmed.split(/\s*\|\s*/).map((stage) => stage.trim()).filter(Boolean);
  if (stages.length === 0) return false;
  return stages.every((stage) => isReadOnlyStage(stage));
}

function isReadOnlyStage(stage: string): boolean {
  const first = stage.split(/\s+/)[0]?.toLowerCase();
  const readOnly = new Set([
    'cat', 'cd', 'dir', 'echo', 'find', 'git', 'grep', 'head', 'ls', 'pwd', 'rg', 'tail', 'type',
    'where', 'whoami', 'get-childitem', 'get-content', 'get-location', 'get-process', 'select-string',
    'select-object', 'where-object', 'sort-object', 'group-object', 'measure-object', 'format-table', 'format-list', 'out-string',
  ]);
  if (!first || !readOnly.has(first)) return false;
  if (first === 'git') return /^git\s+(status|diff|log|show|branch|rev-parse|ls-files)\b/i.test(stage);
  return !/[;&`]|>\s*|>>/.test(stage);
}

function isWorkspaceRoutineCommand(command: string): boolean {
  return /\b(npm|pnpm|yarn|bun)\s+(run\s+)?(test|typecheck|lint|build)\b/i.test(command.trim());
}

function matchRule(rule: string, tu: ToolUse, cwd: string): boolean {
  const m = rule.match(/^(\w+)\((.*)\)$/);
  if (!m) return false;
  const [, toolName, specifier] = m;
  if (toolName !== tu.name) return false;

  if (tu.name === 'Bash' || tu.name === 'Monitor' || tu.name === 'PowerShell') {
    const cmd = (tu.input as { command?: string }).command ?? '';
    return minimatch(cmd, specifier);
  }
  if (
    tu.name === 'Read' ||
    tu.name === 'Edit' ||
    tu.name === 'Write' ||
    tu.name === 'Delete' ||
    tu.name === 'Grep' ||
    tu.name === 'Glob' ||
    tu.name === 'LSP'
  ) {
    const filePath =
      (tu.input as { file_path?: string; path?: string; pattern?: string }).file_path ??
      (tu.input as { path?: string }).path ??
      (tu.input as { pattern?: string }).pattern ??
      '';
    return pathMatch(filePath, specifier, cwd);
  }
  if (tu.name === 'WebFetch') {
    const domain = specifier.replace(/^domain:/, '');
    try {
      const u = new URL((tu.input as { url: string }).url);
      return u.hostname === domain || minimatch(u.hostname, domain);
    } catch {
      return false;
    }
  }
  if (tu.name === 'Skill' || tu.name === 'Agent') {
    return minimatch((tu.input as { name?: string }).name ?? '', specifier);
  }
  return true;
}

function minimatch(s: string, pattern: string): boolean {
  const re = new RegExp('^' + pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
  return re.test(s);
}

function pathMatch(filePath: string, pattern: string, cwd: string): boolean {
  const toPosix = (value: string) => value.replace(/\\/g, '/');
  const normalizedFile = toPosix(filePath);
  const normalizedPattern = toPosix(pattern);
  const candidates = new Set<string>([filePath, normalizedFile]);
  if (filePath) {
    const absolute = isAbsolute(filePath) ? resolve(filePath) : resolve(cwd, filePath);
    candidates.add(absolute);
    candidates.add(toPosix(absolute));
  }
  // Project rules are usually written relative to the repo (`./src/**`).
  // Resolve them against cwd so they match both absolute and relative tool input.
  if (!isAbsolute(pattern)) {
    const absolutePattern = resolve(cwd, pattern);
    candidates.add(toPosix(absolutePattern));
  }
  const patterns = new Set<string>([pattern, normalizedPattern]);
  if (!isAbsolute(pattern)) patterns.add(toPosix(resolve(cwd, pattern)));
  for (const candidate of candidates) {
    for (const candidatePattern of patterns) {
      if (minimatch(candidate, candidatePattern)) return true;
      if (minimatch(toPosix(candidate), toPosix(candidatePattern))) return true;
    }
  }
  return false;
}
