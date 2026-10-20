import { useEffect, useMemo, useState, useCallback } from 'react';
import { useChatStore } from '../../stores/chat';
import { useAgentsStore } from '../../stores/agents';
import { useAutomationStore } from '../../stores/automation';
import { useAiTabsStore } from '../../stores/aiTabs';
import { AppIcon, BRAND_GRADIENT, type AppIconName } from '../brand/AppIcon';
import { InfiniteLogo } from '../brand/InfiniteLogo';

interface InfiniteOverviewViewProps {
  onViewChange: (view: string) => void;
}

const FEATURES = [
  { id: 'chats', title: 'Chats', desc: 'Infinite AI thinks with you in plain language — code, answers, actions.', icon: 'nav.chats' as AppIconName, accent: 'from-violet-500 to-indigo-500' },
  { id: 'automations', title: 'Automations', desc: 'Scheduled jobs and workflows that run real actions on your PC.', icon: 'nav.automations' as AppIconName, accent: 'from-cyan-400 to-blue-500' },
  { id: 'documents', title: 'Files', desc: 'Browse, open, edit and manage files without leaving the OS.', icon: 'nav.files' as AppIconName, accent: 'from-emerald-400 to-teal-500' },
  { id: 'terminal', title: 'Terminal', desc: 'A full terminal — Infinite AI can run and explain commands too.', icon: 'nav.terminal' as AppIconName, accent: 'from-zinc-600 to-zinc-800' },
  { id: 'bots', title: 'Bots', desc: 'A fleet of agents that can work as a crew — even paired models.', icon: 'nav.agents' as AppIconName, accent: 'from-amber-400 to-orange-500' },
  { id: 'memory', title: 'Memory', desc: 'A brain that remembers preferences, projects and learnings.', icon: 'nav.memory' as AppIconName, accent: 'from-fuchsia-400 to-pink-500' },
  { id: 'messaging', title: 'Messaging', desc: 'Reach phone, Telegram and WhatsApp from one inbox.', icon: 'home.chat' as AppIconName, accent: 'from-lime-400 to-emerald-500' },
  { id: 'canvas', title: 'Canvas', desc: 'Visual workflows that persist locally and run real actions.', icon: 'home.canvas' as AppIconName, accent: 'from-pink-500 to-rose-500' },
  { id: 'artifacts', title: 'Artifacts', desc: 'Charts, documents, builds — every AI creation in one home.', icon: 'tab.document' as AppIconName, accent: 'from-indigo-400 to-violet-500' },
  { id: 'workspace', title: 'Workspace', desc: 'Your working folder — files, code and tools in context.', icon: 'nav.workspace' as AppIconName, accent: 'from-teal-400 to-cyan-500' },
  { id: 'plugins', title: 'Plugins', desc: 'Extend the OS with new tools, models and capabilities.', icon: 'home.plugins' as AppIconName, accent: 'from-purple-400 to-fuchsia-500' },
  { id: 'business', title: 'Business', desc: 'Contacts, invoices, leads and deals in a personal CRM.', icon: 'home.business' as AppIconName, accent: 'from-violet-400 to-purple-500' },
  { id: 'creations', title: 'Creations', desc: 'Apps, websites, videos and images built from a prompt.', icon: 'tab.feature' as AppIconName, accent: 'from-orange-400 to-amber-500' },
  { id: 'knowledge', title: 'Knowledge', desc: 'Documents, PDFs and facts Infinite AI can learn from.', icon: 'nav.memory' as AppIconName, accent: 'from-blue-400 to-indigo-500' },
  { id: 'capabilities', title: 'Tools', desc: 'The 100+ tools Infinite AI can safely operate.', icon: 'nav.capabilities' as AppIconName, accent: 'from-cyan-500 to-sky-500' },
  { id: 'browser', title: 'Browser', desc: 'AI-driven browsing with full tab control.', icon: 'nav.capabilities' as AppIconName, accent: 'from-sky-400 to-indigo-400' },
];

const COMMANDS = [
  { text: '"Build me a website for…"', reacts: 'Scaffolds it live' },
  { text: '"Automate my morning"', reacts: 'Creates a workflow' },
  { text: '"Analyze this folder"', reacts: 'Reads & summarizes' },
  { text: '"Create a chart of…"', reacts: 'Renders a chart tab' },
  { text: '"Deploy this"', reacts: 'Ships to production' },
  { text: '"Send the invoice"', reacts: 'Handles paperwork' },
  { text: '"Create a quiz"', reacts: 'Builds a study tab' },
  { text: '"What\'s new?"', reacts: 'Explains OS changes' },
];

