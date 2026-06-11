// Permission system — mirrors Claude Code's pattern-based allow/deny/ask rules.
//
// Rule format: `ToolName(specifier)`
//   Bash(npm run *)
//   Edit(/src/**)
//   Read(./.env)
//   WebFetch(domain:example.com)

import type { ContentBlock } from '../../shared/types.js';
import { settings } from '../settings/store.js';
import { requestPermission } from './permission-prompt.js';

export type PermissionMode = 'default' | 'acceptEdits' | 'plan' | 'bypassPermissions' | 'auto';

type ToolUse = Extract<ContentBlock, { type: 'tool_use' }>;

export async function checkPermission(tu: ToolUse, opts: { sessionId: string; cwd: string }): Promise<boolean> {
  const mode = (settings.get('permissionMode') as PermissionMode | undefined) ?? 'default';
  if (mode === 'bypassPermissions' || mode === 'acceptEdits') {
    if (mode === 'bypassPermissions') return true;
    if (tu.name === 'Edit' || tu.name === 'Write' || tu.name === 'NotebookEdit') return true;
  }

  const perms = (settings.get('permissions') ?? {}) as { allow?: string[]; deny?: string[]; ask?: string[] };
  const allow = perms.allow ?? [];
  const deny = perms.deny ?? [];
  const ask = perms.ask ?? [];

  for (const rule of deny) {
    if (matchRule(rule, tu, opts.cwd)) return false;
  }
  for (const rule of allow) {
    if (matchRule(rule, tu, opts.cwd)) return true;
  }
  for (const rule of ask) {
    if (matchRule(rule, tu, opts.cwd)) {
      return await requestPermission(tu, opts);
    }
  }

  const tool = (await import('../tools/base.js')).toolRegistry.get(tu.name);
  if (tool?.permission === 'ask') return await requestPermission(tu, opts);
  return true;
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
  if (tu.name === 'Read' || tu.name === 'Edit' || tu.name === 'Write' || tu.name === 'Grep' || tu.name === 'Glob' || tu.name === 'LSP') {
    const filePath = (tu.input as { file_path?: string; path?: string; pattern?: string }).file_path
      ?? (tu.input as { path?: string }).path
      ?? (tu.input as { pattern?: string }).pattern
      ?? '';
    return pathMatch(filePath, specifier, cwd);
  }
  if (tu.name === 'WebFetch') {
    const domain = specifier.replace(/^domain:/, '');
    try {
      const u = new URL((tu.input as { url: string }).url);
      return u.hostname === domain || minimatch(u.hostname, domain);
    } catch { return false; }
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
  const abs = filePath.startsWith('/') || /^[A-Z]:/i.test(filePath) ? filePath : `${cwd}/${filePath}`;
  return minimatch(abs, pattern) || minimatch(filePath, pattern);
}
