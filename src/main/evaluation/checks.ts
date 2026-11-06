/**
 * Mechanical check execution for task evaluations.
 *
 * Every check reads the real workspace or runs a real command. No check calls
 * the agent, reads the agent's summary, or trusts a "done" event. Paths are
 * contained to the task workspace (including symlink targets) so a malicious
 * or confused run cannot make a check inspect the rest of the machine.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { readFileSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import type { EvalCheck, EvalCheckResult } from './contracts.js';

const MAX_OUTPUT_CHARS = 120_000;
const MAX_COMMAND_TIMEOUT_MS = 60_000;
const DEFAULT_COMMAND_TIMEOUT_MS = 20_000;

export class EvalPathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EvalPathError';
  }
}

/**
 * Resolve a workspace-relative path and prove it stays inside the workspace.
 * Absolute paths, `..` escapes, and symlinks that point outside are rejected.
 */
export function resolveInsideWorkspace(workspace: string, requested: string): string {
  if (typeof requested !== 'string' || requested.trim().length === 0) {
    throw new EvalPathError('Path is empty.');
  }
  if (isAbsolute(requested)) {
    throw new EvalPathError(`Absolute paths are not allowed in evaluation checks: ${requested}`);
  }
  const root = resolve(workspace);
  const target = resolve(root, requested);
  const rel = relative(root, target);
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) {
    throw new EvalPathError(`Path escapes the evaluation workspace: ${requested}`);
  }
  // Existing files may be symlinks: compare real paths, not lexical ones.
  try {
    const realRoot = realpathSync(root);
    const realTarget = realpathSync(target);
    const realRel = relative(realRoot, realTarget);
    if (realRel === '' || realRel.startsWith('..') || isAbsolute(realRel)) {
      throw new EvalPathError(`Path resolves outside the evaluation workspace: ${requested}`);
    }
  } catch (error) {
    if (error instanceof EvalPathError) throw error;
    // ENOENT is expected for file_absent and for files the run has not created
    // yet. The lexical containment check above already passed.
  }
  return target;
}

interface JsonLookup {
  found: boolean;
  value?: unknown;
}

/** Support `a.b`, `a[0]`, `a["b"]`, and `$`-prefixed paths. */
export function parseJsonPath(jsonPath: string): Array<string | number> {
  const path = jsonPath.trim();
  if (!path) throw new Error('JSON path is empty.');
  const tokens: Array<string | number> = [];
  let index = path.startsWith('$') ? 1 : 0;
  while (index < path.length) {
    const char = path[index];
    if (char === '.') {
      index++;
      continue;
    }
    if (char === '[') {
      const end = path.indexOf(']', index);
      if (end < 0) throw new Error(`Unclosed bracket in JSON path: ${jsonPath}`);
      const inner = path.slice(index + 1, end).trim();
      if (
        (inner.startsWith('"') && inner.endsWith('"')) ||
        (inner.startsWith("'") && inner.endsWith("'"))
      ) {
        tokens.push(inner.slice(1, -1));
      } else if (/^\d+$/.test(inner)) {
        tokens.push(Number(inner));
      } else {
        throw new Error(`Unsupported bracket segment "${inner}" in JSON path: ${jsonPath}`);
      }
      index = end + 1;
      continue;
    }
    let end = index;
    while (end < path.length && path[end] !== '.' && path[end] !== '[') end++;
    const key = path.slice(index, end);
    if (!key) throw new Error(`Invalid JSON path: ${jsonPath}`);
    tokens.push(key);
    index = end;
  }
  if (tokens.length === 0) throw new Error(`Invalid JSON path: ${jsonPath}`);
  return tokens;
}

export function readJsonPath(value: unknown, jsonPath: string): JsonLookup {
  let current: unknown = value;
  for (const token of parseJsonPath(jsonPath)) {
    if (Array.isArray(current) && typeof token === 'number') {
      if (token >= current.length) return { found: false };
      current = current[token];
      continue;
    }
    if (current !== null && typeof current === 'object' && typeof token === 'string') {
      if (!Object.prototype.hasOwnProperty.call(current, token)) return { found: false };
      current = (current as Record<string, unknown>)[token];
      continue;
    }
    return { found: false };
  }
  return { found: true, value: current };
}

interface CommandOutcome {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  error?: string;
}

function appendBounded(current: string, chunk: string): string {
  if (current.length >= MAX_OUTPUT_CHARS) return current;
  return (current + chunk).slice(0, MAX_OUTPUT_CHARS);
}

