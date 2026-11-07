// Benchmark evidence → per-model reliability directives.
//
// The isolation rule (benchmark traffic never changes runtime model choice)
// is preserved: this module produces EVIDENCE SUMMARIES for humans and the
// orchestrator UI — it does not write into model-performance or experience
// rules. Reliability claims about a model must come from MEASURED eval runs,
// not runtime anecdotes.

import type { EvalReport } from './contracts.js';
import { classifyIntent } from '../brain/experience.js';

export interface ModelReliability {
  provider: string;
  model: string;
  label: string;
  tasksAttempted: number;
  tasksPassed: number;
  passRate: number;
  /** Intent → pass rate, so routing can match task type to proven ability. */
  byIntent: Array<{ intent: string; passed: number; total: number }>;
  lastRegression?: { taskId: string; at: number };
}

/** Aggregate eval reports into per-model reliability evidence. */
export function buildReliabilityEvidence(reports: EvalReport[]): ModelReliability[] {
  const byModel = new Map<string, { provider: string; model: string; attempted: number; passed: number; intents: Map<string, { passed: number; total: number }> }>();
  for (const report of reports) {
    for (const task of report.tasks ?? []) {
      if (task.status === 'skipped') continue;
      const key = `${report.provider}/${report.model}`;
      let entry = byModel.get(key);
      if (!entry) {
        entry = { provider: report.provider, model: report.model, attempted: 0, passed: 0, intents: new Map() };
        byModel.set(key, entry);
      }
      entry.attempted++;
      if (task.status === 'passed') entry.passed++;
      const intent = classifyIntent(task.taskName);
      const intentStats = entry.intents.get(intent) ?? { passed: 0, total: 0 };
      intentStats.total++;
      if (task.status === 'passed') intentStats.passed++;
      entry.intents.set(intent, intentStats);
    }
  }
  return [...byModel.entries()].map(([key, e]) => ({
    provider: e.provider,
    model: e.model,
    label: key,
    tasksAttempted: e.attempted,
    tasksPassed: e.passed,
    passRate: e.attempted > 0 ? Math.round((e.passed / e.attempted) * 1000) / 1000 : 0,
    byIntent: [...e.intents.entries()].map(([intent, s]) => ({ intent, passed: s.passed, total: s.total })),
  })).sort((a, b) => b.passRate - a.passRate);
}
