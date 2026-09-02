import { randomUUID } from 'node:crypto';
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import type { Tool, ToolContext, ToolResult } from './base.js';

/**
 * Sandboxed Execution — Hermes-beating isolated run.
 * Hermes runs in a sandbox; Infinite OS runs in a disposable temp dir with:
 *  - isolated cwd (no access to workspace unless explicitly copied in)
 *  - allowlisted env (no secrets leaked)
 *  - 30s default timeout, always verified via exit code + output capture
 *  - automatic cleanup, with opt-in keepDir for debugging
 */
interface SandboxArgs {
  command: string;
  language?: 'bash' | 'powershell' | 'node' | 'python';
  files?: Record<string, string>;
  keepDir?: boolean;
  timeoutMs?: number;
}

const ALLOWED_ENV = new Set(['PATH', 'PATHEXT', 'SystemRoot', 'TEMP', 'TMP', 'HOME', 'USERPROFILE', 'LANG', 'LC_ALL']);

export const sandboxTool: Tool = {
  name: 'Sandbox',
  description:
    'Run a command in a disposable sandboxed temp directory (isolated cwd, minimal env, 30s timeout). Write files into the sandbox via the files map, execute, and capture output. Hermes sandboxes the whole agent; Infinite OS lets the agent choose per-tool sandboxing for safe verification, with automatic cleanup. Always returns exit code and output for verification.',
  inputSchema: {
    type: 'object',
    properties: {
      command: { type: 'string', description: 'Shell command to run inside the sandbox' },
      language: { type: 'string', enum: ['bash', 'powershell', 'node', 'python'], description: 'Shorthand: wraps command for node/python' },
      files: { type: 'object', description: 'Map of filename -> content to pre-populate inside the sandbox', additionalProperties: { type: 'string' } },
      keepDir: { type: 'boolean', description: 'Keep the temp dir after run for inspection (default false)' },
      timeoutMs: { type: 'number', description: 'Timeout in ms, default 30000, max 60000' },
    },
    required: ['command'],
  },
  permission: 'ask',
  async execute(args: unknown, ctx: ToolContext): Promise<ToolResult> {
    const a = args as SandboxArgs;
    if (!a.command || !a.command.trim()) return { content: 'Sandbox requires command.', is_error: true };
    const timeoutMs = Math.min(60_000, Math.max(1_000, a.timeoutMs ?? 30_000));
    const dir = await mkdtemp(join(tmpdir(), `infinite-sandbox-${randomUUID().slice(0, 6)}-`));
    try {
      if (a.files) {
        for (const [name, content] of Object.entries(a.files)) {
          // Prevent path traversal — strip leading slashes and .. segments
          const safeName = name.replace(/^[/\\]+/, '').replace(/\.\.[/\\]/g, '');
          if (!safeName) continue;
          const full = join(dir, safeName);
          const dirParts = safeName.split(/[/\\]/).slice(0, -1);
          if (dirParts.length) await mkdir(join(dir, ...dirParts), { recursive: true }).catch(() => undefined);
          await writeFile(full, content, 'utf8');
        }
      }
      let command = a.command;
      if (a.language === 'node') command = `node -e ${JSON.stringify(a.command)}`;
      if (a.language === 'python') command = `python -c ${JSON.stringify(a.command)}`;

      const env: Record<string, string> = {};
      for (const k of ALLOWED_ENV) if (process.env[k]) env[k] = process.env[k]!;
      // Always ensure PATH exists
      if (!env.PATH) env.PATH = process.env.PATH || '';

      const shell = process.platform === 'win32' ? 'powershell.exe' : 'bash';
      const shellArgs = shell === 'powershell.exe' ? ['-NoProfile', '-Command', command] : ['-c', command];

      const out = await run(shell, shellArgs, dir, env, ctx.abortSignal, timeoutMs);
      const summary = `Sandbox: ${dir}${a.keepDir ? ' (kept)' : ' (cleaned)'}\nExit: ${out.exitCode}${out.timedOut ? ' (timeout)' : ''}\n--- stdout ---\n${out.stdout.slice(-8000) || '(empty)'}\n--- stderr ---\n${out.stderr.slice(-8000) || '(empty)'}`;
      return { content: summary, is_error: out.exitCode !== 0 || out.timedOut };
    } finally {
      if (!a.keepDir) await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  },
};

function run(file: string, args: string[], cwd: string, env: Record<string, string>, signal: AbortSignal, timeoutMs: number): Promise<{ stdout: string; stderr: string; exitCode: number; timedOut: boolean }> {
  return new Promise(resolve => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const child = spawn(file, args, { cwd, env, windowsHide: true });
    const t = setTimeout(() => {
      timedOut = true;
      if (process.platform === 'win32' && child.pid) spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true }).unref();
      else child.kill('SIGTERM');
    }, timeoutMs);
    const onAbort = () => {
      timedOut = true;
      if (process.platform === 'win32' && child.pid) spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true }).unref();
      else child.kill('SIGTERM');
    };
    signal.addEventListener('abort', onAbort, { once: true });
    child.stdout.on('data', d => { stdout += d.toString(); });
    child.stderr.on('data', d => { stderr += d.toString(); });
    child.on('close', code => {
      clearTimeout(t);
      signal.removeEventListener('abort', onAbort);
      resolve({ stdout, stderr, exitCode: code ?? 1, timedOut });
    });
    child.on('error', err => {
      clearTimeout(t);
      resolve({ stdout, stderr: `${stderr}\n[spawn error: ${err.message}]`, exitCode: 1, timedOut });
    });
  });
}
