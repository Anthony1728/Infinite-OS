// Benchmark matrix + regression trend tests. The runner is a scripted fake —
// what is under test is the DIMENSION math: per-candidate cells, pass rates,
// regression detection across time for the same (task, model) pair.
//
// ISOLATION IS MANDATORY here: runEvaluation persists every report into
// dataDir, and omitting it writes into the USER'S REAL evaluation history
// (this file once polluted the profile home with 'run-1.json'). Every
// runBenchmarkMatrix call passes an isolated temp dataDir — no exceptions.

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildMatrix,
  computeTrend,
  parseCandidate,
  runBenchmarkMatrix,
} from './matrix.js';
import type { EvalReport, EvalTaskResult, EvalRunner, EvalTask } from './contracts.js';

let dataDir = '';

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'infinite-matrix-'));
});

afterEach(() => {
  try { rmSync(dataDir, { recursive: true, force: true }); } catch { /* temp best-effort */ }
});

const candidates = [
  { provider: 'prov-a', model: 'model-strong', label: 'prov-a/model-strong' },
  { provider: 'prov-b', model: 'model-weak', label: 'prov-b/model-weak' },
];

function taskResult(taskId: string, status: EvalTaskResult['status'], name = taskId): EvalTaskResult {
  return {
    taskId,
    taskName: name,
    status,
    runnerSuccess: status === 'passed',
    output: '',
    checks: [],
    startedAt: 0,
    finishedAt: 0,
    durationMs: 100,
    workspace: '/tmp/x',
  };
}

describe('parseCandidate', () => {
  it('parses provider/model pairs and rejects malformed specs', () => {
    expect(parseCandidate('openai/gpt-5')).toEqual({ provider: 'openai', model: 'gpt-5', label: 'openai/gpt-5' });
    expect(parseCandidate('no-slash')).toBeNull();
    expect(parseCandidate('/leading')).toBeNull();
    expect(parseCandidate('trailing/')).toBeNull();
  });
});

describe('buildMatrix', () => {
  it('assembles one row per task with per-candidate status cells and pass rates', () => {
    const matrix = buildMatrix(
      'core',
      candidates,
      [
        { candidate: candidates[0], tasks: [taskResult('task-1', 'passed'), taskResult('task-2', 'failed')] },
        { candidate: candidates[1], tasks: [taskResult('task-1', 'failed'), taskResult('task-2', 'error')] },
      ],
      { id: 'matrix-1', startedAt: 1000, finishedAt: 2000 },
    );

    expect(matrix.rows).toHaveLength(2);
    expect(matrix.rows[0].statuses).toEqual(['passed', 'failed']);
    expect(matrix.rows[1].statuses).toEqual(['failed', 'error']);
    expect(matrix.passRates[0]).toEqual({ provider: 'prov-a', model: 'model-strong', passed: 1, total: 2, rate: 0.5 });
    expect(matrix.passRates[1]).toEqual({ provider: 'prov-b', model: 'model-weak', passed: 0, total: 2, rate: 0 });
  });

  it('marks a missing task as skipped rather than inventing a status', () => {
    const matrix = buildMatrix(
      'core',
      candidates,
      [{ candidate: candidates[0], tasks: [taskResult('task-1', 'passed')] }],
      { id: 'm', startedAt: 1, finishedAt: 2 },
    );
    expect(matrix.rows).toHaveLength(1);
    expect(matrix.rows[0].statuses).toEqual(['passed', 'skipped']);
  });
});

