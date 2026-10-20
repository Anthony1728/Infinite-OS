import { useEffect, useMemo, useState } from 'react';
import { useChatStore } from '../../stores/chat';
import { useAgentsStore } from '../../stores/agents';
import { useAutomationStore } from '../../stores/automation';
import { useAiTabsStore } from '../../stores/aiTabs';
import { AppIcon, BRAND_GRADIENT, type AppIconName } from '../brand/AppIcon';
import { InfiniteLogo } from '../brand/InfiniteLogo';

interface InfiniteGuideViewProps {
  onViewChange: (view: string) => void;
}

type SectionId = 'overview' | 'modules' | 'commands' | 'shortcuts' | 'privacy';

const NAV_SECTIONS: { id: SectionId; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'modules', label: 'Modules' },
  { id: 'commands', label: 'Commands' },
  { id: 'shortcuts', label: 'Shortcuts' },
  { id: 'privacy', label: 'Privacy' },
];

const MODULES: { id: string; title: string; desc: string; icon: AppIconName; view: string; accent: string }[] = [
  { id: 'chats', title: 'Chats', desc: 'Infinite AI thinks with you in plain language — code, answers, actions.', icon: 'nav.chats', view: 'chats', accent: 'from-violet-500 to-indigo-500' },
  { id: 'projects', title: 'Projects', desc: 'Organize work into boards, tasks and sprints from a prompt.', icon: 'nav.projects', view: 'projects', accent: 'from-sky-400 to-blue-500' },
  { id: 'documents', title: 'File Explorer', desc: 'Browse, open, edit and manage files without leaving the OS.', icon: 'nav.files', view: 'documents', accent: 'from-emerald-400 to-teal-500' },
  { id: 'terminal', title: 'Terminal', desc: 'A full terminal — Infinite AI can run and explain commands too.', icon: 'nav.terminal', view: 'terminal', accent: 'from-zinc-600 to-zinc-800' },
  { id: 'automations', title: 'Automations', desc: 'Scheduled jobs and workflows that run real actions on your PC.', icon: 'nav.automations', view: 'automations', accent: 'from-cyan-400 to-blue-500' },
  { id: 'bots', title: 'Bots', desc: 'A fleet of agents that can work as a crew — even paired models.', icon: 'nav.agents', view: 'bots', accent: 'from-amber-400 to-orange-500' },
  { id: 'memory', title: 'Memory', desc: 'A brain that remembers preferences, projects and learnings.', icon: 'nav.memory', view: 'memory', accent: 'from-fuchsia-400 to-pink-500' },
  { id: 'messaging', title: 'Messaging', desc: 'Reach phone, Telegram and WhatsApp from one inbox.', icon: 'home.chat', view: 'messaging', accent: 'from-lime-400 to-emerald-500' },
  { id: 'canvas', title: 'Canvas', desc: 'Visual workflows that persist locally and run real actions.', icon: 'home.canvas', view: 'canvas', accent: 'from-pink-500 to-rose-500' },
  { id: 'artifacts', title: 'Artifacts', desc: 'Charts, documents, builds — every AI creation in one home.', icon: 'tab.document', view: 'artifacts', accent: 'from-indigo-400 to-violet-500' },
  { id: 'workspace', title: 'Workspace', desc: 'Your working folder — files, code and tools in context.', icon: 'nav.workspace', view: 'workspace', accent: 'from-teal-400 to-cyan-500' },
  { id: 'plugins', title: 'Plugin Store', desc: 'Extend the OS with new tools, models and capabilities.', icon: 'home.plugins', view: 'plugins', accent: 'from-purple-400 to-fuchsia-500' },
  { id: 'capabilities', title: 'Tools & Skills', desc: 'The 100+ tools Infinite AI can safely operate.', icon: 'nav.capabilities', view: 'capabilities', accent: 'from-cyan-500 to-sky-500' },
  { id: 'business', title: 'Business OS', desc: 'Contacts, invoices, leads and deals in a personal CRM.', icon: 'home.business', view: 'business', accent: 'from-violet-400 to-purple-500' },
  { id: 'creations', title: 'AI Creations', desc: 'Apps, websites, videos and images built from a prompt.', icon: 'tab.feature', view: 'creations', accent: 'from-orange-400 to-amber-500' },
  { id: 'knowledge', title: 'Knowledge', desc: 'Documents, PDFs and facts Infinite AI can learn from.', icon: 'nav.memory', view: 'knowledge', accent: 'from-blue-400 to-indigo-500' },
];