function killProcessTree(child: ChildProcess): void {
  if (!child.pid) return;
  if (process.platform === 'win32') {
    try {
      spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
        windowsHide: true,
        stdio: 'ignore',
      });
    } catch {
      // Best effort; the timeout still resolves the check.
    }
    return;
  }
  try {
    child.kill('SIGKILL');
  } catch {
    // Best effort.
  }
}

/** Run a fixture command in the task workspace with a hard timeout. */
export function runCommand(
  command: string,
  cwd: string,
  timeoutMs = DEFAULT_COMMAND_TIMEOUT_MS,
): Promise<CommandOutcome> {
  return new Promise((resolvePromise) => {
    const budget = Math.max(1_000, Math.min(MAX_COMMAND_TIMEOUT_MS, timeoutMs));
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;

    let child: ChildProcess;
    try {
      child = spawn(command, {
        cwd,
        shell: true,
        windowsHide: true,
        env: { ...process.env, INFINITE_EVAL_RUN: '1' },
      });
    } catch (error) {
      resolvePromise({
        code: null,
        stdout,
        stderr,
        timedOut: false,
        error: (error as Error).message,
      });
      return;
    }

    const settle = (outcome: CommandOutcome): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolvePromise(outcome);
    };

    const timer = setTimeout(() => {
      timedOut = true;
      killProcessTree(child);
      // Do not wait forever for a shell that ignores termination.
      setTimeout(() => {
        settle({
          code: null,
          stdout,
          stderr,
          timedOut: true,
          error: `Command timed out after ${budget}ms.`,
        });
      }, 1_500).unref?.();
    }, budget);

    child.stdout?.on('data', (data: Buffer) => {
      stdout = appendBounded(stdout, data.toString());
    });
    child.stderr?.on('data', (data: Buffer) => {
      stderr = appendBounded(stderr, data.toString());
    });
    child.on('error', (error) => {
      settle({
        code: null,
        stdout,
        stderr,
        timedOut,
        error: error.message,
      });
    });
    child.on('close', (code) => {
      settle({ code, stdout, stderr, timedOut });
    });
  });
}

