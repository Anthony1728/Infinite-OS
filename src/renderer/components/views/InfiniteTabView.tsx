import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useChatStore } from '../../stores/chat';
import { useAgentsStore } from '../../stores/agents';
import { useAutomationStore } from '../../stores/automation';
import { useAiTabsStore } from '../../stores/aiTabs';
import { AppIcon, BRAND_GRADIENT, type AppIconName } from '../brand/AppIcon';
import { InfiniteLogo } from '../brand/InfiniteLogo';

interface InfiniteTabViewProps {
  onViewChange: (view: string) => void;
}

type Category = 'think' | 'build' | 'automate' | 'control' | 'remember' | 'connect';

interface Capability {
  id: string;
  title: string;
  desc: string;
  view: string;
  icon: AppIconName;
  category: Category;
}

const CATEGORIES: { id: Category | 'all'; label: string; hint: string }[] = [
  { id: 'all', label: 'Everything', hint: 'Every module in the OS' },
  { id: 'think', label: 'Think', hint: 'Chat, research, reasoning' },
  { id: 'build', label: 'Build', hint: 'Apps, sites, documents' },
  { id: 'automate', label: 'Automate', hint: 'Jobs that run themselves' },
  { id: 'control', label: 'Control', hint: 'Files, terminal, browser, PC' },
  { id: 'remember', label: 'Remember', hint: 'Memory, knowledge, notes' },
  { id: 'connect', label: 'Connect', hint: 'People, cloud, business' },
];

const CAPABILITIES: Capability[] = [
  { id: 'chats', title: 'Chats', desc: 'Talk to Infinite AI in plain language — it answers, writes code and plans work.', view: 'chats', icon: 'nav.chats', category: 'think' },
  { id: 'research', title: 'Research', desc: 'Deep multi-source research mode with citations and summaries.', view: 'research', icon: 'agent.researcher', category: 'think' },
  { id: 'voice', title: 'Voice', desc: 'Speak your intent, hear the answer — full hands-free conversation.', view: 'voice', icon: 'nav.voice', category: 'think' },
  { id: 'guide', title: 'Guide', desc: 'The manual: what each module does and how the OS fits together.', view: 'guide', icon: 'home.learn', category: 'think' },
  { id: 'video', title: 'Video', desc: 'Generate and process video from a prompt or a file.', view: 'video', icon: 'tab.video', category: 'think' },

  { id: 'app-builder', title: 'App Builder', desc: 'Describe an app, get a working one — scaffolded, run and editable.', view: 'app-builder', icon: 'action.build', category: 'build' },
  { id: 'website-builder', title: 'Website Builder', desc: 'Full sites from a prompt, previewed and deployable in one click.', view: 'website-builder', icon: 'home.code', category: 'build' },
  { id: 'canvas', title: 'Canvas', desc: 'A visual board where AI-built flows live and keep running.', view: 'canvas', icon: 'home.canvas', category: 'build' },
  { id: 'artifacts', title: 'Artifacts', desc: 'Charts, documents, dashboards and builds — every creation in one home.', view: 'artifacts', icon: 'tab.document', category: 'build' },
  { id: 'creations', title: 'AI Creations', desc: 'The gallery of everything Infinite AI has made for you.', view: 'creations', icon: 'tab.feature', category: 'build' },
  { id: 'spell', title: 'Spell Forge', desc: 'Writing studio: drafts, grammar, tone and long-form editing.', view: 'spell', icon: 'nav.spell', category: 'build' },
  { id: 'board', title: 'Board', desc: 'Kanban over your real projects and tasks — drag, ship, repeat.', view: 'board', icon: 'nav.projects', category: 'build' },
  { id: 'projects', title: 'Projects', desc: 'Scaffold and organise multi-file work with a persistent workspace.', view: 'projects', icon: 'nav.projects', category: 'build' },

  { id: 'automations', title: 'Automations', desc: 'Scheduled jobs that run real actions on your PC — unattended.', view: 'automations', icon: 'nav.automations', category: 'automate' },
  { id: 'standing-orders', title: 'Standing Orders', desc: 'Rules that fire when conditions match, forever, until you stop them.', view: 'standing-orders', icon: 'home.standing-orders', category: 'automate' },
  { id: 'replay', title: 'Task Replay', desc: 'Record what you did once, replay it exactly whenever you want.', view: 'replay', icon: 'automation.once', category: 'automate' },
  { id: 'bots', title: 'Bots & Crews', desc: 'A fleet of agents that work as a team — coder, researcher, analyst.', view: 'bots', icon: 'nav.agents', category: 'automate' },
  { id: 'activity', title: 'Activity', desc: 'Watch every run, tool call and permission decision as it happens.', view: 'activity', icon: 'automation.pulse', category: 'automate' },

  { id: 'documents', title: 'File Explorer', desc: 'Browse, open, edit and organise files without leaving the OS.', view: 'documents', icon: 'nav.files', category: 'control' },
  { id: 'terminal', title: 'Terminal', desc: 'A real shell — Infinite AI runs commands and explains every one.', view: 'terminal', icon: 'nav.terminal', category: 'control' },
  { id: 'browser', title: 'Browser Control', desc: 'AI-driven browsing: navigate, click, fill, scrape — with a live view.', view: 'browser', icon: 'agent.browser', category: 'control' },
  { id: 'computer', title: 'PC Control', desc: 'Mouse, keyboard and windows — the agent operates the desktop itself.', view: 'computer', icon: 'home.orchestrator', category: 'control' },
  { id: 'workspace', title: 'Workspace', desc: 'Your working folder: files, code and tools gathered in context.', view: 'workspace', icon: 'nav.workspace', category: 'control' },
  { id: 'testing', title: 'Testing', desc: 'Run suites and let the agent fix what breaks, then prove it green.', view: 'testing', icon: 'automation.tool', category: 'control' },
  { id: 'deploy', title: 'Deploy', desc: 'Ship to GitHub, the web or a package straight from a prompt.', view: 'deploy', icon: 'home.cloud', category: 'control' },

  { id: 'memory', title: 'Memory', desc: 'The brain remembers preferences, projects and everything learned.', view: 'memory', icon: 'nav.memory', category: 'remember' },
  { id: 'active-memory', title: 'Active Memory', desc: 'What Infinite is holding in mind right now — inspect and edit it.', view: 'active-memory', icon: 'home.memory', category: 'remember' },
  { id: 'knowledge', title: 'Knowledge', desc: 'Documents, PDFs and facts the AI learns from and cites back.', view: 'knowledge', icon: 'memory.document', category: 'remember' },
  { id: 'journal', title: 'Journal & Notes', desc: 'Quick capture that feeds straight into long-term memory.', view: 'journal', icon: 'memory.note', category: 'remember' },
  { id: 'archive', title: 'Archive', desc: 'Every finished conversation, searchable and restorable.', view: 'archive', icon: 'tab.summary', category: 'remember' },

  { id: 'messaging', title: 'Messaging', desc: 'Phone, Telegram and WhatsApp in one inbox — both directions.', view: 'messaging', icon: 'home.chat', category: 'connect' },
  { id: 'callcenter', title: 'Call Center', desc: 'Inbound and outbound calls handled by voice agents.', view: 'callcenter', icon: 'action.phone', category: 'connect' },
  { id: 'business', title: 'Business OS', desc: 'Contacts, leads, invoices and deals — a full personal CRM.', view: 'business', icon: 'home.business', category: 'connect' },
  { id: 'cloud', title: 'Cloud Sync', desc: 'Keep sessions, memory and settings in sync across machines.', view: 'cloud', icon: 'home.cloud', category: 'connect' },
  { id: 'plugins', title: 'Plugin Store', desc: 'Install new tools, models and capabilities as you need them.', view: 'plugins', icon: 'home.plugins', category: 'connect' },
  { id: 'capabilities', title: 'Tools & Skills', desc: 'The 100+ tools Infinite AI can operate — each gated by permission.', view: 'capabilities', icon: 'nav.capabilities', category: 'connect' },
  { id: 'enterprise', title: 'Enterprise', desc: 'Teams, roles and policies for running Infinite OS at scale.', view: 'enterprise', icon: 'agent.ops', category: 'connect' },
];