const SHORTCUTS: { keys: string; label: string }[] = [
  { keys: '⌘/Ctrl K', label: 'Command palette — jump anywhere' },
  { keys: '⌘/Ctrl N', label: 'New chat / task' },
  { keys: '⌘/Ctrl `', label: 'Terminal' },
  { keys: '⌘/Ctrl B', label: 'Toggle sidebar' },
  { keys: '⌘/Ctrl .', label: 'Activity panel' },
  { keys: '⌘/Ctrl ⇧ Y', label: 'Quick capture a thought' },
  { keys: '⌘/Ctrl S', label: 'Save current work' },
  { keys: 'Esc', label: 'Close dialogs / stop' },
];

const COMMANDS: { text: string; reacts: string }[] = [
  { text: '“Build me a website for…”', reacts: 'Scaffolds it live in a tab' },
  { text: '“Automate my morning”', reacts: 'Creates a scheduled workflow' },
  { text: '“Analyze this folder”', reacts: 'Reads, summarizes and reports' },
  { text: '“Create a chart of…”', reacts: 'Renders a live chart tab' },
  { text: '“Deploy this”', reacts: 'Ships it to production' },
  { text: '“Send the invoice”', reacts: 'Handles business paperwork' },
  { text: '“Create a quiz for…”', reacts: 'Builds a study tab' },
  { text: '“What’s new?”', reacts: 'Explains recent OS changes' },
];

const PRIVACY_POINTS: { title: string; desc: string; icon: AppIconName }[] = [
  { title: 'Local-first', desc: 'Ollama + local models run on your machine. Work that never needs the cloud stays on the PC.', icon: 'nav.workspace' },
  { title: 'Encrypted store', desc: 'Sessions, memory and secrets are stored locally with encryption — not silently synced.', icon: 'home.memory' },
  { title: 'Profile isolation', desc: 'Netflix-style separate accounts and profiles keep each workspace isolated.', icon: 'nav.projects' },
  { title: 'You stay in control', desc: 'Nothing runs without explicit approval. Infinite AI asks before consequential actions.', icon: 'home.standing-orders' },
];

const STEPS: { n: number; title: string; desc: string }[] = [
  { n: 1, title: 'Say hello', desc: 'Open a chat and just type — Infinite AI answers like a colleague, not a robot.' },
  { n: 2, title: 'Ask for anything', desc: 'Build, automate, analyze, deploy. If it can be done on your PC, describe it.' },
  { n: 3, title: 'Open tabs that work', desc: 'AI creations land as tabs — interactive apps, charts, dashboards and docs.' },
  { n: 4, title: 'Automate the repeat', desc: 'Turn trusted actions into scheduled jobs or standing orders so they run for you.' },
  { n: 5, title: 'Teach it your way', desc: 'The more you work, the more self-evolution learns your patterns.' },
];

