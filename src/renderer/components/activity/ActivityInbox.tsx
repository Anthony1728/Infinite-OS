import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAgentsStore, type AgentRun } from '../../stores/agents';
import { useAutomationStore } from '../../stores/automation';
import { useWatchdogStore } from '../../stores/watchdog';

interface WorkflowRun {
  id: string;
  workflowId: string;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  startedAt: number;
  completedAt?: number;
  result?: string;
  error?: string;
  actionResults: Array<{ actionId: string; status: string; result: string }>;
}

interface DigestRow {
  id: string;
  kind: 'automation' | 'agent';
  title: string;
  detail: string;
  state: 'completed' | 'failed' | 'cancelled';
  updatedAt: number;
  count: number;
}

interface RawRow {
  id: string;
  kind: 'automation' | 'agent';
  title: string;
  detail: string;
  state: 'running' | 'completed' | 'failed' | 'cancelled';
  at: number;
}

const STATE_RANK: Record<DigestRow['state'], number> = { failed: 0, cancelled: 1, completed: 2 };

function startOfToday(): number {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function timeLabel(at: number): string {
  return new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function detailFor(error: string | undefined, result: string | undefined): string {
  const text = (error || result || '').replace(/\s+/g, ' ').trim();
  return text.length > 140 ? `${text.slice(0, 137)}…` : text;
}

function go(view: string): void {
  window.dispatchEvent(new CustomEvent('infinite:navigate', { detail: view }));
}

function StateDot({ state }: { state: RawRow['state'] | DigestRow['state'] }) {
  const color = state === 'failed' ? 'bg-rose-400'
    : state === 'cancelled' ? 'bg-amber-400'
      : state === 'running' ? 'bg-cyan-400 animate-pulse'
        : 'bg-emerald-400';
  return <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${color}`} />;
}

function StateChip({ state }: { state: RawRow['state'] }) {
  const style = state === 'failed' ? 'border-rose-400/20 bg-rose-400/10 text-rose-200'
    : state === 'cancelled' ? 'border-amber-400/20 bg-amber-400/10 text-amber-200'
      : state === 'running' ? 'border-cyan-400/20 bg-cyan-400/10 text-cyan-200'
        : 'border-emerald-400/20 bg-emerald-400/10 text-emerald-200';
  return <span className={`rounded-full border px-2 py-0.5 text-[9px] font-medium capitalize ${style}`}>{state}</span>;
}

export function ActivityInbox() {
  const workflows = useAutomationStore((s) => s.workflows);
  const loadWorkflows = useAutomationStore((s) => s.loadWorkflows);
  const pendingApprovals = useAutomationStore((s) => s.pendingApprovals);
  const loadPendingApprovals = useAutomationStore((s) => s.loadPendingApprovals);
  const agentRuns = useAgentsStore((s) => s.runs);
  const agentTypes = useAgentsStore((s) => s.types);
  const refreshRuns = useAgentsStore((s) => s.refreshRuns);
  const watchdogFindings = useWatchdogStore((s) => s.findings);
  const [automationRuns, setAutomationRuns] = useState<WorkflowRun[]>([]);
  const [rawStream, setRawStream] = useState(false);
  const [loading, setLoading] = useState(true);

  const loadAutomationRuns = useCallback(async () => {
    try {
      const runs = (await window.api.automationListRuns()) as WorkflowRun[];
      setAutomationRuns(Array.isArray(runs) ? runs : []);
    } catch { /* the inbox simply shows what it has */ }
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    await Promise.allSettled([
      loadWorkflows(),
      loadPendingApprovals(),
      refreshRuns(),
      loadAutomationRuns(),
    ]);
    setLoading(false);
  }, [loadWorkflows, loadPendingApprovals, refreshRuns, loadAutomationRuns]);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void loadAutomationRuns();
      void refreshRuns();
      void loadPendingApprovals();
    }, 5000);
    return () => window.clearInterval(timer);
  }, [loadAutomationRuns, refreshRuns, loadPendingApprovals]);

  const workflowNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const workflow of workflows) map.set(workflow.id, workflow.name);
    return map;
  }, [workflows]);

  const agentNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const type of agentTypes) map.set(type.id, type.name);
    return map;
  }, [agentTypes]);

  const today = startOfToday();
  const automationDigest = useMemo(() => {
    const groups = new Map<string, WorkflowRun[]>();
    for (const run of automationRuns) {
      const at = run.completedAt ?? run.startedAt;
      if (run.status === 'running' || at < today) continue;
      const list = groups.get(run.workflowId) ?? [];
      list.push(run);
      groups.set(run.workflowId, list);
    }
    const rows: DigestRow[] = [];
    for (const [workflowId, runs] of groups) {
      const newest = [...runs].sort((a, b) => (b.completedAt ?? b.startedAt) - (a.completedAt ?? a.startedAt))[0];
      rows.push({
        id: `automation:${workflowId}`,
        kind: 'automation',
        title: workflowNames.get(workflowId) || 'Automation',
        detail: detailFor(newest.error, newest.result) || `${runs.length} run${runs.length === 1 ? '' : 's'} today`,
        state: newest.status === 'failed' ? 'failed' : newest.status === 'cancelled' ? 'cancelled' : 'completed',
        updatedAt: newest.completedAt ?? newest.startedAt,
        count: runs.length,
      });
    }
    return rows;
  }, [automationRuns, today, workflowNames]);

  const agentDigest = useMemo(() => {
    const groups = new Map<string, AgentRun[]>();
    for (const run of agentRuns) {
      const at = run.completedAt ?? run.startedAt;
      if (run.status === 'running' || run.status === 'queued' || at < today) continue;
      const list = groups.get(run.agentId) ?? [];
      list.push(run);
      groups.set(run.agentId, list);
    }
    const rows: DigestRow[] = [];
    for (const [agentId, runs] of groups) {
      const newest = [...runs].sort((a, b) => (b.completedAt ?? b.startedAt) - (a.completedAt ?? a.startedAt))[0];
      const name = agentNames.get(agentId) || agentId;
      rows.push({
        id: `agent:${agentId}`,
        kind: 'agent',
        title: newest.task || name,
        detail: detailFor(newest.error, newest.result) || `${name} · ${runs.length} run${runs.length === 1 ? '' : 's'} today`,
        state: newest.status === 'failed' ? 'failed' : newest.status === 'cancelled' ? 'cancelled' : 'completed',
        updatedAt: newest.completedAt ?? newest.startedAt,
        count: runs.length,
      });
    }
    return rows;
  }, [agentRuns, today, agentNames]);

  const digest = useMemo(
    () => [...automationDigest, ...agentDigest].sort((a, b) => (
      STATE_RANK[a.state] - STATE_RANK[b.state] || b.updatedAt - a.updatedAt
    )),
    [automationDigest, agentDigest],
  );

  const rawRows = useMemo<RawRow[]>(() => {
    const rows: RawRow[] = [];
    for (const run of automationRuns) {
      const at = run.completedAt ?? run.startedAt;
      rows.push({
        id: `automation:${run.id}`,
        kind: 'automation',
        title: workflowNames.get(run.workflowId) || 'Automation',
        detail: detailFor(run.error, run.result),
        state: run.status,
        at,
      });
    }
    for (const run of agentRuns) {
      rows.push({
        id: `agent:${run.id}`,
        kind: 'agent',
        title: run.task || agentNames.get(run.agentId) || 'Agent run',
        detail: detailFor(run.error, run.result),
        state: run.status === 'queued' ? 'running' : run.status,
        at: run.completedAt ?? run.startedAt,
      });
    }
    return rows.sort((a, b) => b.at - a.at).slice(0, 120);
  }, [automationRuns, agentRuns, workflowNames, agentNames]);

  const failedToday = digest.filter((row) => row.state === 'failed');
  const needsYouCount = pendingApprovals.length + watchdogFindings.length + failedToday.length;
  const shownNeedsYou = Math.min(pendingApprovals.length, 3) + Math.min(watchdogFindings.length, 3) + Math.min(failedToday.length, 3);
  const automationCount = automationRuns.filter((run) => (run.completedAt ?? run.startedAt) >= today).length;
  const agentCount = agentRuns.filter((run) => (run.completedAt ?? run.startedAt) >= today).length;

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="micro-label">Today</span>
          <span className="text-[11px] text-zinc-600">
            {digest.length === 0 ? 'Nothing has finished yet' : `${digest.length} source${digest.length === 1 ? '' : 's'} · ${automationCount + agentCount} runs`}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setRawStream(false)}
            className={`rounded-lg px-2.5 py-1 text-[11px] transition-colors ${rawStream ? 'text-zinc-500 hover:text-zinc-300' : 'bg-white/[0.09] text-white'}`}
          >
            Digest
          </button>
          <button
            type="button"
            onClick={() => setRawStream(true)}
            className={`rounded-lg px-2.5 py-1 text-[11px] transition-colors ${rawStream ? 'bg-white/[0.09] text-white' : 'text-zinc-500 hover:text-zinc-300'}`}
          >
            Raw stream
          </button>
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={loading}
            className="ml-1 rounded-lg border border-white/[0.07] bg-white/[0.03] px-2.5 py-1 text-[11px] text-zinc-400 transition-colors hover:bg-white/[0.06] disabled:opacity-40"
          >
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </div>

      {needsYouCount > 0 && (
        <section className="mb-4 rounded-2xl border border-amber-400/20 bg-amber-500/[0.04] p-3">
          <div className="mb-2 flex items-center gap-2">
            <span className="text-[10px] uppercase tracking-[0.18em] text-amber-300/90">Needs you</span>
            <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-amber-500/15 px-1.5 text-[10px] font-medium text-amber-200">{needsYouCount}</span>
          </div>
          <div className="space-y-1.5">
            {pendingApprovals.slice(0, 3).map((approval) => (
              <button
                key={approval.id}
                type="button"
                onClick={() => go('automations')}
                className="flex w-full items-center gap-2 rounded-xl border border-white/[0.06] bg-black/20 px-3 py-2 text-left transition-colors hover:border-amber-400/30"
              >
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" />
                <span className="min-w-0 flex-1 truncate text-[12px] text-zinc-200">{approval.workflowName}</span>
                <span className="rounded-full border border-amber-400/20 bg-amber-400/10 px-2 py-0.5 text-[9px] text-amber-200">Review draft</span>
              </button>
            ))}
            {watchdogFindings.slice(0, 3).map((finding) => (
              <button
                key={`${finding.runId}:${finding.kind}`}
                type="button"
                onClick={() => go('chats')}
                className="flex w-full items-center gap-2 rounded-xl border border-white/[0.06] bg-black/20 px-3 py-2 text-left transition-colors hover:border-amber-400/30"
              >
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" />
                <span className="min-w-0 flex-1 truncate text-[12px] text-zinc-200">{finding.task}</span>
                <span className="shrink-0 text-[9px] capitalize text-amber-200/80">{finding.kind.replace(/-/g, ' ')}</span>
              </button>
            ))}
            {failedToday.slice(0, 3).map((row) => (
              <button
                key={`failed:${row.id}`}
                type="button"
                onClick={() => go(row.kind === 'automation' ? 'automations' : 'chats')}
                className="flex w-full items-center gap-2 rounded-xl border border-white/[0.06] bg-black/20 px-3 py-2 text-left transition-colors hover:border-rose-400/30"
              >
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-rose-400" />
                <span className="min-w-0 flex-1 truncate text-[12px] text-zinc-200">{row.title}</span>
                <span className="rounded-full border border-rose-400/20 bg-rose-400/10 px-2 py-0.5 text-[9px] text-rose-200">Failed</span>
              </button>
            ))}
            {needsYouCount > shownNeedsYou && (
              <div className="px-1 text-[10px] text-amber-200/60">More items are waiting in their source views.</div>
            )}
          </div>
        </section>
      )}

      {rawStream ? (
        <div className="overflow-hidden rounded-2xl border border-white/[0.07] bg-[#12131a]">
          {rawRows.length === 0 ? (
            <div className="px-4 py-6 text-[12px] text-zinc-500">No runs yet. Start a chat, agent, or automation and it will appear here.</div>
          ) : rawRows.map((row) => (
            <button
              key={row.id}
              type="button"
              onClick={() => go(row.kind === 'automation' ? 'automations' : 'chats')}
              className="flex w-full items-center gap-3 border-b border-white/[0.04] px-3 py-2.5 text-left transition-colors last:border-b-0 hover:bg-white/[0.025]"
            >
              <StateDot state={row.state} />
              <span className="w-14 shrink-0 text-[10px] uppercase tracking-wide text-zinc-600">{row.kind}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12px] text-zinc-200">{row.title}</span>
                {row.detail && <span className="block truncate text-[10.5px] text-zinc-500">{row.detail}</span>}
              </span>
              <span className="shrink-0 text-[10px] tabular-nums text-zinc-600">{timeLabel(row.at)}</span>
              <StateChip state={row.state} />
            </button>
          ))}
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-white/[0.07] bg-[#12131a]">
          {digest.length === 0 ? (
            <div className="px-4 py-6">
              <p className="text-[12px] text-zinc-400">Nothing has finished today. The inbox fills itself as chats, agents, and automations complete.</p>
              <div className="mt-3 flex gap-2">
                <button onClick={() => go('chats')} className="rounded-lg bg-white px-3 py-1.5 text-[11px] font-semibold text-zinc-900 transition-colors hover:bg-zinc-100">Start a chat</button>
                <button onClick={() => go('automations')} className="rounded-lg border border-white/[0.08] bg-white/[0.04] px-3 py-1.5 text-[11px] text-zinc-300 transition-colors hover:bg-white/[0.08]">Build an automation</button>
              </div>
            </div>
          ) : digest.map((row) => (
            <button
              key={row.id}
              type="button"
              onClick={() => go(row.kind === 'automation' ? 'automations' : 'chats')}
              className="flex w-full items-center gap-3 border-b border-white/[0.04] px-3 py-2.5 text-left transition-colors last:border-b-0 hover:bg-white/[0.025]"
            >
              <StateDot state={row.state} />
              <span className="w-14 shrink-0 text-[10px] uppercase tracking-wide text-zinc-600">{row.kind}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12px] font-medium text-zinc-200">{row.title}</span>
                <span className="block truncate text-[10.5px] text-zinc-500">{row.detail}</span>
              </span>
              {row.count > 1 && (
                <span className="shrink-0 rounded-full border border-white/[0.07] bg-white/[0.03] px-2 py-0.5 text-[9px] text-zinc-400">×{row.count}</span>
              )}
              <span className="shrink-0 text-[10px] tabular-nums text-zinc-600">{timeLabel(row.updatedAt)}</span>
              <StateChip state={row.state} />
            </button>
          ))}
        </div>
      )}

      <p className="mt-2 px-1 text-[10px] text-zinc-600">
        One line per source. The newest finished run speaks for the group; the count says how many runs it stands for. Updates every 5 seconds.
      </p>
    </div>
  );
}
