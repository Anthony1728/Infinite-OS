import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import fg from 'fast-glob';
import type { Tool, ToolResult } from './base.js';
import { spawnWithTimeout } from './spawn-timeout.js';

export const securityTool: Tool = {
  name: 'Security',
  description: 'Authorized defensive security: dependency vulnerability audits, secret scanning, file hashing, and Windows Defender scans. Do not use for unauthorized access, credential theft, persistence, evasion, or malware.',
  inputSchema: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['dependency_audit', 'secret_scan', 'hash_file', 'defender_scan'] },
      path: { type: 'string' },
    },
    required: ['action'],
  },
  permission: 'ask',
  async execute(args, ctx): Promise<ToolResult> {
    const input = args as { action: string; path?: string };
    const path = input.path ?? ctx.cwd;
    if (input.action === 'dependency_audit') return run('npm.cmd', ['audit', '--json'], ctx.cwd, ctx.abortSignal);
    if (input.action === 'defender_scan') return process.platform === 'win32'
      ? run('powershell.exe', ['-NoProfile', '-Command', `Start-MpScan -ScanType CustomScan -ScanPath '${path.replace(/'/g, "''")}'`], ctx.cwd, ctx.abortSignal)
      : bad('Windows Defender scan is only available on Windows.');
    if (input.action === 'hash_file') {
      try { return { content: createHash('sha256').update(await readFile(path)).digest('hex') }; }
      catch (error) { return bad((error as Error).message); }
    }
    if (input.action === 'secret_scan') {
      const files = await fg(['**/*'], { cwd: path, onlyFiles: true, dot: true, ignore: ['**/node_modules/**', '**/.git/**', '**/dist/**', '**/out/**'], absolute: true });
      const patterns = [/\bsk-[A-Za-z0-9_-]{20,}\b/g, /\bgh[pousr]_[A-Za-z0-9]{30,}\b/g, /\bAKIA[A-Z0-9]{16}\b/g, /(?:password|secret|token)\s*[:=]\s*["'][^"']{8,}["']/gi];
      const findings: Array<{ file: string; pattern: string }> = [];
      for (const file of files.slice(0, 5000)) {
        let text = '';
        try { text = await readFile(file, 'utf8'); } catch { continue; }
        for (const pattern of patterns) {
          pattern.lastIndex = 0;
          if (pattern.test(text)) findings.push({ file, pattern: pattern.source });
        }
        if (findings.length >= 200) break;
      }
      return { content: JSON.stringify({ scanned: Math.min(files.length, 5000), findings }, null, 2) };
    }
    return bad(`Unknown Security action: ${input.action}`);
  },
};

function bad(content: string): ToolResult { return { content, is_error: true }; }
async function run(file: string, args: string[], cwd: string, signal: AbortSignal): Promise<ToolResult> {
  const result = await spawnWithTimeout({ command: file, args, cwd, signal, timeoutMs: 120_000, windowsHide: true });
  if (result.timedOut) return bad(`${file} timed out after 120 seconds and was cancelled.`);
  return { content: `${result.stdout}${result.stderr}`.slice(-50_000), is_error: result.exitCode !== 0 };
}