export function InfiniteGuideView({ onViewChange }: InfiniteGuideViewProps) {
  const sessions = useChatStore((s) => s.sessions);
  const runs = useAgentsStore((s) => s.runs);
  const workflows = useAutomationStore((s) => s.workflows);
  const tabs = useAiTabsStore((s) => s.tabs);

  const [activeSection, setActiveSection] = useState<SectionId | null>(null);

  const stats = useMemo(() => {
    const activeAgents = runs.filter((r) => r.status === 'running').length;
    return {
      sessions: sessions.length,
      agents: activeAgents,
      automations: workflows.length,
      tabs: tabs.length,
    };
  }, [sessions.length, runs, workflows.length, tabs.length]);

  useEffect(() => {
    const handler = () => {
      const el = document.getElementById('guide-view');
      if (el) {
        const rect = el.getBoundingClientRect();
        document.documentElement.scrollTop += rect.top;
      }
    };
    document.addEventListener('infinite:guide-scroll-top', handler);
    return () => document.removeEventListener('infinite:guide-scroll-top', handler);
  }, []);

  const scrollTo = (id: SectionId) => {
    setActiveSection(id);
    document.getElementById(`guide-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const openView = (view: string) => onViewChange(view);

  return (
    <div id="guide-view" className="flex-1 overflow-auto chat-scrollbar bg-[#09090c] animate-fade-in">
      <div className="mx-auto max-w-[1160px] px-6 py-6 lg:px-8 lg:py-8">
        {/* Sticky section nav */}
        <div className="sticky top-0 z-20 -mx-2 mb-5 flex items-center gap-1.5 rounded-2xl border border-white/[0.06] bg-[#0b0b10]/90 px-2 py-1.5 backdrop-blur">
          <span className="ml-1 mr-1 hidden sm:inline-flex items-center gap-2 text-[11px] font-semibold text-zinc-400">
            <span className="flex h-5 w-8 items-center justify-center rounded bg-white/[0.05]">
              <InfiniteLogo className="w-6 h-3.5" variant="spectrum" />
            </span>
            Guide
          </span>
          {NAV_SECTIONS.map((s) => (
            <button
              key={s.id}
              onClick={() => scrollTo(s.id)}
              className={`rounded-lg px-2.5 py-1.5 text-[11px] font-medium transition-colors ${
                activeSection === s.id ? 'bg-violet-500/15 text-violet-200' : 'text-zinc-500 hover:text-zinc-200 hover:bg-white/[0.05]'
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>

        {/* HERO */}
        <section id="guide-overview" className="scroll-mt-20 relative overflow-hidden rounded-[22px] border border-white/[0.07] bg-gradient-to-br from-[#0f1120] via-[#0d1022] to-[#0a0a12] p-6 lg:p-9">
          <div className="pointer-events-none absolute -right-24 -top-24 h-80 w-80 rounded-full bg-violet-500/[0.14] blur-[80px]" />
          <div className="pointer-events-none absolute -bottom-24 -left-24 h-72 w-72 rounded-full bg-cyan-500/[0.12] blur-[70px]" />
          <div className="pointer-events-none absolute right-1/3 top-0 h-40 w-40 rounded-full bg-fuchsia-500/[0.08] blur-[60px]" />

          <div className="relative grid gap-8 lg:grid-cols-[1.5fr_1fr] lg:items-center">
            <div className="min-w-0">
              <div className="flex items-center gap-3">
                <div className="relative">
                  <div className="absolute inset-0 rounded-full bg-indigo-500/20 blur-xl" />
                  <InfiniteLogo className="relative h-9 w-16" variant="spectrum" animated />
                </div>
                <span className="rounded-full border border-white/[0.08] bg-white/[0.04] px-3 py-1 text-[10px] font-medium tracking-wide text-zinc-300">Everything explained</span>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-cyan-400/20 bg-cyan-400/[0.07] px-3 py-1 text-[10px] font-medium text-cyan-300">
                  <AppIcon name="topbar.engine" className="h-3 w-3" strokeWidth={1.7} /> v0.1.1
                </span>
              </div>

              <h1 className="mt-4 text-[30px] font-semibold tracking-tight text-white lg:text-[38px]">
                One OS. One brain.{' '}
                <span className="bg-gradient-to-r from-violet-300 via-cyan-300 to-fuchsia-300 bg-clip-text text-transparent">
                  Zero tab-hopping.
                </span>
              </h1>

              <p className="mt-3 max-w-[58ch] text-[13px] leading-6 text-zinc-400">
                <span className="text-zinc-200">Infinite OS</span> is the application — an AI-powered Windows workspace.{' '}
                <span className="text-zinc-200">Infinite AI</span> is the brain inside it. Together they let you chat, code,
                automate Windows, control the browser and PC, learn from documents, manage files, and build new features —
                all from one interface.
              </p>

              <div className="mt-5 flex flex-wrap gap-2">
                <button onClick={() => openView('chats')} className="inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2 text-[13px] font-semibold text-zinc-900 hover:bg-zinc-100 transition-colors">
                  <AppIcon name="nav.chats" className="h-4 w-4" /> Start a chat
                </button>
                <button onClick={() => scrollTo('modules')} className="inline-flex items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.06] px-4 py-2 text-[13px] font-medium text-white hover:bg-white/[0.09] transition-colors">
                  Explore modules
                </button>
                <button onClick={() => openView('capabilities')} className="inline-flex items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.04] px-4 py-2 text-[13px] font-medium text-zinc-300 hover:bg-white/[0.07] hover:text-white transition-colors">
                  <AppIcon name="nav.capabilities" className="h-4 w-4" /> Tools &amp; skills
                </button>
              </div>
            </div>

            {/* Live pulse */}
            <div className="relative rounded-2xl border border-white/[0.07] bg-black/25 p-4 backdrop-blur">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">System pulse</span>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-300">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" /> Live
                </span>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <MiniStat label="Sessions" value={stats.sessions} hint="chats" />
                <MiniStat label="Agents" value={stats.agents} hint="running" live />
                <MiniStat label="Automations" value={stats.automations} hint="jobs" />
                <MiniStat label="Open tabs" value={stats.tabs} hint="workspace" />
              </div>
              <div className="mt-3 space-y-1.5">
                <HealthRow label="Local PC" ok />
                <HealthRow label="AI provider" ok={false} state="configured" />
                <HealthRow label="Workspace" ok />
              </div>
              <p className="mt-3 text-[11px] leading-4 text-zinc-500">
                This tab is generated from real, live state — the numbers above change as you work.
              </p>
            </div>
          </div>

          {/* What is what */}
          <div className="relative mt-7 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <WhatCard
              title="Infinite OS — the app"
              desc="The full desktop workspace: chat, coding, browser & PC control, automation, learning, business tools, files, agents and local memory in one native shell."
            />
            <WhatCard
              title="Infinite AI — the brain"
              desc="The intelligence that runs the OS. It plans, uses 100+ tools, delegates to agents, remembers context and builds things — not just a chatbot."
            />
            <WhatCard
              title="Infinite Tabs — the results"
              desc="Everything the AI builds lands as a real, interactive tab: apps, websites, charts, dashboards, documents, quizzes and more."
            />
          </div>
        </section>

        {/* MODULES */}
        <section id="guide-modules" className="scroll-mt-20 mt-8">
          <SectionHeading
            icon="home.canvas"
            title="Modules"
            accent="Everything under one roof"
            onMore={() => openView('chats')}
            moreLabel="Ask for any module →"
          />
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {MODULES.map((m) => (
              <button
                key={m.id}
                onClick={() => openView(m.view)}
                className="group relative overflow-hidden rounded-2xl border border-white/[0.07] bg-[#12131a] p-4 text-left transition-all hover:border-white/[0.13] hover:bg-[#171821] focus:outline-none focus:ring-2 focus:ring-violet-500/30"
              >
                <div className={`pointer-events-none absolute inset-0 bg-gradient-to-br ${m.accent} opacity-0 group-hover:opacity-[0.09] transition-opacity`} />
                <span className={`inline-flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br ${m.accent} text-white shadow-lg`}>
                  <AppIcon name={m.icon} className="h-4 w-4" />
                </span>
                <div className="mt-3 text-[13px] font-semibold text-white">{m.title}</div>
                <div className="mt-1 text-[11px] leading-4 text-zinc-500">{m.desc}</div>
              </button>
            ))}
          </div>
        </section>

        {/* COMMANDS + SHORTCUTS */}
        <section id="guide-commands" className="scroll-mt-20 mt-8 grid gap-4 lg:grid-cols-2">
          <div className="rounded-2xl border border-white/[0.07] bg-[#12131a] p-5">
            <SectionHeading icon="action.build" title="Just say it" accent="Prompt → result" onMore={() => openView('chats')} moreLabel="→" compact />
            <div className="mt-3 space-y-2">
              {COMMANDS.map((c) => (
                <div key={c.text} className="flex items-center justify-between gap-3 rounded-xl border border-white/[0.05] bg-white/[0.02] px-3 py-2.5 hover:border-white/[0.09] hover:bg-white/[0.04] transition-colors">
                  <span className="text-[12px] font-medium text-zinc-200">{c.text}</span>
                  <span className="hidden shrink-0 rounded-full bg-white/[0.05] px-2 py-0.5 text-[10px] text-zinc-500 sm:inline">{c.reacts}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-white/[0.07] bg-[#12131a] p-5">
            <SectionHeading icon="topbar.engine" title="Keyboard shortcuts" accent="Do more, click less" onMore={() => openView('settings')} moreLabel="Settings →" compact />
            <div className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2.5">
              {SHORTCUTS.map((s) => (
                <div key={s.keys} className="contents">
                  <span className="inline-flex items-center rounded-lg border border-white/[0.08] bg-white/[0.04] px-2 py-1 font-mono text-[10px] text-zinc-200">{s.keys}</span>
                  <span className="self-center text-[12px] text-zinc-400">{s.label}</span>
                </div>
              ))}
            </div>
            <div className="mt-4 rounded-xl border border-dashed border-white/[0.08] bg-white/[0.015] px-3 py-2.5 text-[11px] leading-5 text-zinc-500">
              Keyboard-first, instant: startup in ~270ms with idle-prefetched views — it feels native, not Electron-slow.
            </div>
          </div>
        </section>

        {/* GET STARTED */}
        <section className="mt-8 rounded-2xl border border-white/[0.07] bg-gradient-to-br from-[#0f0f16] to-[#0c0d13] p-5">
          <SectionHeading icon="home.learn" title="Get started in 5 steps" accent="From zero to automating" onMore={() => openView('chats')} moreLabel="Do it now →" />
          <div className="mt-4 grid gap-3 md:grid-cols-5">
            {STEPS.map((step) => (
              <div key={step.n} className="relative rounded-xl border border-white/[0.06] bg-black/20 px-3.5 py-3">
                <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-gradient-to-br from-violet-500 to-cyan-500 px-1.5 text-[11px] font-bold text-white">{step.n}</span>
                <div className="mt-2.5 text-[12px] font-semibold text-white">{step.title}</div>
                <div className="mt-1 text-[11px] leading-4 text-zinc-500">{step.desc}</div>
              </div>
            ))}
          </div>
        </section>

        {/* PRIVACY */}
        <section id="guide-privacy" className="scroll-mt-20 mt-8">
          <SectionHeading icon="home.standing-orders" title="Your data stays yours" accent="Private by design" onMore={() => openView('settings')} moreLabel="Settings →" />
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {PRIVACY_POINTS.map((p) => (
              <div key={p.title} className="group relative overflow-hidden rounded-2xl border border-white/[0.07] bg-[#12131a] p-4">
                <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-violet-500 to-cyan-500 opacity-0 group-hover:opacity-[0.06] transition-opacity" />
                <AppIcon name={p.icon} className="h-5 w-5 text-violet-300" strokeWidth={1.7} gradient={BRAND_GRADIENT} />
                <div className="mt-3 text-[12px] font-semibold text-white">{p.title}</div>
                <div className="mt-1 text-[11px] leading-4 text-zinc-500">{p.desc}</div>
              </div>
            ))}
          </div>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/[0.07] bg-white/[0.02] px-4 py-3.5">
            <span className="text-[11px] text-zinc-500">
              Infinite OS ships as a <span className="text-zinc-300">source-available</span> community product — your workspace, your rules.
            </span>
            <div className="flex gap-2">
              <button onClick={() => openView('home')} className="rounded-lg border border-white/[0.08] bg-white/[0.05] px-3 py-1.5 text-[11px] font-medium text-zinc-200 hover:bg-white/[0.08]">Power Center</button>
              <button onClick={() => openView('settings')} className="rounded-lg bg-white px-3 py-1.5 text-[11px] font-semibold text-zinc-900 hover:bg-zinc-100">Open settings</button>
            </div>
          </div>
        </section>

        <div className="mt-8 mb-2 text-center text-[11px] text-zinc-600">
          Infinite OS v0.1.1 · <button onClick={() => openView('capabilities')} className="underline decoration-zinc-600 underline-offset-2 hover:text-zinc-400">Tools &amp; Skills</button> ·{' '}
          <button onClick={() => openView('plugins')} className="underline decoration-zinc-600 underline-offset-2 hover:text-zinc-400">Plugins</button> ·{' '}
          <button onClick={() => openView('enterprise')} className="underline decoration-zinc-600 underline-offset-2 hover:text-zinc-400">Enterprise</button>
        </div>
      </div>
    </div>
  );
}

function MiniStat({ label, value, hint, live }: { label: string; value: number; hint: string; live?: boolean }) {
  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2.5">
      <div className="text-[9px] uppercase tracking-wide text-zinc-500">{label}</div>
      <div className="flex items-baseline gap-1.5">
        <span className={`text-[18px] font-semibold ${live ? 'text-emerald-300' : 'text-white'}`}>{value}</span>
        <span className="text-[10px] text-zinc-500">{hint}</span>
      </div>
    </div>
  );
}

function HealthRow({ label, ok, state }: { label: string; ok: boolean; state?: string }) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-white/[0.06] bg-white/[0.02] px-2.5 py-2">
      <span className="text-[11px] text-zinc-500">{label}</span>
      <span className={`inline-flex items-center gap-1.5 text-[11px] font-medium ${ok ? 'text-emerald-300' : 'text-zinc-400'}`}>
        <span className={`h-1.5 w-1.5 rounded-full ${ok ? 'bg-emerald-400' : 'bg-amber-400 animate-pulse'}`} />
        {ok ? 'Connected' : state ?? 'Pending'}
      </span>
    </div>
  );
}

function WhatCard({ title, desc }: { title: string; desc: string }) {
  return (
    <div className="rounded-2xl border border-white/[0.07] bg-black/20 p-4">
      <div className="text-[12px] font-semibold text-white">{title}</div>
      <div className="mt-1.5 text-[11px] leading-5 text-zinc-400">{desc}</div>
    </div>
  );
}

function SectionHeading({ icon, title, accent, onMore, moreLabel, compact }: { icon: AppIconName; title: string; accent: string; onMore: () => void; moreLabel: string; compact?: boolean }) {
  return (
    <div className={`flex items-center justify-between ${compact ? '' : 'gap-3'}`}>
      <div className="flex items-center gap-2.5">
        <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-white/[0.07] bg-white/[0.04]">
          <AppIcon name={icon} className="h-3.5 w-3.5 text-violet-300" strokeWidth={1.7} gradient={BRAND_GRADIENT} />
        </span>
        <div>
          <div className="text-[12px] font-semibold text-white">{title}</div>
          <div className="text-[10px] text-zinc-500">{accent}</div>
        </div>
      </div>
      <button onClick={onMore} className="shrink-0 rounded-lg px-2 py-1 text-[11px] text-zinc-500 hover:text-zinc-200 hover:bg-white/[0.05]">
        {moreLabel}
      </button>
    </div>
  );
}