// Hooks engine — runs shell commands configured for PreToolUse / PostToolUse /
// SessionStart / SessionEnd / ConfigChange / UserPromptSubmit / Stop.
//
// Structured governance (Claude Code parity+): when a PreToolUse hook prints a
// JSON object on stdout shaped { "decision": "block", "reason": "..." }, the
// tool call is DENIED and the reason is fed to the model so it can self-
// correct. A PostToolUse hook may print { "additionalContext": "..." } which
// is appended to the tool result the model sees. Plain (non-JSON) stdout or
// no output = allow, so existing hooks keep working unchanged.

import { spawn } from 'node:child_process';
import { settings } from '../settings/store.js';

export type HookEvent =
  | 'PreToolUse'
  | 'PostToolUse'
  | 'SessionStart'
  | 'SessionEnd'
  | 'ConfigChange'
  | 'UserPromptSubmit'
  | 'Stop';

interface HookOutcome {
  blocked: boolean;
  blockReason?: string;
  additionalContext?: string;
}

interface HookExecResult {
  stdout: string;
  stderr: string;
  failed: boolean;
}

function hookExec(cmd: string, cwd: string, timeout: number, signal: AbortSignal): Promise<HookExecResult> {
  return new Promise((resolve) => {
    const shell = process.platform === 'win32' ? 'powershell.exe' : '/bin/sh';
    const shellArgs = process.platform === 'win32' ? ['-NoProfile', '-Command', cmd] : ['-c', cmd];
    let stdout = '';
    let stderr = '';
    let failed = false;
    const child = spawn(shell, shellArgs, { cwd, timeout, env: process.env, windowsHide: true, signal });
    child.stdout?.on('data', (chunk) => { stdout += String(chunk); });
    child.stderr?.on('data', (chunk) => { stderr += String(chunk); });
    child.on('close', (code) => { failed = code !== 0; resolve({ stdout, stderr, failed }); });
    child.on('error', (e) => { failed = true; stderr += String(e); resolve({ stdout, stderr, failed }); });
  });
}

/** Parse a structured governance payload from hook stdout (first JSON object). */
export function parseHookVerdict(stdout: string): { decision?: string; reason?: string; additionalContext?: string } | null {
  const text = (stdout ?? '').trim();
  if (!text.startsWith('{')) return null;
  try {
    const parsed = JSON.parse(text) as { decision?: string; reason?: string; additionalContext?: string };
    return typeof parsed === 'object' && parsed !== null ? parsed : null;
  } catch {
    return null;
  }
}

function toOutcome(result: HookExecResult, event: HookEvent): HookOutcome {
  const verdict = parseHookVerdict(result.stdout);
  if (!verdict) return { blocked: false };
  if (event === 'PreToolUse' && verdict.decision === 'block') {
    return { blocked: true, blockReason: verdict.reason || 'Blocked by PreToolUse hook.' };
  }
  if (event === 'PostToolUse' && typeof verdict.additionalContext === 'string' && verdict.additionalContext.trim()) {
    return { blocked: false, additionalContext: verdict.additionalContext.trim() };
  }
  return { blocked: false };
}

export interface HookRunResult extends HookOutcome {
  /** Stderr/output fragments from hooks, surfaced for debugging. */
  output?: string;
}

export async function runHooks(
  event: HookEvent,
  payload: Record<string, unknown>,
  opts: { cwd: string; sessionId: string; signal?: AbortSignal },
): Promise<HookRunResult> {
  const all = (settings.get('hooks') ?? {}) as Record<string, { matcher?: string; command: string }[]>;
  const list = all[event] ?? [];
  if (list.length === 0) return { blocked: false }; // Fast path: no hooks configured
  const matched = list.filter((hook) => !hook.matcher || !payload.tool || new RegExp(hook.matcher).test(String(payload.tool)));
  if (matched.length === 0) return { blocked: false }; // Fast path: no matching hooks

  const substitutions: Record<string, string> = {
    $TOOL_NAME: String(payload.tool ?? ''),
    $SESSION_ID: opts.sessionId,
    $CWD: opts.cwd,
    $TOOL_INPUT: JSON.stringify(payload.input ?? {}),
    $TOOL_RESULT: typeof (payload.result as { content?: unknown })?.content === 'string'
      ? String((payload.result as { content: unknown }).content).slice(0, 8_000)
      : '',
    $PROMPT: String(payload.prompt ?? ''),
  };

  const results = await Promise.all(matched.map(async (hook) => {
    const cmd = Object.entries(substitutions).reduce(
      (acc, [key, value]) => acc.split(key).join(value),
      hook.command,
    );
    const exec = await hookExec(cmd, opts.cwd, 30_000, opts.signal ?? new AbortController().signal);
    if (exec.failed && exec.stderr) {
      console.error(`[hook ${event}] failed:`, exec.stderr.slice(0, 500));
    }
    return { event, exec };
  }));

  const outcome: HookRunResult = { blocked: false };
  const outputFragments: string[] = [];
  for (const { event: hookEvent, exec } of results) {
    const hookOutcome = toOutcome(exec, hookEvent);
    if (hookOutcome.blocked) {
      outcome.blocked = true;
      outcome.blockReason = hookOutcome.blockReason;
    }
    if (hookOutcome.additionalContext) {
      outcome.additionalContext = [outcome.additionalContext, hookOutcome.additionalContext].filter(Boolean).join('\n');
    }
    if (exec.stdout.trim() && !exec.stdout.trim().startsWith('{')) {
      outputFragments.push(exec.stdout.trim().slice(0, 500));
    }
  }
  if (outputFragments.length) outcome.output = outputFragments.join('\n').slice(0, 1_000);
  return outcome;
}
