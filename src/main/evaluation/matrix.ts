/**
 * Benchmark matrix + regression trend.
 *
 * The evaluation harness proves one (suite, provider, model) run. Reliability
 * claims need the DIMENSION: the same suite run across multiple models, and
 * the history of each (task, model) pair over time. A task that passed last
 * week and fails today with the same model is a regression no single report
 * can reveal.
 *
 * Pure functions here are unit-tested; the runner fan-out reuses runEvaluation
 * so every cell carries the same isolation, timeouts, and check discipline as
 * a single run.
 */

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  reportsDir,
  runEvaluation,
} from './harness.js';
import type {
  EvalReport,
  EvalReportSummary,
  EvalTaskResult,
  EvalTaskStatus,
  EvalRunner,
} from './contracts.js';

// ── Matrix ─────────────────────────────────────────────────────────────────

export interface MatrixCandidate {
  provider: string;
  model: string;
  label: string;
}

export interface MatrixCell {
  taskId: string;
  provider: string;
  model: string;
  status: EvalTaskStatus;
  durationMs: number;
}

export interface MatrixReport {
  version: 1;
  id: string;
  suiteId: string;
  startedAt: number;
  finishedAt: number;
  candidates: MatrixCandidate[];
  /** One row per task, one cell per candidate (order matches candidates). */
  rows: Array<{ taskId: string; taskName: string; statuses: EvalTaskStatus[] }>;
  /** Per-candidate pass counts + rate, for ranking. */
  passRates: Array<{ provider: string; model: string; passed: number; total: number; rate: number }>;
  reports: Array<{ provider: string; model: string; reportId: string; overall: string }>;
}

/**
 * Auto-discovery for `--matrix auto`. The eval CLI runs inside the real
 * Electron main process (scripts/eval.mjs boots electron.exe), so DPAPI-wrapped
 * provider keys ARE readable here. Candidates: the current selection, every
 * key-backed cloud provider (its default model), and up to three local Ollama
 * models. Explicit pairs always pass through untouched.
 */
