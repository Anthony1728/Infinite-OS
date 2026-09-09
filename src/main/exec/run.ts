/**
 * Headless exec — the Droid/Pi/Codex `exec` strength, Infinite OS edition.
 * Runs one agent turn to completion with no window and no prompts:
 * progress on stderr (human) or JSONL events on stdout (--json), final
 * assistant text on stdout, process exit code for scripts/CI.
 *
 *   npm run exec -- "fix the failing tests" --yes
 *   npm run exec -- --review --json
 *   npm run exec -- --resume <sessionId> "continue" --yes
 *
 * Safety: without --yes, any tool needing approval fails closed (no window
 * can answer it) with a clear error. --yes bypasses prompts for THIS RUN
 * ONLY via a process-scoped env flag — nothing is persisted. --review forces
 * read-only for the run. Requires a prior `npm run build` (runs the built
 * main process headless).
 */

import { runAgent } from '../agent/loop.js';
import { loadMessages, loadSessionMeta } from '../session/store.js';
import { settings } from '../settings/store.js';
import type { ExecArgs } from './args.js';
export type { ExecArgs } from './args.js';

function safeJson(value: unknown): string | null {
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

export async function runExec(args: ExecArgs, out: NodeJS.WritableStream = process.stdout, err: NodeJS.WritableStream = process.stderr): Promise<number> {
  if (args.yes) process.env.INFINITE_EXEC_YES = '1';
  if (args.review) process.env.INFINITE_EXEC_READONLY = '1';

  let history: never[] | Awaited<ReturnType<typeof loadMessages>> = [];
  if (args.resume) {
    const meta = await loadSessionMeta(args.resume).catch(() => null);
    if (!meta) {
      err.write(`exec: unknown session '${args.resume}'\n`);
      return 2;
    }
    history = await loadMessages(args.resume).catch(() => []);
  }

  const prompt = args.review
    ? `Review the current working tree for bugs, security issues, missing tests, and breaking changes. READ-ONLY: do not modify any file, run no state-changing commands. Report prioritized findings with file paths. ${args.prompt}`.trim()
    : args.prompt;
  if (!prompt) {
    err.write('exec: empty prompt\n');
    return 2;
  }

  const provider = args.provider ?? settings.get<string>('provider') ?? 'ollama';
  const model = args.model ?? settings.get<string>('model') ?? 'qwen3:4b';
  const sessionId = args.resume ?? `exec-${Date.now()}`;
  const userMessage = {
    id: crypto.randomUUID(),
    role: 'user',
    content: [{ type: 'text', text: prompt }],
    timestamp: Date.now(),
  } as never;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), args.timeoutMin * 60_000);

  try {
    const completed = await runAgent(history as never[], userMessage, {
      sessionId,
      cwd: args.cwd,
      provider,
      model,
      signal: ctrl.signal,
      onEvent: (ev) => {
        const e = ev as { type?: string; name?: string; status?: string; error?: string };
        if (args.json) {
          const json = safeJson({ t: Date.now(), event: e });
          if (json) out.write(json + '\n');
        } else if (e.type === 'tool_use_start' && e.name) err.write(`[tool] ${e.name}…\n`);
        else if (e.type === 'provider_status' && e.status) err.write(`[${provider}/${model}] ${String(e.status).slice(0, 160)}\n`);
        else if (e.type === 'error' && e.error) err.write(`[error] ${e.error}\n`);
      },
    });
    const last = [...completed].reverse().find((m) => m.role === 'assistant');
    const blocks = (last?.content ?? []) as Array<{ type?: string; text?: string }>;
    const answer = blocks.filter((b) => b.type === 'text' && b.text).map((b) => b.text).join('\n\n').trim();
    if (!answer) {
      err.write('exec: agent finished with no text answer\n');
      return 1;
    }
    out.write(answer + (answer.endsWith('\n') ? '' : '\n'));
    return 0;
  } catch (e) {
    err.write(`exec: ${(e as Error).message}\n`);
    return 1;
  } finally {
    clearTimeout(timer);
    delete process.env.INFINITE_EXEC_YES;
    delete process.env.INFINITE_EXEC_READONLY;
  }
}
