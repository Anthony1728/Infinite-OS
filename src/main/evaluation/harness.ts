/**
 * Evaluation harness.
 *
 * Runs each task in its own isolated workspace, seeds the starting files,
 * enforces a per-task wall-clock ceiling, then decides pass/fail from checks
 * that inspect the real filesystem. Reports are persisted so a run can be
 * audited after the fact instead of disappearing with the terminal scrollback.
 */

import { randomBytes } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { infiniteHome } from '../profiles/home.js';
import { resolveInsideWorkspace, runChecks } from './checks.js';
import {
  countTasks,
  summarizeReport,
  type EvalReport,
  type EvalReportSummary,
  type EvalRunner,
  type EvalRunnerResult,
  type EvalTask,
  type EvalTaskResult,
} from './contracts.js';

const DEFAULT_TASK_TIMEOUT_MS = 5 * 60_000;
const RUNNER_GRACE_MS = 2_000;
const MAX_OUTPUT_CHARS = 20_000;
const INDEX_LIMIT = 100;

export type EvalProgress =
  | { phase: 'task-start'; taskId: string; taskName: string; index: number; total: number }
  | { phase: 'task-progress'; taskId: string; message: string }
  | { phase: 'task-done'; index: number; total: number; result: EvalTaskResult }
  | { phase: 'report'; reportId: string; report: EvalReport };

export interface RunEvaluationOptions {
  tasks: EvalTask[];
  suiteId: string;
  provider: string;
  model: string;
  runner: EvalRunner;
  /** Override the evaluation root (tests). Defaults to the profile home. */
  dataDir?: string;
  onProgress?: (event: EvalProgress) => void;
  /** Caller abort (Ctrl+C / window closed). Remaining tasks are marked skipped. */
  signal?: AbortSignal;
  now?: () => number;
  /** Test hook; must be filesystem-safe. */
  idFactory?: () => string;
}

export function evaluationRoot(dataDir?: string): string {
  return dataDir ? resolve(dataDir) : join(infiniteHome(), 'evaluations');
}

export function reportsDir(dataDir?: string): string {
  return join(evaluationRoot(dataDir), 'reports');
}

export function workspacesDir(dataDir?: string): string {
  return join(evaluationRoot(dataDir), 'workspaces');
}

/** Filesystem-safe directory segment for a task id. */
export function safeSegment(value: string): string {
  const cleaned = value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 80);
  return cleaned || 'task';
}

function defaultId(now: () => number): string {
  return `eval-${now().toString(36)}-${randomBytes(3).toString('hex')}`;
}

function atomicWriteJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${randomBytes(3).toString('hex')}.tmp`;
  writeFileSync(temporary, JSON.stringify(value, null, 2), 'utf8');
  renameSync(temporary, path);
}

function seedWorkspace(workspace: string, task: EvalTask): void {
  mkdirSync(workspace, { recursive: true });
  for (const file of task.seedFiles) {
    const target = resolveInsideWorkspace(workspace, file.path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, file.content, 'utf8');
  }
}

function timeoutResult(timeoutMs: number): EvalRunnerResult {
  return {
    success: false,
    output: '',
    error: `Timed out after ${timeoutMs}ms before the runner returned.`,
  };
}

async function withTimeout(
  runner: EvalRunner,
  task: EvalTask,
  context: Parameters<EvalRunner>[1],
  controller: AbortController,
  timeoutMs: number,
): Promise<{ result: EvalRunnerResult; timedOut: boolean }> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<null>((resolvePromise) => {
    timer = setTimeout(() => {
      controller.abort();
      resolvePromise(null);
    }, timeoutMs);
    timer.unref?.();
  });

  const run = Promise.resolve()
    .then(() => runner(task, context))
    .catch((error): EvalRunnerResult => ({
      success: false,
      output: '',
      error: (error as Error).message,
    }));

  const raced = await Promise.race([run, timeout]);
  if (timer) clearTimeout(timer);
  if (raced !== null) return { result: raced, timedOut: false };

  // The runner should observe the abort immediately. Give it a short grace
  // period so a real runAgent can unwind and flush its final events.
  controller.abort();
  const grace = new Promise<null>((resolvePromise) => {
    const handle = setTimeout(() => resolvePromise(null), RUNNER_GRACE_MS);
    handle.unref?.();
  });
  const settled = await Promise.race([run, grace]);
  return {
    result: settled ?? timeoutResult(timeoutMs),
    timedOut: true,
  };
}

function skippedResult(task: EvalTask, reason: string, workspace: string, at: number): EvalTaskResult {
  return {
    taskId: task.id,
    taskName: task.name,
    status: 'skipped',
    runnerSuccess: false,
    runnerError: reason,
    output: '',
    checks: [],
    startedAt: at,
    finishedAt: at,
    durationMs: 0,
    workspace,
  };
}

export async function runEvaluation(options: RunEvaluationOptions): Promise<EvalReport> {
  const now = options.now ?? Date.now;
  const startedAt = now();
  const reportId = options.idFactory?.() ?? defaultId(now);
  if (!/^[a-zA-Z0-9._-]+$/.test(reportId)) {
    throw new Error(`Unsafe evaluation id: ${reportId}`);
  }

  const reportWorkspaceRoot = join(workspacesDir(options.dataDir), reportId);
  mkdirSync(reportWorkspaceRoot, { recursive: true });

  const results: EvalTaskResult[] = [];
  const total = options.tasks.length;
  let aborted = false;

  for (let index = 0; index < options.tasks.length; index++) {
    const task = options.tasks[index];
    const taskWorkspace = join(reportWorkspaceRoot, `${String(index + 1).padStart(2, '0')}-${safeSegment(task.id)}`);

    if (aborted || options.signal?.aborted) {
      aborted = true;
      results.push(skippedResult(task, 'Evaluation aborted before this task started.', taskWorkspace, now()));
      continue;
    }

    options.onProgress?.({ phase: 'task-start', taskId: task.id, taskName: task.name, index, total });
    const taskStartedAt = now();
    let runnerResult: EvalRunnerResult;
    let timedOut = false;

    try {
      seedWorkspace(taskWorkspace, task);
    } catch (error) {
      const finishedAt = now();
      results.push({
        taskId: task.id,
        taskName: task.name,
        status: 'error',
        runnerSuccess: false,
        runnerError: `Could not seed the task workspace: ${(error as Error).message}`,
        output: '',
        checks: [],
        startedAt: taskStartedAt,
        finishedAt,
        durationMs: finishedAt - taskStartedAt,
        workspace: taskWorkspace,
      });
      options.onProgress?.({ phase: 'task-done', index, total, result: results[results.length - 1] });
      continue;
    }

    const controller = new AbortController();
    const forwardAbort = (): void => controller.abort();
    options.signal?.addEventListener('abort', forwardAbort, { once: true });
    const timeoutMs = Math.max(1, task.timeoutMs ?? DEFAULT_TASK_TIMEOUT_MS);

    try {
      const outcome = await withTimeout(
        options.runner,
        task,
        {
          workspace: taskWorkspace,
          provider: options.provider,
          model: options.model,
          signal: controller.signal,
          onProgress: (message) => options.onProgress?.({
            phase: 'task-progress',
            taskId: task.id,
            message,
          }),
        },
        controller,
        timeoutMs,
      );
      runnerResult = outcome.result;
      timedOut = outcome.timedOut;
    } catch (error) {
      runnerResult = { success: false, output: '', error: (error as Error).message };
    } finally {
      options.signal?.removeEventListener('abort', forwardAbort);
    }

    // Checks run even after a runner error: the workspace is the evidence, and
    // a check that passes is real regardless of what the agent claimed.
    const checks = task.checks.length > 0
      ? await runChecks(task.checks, taskWorkspace)
      : [];
    const finishedAt = now();

    let status: EvalTaskResult['status'];
    let runnerError = runnerResult.error;
    if (aborted || options.signal?.aborted) {
      // The caller cancelled mid-task: this task cannot be scored.
      status = 'skipped';
      runnerError = runnerError ?? 'Evaluation was aborted while this task was running.';
      aborted = true;
    } else if (timedOut) {
      status = 'error';
      runnerError = runnerError ?? `Timed out after ${timeoutMs}ms.`;
    } else if (task.checks.length === 0) {
      status = 'error';
      runnerError = 'Task defines no checks, so completion cannot be proven.';
    } else if (checks.every((check) => check.ok)) {
      status = 'passed';
    } else {
      status = 'failed';
    }

    const output = runnerResult.output.length > MAX_OUTPUT_CHARS
      ? `${runnerResult.output.slice(0, MAX_OUTPUT_CHARS)}…`
      : runnerResult.output;

    const result: EvalTaskResult = {
      taskId: task.id,
      taskName: task.name,
      status,
      runnerSuccess: runnerResult.success,
      ...(runnerError ? { runnerError } : {}),
      output,
      checks,
      startedAt: taskStartedAt,
      finishedAt,
      durationMs: finishedAt - taskStartedAt,
      workspace: taskWorkspace,
    };
    results.push(result);
    options.onProgress?.({ phase: 'task-done', index, total, result });
  }

  const finishedAt = now();
  const counts = countTasks(results);
  const report: EvalReport = {
    version: 1,
    id: reportId,
    suiteId: options.suiteId,
    provider: options.provider,
    model: options.model,
    startedAt,
    finishedAt,
    durationMs: finishedAt - startedAt,
    overall: results.length > 0 && counts.failed === 0 && counts.errored === 0 && counts.skipped === 0
      ? 'passed'
      : 'failed',
    counts,
    tasks: results,
  };

  persistReport(report, options.dataDir);
  options.onProgress?.({ phase: 'report', reportId, report });
  return report;
}

export function persistReport(report: EvalReport, dataDir?: string): void {
  if (!/^[a-zA-Z0-9._-]+$/.test(report.id)) throw new Error(`Unsafe evaluation id: ${report.id}`);
  const root = evaluationRoot(dataDir);
  atomicWriteJson(join(reportsDir(dataDir), `${report.id}.json`), report);

  const index = listEvaluationReports({ dataDir, limit: INDEX_LIMIT });
  const summaries = index.filter((entry) => entry.id !== report.id);
  summaries.unshift(summarizeReport(report));
  atomicWriteJson(join(root, 'index.json'), {
    version: 1,
    reports: summaries.slice(0, INDEX_LIMIT),
  });
}

export function listEvaluationReports(options?: { dataDir?: string; limit?: number }): EvalReportSummary[] {
  const limit = Math.max(1, Math.min(INDEX_LIMIT, options?.limit ?? 20));
  const directory = reportsDir(options?.dataDir);
  if (!existsSync(directory)) return [];
  const summaries: EvalReportSummary[] = [];
  for (const name of readdirSync(directory)) {
    if (!name.endsWith('.json')) continue;
    try {
      const report = JSON.parse(readFileSync(join(directory, name), 'utf8')) as EvalReport;
      if (report?.version === 1 && typeof report.id === 'string' && Array.isArray(report.tasks)) {
        summaries.push(summarizeReport(report));
      }
    } catch {
      // A partially-written or hand-edited report is not an evaluation result.
    }
  }
  summaries.sort((a, b) => b.startedAt - a.startedAt);
  return summaries.slice(0, limit);
}

export function getEvaluationReport(id: string, dataDir?: string): EvalReport | null {
  if (!/^[a-zA-Z0-9._-]+$/.test(id)) return null;
  const path = join(reportsDir(dataDir), `${id}.json`);
  try {
    if (!statSync(path).isFile()) return null;
    const report = JSON.parse(readFileSync(path, 'utf8')) as EvalReport;
    return report?.version === 1 && report.id === id ? report : null;
  } catch {
    return null;
  }
}
