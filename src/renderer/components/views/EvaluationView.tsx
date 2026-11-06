/**
 * Evaluation — proof that the agent finishes real tasks.
 *
 * This page is intentionally read-only about execution: evaluations run in the
 * headless CLI process (`npm run eval`) inside isolated workspaces with a
 * process-scoped approval bypass. Running one inside the app process would set
 * a global env flag and could bypass approvals for a concurrent chat turn, so
 * the UI only inspects persisted reports.
 */

import { useCallback, useEffect, useState } from 'react';
import { AppIcon } from '../brand/AppIcon';

interface EvalCheckResult {
  checkId: string;
  type: string;
  ok: boolean;
  detail: string;
  durationMs: number;
}

interface EvalTaskResult {
  taskId: string;
  taskName: string;
  status: 'passed' | 'failed' | 'error' | 'skipped';
  runnerSuccess: boolean;
  runnerError?: string;
  output: string;
  checks: EvalCheckResult[];
  startedAt: number;
  finishedAt: number;
  durationMs: number;
  workspace: string;
}

interface EvalReport {
  version: 1;
  id: string;
  suiteId: string;
  provider: string;
  model: string;
  startedAt: number;
  finishedAt: number;
  durationMs: number;
  overall: 'passed' | 'failed';
  counts: { passed: number; failed: number; errored: number; skipped: number };
  tasks: EvalTaskResult[];
}

interface EvalSummary {
  id: string;
  suiteId: string;
  provider: string;
  model: string;
  startedAt: number;
  durationMs: number;
  overall: 'passed' | 'failed';
  counts: { passed: number; failed: number; errored: number; skipped: number };
}

interface EvalCatalog {
  suites: Array<{ id: string; name: string; tasks: number }>;
  tasks: Array<{
    id: string;
    name: string;
    description: string;
    checks: number;
    timeoutMs: number | null;
    maxTurns: number | null;
  }>;
}

function formatDuration(ms: number): string {
  if (ms < 1_000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1_000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1_000)}s`;
}

function formatDate(ms: number): string {
  try {
    return new Date(ms).toLocaleString();
  } catch {
    return String(ms);
  }
}

function statusTone(status: EvalTaskResult['status']): string {
  if (status === 'passed') return 'border-emerald-500/25 bg-emerald-500/10 text-emerald-300';
  if (status === 'failed') return 'border-rose-500/25 bg-rose-500/10 text-rose-300';
  if (status === 'skipped') return 'border-white/[0.08] bg-white/[0.03] text-zinc-400';
  return 'border-amber-500/25 bg-amber-500/10 text-amber-300';
}

function StatusBadge({ status, label }: { status: EvalTaskResult['status']; label?: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide ${statusTone(status)}`}>
      {label ?? status}
    </span>
  );
}