const FLOW = [
  { n: 1, title: 'You ask', desc: 'Type or speak — no syntax, no config, no commands to memorise.', tag: 'Interface' },
  { n: 2, title: 'Infinite AI plans', desc: 'The brain breaks the request into ordered steps and picks the tools.', tag: 'Brain' },
  { n: 3, title: 'Permission gate', desc: 'Anything touching your PC, files or accounts asks first. Always.', tag: 'Safety' },
  { n: 4, title: 'Infinite OS acts', desc: 'The app executes: shell, browser, files, APIs — with live output.', tag: 'Hands' },
  { n: 5, title: 'You watch it work', desc: 'Every tool call streams into the activity panel as it happens.', tag: 'Visible' },
  { n: 6, title: 'It remembers', desc: 'Outcomes, preferences and patterns land in memory for next time.', tag: 'Learning' },
];

const LAYERS = [
  { name: 'Interface', color: '#8b5cf6', items: ['Sidebar & tabs', 'Command palette (Ctrl+K)', 'Power Center', 'Chat, canvas, terminal'] },
  { name: 'Infinite AI — the brain', color: '#22d3ee', items: ['Reasoning & planning', 'Agent runtime', 'Memory + self-evolution', 'Model routing (local or cloud)'] },
  { name: 'Tool layer', color: '#34d399', items: ['100+ tools & skills', 'Permission enforcement', 'Scheduling & standing orders', 'Plugin marketplace'] },
  { name: 'Your machine', color: '#f472b6', items: ['Windows shell & files', 'Browser & desktop control', 'Local encrypted storage', 'Cloud sync (optional)'] },
];

