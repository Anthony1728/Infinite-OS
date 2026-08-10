import { useEffect, useMemo, useState } from 'react';
import { useChatStore, type BrainTeachingLiveState } from '../../stores/chat';

function asTime(value: number | string | null | undefined): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function teachingProgress(status: BrainTeachingLiveState, now = Date.now()): number {
  const start = asTime(status.startedAt);
  const end = asTime(status.endsAt);
  if (status.state === 'completed') return 100;
  if (!start || !end || end <= start) return 0;
  return Math.max(0, Math.min(100, ((now - start) / (end - start)) * 100));
}

function formatRemaining(status: BrainTeachingLiveState, now: number): string {
  if (status.state === 'completed') return 'Complete';
  if (status.state === 'stopped') return 'Stopped';
  const end = asTime(status.endsAt);
  if (!end) return `${status.durationMinutes ?? 10} min`;
  const seconds = Math.max(0, Math.ceil((end - now) / 1_000));
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}:${remainder.toString().padStart(2, '0')}`;
}

function stageIndex(status: BrainTeachingLiveState): number {
  if (status.phase === 'searching' || status.phase === 'preparing') return 0;
  if (status.phase === 'reading') return 1;
  if (status.phase === 'distilling' || status.phase === 'recovering') return 2;
  if (status.phase === 'verifying' || status.phase === 'saved' || status.phase === 'complete') return 3;
  const message = (status.message ?? '').toLowerCase();
  if (/learned|checked existing|complete|stopped|verifying/.test(message)) return 3;
  if (/switching|waiting|model|distill|learning/.test(message) && !/researching/.test(message)) return 2;
  if (/fetch|read|source/.test(message)) return 1;
  return 0;
}

function Metric({ label, value, accent }: { label: string; value: string | number; accent: string }) {
  return (
    <div className="rounded-lg border border-white/[0.07] bg-black/20 px-3 py-2.5">
      <div className={`text-base font-semibold leading-none ${accent}`}>{value}</div>
      <div className="mt-1.5 text-[9px] font-medium uppercase tracking-[0.14em] text-zinc-500">{label}</div>
    </div>
  );
}

const STAGES = ['Search web', 'Read sources', 'Distill lesson', 'Verify & save'];

export function BrainLearningPanel() {
  const status = useChatStore((state) => state.brainTeaching);
  const currentSessionId = useChatStore((state) => state.currentSessionId);
  const [now, setNow] = useState(Date.now());

  const active = Boolean(status?.active ?? status?.state === 'running');
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [active]);

  const progress = useMemo(() => status ? teachingProgress(status, now) : 0, [status, now]);
  if (!status || status.state === 'idle' || (status.chatSessionId && status.chatSessionId !== currentSessionId)) return null;

  const terminal = status.state === 'completed' || status.state === 'stopped';
  const fullyComplete = status.state === 'completed';
  const currentStage = fullyComplete ? STAGES.length : stageIndex(status);
  const lessons = status.lessonsAdded ?? status.lessonsCompleted ?? status.lessonsLearned ?? 0;
  const provider = status.currentProvider ?? status.provider;
  const model = status.currentModel ?? status.model;
  const sourceLabel = status.source === 'online' ? 'Live web research' : 'Guided curriculum';

  return (
    <section className="mx-6 mt-4 overflow-hidden rounded-2xl border border-violet-400/20 bg-[radial-gradient(circle_at_top_left,rgba(124,58,237,.16),transparent_42%),linear-gradient(135deg,rgba(12,16,28,.98),rgba(6,9,17,.98))] shadow-[0_18px_55px_rgba(0,0,0,.28)] lg:mx-10" aria-label="Infinite Brain learning progress">
      <div className="relative px-5 py-4">
        <div className="pointer-events-none absolute -right-14 -top-16 h-36 w-36 rounded-full bg-cyan-400/10 blur-3xl" />
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="relative flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl border border-violet-400/25 bg-violet-500/10">
              {active && <span className="absolute inset-1 rounded-lg border border-violet-400/35 animate-ping" />}
              <svg className="relative h-5 w-5 text-violet-300" fill="none" stroke="currentColor" strokeWidth="1.6" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.5 4.5a3.5 3.5 0 0 0-3.43 4.2A3.5 3.5 0 0 0 7.5 15.4V17a2.5 2.5 0 0 0 2.5 2.5V4.8a3.5 3.5 0 0 0-.5-.3Zm5 0a3.5 3.5 0 0 1 3.43 4.2 3.5 3.5 0 0 1-1.43 6.7V17a2.5 2.5 0 0 1-2.5 2.5V4.8c.16-.12.33-.22.5-.3ZM10 9H7.5M14 13h2.5" />
              </svg>
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-sm font-semibold text-zinc-100">Infinite Brain Learning</h3>
                <span className={`rounded-full border px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.13em] ${terminal ? 'border-emerald-400/25 bg-emerald-400/10 text-emerald-300' : 'border-cyan-400/25 bg-cyan-400/10 text-cyan-300'}`}>
                  {terminal ? (status.state === 'stopped' ? 'Stopped' : 'Complete') : 'Live'}
                </span>
              </div>
              <p className="mt-1 truncate text-[11px] text-zinc-400">{status.currentTopic ?? status.topic ?? 'Building practical, reusable knowledge'}</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-1.5 text-[9px] text-zinc-400">
            <span className="rounded-md border border-white/[0.07] bg-white/[0.03] px-2 py-1">{sourceLabel}</span>
            {provider && <span className="rounded-md border border-white/[0.07] bg-white/[0.03] px-2 py-1">{provider}</span>}
            {model && <span className="max-w-48 truncate rounded-md border border-white/[0.07] bg-white/[0.03] px-2 py-1" title={model}>{model}</span>}
          </div>
        </div>

        <div className="mt-4">
          <div className="mb-1.5 flex items-center justify-between text-[10px]">
            <span className="text-zinc-400">{status.message ?? (active ? 'Preparing the next lesson…' : 'Learning session saved')}</span>
            <span className="font-mono text-violet-300">{Math.round(progress)}%</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
            <div className="h-full rounded-full bg-gradient-to-r from-violet-500 via-indigo-400 to-cyan-400 transition-[width] duration-700 ease-out shadow-[0_0_16px_rgba(99,102,241,.55)]" style={{ width: `${progress}%` }} />
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Metric label="Lessons saved" value={lessons} accent="text-violet-300" />
          <Metric label="Research cycles" value={status.cyclesCompleted ?? 0} accent="text-cyan-300" />
          <Metric label="Model switches" value={status.recoveryCount ?? 0} accent="text-amber-300" />
          <Metric label="Time remaining" value={formatRemaining(status, now)} accent="text-emerald-300" />
        </div>

        <div className="mt-4 grid grid-cols-4 gap-1.5" aria-label="Learning stages">
          {STAGES.map((stage, index) => {
            const done = fullyComplete || index < currentStage;
            const current = !terminal && index === currentStage;
            return (
              <div key={stage} className={`flex min-w-0 items-center gap-1.5 rounded-md border px-2 py-1.5 text-[9px] ${done ? 'border-emerald-400/15 bg-emerald-400/[0.06] text-emerald-300' : current ? 'border-violet-400/20 bg-violet-400/[0.08] text-violet-200' : 'border-white/[0.05] bg-white/[0.02] text-zinc-600'}`}>
                <span className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${done ? 'bg-emerald-400' : current ? 'bg-violet-400 animate-pulse' : 'bg-zinc-700'}`} />
                <span className="truncate">{stage}</span>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
