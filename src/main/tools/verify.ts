/**
 * Verify — the Claude Code loop: after editing code, run the workspace's own
 * checks (typecheck / lint / test / build) and report structured pass/fail so
 * the agent fixes failures before replying. Auto-detects Node (package.json
 * scripts), Python (pytest), and Go toolchains. Each check is timeout-guarded
 * and output is truncated to the failing tail — never a log flood.
 */
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Tool, ToolContext, ToolResult } from './base.js';

const PER_CHECK_TIMEOUT = 3 * 60 * 1000;
const MAX_TAIL = 12_000;

interface Check {
  label: string;
  command: string;
  args: string[];
}

function readJson(path: string): Record<string, unknown> | null {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Detect runnable checks for a workspace. Pure over injected probes — exported for tests. */
export function detectChecks(
  cwd: string,
  exists: (p: string) => boolean = existsSync,
  read: (p: string) => Record<string, unknown> | null = readJson,
): { checks: Check[]; note: string } {
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const pkg = exists(join(cwd, 'package.json')) ? read(join(cwd, 'package.json')) : null;
  const scripts = (pkg?.scripts ?? {}) as Record<string, string>;
  const has = (s: string) => typeof scripts[s] === 'string' && scripts[s].trim().length > 0;
  const nodeChecks: Check[] = [];
  // Prefer the project's own scripts — they encode its toolchain (tsc/eslint/vitest/jest).
  for (const s of ['typecheck', 'lint', 'test']) {
    if (has(s)) nodeChecks.push({ label: `npm run ${s}`, command: npm, args: ['run', s, '--silent'] });
  }
  if (has('build')) nodeChecks.push({ label: 'npm run build', command: npm, args: ['run', 'build', '--silent'] });
  if (nodeChecks.length > 0) {
    return {
      checks: nodeChecks,
      note: `Node project: ${nodeChecks.map((c) => c.label).join(', ')}`,
    };
  }
  if (exists(join(cwd, 'pyproject.toml')) || exists(join(cwd, 'pytest.ini')) || exists(join(cwd, 'setup.py'))) {
    const py = process.platform === 'win32' ? 'python' : 'python3';
    return { checks: [{ label: 'pytest', command: py, args: ['-m', 'pytest', '-q'] }], note: 'Python project: pytest' };
  }
  if (exists(join(cwd, 'go.mod'))) {
    return {
      checks: [
        { label: 'go vet', command: 'go', args: ['vet', './...'] },
        { label: 'go test', command: 'go', args: ['test', './...'] },
      ],
      note: 'Go project: vet + test',
    };
  }
  return { checks: [], note: 'No supported project detected (no package.json scripts, pytest, or go.mod) — nothing to verify.' };
}

function runCheck(check: Check, cwd: string, signal: AbortSignal): Promise<{ ok: boolean; ms: number; tail: string }> {
  const started = Date.now();
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(check.command, check.args, { cwd, env: process.env, windowsHide: true, signal });
    } catch (e) {
      resolve({ ok: false, ms: Date.now() - started, tail: `Failed to start: ${(e as Error).message}` });
      return;
    }
    let out = '';
    const feed = (d: Buffer) => {
      out += d.toString();
      if (out.length > MAX_TAIL) out = out.slice(-MAX_TAIL);
    };
    child.stdout?.on('data', feed);
    child.stderr?.on('data', feed);
    const timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch { /* already dead */ }
    }, PER_CHECK_TIMEOUT);
    child.on('error', (e) => {
      clearTimeout(timer);
      resolve({ ok: false, ms: Date.now() - started, tail: `Spawn error: ${(e as Error).message}` });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ ok: code === 0, ms: Date.now() - started, tail: out.trim() || '(no output)' });
    });
  });
}

export const verifyTool: Tool = {
  name: 'Verify',
  description:
    'Run workspace checks after editing code: typecheck, lint, test, build (auto-detected). Returns pass/fail per check with the failing tail. Run after Write/Edit and fix every failure before replying — the edit→verify→fix loop.',
  inputSchema: {
    type: 'object',
    properties: {
      only: {
        type: 'array',
        items: { type: 'string' },
        description: 'Subset of check labels to run (e.g. ["npm run typecheck"]). Default: quick checks (everything except build); use ["all"] for everything including build.',
      },
    },
  },
  permission: 'ask',

  async execute(args, ctx: ToolContext): Promise<ToolResult> {
    const { only } = (args ?? {}) as { only?: string[] };
    const { checks, note } = detectChecks(ctx.cwd);
    if (checks.length === 0) return { content: note };
    const wantAll = !only || only.length === 0 || only.includes('all');
    const selected = checks.filter((c) => {
      if (wantAll) return !/build/i.test(c.label); // quick by default: build is slow, run it explicitly
      if (only!.includes('all')) return true;
      return only!.some((o) => c.label.toLowerCase().includes(String(o).toLowerCase()));
    });
    if (selected.length === 0) {
      return { content: `No checks match [${(only ?? []).join(', ')}]. Available: ${checks.map((c) => c.label).join(', ')}`, is_error: true };
    }
    const lines: string[] = [`Verifying ${ctx.cwd} — ${note}.`];
    let failed = 0;
    for (const check of selected) {
      const r = await runCheck(check, ctx.cwd, ctx.abortSignal);
      lines.push(`${r.ok ? 'PASS' : 'FAIL'} ${check.label} (${(r.ms / 1000).toFixed(1)}s)`);
      if (!r.ok) {
        failed++;
        lines.push(`--- ${check.label} output tail ---`);
        lines.push(r.tail.slice(-4000));
      }
      if (ctx.abortSignal.aborted) {
        lines.push('Aborted by user.');
        break;
      }
    }
    lines.push(failed === 0 ? `All ${selected.length} check(s) passed.` : `${failed}/${selected.length} check(s) FAILED — fix every failure and re-run Verify before replying.`);
    return { content: lines.join('\n'), is_error: failed > 0 };
  },
};