function ReportRow({ report, active, onSelect }: { report: EvalSummary; active: boolean; onSelect: () => void }) {
  const passed = report.overall === 'passed';
  return (
    <button
      onClick={onSelect}
      className={`w-full rounded-xl border px-3 py-2.5 text-left transition-colors ${
        active
          ? 'border-cyan-400/30 bg-cyan-400/[0.07]'
          : 'border-white/[0.06] bg-white/[0.02] hover:border-white/[0.12] hover:bg-white/[0.04]'
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className={`text-[10px] font-bold uppercase tracking-wide ${passed ? 'text-emerald-300' : 'text-rose-300'}`}>
          {report.overall}
        </span>
        <span className="text-[10px] text-zinc-500">{formatDuration(report.durationMs)}</span>
      </div>
      <div className="mt-1 truncate text-[12px] font-medium text-zinc-200">{report.provider}/{report.model}</div>
      <div className="mt-0.5 text-[10px] text-zinc-500">
        {report.counts.passed} passed · {report.counts.failed} failed · {report.counts.errored} errored
      </div>
      <div className="mt-1 text-[10px] text-zinc-600">{formatDate(report.startedAt)}</div>
    </button>
  );
}

function TaskCard({ task }: { task: EvalTaskResult }) {
  const failedChecks = task.checks.filter((check) => !check.ok);
  return (
    <div className="rounded-2xl border border-white/[0.07] bg-[#12131a] p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <StatusBadge status={task.status} />
            <span className="truncate text-[13px] font-semibold text-white">{task.taskName}</span>
          </div>
          <div className="mt-1 text-[10px] text-zinc-500">
            {task.taskId} · {formatDuration(task.durationMs)} · {task.checks.filter((check) => check.ok).length}/{task.checks.length} checks
          </div>
        </div>
        <span className={`rounded-full border px-2 py-0.5 text-[9px] ${
          task.runnerSuccess
            ? 'border-emerald-500/20 text-emerald-300/80'
            : 'border-amber-500/20 text-amber-300/80'
        }`}>
          agent {task.runnerSuccess ? 'reported done' : 'did not report done'}
        </span>
      </div>

      {task.runnerError && (
        <div className="mt-3 rounded-lg border border-amber-500/15 bg-amber-500/[0.05] px-2.5 py-2 text-[11px] leading-4 text-amber-200/80">
          {task.runnerError}
        </div>
      )}

      <div className="mt-3 space-y-1">
        {task.checks.map((check) => (
          <div key={check.checkId} className="flex items-start gap-2 text-[11px]">
            <span className={`mt-0.5 font-semibold ${check.ok ? 'text-emerald-400' : 'text-rose-400'}`}>
              {check.ok ? '✓' : '✗'}
            </span>
            <div className="min-w-0">
              <span className="font-mono text-[10.5px] text-zinc-300">{check.checkId}</span>
              <span className="ml-2 text-zinc-500">{check.detail}</span>
            </div>
          </div>
        ))}
      </div>

      {task.status !== 'passed' && failedChecks.length === 0 && task.runnerError && (
        <div className="mt-2 text-[10.5px] text-zinc-500">No check-level detail was recorded for this failure.</div>
      )}

      <div className="mt-3 truncate rounded-lg border border-white/[0.05] bg-black/25 px-2 py-1 font-mono text-[10px] text-zinc-500" title={task.workspace}>
        {task.workspace}
      </div>
    </div>
  );
}

export function EvaluationView() {
  const [reports, setReports] = useState<EvalSummary[]>([]);
  const [selected, setSelected] = useState<EvalReport | null>(null);
  const [catalog, setCatalog] = useState<EvalCatalog | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingReport, setLoadingReport] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const openReport = useCallback(async (id: string) => {
    setLoadingReport(true);
    try {
      const report = await window.api.getEvaluation({ id }) as EvalReport | null;
      setSelected(report);
      if (!report) setError(`Report ${id} could not be read.`);
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setLoadingReport(false);
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [summaries, nextCatalog] = await Promise.all([
        window.api.listEvaluations({ limit: 50 }) as Promise<EvalSummary[]>,
        window.api.evaluationCatalog() as Promise<EvalCatalog>,
      ]);
      setReports(summaries);
      setCatalog(nextCatalog);
      if (summaries.length > 0) {
        await openReport(summaries[0].id);
      } else {
        setSelected(null);
      }
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setLoading(false);
    }
  }, [openReport]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="flex h-full flex-col overflow-hidden p-6">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-cyan-400/25 bg-cyan-400/[0.08] text-cyan-300">
              <AppIcon name="automation.pulse" className="h-5 w-5" strokeWidth={1.7} />
            </span>
            <div>
              <h1 className="text-2xl font-bold text-white">Evaluation</h1>
              <p className="text-[11.5px] text-zinc-500">
                Mechanical proof that agents complete tasks — checks run against the real workspace, not the agent&apos;s summary.
              </p>
            </div>
          </div>
        </div>
        <button
          onClick={() => void load()}
          disabled={loading}
          className="rounded-xl border border-white/[0.09] bg-white/[0.04] px-3 py-1.5 text-[11.5px] font-medium text-zinc-200 transition-colors hover:bg-white/[0.08] disabled:opacity-50"
        >
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      <div className="mb-4 rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2.5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-zinc-400">
          <span className="font-semibold text-zinc-300">Run an evaluation</span>
          <code className="rounded-md border border-white/[0.07] bg-black/30 px-2 py-0.5 font-mono text-[10.5px] text-cyan-300">npm run build</code>
          <span className="text-zinc-600">then</span>
          <code className="rounded-md border border-white/[0.07] bg-black/30 px-2 py-0.5 font-mono text-[10.5px] text-cyan-300">npm run eval</code>
          <span className="text-zinc-600">or</span>
          <code className="rounded-md border border-white/[0.07] bg-black/30 px-2 py-0.5 font-mono text-[10.5px] text-cyan-300">npm run eval:list</code>
          <span className="text-zinc-600">· isolated workspace per task · exit code 0 only when every check passes</span>
        </div>
      </div>

      {error && (
        <div className="mb-3 rounded-xl border border-rose-500/20 bg-rose-500/[0.06] px-3 py-2 text-[11.5px] text-rose-200">
          {error}
        </div>
      )}

      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[290px_1fr]">
        <div className="flex min-h-0 flex-col rounded-2xl border border-white/[0.07] bg-[#0e0f14] p-3">
          <div className="mb-2 flex items-center justify-between px-1">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Runs</span>
            <span className="text-[10px] text-zinc-600">{reports.length}</span>
          </div>
          <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto pr-0.5">
            {reports.map((report) => (
              <ReportRow
                key={report.id}
                report={report}
                active={selected?.id === report.id}
                onSelect={() => void openReport(report.id)}
              />
            ))}
            {!loading && reports.length === 0 && (
              <div className="rounded-xl border border-dashed border-white/[0.08] px-3 py-6 text-center text-[11px] leading-5 text-zinc-500">
                No evaluation runs yet.<br />Run <span className="font-mono text-zinc-400">npm run eval</span> to produce the first report.
              </div>
            )}
          </div>
          {catalog && (
            <div className="mt-2 border-t border-white/[0.06] pt-2">
              <div className="px-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Suite</div>
              {catalog.suites.map((suite) => (
                <div key={suite.id} className="mt-1 flex items-center justify-between px-1 text-[10.5px] text-zinc-400">
                  <span>{suite.name}</span>
                  <span className="text-zinc-600">{suite.tasks} tasks</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="min-h-0 overflow-y-auto rounded-2xl border border-white/[0.07] bg-[#0e0f14] p-4">
          {loadingReport && !selected && (
            <div className="flex h-full items-center justify-center text-[12px] text-zinc-500">Loading report…</div>
          )}

          {!selected && !loadingReport && (
            <div className="flex h-full flex-col items-center justify-center px-6 text-center">
              <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl border border-white/[0.08] bg-white/[0.03] text-zinc-500">
                <AppIcon name="automation.pulse" className="h-6 w-6" strokeWidth={1.5} />
              </span>
              <div className="text-[14px] font-semibold text-zinc-200">No report selected</div>
              <p className="mt-1 max-w-sm text-[11.5px] leading-5 text-zinc-500">
                {catalog
                  ? `${catalog.tasks.length} built-in tasks cover file creation, test repair, JSON edits, diagnosis, and multi-file refactors. Each starts from seeded files that fail their checks until the work is actually done.`
                  : 'Evaluations run in isolated workspaces and are scored by file, JSON, and command checks.'}
              </p>
              {catalog && (
                <div className="mt-4 grid w-full max-w-xl gap-2 text-left sm:grid-cols-2">
                  {catalog.tasks.map((task) => (
                    <div key={task.id} className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2">
                      <div className="text-[11.5px] font-medium text-zinc-200">{task.name}</div>
                      <div className="mt-0.5 text-[10px] text-zinc-500">{task.checks} checks · {task.maxTurns ?? 12} turn cap</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {selected && (
            <div>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <div className="flex items-center gap-2">
                    <StatusBadge status={selected.overall} />
                    <span className="font-mono text-[10.5px] text-zinc-500">{selected.id}</span>
                  </div>
                  <div className="mt-1.5 text-[12px] text-zinc-300">
                    {selected.provider}/{selected.model} · {formatDate(selected.startedAt)}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-[11px] font-semibold text-zinc-200">
                    {selected.counts.passed}/{selected.tasks.length} passed
                  </div>
                  <div className="text-[10px] text-zinc-500">{formatDuration(selected.durationMs)} total</div>
                </div>
              </div>

              <div className="mt-4 space-y-3">
                {selected.tasks.map((task) => <TaskCard key={task.taskId} task={task} />)}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