const FAQ = [
  { q: 'What is the difference between Infinite OS and Infinite AI?', a: 'Infinite OS is the application — the window, the sidebar, the tabs, the modules, the file explorer, the terminal. Infinite AI is the brain inside it: the reasoning, planning, memory and tool-use engine. You only ever talk to the brain; the OS is what gives it hands.' },
  { q: 'Does everything run locally?', a: 'Local-first. Models can run through Ollama on your own machine, sessions and memory are encrypted on disk, and cloud sync plus cloud models are strictly opt-in. Nothing leaves the machine unless you turn it on.' },
  { q: 'Will it do things without asking?', a: 'No. Every capability that touches your files, shell, browser or accounts goes through an explicit permission gate. You approve once or every time — your choice, per tool.' },
  { q: 'Which models can it use?', a: 'Whatever you connect: local models through Ollama, or cloud providers through OpenRouter and other APIs. You can swap the active model mid-conversation and the OS keeps the same memory and tools.' },
  { q: 'How does memory actually work?', a: 'Three layers. Chat memory keeps the current conversation coherent. Active Memory holds what is in mind right now, editable by you. Long-term memory stores durable facts, preferences and project knowledge that any future session can recall.' },
  { q: 'Can it build real software, or just talk about it?', a: 'Real software. App Builder, Website Builder, Canvas, Deploy and the Terminal all operate on your actual filesystem — scaffolding, editing, running, testing and shipping what it writes.' },
  { q: 'Is this free?', a: 'Yes. Infinite OS is an open-source, source-available community product under MIT. You bring your own model keys or run local models — there is no subscription to the OS itself.' },
  { q: 'What should I try first?', a: 'Press Ctrl+K and type what you want, or open Chats and describe a task in a sentence. Ask it to analyse a folder, build a page, or automate something you repeat daily.' },
];

const SHORTCUTS = [
  { keys: 'Ctrl K', label: 'Command palette — jump anywhere' },
  { keys: 'Ctrl N', label: 'New chat / new task' },
  { keys: 'Ctrl `', label: 'Terminal' },
  { keys: 'Ctrl B', label: 'Toggle sidebar' },
  { keys: 'Ctrl ,', label: 'Settings' },
  { keys: 'Ctrl ⇧ Y', label: 'Quick capture a thought' },
  { keys: 'Esc', label: 'Close dialog / stop run' },
];

function SectionHead({ icon, kicker, title, sub }: { icon: AppIconName; kicker: string; title: string; sub: string }) {
  return (
    <div className="mb-6 flex items-start gap-3">
      <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/[0.07] bg-white/[0.04]">
        <AppIcon name={icon} className="h-4 w-4" strokeWidth={1.7} gradient={BRAND_GRADIENT} />
      </span>
      <div className="min-w-0">
        <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-violet-400/80">{kicker}</div>
        <h2 className="mt-0.5 text-[20px] font-semibold leading-tight text-white">{title}</h2>
        <p className="mt-1 text-[12.5px] leading-5 text-zinc-500">{sub}</p>
      </div>
    </div>
  );
}