describe('runBenchmarkMatrix', () => {
  const fakeTasks: EvalTask[] = [
    { id: 'task-1', name: 'Task One', description: '', prompt: 'p', seedFiles: [], checks: [{ id: 'c1', type: 'file_exists', path: 'a.txt' }] },
    { id: 'task-2', name: 'Task Two', description: '', prompt: 'p', seedFiles: [], checks: [{ id: 'c2', type: 'file_exists', path: 'b.txt' }] },
  ];

  it('runs the suite once per candidate and produces per-candidate cells', async () => {
    // The harness decides status from REAL file checks, so a "passing" fake
    // runner must produce the actual evidence file in the task workspace —
    // exactly the discipline the harness enforces on real agents.
    const runnerFor = (candidate: typeof candidates[number]): EvalRunner => async (task, context) => {
      const ok = candidate.provider === 'prov-a' || task.id === 'task-1';
      if (!ok) return { success: false, output: '', error: 'could not complete' };
      const target = task.checks.find((c) => c.type === 'file_exists');
      if (target && target.type === 'file_exists') {
        const { writeFileSync } = await import('node:fs');
        const { join } = await import('node:path');
        writeFileSync(join(context.workspace, target.path), 'evidence\n', 'utf8');
      }
      return { success: true, output: 'done' };
    };

    const matrix = await runBenchmarkMatrix({
      suiteId: 'core',
      tasks: fakeTasks,
      candidates,
      runnerFactory: runnerFor,
      dataDir,
      now: (() => { let t = 1000; return () => (t += 10); })(),
      idFactory: (() => { let n = 0; return () => `run-${++n}`; })(),
    });

    expect(matrix.rows).toHaveLength(2);
    expect(matrix.rows[0].statuses).toEqual(['passed', 'passed']);
    expect(matrix.rows[1].statuses).toEqual(['passed', 'failed']);
    expect(matrix.passRates[0].rate).toBe(1);
    expect(matrix.passRates[1].rate).toBe(0.5);
    expect(matrix.reports.every((r) => r.reportId !== '')).toBe(true);
  });

  it('a candidate whose runner factory throws is recorded as errored — later candidates still run', async () => {
    // A 6-candidate matrix dying on candidate 5 would lose every earlier
    // result. The per-candidate catch records the failure and continues.
    const runnerFor = (candidate: typeof candidates[number]): EvalRunner => {
      if (candidate.provider === 'prov-b') throw new Error('no API key configured');
      return async (task, context) => {
        const { writeFileSync } = await import('node:fs');
        const { join } = await import('node:path');
        const target = task.checks.find((c) => c.type === 'file_exists');
        if (target && target.type === 'file_exists') {
          writeFileSync(join(context.workspace, target.path), 'evidence\n', 'utf8');
        }
        return { success: true, output: 'done' };
      };
    };

    const matrix = await runBenchmarkMatrix({
      suiteId: 'core',
      tasks: fakeTasks,
      candidates,
      runnerFactory: runnerFor,
      dataDir,
      now: (() => { let t = 1000; return () => (t += 10); })(),
      idFactory: (() => { let n = 0; return () => `run-${++n}`; })(),
    });

    // prov-a ran; prov-b errored but is still a column in the matrix.
    expect(matrix.rows[0].statuses).toEqual(['passed', 'error']);
    expect(matrix.passRates[1]).toEqual({ provider: 'prov-b', model: 'model-weak', passed: 0, total: 2, rate: 0 });
    expect(matrix.reports[0].reportId).not.toBe('');
  });
});

describe('computeTrend', () => {
  function report(id: string, provider: string, model: string, startedAt: number, tasks: Array<[string, EvalTaskResult['status']]>): EvalReport {
    return {
      version: 1,
      id,
      suiteId: 'core',
      provider,
      model,
      startedAt,
      finishedAt: startedAt + 1,
      durationMs: 1,
      overall: 'passed',
      counts: { passed: 0, failed: 0, errored: 0, skipped: 0 },
      tasks: tasks.map(([taskId, status]) => taskResult(taskId, status)),
    };
  }

  it('flags a passed→failed regression for the same task+model over time', () => {
    const trend = computeTrend([
      report('r1', 'prov-a', 'model-x', 1000, [['task-1', 'passed']]),
      report('r2', 'prov-a', 'model-x', 2000, [['task-1', 'failed']]),
    ]);
    expect(trend.regressions).toHaveLength(1);
    expect(trend.regressions[0].taskId).toBe('task-1');
    expect(trend.regressions[0].provider).toBe('prov-a');
    expect(trend.regressions[0].regressions[0].from.reportId).toBe('r1');
    expect(trend.regressions[0].regressions[0].to.reportId).toBe('r2');
  });

  it('does NOT cross-compare different models — a weak model failing is not a regression of a strong one', () => {
    const trend = computeTrend([
      report('r1', 'prov-a', 'model-strong', 1000, [['task-1', 'passed']]),
      report('r2', 'prov-b', 'model-weak', 2000, [['task-1', 'failed']]),
    ]);
    expect(trend.regressions).toHaveLength(0);
    expect(trend.series).toHaveLength(2);
  });

  it('records an improvement on failed→passed, and orders regression keys most-recent-first', () => {
    const trend = computeTrend([
      report('r1', 'p', 'm', 1000, [['t1', 'failed']]),
      report('r2', 'p', 'm', 2000, [['t1', 'passed']]),
      report('r3', 'q', 'm', 1500, [['t2', 'passed']]),
      report('r4', 'q', 'm', 3000, [['t2', 'failed']]),
    ]);
    expect(trend.series.find((s) => s.taskId === 't1')?.improvements).toHaveLength(1);
    // t2's regression (3000) is more recent than nothing on t1 → regressions only holds t2.
    expect(trend.regressions.map((s) => s.taskId)).toEqual(['t2']);
  });

  it('ignores skipped tasks — an abort is not a regression', () => {
    const trend = computeTrend([
      report('r1', 'p', 'm', 1000, [['t1', 'passed']]),
      report('r2', 'p', 'm', 2000, [['t1', 'skipped']]),
    ]);
    expect(trend.regressions).toHaveLength(0);
    // The series exists (from the real run) but the skipped point never enters it.
    const series = trend.series.find((s) => s.taskId === 't1');
    expect(series?.points.map((p) => p.status)).toEqual(['passed']);
  });
});