const STEPS = [
  { n: 1, title: 'Say hello', desc: 'Open a chat and type — Infinite AI answers like a colleague.' },
  { n: 2, title: 'Ask for anything', desc: 'Build, automate, analyze, deploy. If it can be done on your PC, describe it.' },
  { n: 3, title: 'Open tabs that work', desc: 'AI creations land as real, interactive tabs — apps, charts, dashboards.' },
  { n: 4, title: 'Automate the repeat', desc: 'Turn trusted actions into scheduled jobs or standing orders.' },
  { n: 5, title: 'Teach it your way', desc: 'Self-evolution learns your patterns the more you work.' },
];

export function InfiniteOverviewView({ onViewChange }: InfiniteOverviewViewProps) {
  const sessions = useChatStore((s) => s.sessions);
  const runs = useAgentsStore((s) => s.runs);
  const workflows = useAutomationStore((s) => s.workflows);
  const tabs = useAiTabsStore((s) => s.tabs);
  const [mouseX, setMouseX] = useState(0);
  const [mouseY, setMouseY] = useState(0);

  const stats = useMemo(() => ({
    sessions: sessions.length,
    agents: runs.filter((r) => r.status === 'running').length,
    automations: workflows.length,
    tabs: tabs.length,
  }), [sessions.length, runs, workflows.length, tabs.length]);

  useEffect(() => {
    const handleMouse = (e: MouseEvent) => {
      setMouseX(e.clientX / window.innerWidth);
      setMouseY(e.clientY / window.innerHeight);
    };
    window.addEventListener('mousemove', handleMouse, { passive: true });
    return () => window.removeEventListener('mousemove', handleMouse);
  }, []);

  const openView = useCallback((view: string) => onViewChange(view), [onViewChange]);

  return (
    <div className="flex-1 overflow-auto chat-scrollbar bg-[#09090c] animate-fade-in">
      {/* Immersive hero with particle field */}
      <section className="relative overflow-hidden">
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background: `
              radial-gradient(ellipse 80% 60% at ${50 + mouseX * 20}% ${40 + mouseY * 20}%, rgba(99,102,241,0.08) 0%, transparent 60%),
              radial-gradient(ellipse 60% 40% at ${30 + mouseX * 15}% ${60 + mouseY * 15}%, rgba(34,211,238,0.06) 0%, transparent 50%),
              radial-gradient(ellipse 50% 50% at ${70 + mouseX * 10}% ${30 + mouseY * 10}%, rgba(236,72,153,0.05) 0%, transparent 50%)
            `,
          }}
        />
        <div className="absolute inset-0 pointer-events-none opacity-[0.03]" style={{
          backgroundImage: `radial-gradient(circle, rgba(255,255,255,0.5) 1px, transparent 1px)`,
          backgroundSize: '32px 32px',
          transform: `translate(${mouseX * -20}px, ${mouseY * -20}px)`,
        }} />

        <div className="relative mx-auto max-w-[1200px] px-6 lg:px-8 py-12 lg:py-20">
          {/* Floating particles */}
          <div className="absolute inset-0 overflow-hidden pointer-events-none">
            {Array.from({ length: 30 }).map((_, i) => (
              <div
                key={i}
                className="absolute rounded-full"
                style={{
                  left: `${(i * 137.5) % 100}%`,
                  top: `${(i * 89.3) % 100}%`,
                  width: `${2 + (i % 3)}px`,
                  height: `${2 + (i % 3)}px`,
                  background: `hsl(${260 + i * 12}, 70%, ${60 + i * 2}%)`,
                  opacity: 0.15 + Math.sin(i * 1.7) * 0.1,
                  animation: `particle-float ${3 + i * 0.4}s ease-in-out ${i * 0.2}s infinite`,
                }}
              />
            ))}
          </div>

          {/* Logo + Badge */}
          <div className="relative flex items-center gap-4 mb-8">
            <div className="relative">
              <div className="absolute inset-0 rounded-full bg-indigo-500/20 blur-xl animate-pulse" />
              <InfiniteLogo className="relative h-12 w-24" variant="spectrum" animated />
            </div>
            <div>
              <span className="inline-flex items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.04] px-3 py-1 text-[10px] font-medium tracking-wide text-zinc-300">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" /> Infinite OS v0.1.1
              </span>
              <p className="mt-1 text-[11px] text-zinc-500">Everything explained · One OS · One brain</p>
            </div>
          </div>

          {/* Main heading */}
          <h1 className="relative text-[40px] lg:text-[56px] font-semibold tracking-tight text-white leading-[1.05]">
            One OS. One brain.{' '}
            <span className="bg-gradient-to-r from-violet-300 via-cyan-300 to-fuchsia-300 bg-clip-text text-transparent animate-gradient-shift bg-[length:200%_200%]">
              Zero tab-hopping.
            </span>
          </h1>

          <p className="relative mt-4 max-w-[64ch] text-[15px] leading-6 text-zinc-400">
            <span className="text-zinc-200 font-medium">Infinite OS</span> is the application — an AI-powered Windows workspace.{' '}
            <span className="text-zinc-200 font-medium">Infinite AI</span> is the brain inside it. Together they let you chat, code, automate Windows, control the browser and PC, learn from documents, manage files, and build new features — all from one interface.
          </p>

          {/* CTA row */}
          <div className="relative mt-6 flex flex-wrap gap-3">
            <button onClick={() => openView('chats')} className="inline-flex items-center gap-2 rounded-xl bg-white px-5 py-2.5 text-[13px] font-semibold text-zinc-900 hover:bg-zinc-100 transition-all hover:shadow-lg hover:shadow-white/10">
              <AppIcon name="nav.chats" className="h-4 w-4" /> Start a chat
            </button>
            <button onClick={() => openView('capabilities')} className="inline-flex items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.06] px-5 py-2.5 text-[13px] font-medium text-white hover:bg-white/[0.09] transition-all">
              <AppIcon name="nav.capabilities" className="h-4 w-4" /> Explore tools
            </button>
            <button onClick={() => openView('plugins')} className="inline-flex items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.04] px-5 py-2.5 text-[13px] font-medium text-zinc-300 hover:bg-white/[0.07] hover:text-white transition-all">
              <AppIcon name="home.plugins" className="h-4 w-4" /> Plugins
            </button>
          </div>

          {/* Live stats bar */}
          <div className="relative mt-8 grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: 'Sessions', value: stats.sessions, hint: 'chats', color: '#8b5cf6' },
              { label: 'Active agents', value: stats.agents, hint: 'running', color: '#22d3ee' },
              { label: 'Automations', value: stats.automations, hint: 'jobs', color: '#10b981' },
              { label: 'Open tabs', value: stats.tabs, hint: 'workspace', color: '#ec4899' },
            ].map((s) => (
              <div key={s.label} className="group relative overflow-hidden rounded-xl border border-white/[0.07] bg-[#12131a]/80 backdrop-blur p-4 transition-all hover:border-white/[0.13] hover:bg-[#171821]">
                <div className="absolute inset-0 bg-gradient-to-br opacity-0 group-hover:opacity-[0.06] transition-opacity" style={{ background: `linear-gradient(135deg, ${s.color}, transparent)` }} />
                <div className="relative">
                  <div className="text-[10px] uppercase tracking-wide text-zinc-500">{s.label}</div>
                  <div className="flex items-baseline gap-1.5 mt-1">
                    <span className="text-[22px] font-semibold text-white">{s.value}</span>
                    <span className="text-[11px] text-zinc-500">{s.hint}</span>
                  </div>
                  <div className="mt-2 h-0.5 w-full overflow-hidden rounded-full bg-white/[0.06]">
                    <div className="h-full rounded-full bg-gradient-to-r transition-all duration-700" style={{ width: `${Math.min(100, (s.value / Math.max(10, s.value + 2)) * 100)}%`, background: `linear-gradient(90deg, ${s.color}, ${s.color}88)` }} />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Modules grid */}
      <section className="relative mx-auto max-w-[1200px] px-6 lg:px-8 py-12">
        <div className="flex items-center gap-3 mb-6">
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-white/[0.07] bg-white/[0.04]">
            <AppIcon name="home.canvas" className="h-4 w-4 text-violet-300" strokeWidth={1.7} gradient={BRAND_GRADIENT} />
          </span>
          <div>
            <h2 className="text-[18px] font-semibold text-white">Every module at your fingertips</h2>
            <p className="text-[12px] text-zinc-500">Click any module to open it instantly</p>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {FEATURES.map((f) => (
            <button
              key={f.id}
              onClick={() => openView(f.id)}
              className="group relative overflow-hidden rounded-2xl border border-white/[0.07] bg-[#12131a] p-5 text-left transition-all hover:border-white/[0.13] hover:bg-[#171821] focus:outline-none focus:ring-2 focus:ring-violet-500/30"
            >
              <div className={`pointer-events-none absolute inset-0 bg-gradient-to-br ${f.accent} opacity-0 group-hover:opacity-[0.07] transition-opacity`} />
              <span className={`inline-flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br ${f.accent} text-white shadow-lg`}>
                <AppIcon name={f.icon} className="h-5 w-5" />
              </span>
              <div className="mt-4 text-[14px] font-semibold text-white group-hover:text-zinc-100">{f.title}</div>
              <div className="mt-1.5 text-[12px] leading-4 text-zinc-500 group-hover:text-zinc-400">{f.desc}</div>
              <div className="mt-3 inline-flex items-center gap-1 text-[11px] text-zinc-600 group-hover:text-violet-400 transition-colors">
                Open → <span className="inline-block transition-transform group-hover:translate-x-0.5">→</span>
              </div>
            </button>
          ))}
        </div>
      </section>

      {/* How it works + Commands */}
      <section className="relative mx-auto max-w-[1200px] px-6 lg:px-8 py-12">
        <div className="grid gap-8 lg:grid-cols-[1fr_1fr]">
          {/* Steps */}
          <div>
            <div className="flex items-center gap-3 mb-6">
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-white/[0.07] bg-white/[0.04]">
                <AppIcon name="home.learn" className="h-4 w-4 text-cyan-300" strokeWidth={1.7} gradient={BRAND_GRADIENT} />
              </span>
              <div>
                <h2 className="text-[18px] font-semibold text-white">Get started in 5 steps</h2>
                <p className="text-[12px] text-zinc-500">From zero to automating</p>
              </div>
            </div>
            <div className="space-y-3">
              {STEPS.map((step) => (
                <div key={step.n} className="group relative flex gap-4 rounded-xl border border-white/[0.05] bg-[#12131a]/60 p-4 hover:border-white/[0.1] hover:bg-[#171821]/60 transition-colors">
                  <span className="inline-flex h-7 min-w-7 items-center justify-center rounded-full bg-gradient-to-br from-violet-500 to-cyan-500 px-1.5 text-[11px] font-bold text-white shrink-0">{step.n}</span>
                  <div>
                    <div className="text-[13px] font-semibold text-white group-hover:text-zinc-100">{step.title}</div>
                    <div className="mt-0.5 text-[12px] leading-4 text-zinc-500">{step.desc}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Commands */}
          <div>
            <div className="flex items-center gap-3 mb-6">
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-white/[0.07] bg-white/[0.04]">
                <AppIcon name="action.build" className="h-4 w-4 text-amber-300" strokeWidth={1.7} gradient={BRAND_GRADIENT} />
              </span>
              <div>
                <h2 className="text-[18px] font-semibold text-white">Just say it</h2>
                <p className="text-[12px] text-zinc-500">Prompt → result</p>
              </div>
            </div>
            <div className="space-y-2">
              {COMMANDS.map((c) => (
                <div key={c.text} className="flex items-center justify-between gap-3 rounded-xl border border-white/[0.05] bg-[#12131a]/60 px-4 py-3 hover:border-white/[0.09] hover:bg-[#171821]/60 transition-colors">
                  <span className="text-[12px] font-medium text-zinc-200">{c.text}</span>
                  <span className="hidden shrink-0 rounded-full bg-white/[0.05] px-2 py-0.5 text-[10px] text-zinc-500 sm:inline">{c.reacts}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Keyboard shortcuts */}
      <section className="relative mx-auto max-w-[1200px] px-6 lg:px-8 py-12">
        <div className="flex items-center gap-3 mb-6">
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-white/[0.07] bg-white/[0.04]">
            <AppIcon name="topbar.engine" className="h-4 w-4 text-emerald-300" strokeWidth={1.7} gradient={BRAND_GRADIENT} />
          </span>
          <div>
            <h2 className="text-[18px] font-semibold text-white">Keyboard shortcuts</h2>
            <p className="text-[12px] text-zinc-500">Do more, click less</p>
          </div>
        </div>
        <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
          <div className="rounded-2xl border border-white/[0.07] bg-[#12131a] p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-[13px] font-semibold text-white">Global shortcuts</h3>
              <span className="text-[11px] text-zinc-600">⌘ or Ctrl</span>
            </div>
            <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2.5">
              {[
                { keys: '⌘ K', label: 'Command palette — jump anywhere' },
                { keys: '⌘ N', label: 'New chat / task' },
                { keys: '⌘ `', label: 'Terminal' },
                { keys: '⌘ B', label: 'Toggle sidebar' },
                { keys: '⌘ .', label: 'Activity panel' },
                { keys: '⌘ ⇧ Y', label: 'Quick capture a thought' },
                { keys: '⌘ S', label: 'Save current work' },
                { keys: 'Esc', label: 'Close dialogs / stop' },
              ].map((s) => (
                <div key={s.keys} className="contents">
                  <span className="inline-flex items-center rounded-lg border border-white/[0.08] bg-white/[0.04] px-2 py-1 font-mono text-[10px] text-zinc-200">{s.keys}</span>
                  <span className="self-center text-[12px] text-zinc-400">{s.label}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="rounded-2xl border border-white/[0.07] bg-[#12131a] p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-[13px] font-semibold text-white">What makes this the best</h3>
              <span className="text-[11px] text-zinc-600">Core design</span>
            </div>
            <div className="space-y-3">
              {[
                { title: 'All-in-one, not tab hell', desc: 'Chat, code, files, terminal, browser + PC automation in one native app.' },
                { title: 'Keyboard-first, instant', desc: '⌘K palette + idle-prefetched views. Startup in ~270ms.' },
                { title: 'Local-first & private', desc: 'Ollama + local models, encrypted store, Netflix-style profile isolation.' },
                { title: 'Build, don\'t configure', desc: 'App Builder, Website Builder, Canvas, Automations — ship from a prompt.' },
              ].map((b) => (
                <div key={b.title} className="rounded-lg border border-white/[0.05] bg-white/[0.02] px-3 py-2.5">
                  <div className="text-[12px] font-semibold text-white">{b.title}</div>
                  <div className="mt-0.5 text-[11px] leading-4 text-zinc-500">{b.desc}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Privacy section */}
      <section className="relative mx-auto max-w-[1200px] px-6 lg:px-8 py-12">
        <div className="rounded-2xl border border-white/[0.07] bg-gradient-to-br from-[#0f0f16] via-[#0d1022] to-[#0a0a12] p-6 lg:p-8 overflow-hidden">
          <div className="pointer-events-none absolute -right-20 -top-20 h-60 w-60 rounded-full bg-violet-500/[0.08] blur-[60px]" />
          <div className="pointer-events-none absolute -bottom-16 -left-16 h-48 w-48 rounded-full bg-cyan-500/[0.06] blur-[50px]" />
          <div className="relative flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="flex items-center gap-3 mb-3">
                <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-white/[0.07] bg-white/[0.04]">
                  <AppIcon name="home.standing-orders" className="h-4 w-4 text-emerald-300" strokeWidth={1.7} gradient={BRAND_GRADIENT} />
                </span>
                <h2 className="text-[22px] font-semibold text-white">Your data stays yours</h2>
              </div>
              <p className="text-[13px] leading-5 text-zinc-400 max-w-[50ch]">Infinite OS is source-available and local-first. Nothing runs without explicit approval, and your workspace is encrypted and isolated.</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {[
                { title: 'Local-first', desc: 'Ollama + local models. Work stays on your PC.' },
                { title: 'Encrypted store', desc: 'Sessions, memory and secrets encrypted locally.' },
                { title: 'Profile isolation', desc: 'Netflix-style separate accounts keep workspaces apart.' },
                { title: 'You stay in control', desc: 'Nothing runs without explicit approval.' },
              ].map((p) => (
                <div key={p.title} className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3 hover:border-white/[0.1] transition-colors">
                  <div className="text-[12px] font-semibold text-white">{p.title}</div>
                  <div className="mt-0.5 text-[11px] leading-4 text-zinc-500">{p.desc}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <div className="relative mx-auto max-w-[1200px] px-6 lg:px-8 py-8">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/[0.05] bg-white/[0.02] px-5 py-4">
          <span className="text-[11px] text-zinc-600">Infinite OS v0.1.1 · Source-available community product</span>
          <div className="flex gap-2">
            <button onClick={() => openView('home')} className="rounded-lg border border-white/[0.08] bg-white/[0.05] px-3 py-1.5 text-[11px] font-medium text-zinc-200 hover:bg-white/[0.08]">Power Center</button>
            <button onClick={() => openView('capabilities')} className="rounded-lg border border-white/[0.08] bg-white/[0.05] px-3 py-1.5 text-[11px] font-medium text-zinc-200 hover:bg-white/[0.08]">Tools</button>
            <button onClick={() => openView('settings')} className="rounded-lg bg-white px-3 py-1.5 text-[11px] font-semibold text-zinc-900 hover:bg-zinc-100">Settings</button>
          </div>
        </div>
      </div>
    </div>
  );
}
