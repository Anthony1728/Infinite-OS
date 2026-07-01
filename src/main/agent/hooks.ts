// Hooks engine — runs shell commands configured for PreToolUse / PostToolUse / SessionStart / etc.

import { spawn } from 'node:child_process';
import { settings } from '../settings/store.js';

export type HookEvent = 'PreToolUse' | 'PostToolUse' | 'SessionStart' | 'SessionEnd' | 'ConfigChange';

function hookExec(cmd: string, cwd: string, timeout: number): Promise<void> {
  return new Promise((resolve) => {
    const shell = process.platform === 'win32' ? 'powershell.exe' : '/bin/sh';
    const shellArgs = process.platform === 'win32' ? ['-NoProfile', '-Command', cmd] : ['-c', cmd];
    const child = spawn(shell, shellArgs, { cwd, timeout, env: process.env, windowsHide: true });
    child.on('close', () => resolve());
    child.on('error', () => resolve());
  });
}

export async function runHooks(event: HookEvent, payload: Record<string, unknown>, opts: { cwd: string; sessionId: string }): Promise<void> {
  const all = (settings.get('hooks') ?? {}) as Record<string, { matcher?: string; command: string }[]>;
  const list = all[event] ?? [];
  for (const hook of list) {
    if (hook.matcher && payload.tool && !new RegExp(hook.matcher).test(String(payload.tool))) continue;
    const cmd = hook.command
      .replace(/\$TOOL_NAME/g, String(payload.tool ?? ''))
      .replace(/\$SESSION_ID/g, opts.sessionId)
      .replace(/\$CWD/g, opts.cwd);
    try {
      await hookExec(cmd, opts.cwd, 30_000);
    } catch (e) {
      console.error(`[hook ${event}] failed:`, (e as Error).message);
    }
  }
}

