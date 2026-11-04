/**
 * Dashboards — one calm page answering "how is my OS actually doing?"
 *
 * Otto-inspired: micro-labeled sections, honest numbers, no vanity charts.
 * Everything is computed from real local stores (sessions, automations,
 * agent runs, AI tabs) — nothing is mocked. Charts are hand-rolled SVG so
 * the page stays dependency-free and instant.
 */

import { useEffect, useMemo } from 'react';
import { motion } from 'framer-motion';
import { useChatStore } from '../../stores/chat';
import { useAgentsStore } from '../../stores/agents';
import { useAutomationStore } from '../../stores/automation';
import { useAiTabsStore } from '../../stores/aiTabs';
import { AppIcon, BRAND_GRADIENT, type AppIconName } from '../brand/AppIcon';

interface DashboardsViewProps {
  onViewChange: (view: string) => void;
}

const DAY = 86_400_000;
const CHART_DAYS = 14;

/** Uppercase mono section header — the Otto micro-label, Infinite-branded. */
function MicroLabel({ children, tone = 'default' }: { children: React.ReactNode; tone?: 'default' | 'signal' }) {
  return (
    <span className={`micro-label ${tone === 'signal' ? 'text-violet-300/90' : ''}`}>{children}</span>
  );
}

function SectionCard({ label, title, action, children }: { label: string; title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-white/[0.07] bg-[#12131a] p-4 transition-colors hover:border-white/[0.11]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <MicroLabel>{label}</MicroLabel>
          <h3 className="mt-1 text-[14px] font-semibold text-white">{title}</h3>
        </div>
        {action}
      </div>
      <div className="mt-3">{children}</div>
    </div>
  );
}

function StatCard({ label, value, sub, icon, color, onClick }: {
  label: string; value: string | number; sub?: string; icon: AppIconName; color: string; onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className={`group rounded-2xl border border-white/[0.07] bg-[#12131a] p-4 text-left transition-all ${
        onClick ? 'hover:-translate-y-0.5 hover:border-white/[0.14] cursor-pointer' : 'cursor-default'
      }`}
    >
      <div className="flex items-center justify-between">
        <MicroLabel>{label}</MicroLabel>
        <span
          className="flex h-7 w-7 items-center justify-center rounded-lg"
          style={{ background: `${color}1f`, border: `1px solid ${color}33`, color }}
        >
          <AppIcon name={icon} className="h-3.5 w-3.5" strokeWidth={1.8} />
        </span>
      </div>
      <div className="mt-2 text-[24px] font-semibold leading-7 text-white tabular-nums">{value}</div>
      {sub && <div className="mt-0.5 text-[11px] text-zinc-500">{sub}</div>}
    </button>
  );
}

/** 14-day bar chart of new chats — deterministic, honest Y axis. */
function ChatsPerDayChart({ sessions }: { sessions: Array<{ created_at: number }> }) {
  const buckets = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const start = today.getTime() - (CHART_DAYS - 1) * DAY;
    const counts = Array.from({ length: CHART_DAYS }, () => 0);
    for (const s of sessions) {
      const dayIndex = Math.floor((s.created_at - start) / DAY);
      if (dayIndex >= 0 && dayIndex < CHART_DAYS) counts[dayIndex] += 1;
    }
    return counts;
  }, [sessions]);

  const max = Math.max(1, ...buckets);
  const W = 560;
  const H = 140;
  const gap = 6;
  const barW = (W - gap * (CHART_DAYS - 1)) / CHART_DAYS;
  const today = new Date();

  return (
    <svg viewBox={`0 0 ${W} ${H + 18}`} className="w-full" role="img" aria-label="New chats per day, last 14 days">
      {[0.5, 1].map((f) => (
        <line key={f} x1={0} x2={W} y1={H * f} y2={H * f} stroke="rgba(255,255,255,0.05)" strokeWidth={1} />
      ))}
      {buckets.map((count, i) => {
        const h = count === 0 ? 2 : Math.max(4, (count / max) * (H - 8));
        const x = i * (barW + gap);
        const isToday = i === CHART_DAYS - 1;
        return (
          <g key={i}>
            <rect
              x={x}
              y={H - h}
              width={barW}
              height={h}
              rx={3}
              fill={isToday ? 'url(#dashBarToday)' : 'url(#dashBar)'}
              opacity={count === 0 ? 0.35 : 1}
            >
              <title>{`${Math.max(0, CHART_DAYS - 1 - i)} day(s) ago: ${count} chat${count === 1 ? '' : 's'}`}</title>
            </rect>
            {(i % 3 === 1 || isToday) && (
              <text x={x + barW / 2} y={H + 13} textAnchor="middle" className="fill-zinc-600" fontSize={8} fontFamily="JetBrains Mono, monospace">
                {isToday ? 'TODAY' : `-${CHART_DAYS - 1 - i}d`}
              </text>
            )}
          </g>
        );
      })}
      <defs>
        <linearGradient id="dashBar" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#8b5cf6" stopOpacity={0.95} />
          <stop offset="100%" stopColor="#8b5cf6" stopOpacity={0.45} />
        </linearGradient>
        <linearGradient id="dashBarToday" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#22d3ee" />
          <stop offset="100%" stopColor="#8b5cf6" stopOpacity={0.6} />
        </linearGradient>
      </defs>
      {/* today marker date, mono micro style */}
      <text x={W} y={H + 13} textAnchor="end" className="fill-zinc-700" fontSize={8} fontFamily="JetBrains Mono, monospace">
        {today.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }).toUpperCase()}
      </text>
    </svg>
  );
}

