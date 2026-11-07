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
import {
  computeTrendFromDisk,
  discoverCandidates,
  parseCandidate,
  runBenchmarkMatrix,
  type MatrixReport,
} from './matrix.js';

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

function printTrend(out: NodeJS.WritableStream, err: NodeJS.WritableStream): number {
  const trend = computeTrendFromDisk();
  if (trend.series.length === 0) {
    out.write('trend: no evaluation history yet — run the suite first (npm run eval).\n');
    return 0;
  }
  out.write(`Trend across ${trend.series.length} task/model series (skipped runs excluded):\n`);
  for (const series of trend.series) {
    const path = series.points
      .map((point) => `${point.status}@${new Date(point.startedAt).toISOString().slice(0, 10)}`)
      .join(' → ');
    out.write(`  ${series.taskId} [${series.provider}/${series.model}]: ${path}\n`);
    for (const regression of series.regressions) {
      out.write(`    REGRESSION ${regression.from.reportId} (passed) → ${regression.to.reportId} (${regression.to.status})\n`);
    }
  }
  if (trend.regressions.length === 0) {
    out.write('\nNo regressions detected.\n');
    return 0;
  }
  out.write(`\n${trend.regressions.length} regressed task/model series.\n`);
  void err;
  return 1;
}

/** Providers with a saved key (or keyless by design), with their default model.
 *  Runs inside the real Electron main process, so DPAPI-wrapped keys resolve. */
async function listKeyBackedCandidates(): Promise<Array<{ provider: string; model: string }>> {
  const out: Array<{ provider: string; model: string }> = [];
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { getAllApiKeys } = require('../settings/secrets.js') as typeof import('../settings/secrets.js');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { listProviders } = require('../providers/registry.js') as typeof import('../providers/registry.js');
    for (const p of listProviders()) {
      const model = p.defaultModel;
      if (!model) continue;
      if (!p.requiresApiKey) { out.push({ provider: p.id, model }); continue; }
      try {
        const keys = await getAllApiKeys(p.id);
        if (keys.length > 0) out.push({ provider: p.id, model });
      } catch { /* unreadable key — candidate skipped */ }
    }
  } catch { /* registry unavailable — discovery degrades to the current selection */ }
  return out;
}
async function runMatrix(
  args: EvalArgs,
  out: NodeJS.WritableStream,
  err: NodeJS.WritableStream,
): Promise<number> {
  const suite = getEvalSuite(args.suite);
  if (!suite) {
    err.write(`eval: unknown suite '${args.suite}'.\n`);
    return 2;
  }
  const problems = validateEvalSuite(suite);
  if (problems.length > 0) {
    err.write(`eval: suite '${suite.id}' is invalid:\n`);
    for (const problem of problems) err.write(`  - ${problem}\n`);
    return 2;
  }

  // 'auto' expands to the current selection plus locally installed Ollama
  // models (the headless CLI cannot read DPAPI-wrapped cloud keys).
  await settings.load(process.cwd()).catch(() => undefined);
  const provider = args.provider ?? settings.get<string>('provider') ?? 'ollama';
  const model = args.model ?? settings.get<string>('model') ?? 'qwen3:4b';
  let candidateSpecs = args.matrix;
  if (candidateSpecs.some((entry) => entry.trim().toLowerCase() === 'auto')) {
    const discovered = await discoverCandidates(provider ?? 'ollama', model ?? 'qwen3:4b', listKeyBackedCandidates);
    candidateSpecs = [
      ...candidateSpecs.filter((entry) => entry.trim().toLowerCase() !== 'auto'),
      ...discovered.map((entry) => entry.label),
    ];
  }
  // Dedupe after expansion: '--matrix auto,openai/gpt-5' with the current
  // selection ALREADY being openai/gpt-5 must not run the suite twice for
  // the same model.
  const seenSpecs = new Set<string>();
  const candidates = candidateSpecs
    .map(parseCandidate)
    .filter((c): c is NonNullable<typeof c> => {
      if (!c) return false;
      if (seenSpecs.has(c.label)) return false;
      seenSpecs.add(c.label);
      return true;
    });
  if (candidates.length === 0) {
    err.write("eval: --matrix needs comma-separated provider/model pairs, e.g. --matrix 'openai/gpt-5,ollama/qwen3:8b'.\n");
    return 2;
  }

  let tasks: EvalTask[] = args.tasks.length > 0
    ? suite.tasks.filter((task) => args.tasks.includes(task.id))
    : suite.tasks;
  if (args.timeoutMin !== null) {
    tasks = tasks.map((task) => ({ ...task, timeoutMs: Math.round(args.timeoutMin! * 60_000) }));
  }
  if (tasks.length === 0) {
    err.write('eval: no tasks selected.\n');
    return 2;
  }

  err.write(`eval matrix: suite=${suite.id} candidates=${candidates.map((c) => c.label).join(', ')} tasks=${tasks.length}\n`);

  const matrix: MatrixReport = await runBenchmarkMatrix({
    suiteId: suite.id,
    tasks,
    candidates,
    runnerFactory: (candidate) => createAgentEvalRunner({ provider: candidate.provider, model: candidate.model }),
    onProgress: (message) => err.write(`  ${message}\n`),
  });

  // Persist the matrix alongside the per-run reports so trends and the UI
  // can read it back.
  const { writeFileSync, mkdirSync } = await import('node:fs');
  const { dirname } = await import('node:path');
  const matrixPath = join(reportsDir(), `${matrix.id}.matrix.json`);
  mkdirSync(dirname(matrixPath), { recursive: true });
  writeFileSync(matrixPath, JSON.stringify(matrix, null, 2));

  if (args.json) {
    out.write(JSON.stringify(matrix, null, 2) + '\n');
    return 0;
  }

  out.write(`\nBenchmark matrix ${matrix.id} — suite ${suite.id}\n`);
  out.write('  task'.padEnd(28));
  for (const candidate of candidates) out.write(`${candidate.label.slice(0, 26).padEnd(28)}`);
  out.write('\n');
  for (const row of matrix.rows) {
    out.write(`  ${row.taskId.padEnd(26).slice(0, 26)}`);
    for (const status of row.statuses) out.write(status.toUpperCase().padEnd(28));
    out.write('\n');
  }
  out.write('\nPass rates:\n');
  const ranked = [...matrix.passRates].sort((a, b) => b.rate - a.rate);
  for (const entry of ranked) {
    out.write(`  ${entry.provider}/${entry.model}: ${entry.passed}/${entry.total} (${Math.round(entry.rate * 100)}%)\n`);
  }
  out.write(`\nMatrix report: ${matrixPath}\n`);
  return 0;
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

  if (args.trend) {
    return printTrend(out, err);
  }

  if (args.matrix.length > 0) {
    return runMatrix(args, out, err);
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
