// Enforced plan mode — the tool-level read-only gate behind the composer's
// "Plan" execution mode. Prompt instructions ("you are READ-ONLY") are only a
// suggestion; this module is the enforcement: mutating tool calls are denied
// BEFORE they run and the model is told why, the way Claude Code / Codex /
// OpenCode gate plan mode in the harness rather than in the prompt.
//
// Lifecycle: the renderer marks a session plan-active when the user sends a
// message in Plan mode. The model inspects the workspace, produces a plan,
// and calls ExitPlan(plan=…) to request execution. The renderer shows
// Approve / Decline; Approve clears the gate so the SAME run continues with
// the plan in context — no re-send, no lost work.

import type { ToolResult } from '../tools/base.js';

/** Sessions currently gated to read-only. Keyed by sessionId. */
const planActiveSessions = new Set<string>();

export function setPlanMode(sessionId: string, active: boolean): void {
  if (active) planActiveSessions.add(sessionId);
  else planActiveSessions.delete(sessionId);
}

export function isPlanMode(sessionId: string): boolean {
  return planActiveSessions.has(sessionId);
}

/**
 * The ExitPlan tool call carries the plan here and resolves when the user
 * approves. One pending request per session: a second call while one is
 * pending replaces it (the latest plan wins).
 */
interface PendingExitPlan {
  plan: string;
  resolve: (approved: boolean) => void;
  requestedAt: number;
}

const pendingExitPlans = new Map<string, PendingExitPlan>();

/** Renderer → main: the user approved or declined the presented plan. */
export function resolveExitPlan(sessionId: string, approved: boolean): boolean {
  const pending = pendingExitPlans.get(sessionId);
  if (!pending) return false;
  pendingExitPlans.delete(sessionId);
  pending.resolve(approved);
  if (approved) setPlanMode(sessionId, false);
  return true;
}

export function getPendingExitPlan(sessionId: string): { plan: string; requestedAt: number } | null {
  const pending = pendingExitPlans.get(sessionId);
  return pending ? { plan: pending.plan, requestedAt: pending.requestedAt } : null;
}

/** Await the user's Approve/Decline on the ExitPlan tool call. */
export function awaitPlanApproval(sessionId: string, plan: string, timeoutMs: number): Promise<boolean> {
  const existing = pendingExitPlans.get(sessionId);
  if (existing) existing.resolve(false); // superseded
  return new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => {
      pendingExitPlans.delete(sessionId);
      resolve(false);
    }, timeoutMs);
    timer.unref?.();
    pendingExitPlans.set(sessionId, { plan, resolve, requestedAt: Date.now() });
  });
}

// ── Read-only allowlist ────────────────────────────────────────────────────

/** Tools that never mutate anything — always allowed in plan mode. */
const PLAN_MODE_ALLOWED = new Set([
  'Read', 'Glob', 'Grep', 'WebSearch', 'WebFetch', 'TodoWrite', 'TodoRead',
  'ExitPlan', 'AskUserQuestion', 'Skills', 'Knowledge', 'LSP',
  'GitStatus', 'GitLog', 'GitDiff', 'System', 'Time', 'Math', 'Json', 'Text',
]);

/**
 * Bash/PowerShell side-effect heuristics. Read-only command prefixes are
 * allowed; anything that writes, installs, moves, or kills is blocked. This
 * is intentionally conservative — plan mode's whole point is that nothing
 * changes, so a false "read-only" is worse than a false block.
 */
const READONLY_COMMAND_PREFIXES = [
  'cat', 'cd', 'dir', 'echo', 'find', 'git ', 'grep', 'head', 'ls', 'pwd', 'rg',
  'tail', 'type', 'where', 'whoami', 'tree', 'wc', 'du ', 'df ',
  'get-childitem', 'get-content', 'get-location', 'get-process', 'get-command', 'get-help',
  'select-string', 'select-object', 'where-object', 'sort-object', 'group-object',
  'measure-object', 'format-table', 'format-list', 'out-string', 'node -v', 'node --version',
  'python --version', 'npm ls', 'npm list', 'npm view', 'npx tsc --version',
];