function snippet(value: string, max = 400): string {
  const trimmed = value.replace(/\s+/g, ' ').trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max)}…`;
}

function readText(workspace: string, path: string): { text: string } | { error: string } {
  let absolute: string;
  try {
    absolute = resolveInsideWorkspace(workspace, path);
  } catch (error) {
    return { error: (error as Error).message };
  }
  try {
    const stat = statSync(absolute);
    if (!stat.isFile()) return { error: `${path} is not a regular file.` };
    return { text: readFileSync(absolute, 'utf8') };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return { error: `${path} does not exist.` };
    return { error: `Could not read ${path}: ${(error as Error).message}` };
  }
}

async function executeCheck(
  check: EvalCheck,
  workspace: string,
): Promise<{ ok: boolean; detail: string }> {
  switch (check.type) {
    case 'file_exists': {
      try {
        const absolute = resolveInsideWorkspace(workspace, check.path);
        const stat = statSync(absolute);
        return stat.isFile()
          ? { ok: true, detail: `${check.path} exists.` }
          : { ok: false, detail: `${check.path} exists but is not a regular file.` };
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === 'ENOENT') return { ok: false, detail: `${check.path} does not exist.` };
        return { ok: false, detail: (error as Error).message };
      }
    }

    case 'file_absent': {
      try {
        const absolute = resolveInsideWorkspace(workspace, check.path);
        statSync(absolute);
        return { ok: false, detail: `${check.path} exists but should not.` };
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === 'ENOENT') return { ok: true, detail: `${check.path} is absent.` };
        return { ok: false, detail: (error as Error).message };
      }
    }

    case 'file_contains':
    case 'file_not_contains': {
      const read = readText(workspace, check.path);
      if ('error' in read) return { ok: false, detail: read.error };
      const caseSensitive = check.caseSensitive !== false;
      const haystack = caseSensitive ? read.text : read.text.toLowerCase();
      const needle = caseSensitive ? check.text : check.text.toLowerCase();
      const contains = haystack.includes(needle);
      if (check.type === 'file_contains') {
        return contains
          ? { ok: true, detail: `${check.path} contains ${JSON.stringify(check.text)}.` }
          : {
              ok: false,
              detail: `${check.path} does not contain ${JSON.stringify(check.text)}.`,
            };
      }
      return contains
        ? { ok: false, detail: `${check.path} still contains ${JSON.stringify(check.text)}.` }
        : { ok: true, detail: `${check.path} does not contain ${JSON.stringify(check.text)}.` };
    }

    case 'file_matches': {
      const read = readText(workspace, check.path);
      if ('error' in read) return { ok: false, detail: read.error };
      let expression: RegExp;
      try {
        expression = new RegExp(check.pattern, check.flags ?? 'm');
      } catch (error) {
        return { ok: false, detail: `Invalid pattern: ${(error as Error).message}` };
      }
      const match = expression.exec(read.text);
      return match
        ? { ok: true, detail: `${check.path} matches /${check.pattern}/${check.flags ?? 'm'}.` }
        : {
            ok: false,
            detail: `${check.path} does not match /${check.pattern}/${check.flags ?? 'm'}.`,
          };
    }

    case 'json_path_equals': {
      const read = readText(workspace, check.path);
      if ('error' in read) return { ok: false, detail: read.error };
      let parsed: unknown;
      try {
        parsed = JSON.parse(read.text);
      } catch (error) {
        return { ok: false, detail: `${check.path} is not valid JSON: ${(error as Error).message}` };
      }
      let lookup: JsonLookup;
      try {
        lookup = readJsonPath(parsed, check.jsonPath);
      } catch (error) {
        return { ok: false, detail: (error as Error).message };
      }
      if (!lookup.found) {
        return { ok: false, detail: `${check.path} has no JSON path ${check.jsonPath}.` };
      }
      if (!isDeepStrictEqual(lookup.value, check.equals)) {
        return {
          ok: false,
          detail: `${check.path} ${check.jsonPath} is ${snippet(JSON.stringify(lookup.value) ?? 'undefined', 200)}, expected ${snippet(JSON.stringify(check.equals) ?? 'undefined', 200)}.`,
        };
      }
      return {
        ok: true,
        detail: `${check.path} ${check.jsonPath} equals ${snippet(JSON.stringify(check.equals) ?? 'undefined', 200)}.`,
      };
    }

    case 'command': {
      const outcome = await runCommand(check.command, workspace, check.timeoutMs);
      const expected = check.expectExitCode ?? 0;
      const parts: string[] = [];
      let ok = true;
      if (outcome.timedOut) {
        ok = false;
        parts.push(`\`${check.command}\` timed out.`);
      } else if (outcome.error && outcome.code === null) {
        ok = false;
        parts.push(`\`${check.command}\` failed to start: ${outcome.error}`);
      } else if (outcome.code !== expected) {
        ok = false;
        parts.push(`\`${check.command}\` exited ${outcome.code}, expected ${expected}.`);
      } else {
        parts.push(`\`${check.command}\` exited ${outcome.code}.`);
      }
      if (check.stdoutContains !== undefined) {
        const contains = outcome.stdout.includes(check.stdoutContains);
        if (!contains) {
          ok = false;
          parts.push(`stdout did not contain ${JSON.stringify(check.stdoutContains)}.`);
        } else {
          parts.push(`stdout contained ${JSON.stringify(check.stdoutContains)}.`);
        }
      }
      if (!ok) {
        const output = snippet(`${outcome.stdout}\n${outcome.stderr}`.trim());
        if (output) parts.push(`Output: ${output}`);
      }
      return { ok, detail: parts.join(' ') };
    }

    default: {
      const exhaustive: never = check;
      return { ok: false, detail: `Unsupported check type: ${String((exhaustive as { type?: string }).type)}` };
    }
  }
}

/** Execute every check in order. A thrown check is a failed check, not a crash. */
export async function runChecks(checks: EvalCheck[], workspace: string): Promise<EvalCheckResult[]> {
  const results: EvalCheckResult[] = [];
  for (const check of checks) {
    const started = Date.now();
    try {
      const outcome = await executeCheck(check, workspace);
      results.push({
        checkId: check.id,
        type: check.type,
        ok: outcome.ok,
        detail: outcome.detail,
        durationMs: Date.now() - started,
      });
    } catch (error) {
      results.push({
        checkId: check.id,
        type: check.type,
        ok: false,
        detail: `Check crashed: ${(error as Error).message}`,
        durationMs: Date.now() - started,
      });
    }
  }
  return results;
}