export function InfiniteTabView({ onViewChange }: InfiniteTabViewProps) {
  const sessions = useChatStore((s) => s.sessions);
  const runs = useAgentsStore((s) => s.runs);
  const workflows = useAutomationStore((s) => s.workflows);
  const tabs = useAiTabsStore((s) => s.tabs);

  const scrollRef = useRef<HTMLDivElement>(null);
  const [activeSection, setActiveSection] = useState('hero');
  const [filter, setFilter] = useState<Category | 'all'>('all');
  const [openFaq, setOpenFaq] = useState<number | null>(0);
  const [pointer, setPointer] = useState({ x: 0.5, y: 0.5 });

  const stats = useMemo(() => ({
    sessions: sessions.length,
    agents: runs.filter((r) => r.status === 'running').length,
    automations: workflows.length,
    tabs: tabs.length,
    modules: CAPABILITIES.length,
  }), [sessions.length, runs, workflows.length, tabs.length]);

  const visible = useMemo(
    () => (filter === 'all' ? CAPABILITIES : CAPABILITIES.filter((c) => c.category === filter)),
    [filter],
  );

  const open = useCallback((view: string) => onViewChange(view), [onViewChange]);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      setPointer({ x: e.clientX / window.innerWidth, y: e.clientY / window.innerHeight });
    };
    window.addEventListener('mousemove', onMove, { passive: true });
    return () => window.removeEventListener('mousemove', onMove);
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ids = ['duo', 'flow', 'atlas', 'stack', 'faq', 'start'];
    const onScroll = () => {
      const top = el.scrollTop + 140;
      let current = 'hero';
      for (const id of ids) {
        const node = document.getElementById(id);
        if (node && node.offsetTop <= top) current = id;
      }
      setActiveSection(current);
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  const goTo = (id: string) => {
    const node = document.getElementById(id);
    const el = scrollRef.current;
    if (node && el) el.scrollTo({ top: node.offsetTop - 16, behavior: 'smooth' });
  };

  const NAV = [
    { id: 'duo', label: 'What it is' },
    { id: 'flow', label: 'How it works' },
    { id: 'atlas', label: 'Everything' },
    { id: 'stack', label: 'Under the hood' },
    { id: 'faq', label: 'Questions' },
    { id: 'start', label: 'Start' },
  ];

  return (
    <div ref={scrollRef} className="chat-scrollbar flex-1 overflow-auto bg-[#09090c] animate-fade-in">
      {/* ── Hero ─────────────────────────────────────────────── */}
      <section id="hero" className="relative overflow-hidden border-b border-white/[0.05]">
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background: `
              radial-gradient(ellipse 70% 55% at ${50 + (pointer.x - 0.5) * 22}% ${35 + (pointer.y - 0.5) * 18}%, rgba(139,92,246,0.16) 0%, transparent 62%),
              radial-gradient(ellipse 55% 45% at ${26 + (pointer.x - 0.5) * 14}% ${70 + (pointer.y - 0.5) * 12}%, rgba(34,211,238,0.11) 0%, transparent 58%),
              radial-gradient(ellipse 45% 45% at ${78 + (pointer.x - 0.5) * 10}% ${22 + (pointer.y - 0.5) * 10}%, rgba(236,72,153,0.09) 0%, transparent 55%)`,
          }}
        />
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.035]"
          style={{
            backgroundImage: 'radial-gradient(circle, rgba(255,255,255,0.6) 1px, transparent 1px)',
            backgroundSize: '30px 30px',
            transform: `translate(${(pointer.x - 0.5) * -26}px, ${(pointer.y - 0.5) * -18}px)`,
          }}
        />
        {Array.from({ length: 26 }).map((_, i) => (
          <span
            key={i}
            className="pointer-events-none absolute rounded-full"
            style={{
              left: `${(i * 143.7) % 100}%`,
              top: `${(i * 91.3) % 100}%`,
              width: `${2 + (i % 3)}px`,
              height: `${2 + (i % 3)}px`,
              background: `hsl(${255 + i * 11}, 75%, ${62 + (i % 4) * 4}%)`,
              opacity: 0.16 + Math.sin(i * 1.3) * 0.08,
              animation: `particle-float ${3 + i * 0.35}s ease-in-out ${i * 0.18}s infinite`,
            }}
          />
        ))}

        <div className="relative mx-auto max-w-[1160px] px-6 lg:px-8 py-11 lg:py-16">
          <div className="flex flex-wrap items-center gap-3">
            <span className="relative inline-flex items-center">
              <span className="absolute inset-0 rounded-full bg-violet-500/25 blur-lg animate-pulse" />
              <InfiniteLogo className="relative h-10 w-20" variant="spectrum" animated />
            </span>
            <span className="inline-flex items-center gap-2 rounded-full border border-white/[0.09] bg-white/[0.05] px-3 py-1 text-[10.5px] font-medium tracking-wide text-zinc-300">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" /> The Infinite Tab
            </span>
            <span className="hidden rounded-full border border-white/[0.07] bg-white/[0.03] px-3 py-1 text-[10.5px] text-zinc-500 sm:inline">
              v0.1.1 · MIT · local-first
            </span>
          </div>

          <h1 className="relative mt-6 max-w-[22ch] text-[38px] lg:text-[54px] font-semibold leading-[1.04] tracking-tight text-white">
            Everything Infinite,{' '}
            <span className="bg-gradient-to-r from-violet-300 via-cyan-300 to-fuchsia-300 bg-clip-text text-transparent animate-gradient-shift bg-[length:200%_200%]">
              explained in one place.
            </span>
          </h1>

          <p className="relative mt-4 max-w-[70ch] text-[14.5px] leading-6 text-zinc-400">
            One tab that answers the only question that matters: <span className="text-zinc-200">what is this thing and how do I use it?</span>{' '}
            Scroll for the plain-English version of the OS, the brain inside it, the full module atlas, and what happens the moment you ask for something.
          </p>

          <div className="relative mt-6 flex flex-wrap gap-2.5">
            <button
              onClick={() => open('chats')}
              className="inline-flex items-center gap-2 rounded-xl bg-white px-5 py-2.5 text-[13px] font-semibold text-zinc-900 transition-all hover:bg-zinc-100 hover:shadow-lg hover:shadow-white/10"
            >
              <AppIcon name="nav.chats" className="h-4 w-4" /> Ask Infinite AI
            </button>
            <button
              onClick={() => open('capabilities')}
              className="inline-flex items-center gap-2 rounded-xl border border-white/[0.09] bg-white/[0.06] px-5 py-2.5 text-[13px] font-medium text-white transition-all hover:bg-white/[0.1]"
            >
              <AppIcon name="nav.capabilities" className="h-4 w-4" /> {stats.modules} modules
            </button>
            <button
              onClick={() => goTo('flow')}
              className="inline-flex items-center gap-2 rounded-xl border border-white/[0.07] bg-white/[0.04] px-5 py-2.5 text-[13px] font-medium text-zinc-300 transition-all hover:bg-white/[0.07] hover:text-white"
            >
              See how it works ↓
            </button>
          </div>

          <div className="relative mt-7 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { label: 'Conversations', value: stats.sessions, hint: 'stored', color: '#8b5cf6' },
              { label: 'Agents running', value: stats.agents, hint: 'live', color: '#22d3ee' },
              { label: 'Automations', value: stats.automations, hint: 'armed', color: '#34d399' },
              { label: 'Open tabs', value: stats.tabs, hint: 'AI-built', color: '#f472b6' },
            ].map((s) => (
              <div
                key={s.label}
                className="group relative overflow-hidden rounded-xl border border-white/[0.07] bg-[#12131a]/85 p-3.5 backdrop-blur transition-all hover:border-white/[0.14] hover:bg-[#171821]"
              >
                <div
                  className="absolute inset-0 opacity-0 transition-opacity group-hover:opacity-[0.07]"
                  style={{ background: `linear-gradient(135deg, ${s.color}, transparent)` }}
                />
                <div className="relative text-[9.5px] uppercase tracking-[0.13em] text-zinc-500">{s.label}</div>
                <div className="relative mt-1 flex items-baseline gap-1.5">
                  <span className="text-[22px] font-semibold leading-none text-white">{s.value}</span>
                  <span className="text-[10.5px] text-zinc-500">{s.hint}</span>
                </div>
                <div className="relative mt-2.5 h-px w-full overflow-hidden rounded-full bg-white/[0.07]">
                  <div
                    className="h-full rounded-full transition-all duration-700"
                    style={{
                      width: `${Math.min(100, ((s.value + 1) / Math.max(6, s.value + 4)) * 100)}%`,
                      background: `linear-gradient(90deg, ${s.color}, ${s.color}66)`,
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Sticky section rail */}
        <div className="relative border-t border-white/[0.05] bg-[#0b0b0f]/85 backdrop-blur-md">
          <div className="mx-auto flex max-w-[1160px] gap-1.5 overflow-x-auto px-6 py-2.5 lg:px-8 chat-scrollbar">
            {NAV.map((n) => (
              <button
                key={n.id}
                onClick={() => goTo(n.id)}
                className={`shrink-0 rounded-lg px-3 py-1.5 text-[11.5px] font-medium transition-colors ${
                  activeSection === n.id
                    ? 'bg-white/[0.1] text-white'
                    : 'text-zinc-500 hover:bg-white/[0.05] hover:text-zinc-200'
                }`}
              >
                {n.label}
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* ── Two halves ───────────────────────────────────────── */}
      <section id="duo" className="mx-auto max-w-[1160px] px-6 lg:px-8 py-12">
        <SectionHead
          icon="home.orchestrator"
          kicker="The core idea"
          title="Two halves. One machine."
          sub="Get this straight and the rest of the OS makes sense."
        />

        <div className="grid gap-4 lg:grid-cols-[1fr_auto_1fr] lg:items-stretch">
          <div className="group relative overflow-hidden rounded-2xl border border-white/[0.08] bg-[#12131a] p-6 transition-colors hover:border-violet-400/30">
            <div className="absolute -right-14 -top-14 h-44 w-44 rounded-full bg-violet-500/10 blur-[50px]" />
            <div className="relative">
              <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500 to-indigo-500 text-white shadow-lg shadow-violet-500/20">
                <AppIcon name="home.orchestrator" className="h-5 w-5" />
              </span>
              <div className="mt-4 text-[11px] font-semibold uppercase tracking-[0.15em] text-violet-300">The application</div>
              <h3 className="mt-1 text-[24px] font-semibold text-white">Infinite OS</h3>
              <p className="mt-2 text-[13px] leading-6 text-zinc-400">
                The window you are looking at. Sidebar, tabs, chat, files, terminal, canvas, automations, settings —
                every surface and module you click. It is the hands, the storage and the permission system.
              </p>
              <ul className="mt-4 space-y-2">
                {['Modular views — each capability is a first-class tab', 'Real access to your filesystem, shell and browser', 'Encrypted local store + optional cloud sync', 'Permission gate in front of every sensitive action'].map((t) => (
                  <li key={t} className="flex items-start gap-2 text-[12.5px] leading-5 text-zinc-400">
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-violet-400" />
                    {t}
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div className="relative hidden w-16 lg:block">
            <div className="absolute left-1/2 top-0 h-full w-px -translate-x-1/2 bg-gradient-to-b from-transparent via-white/15 to-transparent" />
            <div className="absolute left-1/2 top-1/2 flex h-9 w-9 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-white/15 bg-[#0f0f16]">
              <span className="h-2 w-2 animate-ping rounded-full bg-cyan-400" />
            </div>
          </div>

          <div className="group relative overflow-hidden rounded-2xl border border-white/[0.08] bg-[#12131a] p-6 transition-colors hover:border-cyan-400/30">
            <div className="absolute -left-14 -top-14 h-44 w-44 rounded-full bg-cyan-500/10 blur-[50px]" />
            <div className="relative">
              <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-cyan-400 to-blue-500 text-white shadow-lg shadow-cyan-500/20">
                <AppIcon name="action.ai" className="h-5 w-5" />
              </span>
              <div className="mt-4 text-[11px] font-semibold uppercase tracking-[0.15em] text-cyan-300">The brain</div>
              <h3 className="mt-1 text-[24px] font-semibold text-white">Infinite AI</h3>
              <p className="mt-2 text-[13px] leading-6 text-zinc-400">
                The reasoning engine inside. It plans, chooses tools, runs the agent loop, remembers what matters
                and learns your patterns — then tells the OS what to do.
              </p>
              <ul className="mt-4 space-y-2">
                {['Reasoning + step-by-step planning before acting', '100+ tools: shell, browser, files, APIs, more', 'Three-layer memory: chat, active, long-term', 'Bring your own model — local Ollama or cloud'].map((t) => (
                  <li key={t} className="flex items-start gap-2 text-[12.5px] leading-5 text-zinc-400">
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-cyan-400" />
                    {t}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>

        <div className="mt-4 rounded-2xl border border-white/[0.07] bg-gradient-to-r from-[#101018] via-[#0d1220] to-[#101018] px-5 py-4 text-center">
          <p className="text-[13px] leading-6 text-zinc-400">
            <span className="font-medium text-white">You speak</span>
            <span className="mx-2 text-zinc-600">→</span>
            <span className="font-medium text-cyan-300">Infinite AI thinks</span>
            <span className="mx-2 text-zinc-600">→</span>
            <span className="font-medium text-violet-300">Infinite OS acts</span>
            <span className="mx-2 text-zinc-600">→</span>
            <span className="font-medium text-emerald-300">it remembers</span>
          </p>
        </div>
      </section>

      {/* ── Flow ─────────────────────────────────────────────── */}
      <section id="flow" className="border-y border-white/[0.05] bg-[#0b0b10]">
        <div className="mx-auto max-w-[1160px] px-6 lg:px-8 py-12">
          <SectionHead
            icon="automation.pulse"
            kicker="Anatomy of a request"
            title="How a thought becomes an action"
            sub="Six steps, every single time — whether you asked for a joke or a deployment."
          />
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {FLOW.map((s, i) => (
              <div
                key={s.n}
                className="group relative overflow-hidden rounded-2xl border border-white/[0.06] bg-[#12131a] p-5 transition-all hover:border-white/[0.13] hover:bg-[#171821]"
              >
                <div className="flex items-center justify-between">
                  <span className="inline-flex h-7 min-w-7 items-center justify-center rounded-full bg-gradient-to-br from-violet-500 to-cyan-500 px-2 text-[11px] font-bold text-white">
                    {s.n}
                  </span>
                  <span className="rounded-full border border-white/[0.08] bg-white/[0.04] px-2 py-0.5 text-[9.5px] uppercase tracking-[0.12em] text-zinc-500 group-hover:text-violet-300">
                    {s.tag}
                  </span>
                </div>
                <div className="mt-3.5 text-[14px] font-semibold text-white">{s.title}</div>
                <div className="mt-1.5 text-[12px] leading-5 text-zinc-500 group-hover:text-zinc-400">{s.desc}</div>
                {i < FLOW.length - 1 && (
                  <span className="absolute right-3 top-1/2 hidden -translate-y-1/2 text-[16px] text-white/10 lg:block">→</span>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Atlas ────────────────────────────────────────────── */}
      <section id="atlas" className="mx-auto max-w-[1160px] px-6 lg:px-8 py-12">
        <SectionHead
          icon="nav.capabilities"
          kicker="Module atlas"
          title="Everything it can do"
          sub="Filter by what you want to achieve — click any card to open it."
        />

        <div className="mb-5 flex flex-wrap gap-2">
          {CATEGORIES.map((c) => {
            const count = c.id === 'all' ? CAPABILITIES.length : CAPABILITIES.filter((x) => x.category === c.id).length;
            const active = filter === c.id;
            return (
              <button
                key={c.id}
                onClick={() => setFilter(c.id)}
                title={c.hint}
                className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-[12px] font-medium transition-all ${
                  active
                    ? 'border-violet-400/40 bg-violet-500/15 text-white'
                    : 'border-white/[0.07] bg-white/[0.03] text-zinc-500 hover:border-white/[0.13] hover:text-zinc-200'
                }`}
              >
                {c.label}
                <span className={`text-[10px] ${active ? 'text-violet-300' : 'text-zinc-600'}`}>{count}</span>
              </button>
            );
          })}
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map((c) => (
            <button
              key={c.id}
              onClick={() => open(c.view)}
              className="group relative overflow-hidden rounded-2xl border border-white/[0.06] bg-[#12131a] p-4 text-left transition-all hover:border-white/[0.14] hover:bg-[#171821] focus:outline-none focus:ring-2 focus:ring-violet-500/30"
            >
              <div className="pointer-events-none absolute -right-8 -top-8 h-24 w-24 rounded-full bg-violet-500/0 blur-2xl transition-all duration-500 group-hover:bg-violet-500/15" />
              <div className="relative flex items-start gap-3">
                <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.05] text-zinc-300 transition-colors group-hover:border-violet-400/40 group-hover:bg-violet-500/15 group-hover:text-white">
                  <AppIcon name={c.icon} className="h-4 w-4" strokeWidth={1.7} gradient={BRAND_GRADIENT} />
                </span>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[13.5px] font-semibold text-white">{c.title}</span>
                    <span className="text-[9.5px] uppercase tracking-[0.1em] text-zinc-600 transition-colors group-hover:text-violet-400">
                      {c.category}
                    </span>
                  </div>
                  <div className="mt-1 text-[11.5px] leading-[18px] text-zinc-500 group-hover:text-zinc-400">{c.desc}</div>
                </div>
              </div>
              <div className="relative mt-3 flex items-center gap-1 text-[10.5px] text-zinc-600 transition-colors group-hover:text-violet-400">
                Open <span className="transition-transform group-hover:translate-x-0.5">→</span>
              </div>
            </button>
          ))}
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3">
          <span className="text-[11.5px] text-zinc-500">
            Showing <span className="text-zinc-300">{visible.length}</span> of {CAPABILITIES.length} modules · more
            arrive through the Plugin Store and self-evolution.
          </span>
          <div className="flex gap-2">
            <button
              onClick={() => open('plugins')}
              className="rounded-lg border border-white/[0.08] bg-white/[0.05] px-3 py-1.5 text-[11px] font-medium text-zinc-200 transition-colors hover:bg-white/[0.09]"
            >
              Plugin Store
            </button>
            <button
              onClick={() => open('guide')}
              className="rounded-lg bg-white px-3 py-1.5 text-[11px] font-semibold text-zinc-900 transition-colors hover:bg-zinc-100"
            >
              Read the Guide
            </button>
          </div>
        </div>
      </section>

      {/* ── Stack ────────────────────────────────────────────── */}
      <section id="stack" className="border-y border-white/[0.05] bg-[#0b0b10]">
        <div className="mx-auto max-w-[1160px] px-6 lg:px-8 py-12">
          <SectionHead
            icon="topbar.engine"
            kicker="Under the hood"
            title="Four layers, no mystery"
            sub="From the pixel you click down to the machine it runs on."
          />
          <div className="relative space-y-3">
            <div className="pointer-events-none absolute left-[27px] top-4 bottom-4 hidden w-px bg-gradient-to-b from-violet-500/50 via-cyan-500/40 to-pink-500/40 sm:block" />
            {LAYERS.map((l, i) => (
              <div
                key={l.name}
                className="relative flex gap-4 rounded-2xl border border-white/[0.06] bg-[#12131a] p-5 transition-colors hover:border-white/[0.12]"
                style={{ marginLeft: `${i * 14}px` }}
              >
                <span
                  className="mt-0.5 hidden h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[10px] font-bold text-white sm:inline-flex"
                  style={{ borderColor: `${l.color}55`, background: `${l.color}22` }}
                >
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="h-2 w-2 rounded-full" style={{ background: l.color }} />
                    <h3 className="text-[14px] font-semibold text-white">{l.name}</h3>
                    <span className="text-[10px] uppercase tracking-[0.12em] text-zinc-600">layer {i + 1}</span>
                  </div>
                  <div className="mt-2.5 flex flex-wrap gap-1.5">
                    {l.items.map((it) => (
                      <span
                        key={it}
                        className="rounded-lg border border-white/[0.07] bg-white/[0.03] px-2.5 py-1 text-[11.5px] text-zinc-400"
                      >
                        {it}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── FAQ ──────────────────────────────────────────────── */}
      <section id="faq" className="mx-auto max-w-[1160px] px-6 lg:px-8 py-12">
        <SectionHead
          icon="home.learn"
          kicker="Straight answers"
          title="Questions people actually ask"
          sub="No marketing language — the honest version."
        />
        <div className="grid gap-4 lg:grid-cols-[1fr_320px] lg:items-start">
          <div className="space-y-2">
            {FAQ.map((f, i) => {
              const isOpen = openFaq === i;
              return (
                <div
                  key={f.q}
                  className={`overflow-hidden rounded-xl border transition-colors ${
                    isOpen ? 'border-violet-400/30 bg-[#14141d]' : 'border-white/[0.06] bg-[#12131a] hover:border-white/[0.12]'
                  }`}
                >
                  <button
                    onClick={() => setOpenFaq(isOpen ? null : i)}
                    className="flex w-full items-center justify-between gap-3 px-4 py-3.5 text-left"
                    aria-expanded={isOpen}
                  >
                    <span className="text-[13px] font-medium text-zinc-100">{f.q}</span>
                    <span
                      className={`shrink-0 text-zinc-500 transition-transform duration-200 ${isOpen ? 'rotate-45 text-violet-300' : ''}`}
                    >
                      <AppIcon name="action.add" className="h-4 w-4" />
                    </span>
                  </button>
                  <div
                    className="grid transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]"
                    style={{ gridTemplateRows: isOpen ? '1fr' : '0fr' }}
                  >
                    <div className="overflow-hidden">
                      <p className="px-4 pb-4 text-[12.5px] leading-6 text-zinc-400">{f.a}</p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="space-y-3">
            <div className="rounded-2xl border border-white/[0.07] bg-[#12131a] p-5">
              <div className="flex items-center justify-between">
                <h3 className="text-[13px] font-semibold text-white">Shortcuts</h3>
                <span className="text-[10.5px] text-zinc-600">Ctrl</span>
              </div>
              <div className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-2">
                {SHORTCUTS.map((s) => (
                  <div key={s.keys} className="contents">
                    <span className="inline-flex items-center rounded-md border border-white/[0.08] bg-white/[0.04] px-1.5 py-1 font-mono text-[10px] text-zinc-200">
                      {s.keys}
                    </span>
                    <span className="self-center text-[11.5px] text-zinc-500">{s.label}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-2xl border border-emerald-400/20 bg-emerald-400/[0.05] p-5">
              <div className="flex items-center gap-2 text-[12px] font-medium text-emerald-300">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" /> Privacy by default
              </div>
              <div className="mt-3 space-y-2">
                {[
                  ['Local-first', 'Ollama models, encrypted on-disk store.'],
                  ['Nothing silent', 'Sensitive actions always ask first.'],
                  ['Isolated profiles', 'Separate accounts, separate workspaces.'],
                  ['Opt-in cloud', 'Sync and cloud models only when you enable them.'],
                ].map(([t, d]) => (
                  <div key={t} className="rounded-lg border border-white/[0.05] bg-white/[0.02] px-3 py-2">
                    <div className="text-[11.5px] font-semibold text-white">{t}</div>
                    <div className="mt-0.5 text-[11px] leading-4 text-zinc-500">{d}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Start ────────────────────────────────────────────── */}
      <section id="start" className="border-t border-white/[0.05] bg-[#0b0b10]">
        <div className="mx-auto max-w-[1160px] px-6 lg:px-8 py-12">
          <SectionHead
            icon="action.launch"
            kicker="Three moves"
            title="Start here"
            sub="You do not need a tutorial. Pick one."
          />
          <div className="grid gap-3 md:grid-cols-3">
            {[
              { title: 'Just say it', desc: 'Open a chat and describe the task in one sentence. Infinite AI plans it, asks permission, then runs it.', cta: 'Open Chats', view: 'chats', icon: 'nav.chats' as AppIconName, color: 'from-violet-500 to-indigo-500' },
              { title: 'Automate the repeat', desc: 'Turn anything you do twice into a scheduled job or standing order and stop doing it manually.', cta: 'Automations', view: 'automations', icon: 'nav.automations' as AppIconName, color: 'from-cyan-400 to-blue-500' },
              { title: 'Build something', desc: 'Ask for an app, a site or a dashboard. It scaffolds, runs and shows up as a real tab.', cta: 'App Builder', view: 'app-builder', icon: 'action.build' as AppIconName, color: 'from-emerald-400 to-teal-500' },
            ].map((c) => (
              <div
                key={c.title}
                className="group relative overflow-hidden rounded-2xl border border-white/[0.07] bg-[#12131a] p-6 transition-all hover:border-white/[0.14] hover:bg-[#171821]"
              >
                <div className={`pointer-events-none absolute inset-0 bg-gradient-to-br ${c.color} opacity-0 transition-opacity group-hover:opacity-[0.06]`} />
                <div className="relative">
                  <span className={`inline-flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br ${c.color} text-white shadow-lg`}>
                    <AppIcon name={c.icon} className="h-5 w-5" />
                  </span>
                  <h3 className="mt-4 text-[15px] font-semibold text-white">{c.title}</h3>
                  <p className="mt-1.5 text-[12.5px] leading-5 text-zinc-500">{c.desc}</p>
                  <button
                    onClick={() => open(c.view)}
                    className="mt-4 inline-flex items-center gap-1.5 rounded-lg border border-white/[0.09] bg-white/[0.06] px-3.5 py-2 text-[12px] font-medium text-white transition-colors group-hover:bg-white/[0.1]"
                  >
                    {c.cta} <span className="transition-transform group-hover:translate-x-0.5">→</span>
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/[0.07] bg-gradient-to-r from-[#0f0f16] to-[#11101c] px-5 py-4">
            <div className="flex items-center gap-3">
              <InfiniteLogo className="h-6 w-12" animated />
              <div>
                <div className="text-[12.5px] font-semibold text-white">Infinite OS v0.1.1 — the app</div>
                <div className="text-[11px] text-zinc-500">Infinite AI — the brain inside. MIT licensed, source available.</div>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => open('settings')}
                className="rounded-lg border border-white/[0.08] bg-white/[0.05] px-3 py-1.5 text-[11.5px] font-medium text-zinc-200 transition-colors hover:bg-white/[0.09]"
              >
                Settings
              </button>
              <button
                onClick={() => open('overview')}
                className="rounded-lg border border-white/[0.08] bg-white/[0.05] px-3 py-1.5 text-[11.5px] font-medium text-zinc-200 transition-colors hover:bg-white/[0.09]"
              >
                Product overview
              </button>
              <button
                onClick={() => open('home')}
                className="rounded-lg bg-white px-3 py-1.5 text-[11.5px] font-semibold text-zinc-900 transition-colors hover:bg-zinc-100"
              >
                Power Center
              </button>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