export function isReadOnlyCommand(command: string): boolean {
  const trimmed = command.trim().toLowerCase();
  if (!trimmed) return false;
  // Any write/dangerous token anywhere → not read-only (conservative).
  if (/(\b|\s|>)(rm|del|rmdir|rd|remove-item|mv|move|copy|cp|kill|taskkill|stop-process|mkdir|new-item|touch|chmod|chown|tee|set-content|add-content|out-file|npm\s+(i|install|ci|update|uninstall|link)|pnpm\s+(add|install|remove|update)|yarn\s+(add|remove|upgrade)|pip\s+install|git\s+(add|commit|push|pull|merge|rebase|reset|checkout|restore|clean|stash|apply)|npm\s+run\s+(build|deploy)|curl\s+-o|wget|invoke-webrequest|invoke-restmethod|schtasks|reg|regedit|format)\b/.test(trimmed)) {
    return false;
  }
  // Redirects and chaining can hide writes ("> file", "&& cmd", "; cmd", "`cmd`", "$(...)").
  if (/[>|]|&&|\|\||;|`|\$\(/.test(trimmed)) return false;
  const first = trimmed.split(/\s+/)[0];
  if (first === 'git') return /^git\s+(status|log|diff|show|branch|rev-parse|ls-files|blame|remote)\b/.test(trimmed);
  return READONLY_COMMAND_PREFIXES.some((prefix) => trimmed.startsWith(prefix));
}

/** Tools whose writes are sideloaded through an `action` enum. */
const ACTION_GUARDED_TOOLS: Record<string, string[]> = {
  FileOps: ['move', 'copy', 'rename', 'delete', 'mkdir', 'write'],
  Computer: ['click', 'type', 'key', 'press', 'drag', 'scroll', 'launch_app', 'run'],
  Operator: ['click', 'type', 'fill', 'submit', 'upload'],
  Browser: ['click', 'type', 'fill', 'submit'],
  Automation: ['create', 'enable', 'disable', 'delete', 'run'],
  Skills: ['invoke'], // loading a skill is fine, but invoking can trigger workflows
  Snapshot: ['restore', 'rollback', 'delete'],
  Deploy: ['deploy', 'push', 'run'],
  Docker: ['run', 'stop', 'rm', 'down', 'up', 'exec', 'build', 'push'],
  Git: ['commit', 'push', 'pull', 'merge', 'rebase', 'checkout', 'reset', 'apply'],
};

export interface PlanModeVerdict {
  allowed: boolean;
  reason?: string;
}

/**
 * Decide whether a tool call may proceed in plan mode. Returns the blocked
 * message text so the model can self-correct instead of retrying blind.
 */
export function planModeCheck(toolName: string, input: unknown): PlanModeVerdict {
  if (PLAN_MODE_ALLOWED.has(toolName)) return { allowed: true };
  // ExitPlan carries no side effects; approval flips the mode (handled by the tool).
  if (toolName === 'ExitPlan') return { allowed: true };

  const args = (input ?? {}) as Record<string, unknown>;
  const action = typeof args.action === 'string' ? args.action.toLowerCase() : '';

  if (toolName === 'Bash' || toolName === 'PowerShell' || toolName === 'Sandbox') {
    const command = typeof args.command === 'string' ? args.command : '';
    if (isReadOnlyCommand(command)) return { allowed: true };
    return {
      allowed: false,
      reason: `Blocked by plan mode: Bash command is not read-only ("${command.slice(0, 80)}"). Plan mode cannot modify files, install packages, or run builds. Finish your plan and call ExitPlan to request approval.`,
    };
  }
  if (toolName === 'Write' || toolName === 'Edit' || toolName === 'Delete' || toolName === 'NotebookEdit') {
    return {
      allowed: false,
      reason: `Blocked by plan mode: ${toolName} would modify ${String(args.file_path ?? args.path ?? 'the workspace')}. Research the codebase, write the plan, and call ExitPlan to request approval.`,
    };
  }
  if (ACTION_GUARDED_TOOLS[toolName]) {
    if (action && ACTION_GUARDED_TOOLS[toolName].includes(action)) {
      return {
        allowed: false,
        reason: `Blocked by plan mode: ${toolName} action="${action}" is a mutating action. Observation actions only. Call ExitPlan when your plan is ready.`,
      };
    }
    return { allowed: true }; // observation actions on guarded tools stay available
  }
  // Unknown or unlisted mutating tools fail closed.
  return {
    allowed: false,
    reason: `Blocked by plan mode: ${toolName} may modify the system and is not on the plan-mode read-only allowlist. Use read-only tools (Read, Glob, Grep, WebSearch) to finish your plan, then call ExitPlan.`,
  };
}

/** Guard used by executeToolCall: block the call before permission checks. */
export function planModeGuard(sessionId: string, toolName: string, input: unknown): ToolResult | null {
  if (!isPlanMode(sessionId)) return null;
  const verdict = planModeCheck(toolName, input);
  if (verdict.allowed) return null;
  return { content: verdict.reason ?? 'Blocked by plan mode.', is_error: true };
}
