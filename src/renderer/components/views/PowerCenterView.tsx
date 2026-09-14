import { useEffect, useMemo, useState } from 'react';
import { useAuthStore } from '../../stores/auth';
import { useChatStore } from '../../stores/chat';
import { useAgentsStore } from '../../stores/agents';
import { useBrainStore } from '../../stores/brain';
import { useAutomationStore } from '../../stores/automation';
import { AppIcon, type AppIconName } from '../brand/AppIcon';
import { InfiniteLogo } from '../brand/InfiniteLogo';
import { creativeGreeting, dayOfYearSeed } from '../../lib/greeting';

interface PowerCenterViewProps {
  onViewChange: (view: string) => void;
  onOpenDeploy?: () => void;
}

type QuickAction = { id: string; label: string; desc: string; icon: AppIconName; view: string; hotkey?: string; accent: string };

const QUICK_ACTIONS: QuickAction[] = [
  { id: 'new-chat', label: 'New Chat', desc: 'Ask Infinite AI anything', icon: 'nav.chats', view: 'chats', hotkey: '⌘ N', accent: 'from-violet-500 to-indigo-500' },
  { id: 'automate', label: 'Automate', desc: 'Build a workflow', icon: 'nav.automations', view: 'automations', accent: 'from-cyan-400 to-blue-500' },
  { id: 'files', label: 'Files', desc: 'Explorer & editor', icon: 'nav.files', view: 'documents', accent: 'from-emerald-400 to-teal-500' },
  { id: 'terminal', label: 'Terminal', desc: 'Full PTY — Cmd+`', icon: 'nav.terminal', view: 'terminal', hotkey: '⌘ `', accent: 'from-zinc-700 to-zinc-900' },
  { id: 'canvas', label: 'Canvas', desc: 'Visual workflows', icon: 'nav.workspace', view: 'canvas', accent: 'from-pink-500 to-rose-500' },
  { id: 'bots', label: 'Bots', desc: 'Your agent fleet', icon: 'nav.agents', view: 'bots', accent: 'from-amber-400 to-orange-500' },
  { id: 'browser', label: 'Browser', desc: 'AI-driven browsing', icon: 'nav.capabilities', view: 'browser', accent: 'from-sky-400 to-indigo-400' },
  { id: 'artifacts', label: 'Artifacts', desc: 'Charts, docs, builds', icon: 'tab.document', view: 'artifacts', accent: 'from-violet-400 to-fuchsia-400' },
];

const SHORTCUTS: Array<{ keys: string; label: string }> = [
  { keys: '⌘ K', label: 'Command palette' },
  { keys: '⌘ N', label: 'New chat' },
  { keys: '⌘ `', label: 'Terminal' },
  { keys: '⌘ B', label: 'Toggle sidebar' },
  { keys: '⌘ .', label: 'Activity panel' },
];

const TIPS = [
  'Tip: Press ⌘ K then type "deploy" to ship in seconds.',
  'Tip: Quick Capture (⌘⇧Y) saves any thought to your notes instantly.',
  'Tip: Bots can run as a crew — pair two models for crew mode.',
  'Tip: Canvas workflows persist locally and run real actions.',
  'Tip: Say "build me a..." in chat — Infinite AI scaffolds it live.',
];

function useClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(id);
  }, []);
  return now;
}

