import { spawn } from 'node:child_process';
import type { Tool, ToolResult } from './base.js';

const MAX_OUTPUT = 30_000;
const DEFAULT_TIMEOUT = 2 * 60 * 1000;

export const bash: Tool = {
  name: 'Bash',
  description: 'Run a shell command in the project working directory. Returns combined stdout/stderr. Output is capped at 30k characters.',
  inputSchema: {
    type: 'object',
    properties: {
      command: { type: 'string', description: 'The shell command to run' },
      timeout: { type: 'number', description: 'Timeout in ms (max 10 min)' },
      run_in_background: { type: 'boolean', description: 'Run without blocking the conversation' },
    },
    required: ['command'],
  },
  permission: 'ask',

  async execute(args, ctx): Promise<ToolResult> {
    const { command, timeout = DEFAULT_TIMEOUT, run_in_background = false } = args as { command: string; timeout?: number; run_in_background?: boolean };
    const shell = process.platform === 'win32' ? 'powershell.exe' : 'bash';

    return new Promise<ToolResult>((resolve) => {
      const child = spawn(shell, process.platform === 'win32' ? ['-NoProfile', '-Command', command] : ['-c', command], {
        cwd: ctx.cwd,
        env: process.env,
        signal: run_in_background ? undefined : ctx.abortSignal,
      });

      let out = '';
      child.stdout.on('data', (d: Buffer) => {
        out += d.toString();
        if (out.length > MAX_OUTPUT) out = out.slice(0, MAX_OUTPUT) + '\n…[truncated]';
        ctx.onUpdate({ content: out });
      });
      child.stderr.on('data', (d: Buffer) => {
        out += d.toString();
        ctx.onUpdate({ content: out });
      });

      const timer = setTimeout(() => {
        child.kill();
        resolve({ content: out + '\n[killed: timeout]', is_error: true });
      }, timeout);

      child.on('close', (code) => {
        clearTimeout(timer);
        if (run_in_background) {
          resolve({ content: `(started in background, pid ${child.pid})` });
        } else {
          resolve({ content: out, is_error: code !== 0 });
        }
      });
    });
  },
};
