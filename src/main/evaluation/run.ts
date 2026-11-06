/**
 * Headless evaluation runner.
 *
 *   npm run eval -- --list
 *   npm run eval -- --task fix-failing-test
 *   npm run eval -- --provider openai --model gpt-5 --json
 *
 * Exit code 0 means every selected task passed its mechanical checks. A task
 * never passes because the agent said it was done.
 */

import { join } from 'node:path';
import { settings } from '../settings/store.js';
import type { EvalArgs } from './args.js';
import type { EvalTask, EvalTaskResult } from './contracts.js';
import { getEvalSuite, listEvalSuites, validateEvalSuite } from './fixtures.js';
import { evaluationRoot, runEvaluation } from './harness.js';
import { reportsDir } from './harness.js';
import { createAgentEvalRunner } from './runner.js';

function formatDuration(ms: number): string {
  if (ms < 1_000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1_000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1_000)}s`;
}

function statusGlyph(result: EvalTaskResult): string {
  if (result.status === 'passed') return 'PASS';
  if (result.status === 'failed') return 'FAIL';
  if (result.status === 'skipped') return 'SKIP';
  return 'ERROR';
}

function printTaskDetail(result: EvalTaskResult, err: NodeJS.WritableStream): void {
  const failed = result.checks.filter((check) => !check.ok);
  for (const check of failed) {
    err.write(`      ${check.checkId}: ${check.detail}\n`);
  }
  if (result.runnerError && result.status !== 'failed') {
    err.write(`      runner: ${result.runnerError}\n`);
  }
}

export async function runEval(
  args: EvalArgs,
  out: NodeJS.WritableStream = process.stdout,
  err: NodeJS.WritableStream = process.stderr,
): Promise<number> {
  if (args.list) {
    out.write('Evaluation suites:\n');
    for (const suite of listEvalSuites()) {
      out.write(`  ${suite.id} — ${suite.name} (${suite.tasks} tasks)\n`);
    }
    const suite = getEvalSuite(args.suite);
    if (suite) {
      out.write(`\nTasks in ${suite.id}:\n`);
      for (const task of suite.tasks) {
        out.write(`  ${task.id} — ${task.name}\n`);
      }
    }
    return 0;
  }

  const suite = getEvalSuite(args.suite);
  if (!suite) {
    err.write(`eval: unknown suite '${args.suite}'. Available: ${listEvalSuites().map((entry) => entry.id).join(', ')}\n`);
    return 2;
  }

  const problems = validateEvalSuite(suite);
  if (problems.length > 0) {
    err.write(`eval: suite '${suite.id}' is invalid:\n`);
    for (const problem of problems) err.write(`  - ${problem}\n`);
    return 2;
  }

  const unknownTasks = args.tasks.filter((id) => !suite.tasks.some((task) => task.id === id));
  if (unknownTasks.length > 0) {
    err.write(`eval: unknown task(s): ${unknownTasks.join(', ')}\n`);
    err.write(`Available tasks: ${suite.tasks.map((task) => task.id).join(', ')}\n`);
    return 2;
  }

  let tasks: EvalTask[] = args.tasks.length > 0
    ? suite.tasks.filter((task) => args.tasks.includes(task.id))
    : suite.tasks;
  if (args.timeoutMin !== null) {
    const timeoutMs = Math.round(args.timeoutMin * 60_000);
    tasks = tasks.map((task) => ({ ...task, timeoutMs }));
  }
  if (tasks.length === 0) {
    err.write('eval: no tasks selected.\n');
    return 2;
  }

  await settings.load(process.cwd()).catch((error) => {
    err.write(`eval: could not load settings (${(error as Error).message}); using defaults.\n`);
  });
  const provider = args.provider ?? settings.get<string>('provider') ?? 'ollama';
  const model = args.model ?? settings.get<string>('model') ?? 'qwen3:4b';

  err.write(`eval: suite=${suite.id} provider=${provider} model=${model} tasks=${tasks.length}\n`);

  const report = await runEvaluation({
    tasks,
    suiteId: suite.id,
    provider,
    model,
    runner: createAgentEvalRunner({ provider, model }),
    onProgress: (event) => {
      if (event.phase === 'task-start') {
        err.write(`\n[eval ${event.index + 1}/${event.total}] ${event.taskName} (${event.taskId})\n`);
      } else if (event.phase === 'task-progress') {
        err.write(`  ${event.message}\n`);
      } else if (event.phase === 'task-done') {
        err.write(`  ${statusGlyph(event.result)} in ${formatDuration(event.result.durationMs)}\n`);
        printTaskDetail(event.result, err);
      }
    },
  });

  if (args.json) {
    out.write(JSON.stringify(report, null, 2) + '\n');
  } else {
    const counts = report.counts;
    out.write(`\nEvaluation ${report.id} — ${report.overall.toUpperCase()}\n`);
    out.write(`${provider}/${model} · ${formatDuration(report.durationMs)} · ` +
      `${counts.passed} passed, ${counts.failed} failed, ${counts.errored} errored, ${counts.skipped} skipped\n`);
    for (const result of report.tasks) {
      out.write(`  ${statusGlyph(result)}  ${result.taskId} (${formatDuration(result.durationMs)})\n`);
    }
    const failed = report.tasks.filter((task) => task.status !== 'passed');
    if (failed.length > 0) {
      out.write('\nNot passed:\n');
      for (const result of failed) {
        out.write(`  ${result.taskId}: ${result.runnerError ?? `${result.checks.filter((check) => !check.ok).length} failed check(s)`}\n`);
      }
    }
    out.write(`\nReport: ${join(reportsDir(), `${report.id}.json`)}\n`);
    out.write(`Workspaces: ${join(evaluationRoot(), 'workspaces', report.id)}\n`);
  }

  return report.overall === 'passed' ? 0 : 1;
}