export function PowerCenterView({ onViewChange, onOpenDeploy }: PowerCenterViewProps) {
  const user = useAuthStore((s) => s.user);
  const sessions = useChatStore((s) => s.sessions);
  const selectSession = useChatStore((s) => s.selectSession);
  const createSession = useChatStore((s) => s.createSession);
  const runs = useAgentsStore((s) => s.runs);
  const enginePhase = useBrainStore((s) => s.enginePhase);
  const engineProgress = useBrainStore((s) => s.engineProgress);
  const workflows = useAutomationStore((s) => s.workflows);
  const loadWorkflows = useAutomationStore((s) => s.loadWorkflows);
  const now = useClock();
  const [focusOn, setFocusOn] = useState(() => {
    try { return localStorage.getItem('infinite:focus') === '1'; } catch { return false; }
  });
  const [capture, setCapture] = useState('');
  const [saving, setSaving] = useState(false);
  const [savedPath, setSavedPath] = useState<string | null>(null);
  const [spotlight, setSpotlight] = useState('');

  useEffect(() => {
    try { localStorage.setItem('infinite:focus', focusOn ? '1' : '0'); } catch { /* ignore */ }
    // subtle document hint so global styles could dim if we want — best-in-class focus
    try { document.documentElement.dataset.focus = focusOn ? 'on' : 'off'; } catch { /* ignore */ }
  }, [focusOn]);

  useEffect(() => {
    // warm automations so recents are real — best OS never shows stale zeros
    void loadWorkflows().catch(() => {});
  }, [loadWorkflows]);

  const firstName = useMemo(() => user?.name?.split(' ')[0] || 'Anthony', [user?.name]);
  const dateLabel = useMemo(() => now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }), [now]);
  const timeLabel = useMemo(() => now.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }), [now]);

  const recentSessions = useMemo(() => [...sessions].sort((a, b) => b.updated_at - a.updated_at).slice(0, 3), [sessions]);
  const activeRuns = useMemo(() => runs.filter((r) => r.status === 'running').length, [runs]);
  const recentAutos = useMemo(() => {
    type W = { id: string; name: string; enabled: boolean; createdAt: number };
    const list = (workflows as unknown as W[]) ?? [];
    return [...list].sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0)).slice(0, 3);
  }, [workflows]);

  const tip = useMemo(() => TIPS[new Date().getDate() % TIPS.length], []);

  const hero = useMemo(() => creativeGreeting({
    firstName,
    hour: now.getHours(),
    weekday: now.getDay(),
    dayOfYear: dayOfYearSeed(now),
    recentSessions: recentSessions.length,
    activeRuns,
    readyAutomations: recentAutos.filter((w) => w.enabled).length,
  }), [now, firstName, recentSessions.length, activeRuns, recentAutos]);

  const filteredActions = useMemo(() => {
    const q = spotlight.trim().toLowerCase();
    if (!q) return QUICK_ACTIONS;
    return QUICK_ACTIONS.filter((a) => `${a.label} ${a.desc} ${a.view}`.toLowerCase().includes(q));
  }, [spotlight]);

  const filteredSessions = useMemo(() => {
    const q = spotlight.trim().toLowerCase();
    if (!q) return recentSessions;
    return recentSessions.filter((s) => (s.title || '').toLowerCase().includes(q));
  }, [recentSessions, spotlight]);

  const handleNewChat = async () => {
    try {
      const cur = JSON.parse(localStorage.getItem('infinite:current') ?? '{}') as { cwd?: string; model?: string; provider?: string };
      const session = await createSession(cur.cwd ?? '.', cur.model ?? 'meta-llama/llama-3.3-70b-instruct:free', cur.provider ?? 'openrouter');
      selectSession(session.id);
    } catch { /* fallback to nav */ }
    onViewChange('chats');
  };

  const handleQuickCapture = async () => {
    const text = capture.trim();
    if (!text) return;
    setSaving(true);
    try {
      const res = (await window.api.quickCaptureAppend({ text })) as { ok: true; path: string } | { ok: false; error: string };
      if (res.ok) {
        setSavedPath(res.path);
        setCapture('');
        window.setTimeout(() => setSavedPath(null), 3000);
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex-1 overflow-auto bg-[#09090c] animate-fade-in">
      <div className="mx-auto max-w-[1160px] px-6 py-6 lg:px-8 lg:py-7">
        {/* SPOTLIGHT — best OS is instant: one field to jump anywhere */}
        <div className="mb-4 flex items-center gap-2 rounded-2xl border border-white/[0.07] bg-white/[0.02] px-3 py-2 shadow-[0_8px_30px_rgba(0,0,0,0.25)]">
          <AppIcon name="nav.chats" className="h-4 w-4 text-zinc-500" />
          <input
            value={spotlight}
            onChange={(e) => setSpotlight(e.target.value)}
            placeholder="Spotlight — type to filter actions & recents, or press ⌘K for everything…"
            className="flex-1 bg-transparent text-[13px] text-white placeholder:text-zinc-600 focus:outline-none"
            aria-label="Spotlight search"
          />
          {spotlight && (
            <button onClick={() => setSpotlight('')} className="rounded-lg bg-white/[0.06] px-2 py-1 text-[11px] text-zinc-400 hover:bg-white/[0.08] hover:text-zinc-200" aria-label="Clear spotlight">Clear</button>
          )}
          <span className="hidden sm:inline rounded bg-white/[0.06] px-1.5 py-0.5 font-mono text-[10px] text-zinc-500">⌘K</span>
        </div>
        {/* HERO — the "why this is the best" first impression */}
        <div className="relative overflow-hidden rounded-[20px] border border-white/[0.07] bg-gradient-to-br from-[#0f1120] via-[#0e1220] to-[#0a0a12] p-6 lg:p-7">
          <div className="pointer-events-none absolute -right-20 -top-20 h-72 w-72 rounded-full bg-violet-500/10 blur-[70px]" />
          <div className="pointer-events-none absolute -bottom-16 -left-16 h-64 w-64 rounded-full bg-cyan-500/10 blur-[60px]" />
          <div className="relative flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0">
              <div className="flex items-center gap-3">
                <div className="relative">
                  <div className="absolute inset-0 rounded-full bg-indigo-500/15 blur-xl" />
                  <InfiniteLogo className="relative h-8 w-14" variant="spectrum" />
                </div>
                <span className="rounded-full border border-white/[0.08] bg-white/[0.04] px-2.5 py-1 text-[10px] font-medium tracking-wide text-zinc-300">Infinite OS — Power Center</span>
                <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-medium ${enginePhase === 'active' ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/20' : 'bg-amber-500/15 text-amber-300 border border-amber-500/20'}`}>
                  <span className={`h-1.5 w-1.5 rounded-full ${enginePhase === 'active' ? 'bg-emerald-400' : 'bg-amber-400 animate-pulse'}`} />
                  {enginePhase === 'active' ? 'Engine live 100%' : `Engine ${enginePhase} ${engineProgress}%`}
                </span>
              </div>
              <h1 className="mt-3 text-[26px] font-semibold tracking-tight text-white lg:text-[30px]">{hero.greeting}, {firstName} <span className="text-zinc-500">—</span> <span className="bg-gradient-to-r from-violet-300 via-cyan-300 to-fuchsia-300 bg-clip-text text-transparent">{hero.accent}</span></h1>
              <p className="mt-1.5 max-w-[62ch] text-[13px] leading-5 text-zinc-400">
                {hero.sub}
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <button onClick={handleNewChat} className="inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2 text-[13px] font-semibold text-zinc-900 hover:bg-zinc-100 transition-colors">
                  <AppIcon name="nav.chats" className="h-4 w-4" /> New Chat
                </button>
                <button onClick={() => onViewChange('automations')} className="inline-flex items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.06] px-4 py-2 text-[13px] font-medium text-white hover:bg-white/[0.09] transition-colors">
                  <AppIcon name="nav.automations" className="h-4 w-4" /> Automate
                </button>
                <button onClick={() => onViewChange('workspace')} className="inline-flex items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.04] px-4 py-2 text-[13px] font-medium text-zinc-300 hover:bg-white/[0.07] hover:text-white transition-colors">
                  <AppIcon name="nav.workspace" className="h-4 w-4" /> Open Workspace
                </button>
                {onOpenDeploy && (
                  <button onClick={onOpenDeploy} className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 px-4 py-2 text-[13px] font-semibold text-white hover:from-violet-500 hover:to-indigo-500 transition-colors">
                    Deploy
                  </button>
                )}
              </div>
              <div className="mt-3 flex items-center gap-2 text-[11px] text-zinc-500">
                <span>{dateLabel} · {timeLabel}</span>
                <span className="opacity-30">•</span>
                <span className="text-zinc-400">{tip}</span>
              </div>
            </div>
            <div className="grid w-full max-w-[360px] grid-cols-3 gap-2 lg:w-[340px]">
              <StatMini label="Sessions" value={String(sessions.length)} hint={recentSessions.length ? 'recent' : 'start one'} />
              <StatMini label="Agents" value={String(activeRuns)} hint={activeRuns ? 'running' : 'idle'} tone={activeRuns ? 'live' : 'idle'} />
              <StatMini label="Automations" value={String(workflows.length)} hint={workflows.length ? 'ready' : 'create one'} />
              <div className="col-span-3 rounded-xl border border-white/[0.06] bg-black/20 px-3 py-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] uppercase tracking-wide text-zinc-500">Focus</span>
                  <button onClick={() => setFocusOn((v) => !v)} className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${focusOn ? 'bg-violet-600' : 'bg-white/15'}`} aria-label="Toggle focus">
                    <span className={`inline-block h-4 w-4 rounded-full bg-white transition-transform ${focusOn ? 'translate-x-4' : 'translate-x-0.5'}`} />
                  </button>
                </div>
                <div className="mt-1 text-[12px] font-medium text-zinc-200">{focusOn ? 'Focus mode — distractions dimmed' : 'Turn on to hide noise, keep chat + editor'}</div>
                <div className="text-[11px] text-zinc-500">Pairs with ⌘B / ⌘. to shape your rail.</div>
              </div>
            </div>
          </div>
        </div>

        {/* QUICK ACTIONS — one-click power */}
        <div className="mt-5">
          <div className="flex items-center justify-between">
            <h2 className="text-[11px] font-semibold uppercase tracking-widest text-zinc-500">Instant actions</h2>
            <span className="text-[11px] text-zinc-600">Press ⌘K for everything</span>
          </div>
            <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
            {filteredActions.length === 0 ? (
              <div className="col-span-2 lg:col-span-4 rounded-2xl border border-dashed border-white/[0.08] bg-white/[0.015] px-4 py-6 text-center text-[13px] text-zinc-500">No actions match “{spotlight}” — try “chat”, “terminal”, or press ⌘K.</div>
            ) : filteredActions.map((a) => (
              <button
                key={a.id}
                onClick={() => a.id === 'new-chat' ? handleNewChat() : onViewChange(a.view)}
                className="group relative overflow-hidden rounded-2xl border border-white/[0.07] bg-[#12131a] p-4 text-left transition-all hover:border-white/[0.12] hover:bg-[#171821] focus:outline-none focus:ring-2 focus:ring-violet-500/30"
                aria-label={a.label}
              >
                <div className={`pointer-events-none absolute inset-0 bg-gradient-to-br ${a.accent} opacity-0 group-hover:opacity-[0.08] transition-opacity`} />
                <div className="flex items-start justify-between">
                  <span className={`inline-flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br ${a.accent} text-white shadow-lg`}>
                    <AppIcon name={a.icon} className="h-4 w-4" />
                  </span>
                  {a.hotkey && <span className="rounded bg-white/[0.06] px-1.5 py-0.5 font-mono text-[10px] text-zinc-400">{a.hotkey}</span>}
                </div>
                <div className="mt-3 text-[13px] font-semibold text-white">{a.label}</div>
                <div className="text-[11px] text-zinc-500">{a.desc}</div>
              </button>
            ))}
          </div>
        </div>

        {/* RECENTS + PULSE + CAPTURE */}
        <div className="mt-5 grid gap-4 lg:grid-cols-[1.35fr_0.85fr]">
          <div className="rounded-2xl border border-white/[0.07] bg-[#12131a] p-4">
            <div className="flex items-center justify-between">
              <h3 className="text-[12px] font-semibold text-white">Recents</h3>
              <button onClick={() => onViewChange('chats')} className="text-[11px] text-zinc-500 hover:text-zinc-300">View all →</button>
            </div>
            <div className="mt-3 space-y-2">
              {(spotlight ? filteredSessions : recentSessions).length === 0 ? (
                spotlight ? <div className="rounded-xl border border-dashed border-white/[0.08] bg-white/[0.015] px-3 py-3 text-[12px] text-zinc-500">No chats match “{spotlight}”.</div> : <EmptyRow label="No chats yet — start your first one" actionLabel="New Chat" onAction={handleNewChat} />
              ) : (spotlight ? filteredSessions : recentSessions).map((s) => (
                <button key={s.id} onClick={() => { selectSession(s.id); onViewChange('chats'); }} className="flex w-full items-center justify-between rounded-xl border border-white/[0.05] bg-white/[0.02] px-3 py-2.5 text-left hover:bg-white/[0.05] hover:border-white/[0.08] transition-colors">
                  <span className="min-w-0">
                    <span className="block truncate text-[12px] font-medium text-zinc-200">{(s.title || 'Untitled chat').slice(0, 64)}</span>
                    <span className="block text-[11px] text-zinc-500">{new Date(s.updated_at).toLocaleString()} · {s.message_count ?? 0} msgs</span>
                  </span>
                  <span className="ml-3 rounded-lg bg-white px-2 py-1 text-[11px] font-medium text-zinc-900">Open</span>
                </button>
              ))}
              <div className="pt-2">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-[11px] font-medium uppercase tracking-wide text-zinc-600">Automations</span>
                  <button onClick={() => onViewChange('automations')} className="text-[11px] text-zinc-500 hover:text-zinc-300">Manage →</button>
                </div>
                {recentAutos.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-white/[0.08] bg-white/[0.015] px-3 py-3 text-[12px] text-zinc-500">No workflows yet — create one in Automation Studio.</div>
                ) : recentAutos.map((w) => (
                  <div key={w.id} className="flex items-center justify-between rounded-xl border border-white/[0.05] bg-white/[0.02] px-3 py-2">
                    <span className="truncate text-[12px] text-zinc-300">{w.name || w.id}</span>
                    <span className={`ml-2 rounded-full px-2 py-0.5 text-[10px] ${w.enabled ? 'bg-emerald-500/15 text-emerald-300' : 'bg-zinc-500/15 text-zinc-400'}`}>{w.enabled ? 'Enabled' : 'Off'}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <div className="rounded-2xl border border-white/[0.07] bg-[#12131a] p-4">
              <h3 className="text-[12px] font-semibold text-white">Quick Capture</h3>
              <p className="mt-1 text-[11px] text-zinc-500">Drop a thought — saved instantly to your quick notes. Works offline.</p>
              <div className="mt-3 flex gap-2">
                <input value={capture} onChange={(e) => setCapture(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) void handleQuickCapture(); }} placeholder="What should I remember?" aria-label="Quick capture input" className="flex-1 rounded-xl border border-white/[0.08] bg-black/30 px-3 py-2 text-[12px] text-white placeholder:text-zinc-600 focus:outline-none focus:border-violet-500/40" />
                <button onClick={() => void handleQuickCapture()} disabled={saving || !capture.trim()} className="rounded-xl bg-white px-3 py-2 text-[12px] font-semibold text-zinc-900 disabled:opacity-40 hover:bg-zinc-100 transition-colors" aria-label="Save quick capture">{saving ? '…' : 'Save'}</button>
              </div>
              {savedPath && <div className="mt-2 rounded-lg bg-emerald-500/10 px-2.5 py-1.5 text-[11px] text-emerald-300">Saved → {savedPath}</div>}
              <div className="mt-2 flex gap-1.5">
                <button onClick={() => void window.api.quickCaptureOpen()} className="rounded-lg border border-white/[0.07] bg-white/[0.04] px-2.5 py-1 text-[11px] text-zinc-300 hover:bg-white/[0.07]">Open notes</button>
                <span className="rounded-lg bg-white/[0.04] px-2 py-1 font-mono text-[10px] text-zinc-500">⌘⇧Y</span>
              </div>
            </div>

            <div className="rounded-2xl border border-white/[0.07] bg-[#12131a] p-4">
              <h3 className="text-[12px] font-semibold text-white">System pulse</h3>
              <div className="mt-3 grid grid-cols-2 gap-2 text-[11px]">
                <PulseRow label="Engine" value={enginePhase === 'active' ? 'Live' : enginePhase} ok={enginePhase === 'active'} />
                <PulseRow label="Sessions" value={String(sessions.length)} />
                <PulseRow label="Active agents" value={String(activeRuns)} ok={activeRuns === 0} />
                <PulseRow label="Automations" value={String(workflows.length)} />
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {SHORTCUTS.map((s) => (
                  <span key={s.keys} className="inline-flex items-center gap-1.5 rounded-full border border-white/[0.06] bg-white/[0.03] px-2.5 py-1 text-[11px] text-zinc-400">
                    <span className="font-mono text-[11px] text-zinc-200">{s.keys}</span>{s.label}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* WHY BEST — positioning */}
        <div className="mt-5 rounded-2xl border border-white/[0.07] bg-gradient-to-br from-[#0f0f14] to-[#0c0d12] p-4 lg:p-5">
          <h3 className="text-[12px] font-semibold uppercase tracking-widest text-zinc-500">What makes Infinite OS the best</h3>
          <div className="mt-3 grid gap-3 lg:grid-cols-4">
            <BestCard title="All-in-one, not tab hell" desc="Chat, code, files, terminal, browser + PC automation in one native app — no juggling 12 tools." />
            <BestCard title="Keyboard-first, instant" desc="⌘K palette + idle-prefetched views. Startup in ~270ms — feels instant, not Electron-slow." />
            <BestCard title="Local-first & private" desc="Ollama + local models, encrypted store, Netflix-style profile isolation. Your data stays yours." />
            <BestCard title="Build, don't configure" desc="App Builder, Website Builder, Canvas, Automations — ship from a prompt, not a backlog." />
          </div>
        </div>

        <div className="mt-6 text-center text-[11px] text-zinc-600">
          Infinite OS v0.1.1 · <button onClick={() => window.dispatchEvent(new Event('infinite:open-settings'))} className="underline decoration-zinc-600 underline-offset-2 hover:text-zinc-400">Settings</button> · <button onClick={() => onViewChange('capabilities')} className="underline decoration-zinc-600 underline-offset-2 hover:text-zinc-400">Tools &amp; Skills</button> · <button onClick={() => onViewChange('plugins')} className="underline decoration-zinc-600 underline-offset-2 hover:text-zinc-400">Plugins</button>
        </div>
      </div>
    </div>
  );
}

function StatMini({ label, value, hint, tone }: { label: string; value: string; hint: string; tone?: 'live' | 'idle' }) {
  return (
    <div className="rounded-xl border border-white/[0.06] bg-black/20 px-3 py-2.5">
      <div className="text-[10px] uppercase tracking-wide text-zinc-500">{label}</div>
      <div className="flex items-baseline gap-1.5">
        <span className={`text-[18px] font-semibold ${tone === 'live' ? 'text-emerald-300' : 'text-white'}`}>{value}</span>
        <span className="text-[11px] text-zinc-500">{hint}</span>
      </div>
    </div>
  );
}

function PulseRow({ label, value, ok }: { label: string; value: string; ok?: boolean }) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-white/[0.06] bg-white/[0.02] px-2.5 py-2">
      <span className="text-zinc-500">{label}</span>
      <span className={`font-medium ${ok === false ? 'text-amber-300' : ok ? 'text-zinc-200' : 'text-white'}`}>{value}</span>
    </div>
  );
}

function BestCard({ title, desc }: { title: string; desc: string }) {
  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-3.5 py-3">
      <div className="text-[12px] font-semibold text-white">{title}</div>
      <div className="mt-1 text-[11px] leading-4 text-zinc-500">{desc}</div>
    </div>
  );
}

function EmptyRow({ label, actionLabel, onAction }: { label: string; actionLabel: string; onAction: () => void }) {
  return (
    <div className="flex items-center justify-between rounded-xl border border-dashed border-white/[0.08] bg-white/[0.015] px-3 py-3">
      <span className="text-[12px] text-zinc-500">{label}</span>
      <button onClick={onAction} className="rounded-lg bg-white px-2.5 py-1 text-[11px] font-medium text-zinc-900 hover:bg-zinc-100">{actionLabel}</button>
    </div>
  );
}