/** Horizontal bars — model mix by sessions. */
function ModelMix({ models }: { models: Array<{ model: string; count: number }> }) {
  const max = Math.max(1, ...models.map((m) => m.count));
  const palette = ['#8b5cf6', '#22d3ee', '#34d399', '#f472b6', '#fbbf24'];
  return (
    <div className="space-y-2.5">
      {models.length === 0 && <div className="text-[12px] text-zinc-500">No sessions yet.</div>}
      {models.map((m, i) => (
        <div key={m.model}>
          <div className="mb-1 flex items-center justify-between text-[11px]">
            <span className="truncate font-mono text-zinc-300">{m.model}</span>
            <span className="ml-2 shrink-0 tabular-nums text-zinc-500">{m.count}</span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/[0.05]">
            <div
              className="h-full rounded-full transition-all duration-700"
              style={{ width: `${Math.max(3, (m.count / max) * 100)}%`, background: palette[i % palette.length] }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Agent outcome split — completed/failed/cancelled/running. */
function OutcomeBars({ counts }: { counts: { completed: number; failed: number; cancelled: number; running: number } }) {
  const total = Math.max(1, counts.completed + counts.failed + counts.cancelled + counts.running);
  const rows = [
    { label: 'Completed', value: counts.completed, color: '#34d399' },
    { label: 'Running', value: counts.running, color: '#22d3ee' },
    { label: 'Failed', value: counts.failed, color: '#f2524c' },
    { label: 'Cancelled', value: counts.cancelled, color: '#8c9187' },
  ];
  return (
    <div className="space-y-2.5">
      {rows.map((r) => (
        <div key={r.label} className="flex items-center gap-3">
          <span className="w-20 shrink-0 text-[11px] text-zinc-500">{r.label}</span>
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-white/[0.05]">
            <div className="h-full rounded-full transition-all duration-700" style={{ width: `${(r.value / total) * 100}%`, background: r.color }} />
          </div>
          <span className="w-8 shrink-0 text-right text-[11px] tabular-nums text-zinc-400">{r.value}</span>
        </div>
      ))}
    </div>
  );
}

export function DashboardsView({ onViewChange }: DashboardsViewProps) {
  const sessions = useChatStore((s) => s.sessions);
  const loadSessions = useChatStore((s) => s.loadSessions);
  const runs = useAgentsStore((s) => s.runs);
  const workflows = useAutomationStore((s) => s.workflows);
  const loadWorkflows = useAutomationStore((s) => s.loadWorkflows);
  const tabs = useAiTabsStore((s) => s.tabs);

  useEffect(() => {
    void loadSessions().catch(() => {});
    void loadWorkflows().catch(() => {});
  }, [loadSessions, loadWorkflows]);

  const totalMessages = useMemo(() => sessions.reduce((sum, s) => sum + (s.message_count ?? 0), 0), [sessions]);
  const chatsLast7 = useMemo(() => {
    const weekAgo = Date.now() - 7 * DAY;
    return sessions.filter((s) => s.created_at >= weekAgo).length;
  }, [sessions]);
  const modelMix = useMemo(() => {
    const counts = new Map<string, number>();
    for (const s of sessions) counts.set(s.model || 'unknown', (counts.get(s.model || 'unknown') ?? 0) + 1);
    return [...counts.entries()]
      .map(([model, count]) => ({ model, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
  }, [sessions]);
  const outcomes = useMemo(() => ({
    completed: runs.filter((r) => r.status === 'completed').length,
    failed: runs.filter((r) => r.status === 'failed').length,
    cancelled: runs.filter((r) => r.status === 'cancelled').length,
    running: runs.filter((r) => r.status === 'running' || r.status === 'queued').length,
  }), [runs]);
  const enabledAutos = workflows.filter((w) => w.enabled).length;
  const totalRuns = workflows.reduce((sum, w) => sum + (w.runs ?? 0), 0);
  const recent = useMemo(() => [...sessions].sort((a, b) => b.updated_at - a.updated_at).slice(0, 6), [sessions]);

  return (
    <div className="flex-1 overflow-auto chat-scrollbar bg-[#09090c] animate-fade-in">
      <div className="mx-auto max-w-[1100px] px-6 py-8 lg:px-8">
        {/* Header */}
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <MicroLabel>Insights</MicroLabel>
            <h1 className="mt-1 text-[24px] font-semibold tracking-tight text-white">Dashboards</h1>
            <p className="mt-1 text-[12.5px] text-zinc-500">Your OS, measured — chats, models, automations and agents, all local.</p>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-1 text-[10px] font-medium text-emerald-300">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> Live local data
          </span>
        </div>

        {/* Top stats */}
        <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label="Conversations" value={sessions.length} sub={`+${chatsLast7} this week`} icon="nav.chats" color="#8b5cf6" onClick={() => onViewChange('chats')} />
          <StatCard label="Messages" value={totalMessages} sub="Across all chats" icon="home.chat" color="#22d3ee" onClick={() => onViewChange('chats')} />
          <StatCard label="Automation runs" value={totalRuns} sub={`${enabledAutos}/${workflows.length} enabled`} icon="nav.automations" color="#34d399" onClick={() => onViewChange('automations')} />
          <StatCard label="Open AI tabs" value={tabs.length} sub="Live artifacts" icon="nav.tabs" color="#f472b6" onClick={() => tabs.length ? onViewChange(tabs[tabs.length - 1].id) : undefined} />
        </div>

        {/* Charts row */}
        <div className="mt-4 grid gap-4 lg:grid-cols-[1.4fr_1fr]">
          <SectionCard label="Activity · 14 days" title="New conversations per day">
            <ChatsPerDayChart sessions={sessions} />
          </SectionCard>
          <SectionCard
            label="Engines"
            title="Model mix"
            action={<button onClick={() => onViewChange('chats')} className="text-[11px] text-zinc-500 transition-colors hover:text-zinc-300">Sessions →</button>}
          >
            <ModelMix models={modelMix} />
          </SectionCard>
        </div>

        {/* Agents + automations */}
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <SectionCard
            label="Agents"
            title="Run outcomes"
            action={<button onClick={() => onViewChange('activity')} className="text-[11px] text-zinc-500 transition-colors hover:text-zinc-300">Activity →</button>}
          >
            <OutcomeBars counts={outcomes} />
          </SectionCard>
          <SectionCard
            label="Automations"
            title="Health"
            action={<button onClick={() => onViewChange('automations')} className="text-[11px] text-zinc-500 transition-colors hover:text-zinc-300">Manage →</button>}
          >
            <div className="grid grid-cols-3 gap-2">
              <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2.5">
                <div className="micro-label">Enabled</div>
                <div className="mt-1 text-[18px] font-semibold text-emerald-300 tabular-nums">{enabledAutos}</div>
              </div>
              <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2.5">
                <div className="micro-label">Total</div>
                <div className="mt-1 text-[18px] font-semibold text-white tabular-nums">{workflows.length}</div>
              </div>
              <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2.5">
                <div className="micro-label">Runs</div>
                <div className="mt-1 text-[18px] font-semibold text-white tabular-nums">{totalRuns}</div>
              </div>
            </div>
            <div className="mt-3 space-y-1.5">
              {workflows.slice(0, 3).map((w) => (
                <div key={w.id} className="flex items-center justify-between rounded-lg border border-white/[0.05] bg-white/[0.02] px-2.5 py-1.5">
                  <span className="truncate text-[11.5px] text-zinc-300">{w.name || w.id}</span>
                  <span className={`ml-2 shrink-0 rounded-full px-2 py-0.5 text-[9px] font-medium ${w.enabled ? 'bg-emerald-500/15 text-emerald-300' : 'bg-zinc-500/15 text-zinc-400'}`}>
                    {w.enabled ? 'ON' : 'OFF'}
                  </span>
                </div>
              ))}
              {workflows.length === 0 && (
                <div className="rounded-lg border border-dashed border-white/[0.08] px-2.5 py-2 text-[11px] text-zinc-500">
                  No automations yet — create one and it shows up here.
                </div>
              )}
            </div>
          </SectionCard>
        </div>

        {/* Recent conversations */}
        <div className="mt-4">
          <SectionCard
            label="Recent"
            title="Latest conversations"
            action={<button onClick={() => onViewChange('chats')} className="text-[11px] text-zinc-500 transition-colors hover:text-zinc-300">View all →</button>}
          >
            <div className="space-y-2">
              {recent.length === 0 && (
                <button onClick={() => onViewChange('chats')} className="w-full rounded-xl border border-dashed border-white/[0.08] bg-white/[0.015] px-3 py-3 text-[12px] text-zinc-500 transition-colors hover:border-violet-400/30 hover:text-zinc-300">
                  No conversations yet — start your first one →
                </button>
              )}
              {recent.map((s, i) => (
                <motion.button
                  key={s.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.25, delay: i * 0.04 }}
                  onClick={() => onViewChange('chats')}
                  className="flex w-full items-center justify-between gap-3 rounded-xl border border-white/[0.05] bg-white/[0.02] px-3 py-2.5 text-left transition-colors hover:border-white/[0.1] hover:bg-white/[0.05]"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-[12px] font-medium text-zinc-200">{(s.title || 'Untitled chat').slice(0, 64)}</span>
                    <span className="block text-[10.5px] text-zinc-500">
                      {new Date(s.updated_at).toLocaleString()} · {s.message_count ?? 0} msgs
                    </span>
                  </span>
                  <span className="hidden shrink-0 rounded-md border border-white/[0.07] bg-white/[0.04] px-2 py-0.5 font-mono text-[9px] text-zinc-500 sm:block">
                    {(s.model || '').split('/').pop()?.slice(0, 22)}
                  </span>
                </motion.button>
              ))}
            </div>
          </SectionCard>
        </div>

        {/* Footer hint */}
        <div className="mt-6 flex items-center justify-center gap-2 text-[11px] text-zinc-600">
          <AppIcon name="topbar.engine" className="h-3.5 w-3.5" strokeWidth={1.7} gradient={BRAND_GRADIENT} />
          Every number is computed locally — nothing leaves this machine.
        </div>
      </div>
    </div>
  );
}
