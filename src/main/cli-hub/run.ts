import { spawn } from 'node:child_process';

/**
 * Running a CLI-Hub install command, and a CLI-Hub entry point.
 *
 * Both are third-party shell strings from a registry the agent reads at
 * runtime, so both are treated as untrusted. The rules this file follows:
 *
 *   - The install command is run as the registry wrote it. It is never
 *     rewritten, never "corrected", and never assembled from an entry name.
 *     Rewriting it is how a registry typo becomes a different command than the
 *     one a human would read on the page.
 *   - A command containing shell metacharacters is refused rather than passed
 *     to a shell that would expand them. `install_cmd` is a single `pip install`
 *     line; a `&&` or a backtick in one means something is wrong with the entry
 *     and is not something to guess at.
 *   - Everything is bounded by a timeout, because `pip install` on a bad network
 *     otherwise hangs the turn indefinitely.
 */

/** Refuse to hand a string with shell syntax to a shell. */
export function hasShellSyntax(command: string): boolean {
  return /[;&|`$><\n\r]/.test(command) || command.includes('&&') || command.includes('||');
}

/** `pip install x` -> `pip`, `['install','x']`. Only for simple commands. */
export function tokenise(command: string): { file: string; args: string[] } | null {
  const trimmed = command.trim();
  if (!trimmed) return null;
  const parts: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  for (const ch of trimmed) {
    if (quote) {
      if (ch === quote) quote = null;
      else current += ch;
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; continue; }
    if (/\s/.test(ch)) {
      if (current) { parts.push(current); current = ''; }
      continue;
    }
    current += ch;
  }
  if (quote) return null; // unbalanced quote: refuse rather than guess
  if (current) parts.push(current);
  if (parts.length === 0) return null;
  return { file: parts[0], args: parts.slice(1) };
}

export interface RunResult {
  ok: boolean;
  code: number | null;
  stdout: string;
  stderr: string;
  /** True when the run was killed for exceeding its timeout. */
  timedOut: boolean;
}

const MAX_OUTPUT = 20_000;

/**
 * Run a command to completion, capturing its output.
 *
 * `command` is either an argv array or a single command string. The array form
 * is preferred and is what the tool uses: an argument is then exactly the
 * string the caller passed, so `["convert", "my file.png", "out.png"]` sends
 * one argument containing a space rather than three arguments. Round-tripping
 * argv through a string and re-splitting it cannot preserve that.
 *
 * Never rejects. A failed install or a crashing CLI is a result the caller
 * needs to read and explain, not an exception that unwinds the turn.
 */
export function runCommand(
  command: string | string[],
  options: { cwd?: string; timeoutMs?: number; env?: NodeJS.ProcessEnv } = {},
): Promise<RunResult> {
  const { cwd, timeoutMs = 300_000, env } = options;

  let file: string;
  let args: string[];

  if (Array.isArray(command)) {
    if (command.length === 0) {
      return Promise.resolve({
        ok: false, code: null, stdout: '', stderr: 'Refused to run: no command given.', timedOut: false,
      });
    }
    file = command[0];
    args = command.slice(1);
  } else {
    // Only the string form needs the shell-syntax check. An argv array is
    // already inert — nothing in it can be interpreted by a shell.
    if (hasShellSyntax(command)) {
      return Promise.resolve({
        ok: false,
        code: null,
        stdout: '',
        stderr:
          'Refused to run: the command contains shell syntax (;, &&, |, `, $, >, < or a newline). ' +
          'Install commands are run directly, without a shell.',
        timedOut: false,
      });
    }
    const parsed = tokenise(command);
    if (!parsed) {
      return Promise.resolve({
        ok: false, code: null, stdout: '', stderr: 'Refused to run: the command could not be parsed.', timedOut: false,
      });
    }
    file = parsed.file;
    args = parsed.args;
  }

  return new Promise<RunResult>((resolve) => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;

    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(file, args, {
        cwd,
        env: { ...process.env, ...env },
        // No shell. The command is already a single argv, and a shell here would
        // reintroduce exactly the expansion the check above refuses.
        shell: false,
        windowsHide: true,
      });
    } catch (error) {
      resolve({ ok: false, code: null, stdout: '', stderr: (error as Error).message, timedOut: false });
      return;
    }

    const finish = (result: RunResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    const timer = setTimeout(() => {
      timedOut = true;
      // Kill the tree: `pip install` spawns children that would keep the pipe
      // open and keep the agent waiting after the parent is gone.
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 3000).unref?.();
    }, timeoutMs);

    child.stdout?.on('data', (d: Buffer) => { if (stdout.length < MAX_OUTPUT) stdout += d.toString(); });
    child.stderr?.on('data', (d: Buffer) => { if (stderr.length < MAX_OUTPUT) stderr += d.toString(); });

    child.on('error', (error: NodeJS.ErrnoException) => {
      // ENOENT here means the command is not on PATH — the single most likely
      // outcome, and the one worth saying plainly rather than as a raw errno.
      const message = error.code === 'ENOENT'
        ? `\`${file}\` is not installed or not on PATH.`
        : error.message;
      finish({ ok: false, code: null, stdout, stderr: message, timedOut });
    });

    child.on('close', (code) => {
      finish({
        ok: code === 0 && !timedOut,
        code,
        stdout,
        stderr: timedOut ? `Timed out after ${Math.round(timeoutMs / 1000)}s.\n${stderr}` : stderr,
        timedOut,
      });
    });
  });
}