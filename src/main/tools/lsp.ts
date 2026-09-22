import { execFile } from 'node:child_process';
import { statSync } from 'node:fs';
import { extname, join } from 'node:path';
import type { Tool, ToolResult } from './base.js';

// LSP-grade diagnostics without a persistent language server: runs the
// project's own checkers (tsc, pyright, ruff, cargo check) and returns
// file-scoped diagnostics. The agent calls this after edits to see type/lint
// errors instantly — the OpenCode/Codex feedback loop that catches breakage
// before a full build. The permissions system already whitelists an 'LSP'
// tool name; this is the real tool behind it.

export interface Diagnostic {
  file: string;
  line: number;
  column: number;
  severity: 'error' | 'warning' | 'info';
  message: string;
  source: string;
}

interface TscOutput {
  'file_name'?: string;
  line?: number;
  column?: number;
  category?: string;
  message?: string;
}

function runCommand(cmd: string, args: string[], cwd: string, timeoutMs = 120_000): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile(cmd, args, { cwd, timeout: timeoutMs, windowsHide: true, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
      const code = err && typeof (err as { code?: number }).code === 'number' ? (err as { code: number }).code : err ? 1 : 0;
      resolve({ code, stdout: String(stdout ?? ''), stderr: String(stderr ?? '') });
    });
  });
}

/** Parse `tsc --noEmit --pretty false` output lines. */
export function parseTscOutput(stdout: string): Diagnostic[] {
  const out: Diagnostic[] = [];
  for (const line of stdout.split('\n')) {
    // e.g. src/main/index.ts(42,7): error TS2551: Property 'x' does not exist...
    const m = /^(.+?)\((\d+),(\d+)\):\s+(error|warning|info)\s+TS\d+:\s+(.+)$/.exec(line.trim());
    if (m) {
      out.push({
        file: m[1], line: Number(m[2]), column: Number(m[3]),
        severity: m[4] as Diagnostic['severity'], message: m[5], source: 'tsc',
      });
    }
  }
  return out;
}

/** Parse tsgo/tsc JSON output shape when --pretty false misses. */
function parseJsonDiagnostics(stdout: string, source: string): Diagnostic[] {
  try {
    const parsed = JSON.parse(stdout) as { diagnostics?: TscOutput[] } | TscOutput[];
    const list = Array.isArray(parsed) ? parsed : parsed.diagnostics ?? [];
    return list
      .filter((d) => d.file_name && typeof d.line === 'number')
      .map((d) => ({
        file: d.file_name!,
        line: d.line ?? 0,
        column: d.column ?? 0,
        severity: (d.category === 'error' ? 'error' : d.category === 'warning' ? 'warning' : 'info') as Diagnostic['severity'],
        message: d.message ?? '',
        source,
      }));
  } catch {
    return [];
  }
}

/** Parse ruff/pyright-style `file:line:col: SEVERITY message` output. */
export function parseColonOutput(stdout: string, source: string): Diagnostic[] {
  const out: Diagnostic[] = [];
  for (const line of stdout.split('\n')) {
    const m = /^(.+?):(\d+):(\d+):\s*(ERROR|WARNING|error|warning|note)\s*:?\s*(.*)$/.exec(line.trim());
    if (m) {
      const sev = m[4].toLowerCase();
      out.push({
        file: m[1], line: Number(m[2]), column: Number(m[3]),
        severity: sev === 'error' ? 'error' : sev === 'warning' ? 'warning' : 'info',
        message: m[5], source,
      });
    }
  }
  return out;
}

async function diagnosticsForWorkspace(cwd: string, filePath?: string): Promise<Diagnostic[]> {
  const ext = filePath ? extname(filePath).toLowerCase() : '';
  const wantsPython = ext === '.py' || (!filePath && exists(join(cwd, 'pyproject.toml')));
  const wantsRust = ext === '.rs' || (!filePath && exists(join(cwd, 'Cargo.toml')));

  if (wantsPython) {
    const pyright = await runCommand('pyright', filePath ? ['--outputjson', filePath] : ['--outputjson', '.'], cwd, 120_000);
    if (pyright.stdout.trim().startsWith('{')) return parseJsonDiagnostics(pyright.stdout, 'pyright');
    const ruff = await runCommand('ruff', ['check', filePath ?? '.', '--output-format=full'], cwd, 60_000);
    return [...parseJsonDiagnostics(pyright.stdout, 'pyright'), ...parseColonOutput(ruff.stdout, 'ruff')];
  }
  if (wantsRust) {
    const cargo = await runCommand('cargo', ['check', '--message-format=short'], cwd, 180_000);
    return parseColonOutput(cargo.stderr || cargo.stdout, 'cargo');
  }
  // Default: TypeScript via the project's own tsc (npx resolution).
  const tsc = await runCommand('npx', ['tsc', '--noEmit', '--pretty', 'false'], cwd, 180_000);
  return parseTscOutput(tsc.stdout);
}

function exists(path: string): boolean {
  try { statSync(path); return true; } catch { return false; }
}

export const lspTool: Tool = {
  name: 'LSP',
  description: 'Get compiler/linter diagnostics (type errors, lint) for a file or workspace. Run after edits to catch breakage fast — tsc/pyright+ruff/cargo check.',
  inputSchema: {
    type: 'object',
    properties: {
      file_path: { type: 'string', description: 'Optional path to scope diagnostics to one file. Omit for the whole workspace.' },
      max_results: { type: 'number', description: 'Maximum diagnostics to return (default 50).' },
    },
  },
  permission: 'none',

  async execute(args, ctx): Promise<ToolResult> {
    const { file_path, max_results = 50 } = args as { file_path?: string; max_results?: number };
    try {
      const diags = await diagnosticsForWorkspace(ctx.cwd, file_path);
      const scoped = file_path ? diags.filter((d) => d.file.endsWith(file_path.split(/[\\/]/).pop() ?? '')) : diags;
      const shown = scoped.slice(0, Math.max(1, Math.trunc(max_results)));
      if (!shown.length) {
        return { content: file_path ? `No diagnostics for ${file_path}. Clean.` : 'No workspace diagnostics. Clean.' };
      }
      const lines = shown.map((d) => `${d.severity.toUpperCase()} ${d.file}:${d.line}:${d.column} [${d.source}] ${d.message}`);
      const errors = scoped.filter((d) => d.severity === 'error').length;
      return {
        content: `${scoped.length} diagnostic${scoped.length === 1 ? '' : 's'} (${errors} error${errors === 1 ? '' : 's'}):\n${lines.join('\n')}${scoped.length > shown.length ? `\n... and ${scoped.length - shown.length} more` : ''}`,
        is_error: false,
      };
    } catch (e) {
      return { content: `Diagnostics unavailable: ${(e as Error).message}`, is_error: true };
    }
  },
};
