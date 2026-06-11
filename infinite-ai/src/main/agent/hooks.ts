// Hooks engine — runs shell commands configured for PreToolUse / PostToolUse / SessionStart / etc.

import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { settings } from '../settings/store.js';

const execAsync = promisify(exec);

export type HookEvent = 'PreToolUse' | 'PostToolUse' | 'SessionStart' | 'SessionEnd' | 'ConfigChange';

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
      await execAsync(cmd, { cwd: opts.cwd, timeout: 30_000, shell: process.platform === 'win32' ? 'powershell.exe' : '/bin/sh' });
    } catch (e) {
      console.error(`[hook ${event}] failed:`, (e as Error).message);
    }
  }
}
