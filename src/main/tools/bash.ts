import { spawn } from 'node:child_process';
import type { Tool, ToolResult } from './base.js';

const MAX_OUTPUT = 30_000;
const DEFAULT_TIMEOUT = 2 * 60 * 1000;

export const bash: Tool = {
  name: 'Bash',
  description: 'Run PowerShell, Windows CMD, or Bash commands in the working directory. Supports foreground validation and persistent background processes. Returns combined stdout/stderr capped at 30k characters.',
  inputSchema: {
    type: 'object',
    properties: {
      command: { type: 'string', description: 'The shell command to run' },
      shell: { type: 'string', enum: ['powershell', 'cmd', 'bash'], description: 'Shell to use. Windows defaults to PowerShell; choose cmd for Command Prompt syntax.' },
      timeout: { type: 'number', description: 'Timeout in ms (max 10 min)' },
      run_in_background: { type: 'boolean', description: 'Run without blocking the conversation' },
    },
    required: ['command'],
  },
  permission: 'ask',

  async execute(args, ctx): Promise<ToolResult> {
    const { command, timeout = DEFAULT_TIMEOUT, run_in_background = false, shell: requestedShell } = args as {
      command: string;
      timeout?: number;
      run_in_background?: boolean;
      shell?: 'powershell' | 'cmd' | 'bash';
    };
    if (!command || typeof command !== 'string') {
      return { content: 'Bash tool requires a non-empty "command" string parameter.', is_error: true };
    }
    const shell = process.platform === 'win32'
      ? requestedShell === 'cmd' ? 'cmd.exe' : requestedShell === 'bash' ? 'bash.exe' : 'powershell.exe'
      : 'bash';
    const shellArgs = shell === 'powershell.exe'
      ? ['-NoProfile', '-Command', command]
      : shell === 'cmd.exe'
        ? ['/d', '/s', '/c', command]
        : ['-c', command];

    return new Promise<ToolResult>((resolve) => {
      const child = spawn(shell, shellArgs, {
        cwd: ctx.cwd,
        env: process.env,
        windowsHide: true,
      });

      let out = '';
      let finished = false;
      child.stdout.on('data', (d: Buffer) => {
        out += d.toString();
        if (out.length > MAX_OUTPUT) out = out.slice(0, MAX_OUTPUT) + '\n…[truncated]';
        ctx.onUpdate({ content: out });
      });
      child.stderr.on('data', (d: Buffer) => {
        out += d.toString();
        ctx.onUpdate({ content: out });
      });

      if (run_in_background) {
        child.unref();
        resolve({ content: `(started in background with ${shell}, pid ${child.pid})` });
        return;
      }

      const killProcessTree = () => {
        if (process.platform === 'win32' && child.pid) {
          spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true }).unref();
        } else {
          child.kill('SIGTERM');
        }
      };
      const finish = (result: ToolResult) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        ctx.abortSignal.removeEventListener('abort', onAbort);
        resolve(result);
      };
      const onAbort = () => {
        killProcessTree();
        finish({ content: `${out}\n[killed: cancelled]`, is_error: true });
      };
      ctx.abortSignal.addEventListener('abort', onAbort, { once: true });
      const timer = setTimeout(() => {
        killProcessTree();
        finish({ content: out + '\n[killed: timeout]', is_error: true });
      }, timeout);
      if (ctx.abortSignal.aborted) {
        onAbort();
        return;
      }

      child.on('error', (error) => {
        finish({ content: `${out}\n[shell failed: ${error.message}]`, is_error: true });
      });

      child.on('close', (code) => {
        finish({ content: out, is_error: code !== 0 });
      });
    });
  },
};