export async function discoverCandidates(
  currentProvider: string,
  currentModel: string,
  listKeyBacked?: () => Promise<Array<{ provider: string; model: string }>>,
): Promise<MatrixCandidate[]> {
  const out: MatrixCandidate[] = [];
  const seen = new Set<string>();
  const push = (provider: string, model: string): void => {
    if (!provider || !model) return;
    const key = `${provider}/${model}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ provider, model, label: key });
  };
  push(currentProvider, currentModel);
  if (listKeyBacked) {
    for (const entry of await listKeyBacked()) push(entry.provider, entry.model);
  }
  try {
    const res = await fetch('http://127.0.0.1:11434/api/tags', { signal: AbortSignal.timeout(2_500) });
    if (res.ok) {
      const body = (await res.json()) as { models?: Array<{ name?: string }> };
      for (const entry of (body.models ?? []).slice(0, 3)) {
        if (entry.name) push('ollama', entry.name);
      }
    }
  } catch { /* Ollama absent — current selection still benchmarks */ }
  return out;
}

export function parseCandidate(spec: string): MatrixCandidate | null {
  if (spec.trim().toLowerCase() === 'auto') return null; // handled by discoverCandidates
  const trimmed = spec.trim();
  if (!trimmed) return null;
  const slash = trimmed.indexOf('/');
  if (slash <= 0 || slash === trimmed.length - 1) return null;
  const provider = trimmed.slice(0, slash);
  const model = trimmed.slice(slash + 1);
  return { provider, model, label: `${provider}/${model}` };
}

export function buildMatrix(
  suiteId: string,
  candidates: MatrixCandidate[],
  taskResults: Array<{ candidate: MatrixCandidate; tasks: EvalTaskResult[] }>,
  meta: { id: string; startedAt: number; finishedAt: number },
): MatrixReport {
  const taskIds: Array<{ id: string; name: string }> = [];
  const seen = new Set<string>();
  for (const entry of taskResults) {
    for (const task of entry.tasks) {
      if (!seen.has(task.taskId)) {
        seen.add(task.taskId);
        taskIds.push({ id: task.taskId, name: task.taskName });
      }
    }
  }

  const rows = taskIds.map(({ id, name }) => ({
    taskId: id,
    taskName: name,
    statuses: candidates.map((candidate) => {
      const entry = taskResults.find((e) => e.candidate === candidate);
      const task = entry?.tasks.find((t) => t.taskId === id);
      return task?.status ?? ('skipped' as EvalTaskStatus);
    }),
  }));

  const passRates = candidates.map((candidate) => {
    const entry = taskResults.find((e) => e.candidate === candidate);
    const tasks = entry?.tasks ?? [];
    const passed = tasks.filter((t) => t.status === 'passed').length;
    const total = tasks.length;
    return {
      provider: candidate.provider,
      model: candidate.model,
      passed,
      total,
      rate: total > 0 ? Math.round((passed / total) * 1000) / 1000 : 0,
    };
  });

  return {
    version: 1,
    id: meta.id,
    suiteId,
    startedAt: meta.startedAt,
    finishedAt: meta.finishedAt,
    candidates,
    rows,
    passRates,
    reports: taskResults.map((entry) => ({
      provider: entry.candidate.provider,
      model: entry.candidate.model,
      reportId: '',
      overall: entry.tasks.every((t) => t.status === 'passed') ? 'passed' : 'failed',
    })),
  };
}

export interface RunBenchmarkOptions {
  suiteId: string;
  tasks: Parameters<typeof runEvaluation>[0]['tasks'];
  candidates: MatrixCandidate[];
  /** Runner factory per candidate — production passes createAgentEvalRunner. */
  runnerFactory: (candidate: MatrixCandidate) => EvalRunner;
  dataDir?: string;
  signal?: AbortSignal;
  now?: () => number;
  idFactory?: () => string;
  onProgress?: (message: string) => void;
}

/** Run the suite once per candidate and assemble the matrix. */
export async function runBenchmarkMatrix(options: RunBenchmarkOptions): Promise<MatrixReport> {
  const now = options.now ?? Date.now;
  const startedAt = now();
  const taskResults: Array<{ candidate: MatrixCandidate; tasks: EvalTaskResult[] }> = [];
  const reportIds: string[] = [];

  for (const candidate of options.candidates) {
    options.onProgress?.(`Running candidate ${candidate.provider}/${candidate.model}…`);
    let report: Awaited<ReturnType<typeof runEvaluation>>;
    try {
      report = await runEvaluation({
        tasks: options.tasks,
        suiteId: options.suiteId,
        provider: candidate.provider,
        model: candidate.model,
        runner: options.runnerFactory(candidate),
        dataDir: options.dataDir,
        signal: options.signal,
        now: options.now,
        idFactory: options.idFactory,
        onProgress: (event) => {
          if (event.phase === 'task-done') {
            options.onProgress?.(`  ${candidate.label}: ${event.result.taskId} → ${event.result.status}`);
          }
        },
      });
    } catch (error) {
      // One unreachable candidate (bad key, dead local model) must not abort
      // the whole matrix — a 6-candidate run dying on candidate 5 loses every
      // earlier result. Record the candidate as errored and continue.
      options.onProgress?.(`  ${candidate.label}: FAILED — ${(error as Error).message}`);
      const at = options.now?.() ?? Date.now();
      report = {
        version: 1,
        id: options.idFactory?.() ?? `errored-${at.toString(36)}`,
        suiteId: options.suiteId,
        provider: candidate.provider,
        model: candidate.model,
        startedAt: at,
        finishedAt: at,
        durationMs: 0,
        overall: 'failed',
        counts: { passed: 0, failed: 0, errored: options.tasks.length, skipped: 0 },
        tasks: options.tasks.map((task) => ({
          taskId: task.id,
          taskName: task.name,
          status: 'error' as const,
          runnerSuccess: false,
          runnerError: (error as Error).message,
          output: '',
          checks: [],
          startedAt: at,
          finishedAt: at,
          durationMs: 0,
          workspace: '',
        })),
      };
    }
    reportIds.push(report.id);
    taskResults.push({ candidate, tasks: report.tasks });
  }

  const finishedAt = now();
  const matrix = buildMatrix(options.suiteId, options.candidates, taskResults, {
    id: options.idFactory?.() ?? `matrix-${startedAt.toString(36)}`,
    startedAt,
    finishedAt,
  });
  matrix.reports = matrix.reports.map((entry, index) => ({ ...entry, reportId: reportIds[index] ?? '' }));
  return matrix;
}

// ── Regression trend ───────────────────────────────────────────────────────

export interface TrendPoint {
  reportId: string;
  startedAt: number;
  status: EvalTaskStatus;
}

export interface TrendSeries {
  taskId: string;
  provider: string;
  model: string;
  points: TrendPoint[];
  /** passed → failed/error transitions between consecutive runs. */
  regressions: Array<{ from: TrendPoint; to: TrendPoint }>;
  /** failed/error → passed transitions (recovery/fix). */
  improvements: Array<{ from: TrendPoint; to: TrendPoint }>;
}

export interface EvalTrend {
  version: 1;
  computedAt: number;
  series: TrendSeries[];
  /** Keys with at least one regression, most recent first. */
  regressions: TrendSeries[];
}

/** Pure trend computation over full reports — unit-testable. */
export function computeTrend(reports: EvalReport[], computedAt: number = Date.now()): EvalTrend {
  const byKey = new Map<string, TrendSeries>();
  for (const report of reports) {
    for (const task of report.tasks ?? []) {
      if (task.status === 'skipped') continue; // not a real attempt
      const key = `${task.taskId}|${report.provider}|${report.model}`;
      let series = byKey.get(key);
      if (!series) {
        series = { taskId: task.taskId, provider: report.provider, model: report.model, points: [], regressions: [], improvements: [] };
        byKey.set(key, series);
      }
      series.points.push({ reportId: report.id, startedAt: report.startedAt, status: task.status });
    }
  }
  const seriesList = [...byKey.values()];
  for (const series of seriesList) {
    series.points.sort((a, b) => a.startedAt - b.startedAt);
    for (let i = 1; i < series.points.length; i++) {
      const from = series.points[i - 1];
      const to = series.points[i];
      if (from.status === 'passed' && (to.status === 'failed' || to.status === 'error')) {
        series.regressions.push({ from, to });
      } else if ((from.status === 'failed' || from.status === 'error') && to.status === 'passed') {
        series.improvements.push({ from, to });
      }
    }
  }
  const regressions = seriesList
    .filter((s) => s.regressions.length > 0)
    .sort((a, b) => {
      const aLatest = a.regressions[a.regressions.length - 1]?.to.startedAt ?? 0;
      const bLatest = b.regressions[b.regressions.length - 1]?.to.startedAt ?? 0;
      return bLatest - aLatest;
    });
  return { version: 1, computedAt, series: seriesList, regressions };
}

/** Load every stored full report (bounded) and compute the trend. */
export function computeTrendFromDisk(dataDir?: string, limit = 100): EvalTrend {
  const directory = reportsDir(dataDir);
  if (!existsSync(directory)) return { version: 1, computedAt: Date.now(), series: [], regressions: [] };
  const reports: EvalReport[] = [];
  for (const name of readdirSync(directory)) {
    if (!name.endsWith('.json')) continue;
    try {
      const report = JSON.parse(readFileSync(join(directory, name), 'utf8')) as EvalReport;
      if (report?.version === 1 && Array.isArray(report.tasks)) reports.push(report);
    } catch { /* corrupt file is not evidence */ }
  }
  reports.sort((a, b) => a.startedAt - b.startedAt);
  return computeTrend(reports.slice(-limit));
}

export type { EvalReportSummary };
