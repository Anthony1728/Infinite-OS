// Hooks engine — runs shell commands configured for PreToolUse / PostToolUse / SessionStart / etc.

import { spawn } from 'node:child_process';
import { settings } from '../settings/store.js';

export type HookEvent = 'PreToolUse' | 'PostToolUse' | 'SessionStart' | 'SessionEnd' | 'ConfigChange';

function hookExec(cmd: string, cwd: string, timeout: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const shell = process.platform === 'win32' ? 'powershell.exe' : '/bin/sh';
    const shellArgs = process.platform === 'win32' ? ['-NoProfile', '-Command', cmd] : ['-c', cmd];
    const child = spawn(shell, shellArgs, { cwd, timeout, env: process.env, windowsHide: true, signal });
    child.on('close', () => resolve());
    child.on('error', () => resolve());
  });
}

export async function runHooks(event: HookEvent, payload: Record<string, unknown>, opts: { cwd: string; sessionId: string; signal?: AbortSignal }): Promise<void> {
  const all = (settings.get('hooks') ?? {}) as Record<string, { matcher?: string; command: string }[]>;
  const list = all[event] ?? [];
  if (list.length === 0) return; // Fast path: no hooks configured
  const matched = list.filter((hook) => !hook.matcher || !payload.tool || new RegExp(hook.matcher).test(String(payload.tool)));
  if (matched.length === 0) return; // Fast path: no matching hooks
  // Run all matching hooks in parallel instead of sequentially
  await Promise.allSettled(matched.map((hook) => {
    const cmd = hook.command
      .replace(/\$TOOL_NAME/g, String(payload.tool ?? ''))
      .replace(/\$SESSION_ID/g, opts.sessionId)
      .replace(/\$CWD/g, opts.cwd);
    return hookExec(cmd, opts.cwd, 30_000, opts.signal ?? new AbortController().signal).catch((e) => {
      console.error(`[hook ${event}] failed:`, (e as Error).message);
    });
  }));
}

