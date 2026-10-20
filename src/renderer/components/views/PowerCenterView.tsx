/**
 * Power Center — the Infinite tab, rebuilt.
 *
 * One home surface for the whole OS. It keeps the Infinite tab's signature
 * living orbit + hero, and carries the Power Center feature set: spotlight
 * jumping and filtering, recents, automations, quick capture, system pulse,
 * focus mode, engine status and the deploy hand-off. The "how it works"
 * explainer sits underneath so the map of the system is never more than a
 * scroll away.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { useAuthStore } from '../../stores/auth';
import { useChatStore } from '../../stores/chat';
import { useAgentsStore } from '../../stores/agents';
import { useBrainStore } from '../../stores/brain';
import { useAutomationStore } from '../../stores/automation';
import { useAiTabsStore } from '../../stores/aiTabs';
import { AppIcon, BRAND_GRADIENT, type AppIconName } from '../brand/AppIcon';
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
  { id: 'terminal', label: 'Terminal', desc: 'Full PTY — ⌘`', icon: 'nav.terminal', view: 'terminal', hotkey: '⌘ `', accent: 'from-zinc-600 to-zinc-900' },
  { id: 'canvas', label: 'Canvas', desc: 'Visual workflows', icon: 'nav.workspace', view: 'canvas', accent: 'from-pink-500 to-rose-500' },
  { id: 'browser', label: 'Browser', desc: 'AI-driven browsing', icon: 'agent.browser', view: 'browser', accent: 'from-sky-400 to-indigo-400' },
  { id: 'pc', label: 'PC Control', desc: 'Operate this machine', icon: 'home.orchestrator', view: 'capabilities', accent: 'from-fuchsia-400 to-pink-500' },
  { id: 'artifacts', label: 'Artifacts', desc: 'Charts, docs, builds', icon: 'tab.document', view: 'artifacts', accent: 'from-violet-400 to-fuchsia-400' },
];

/** Spotlight jump list: every orbit node plus the surfaces worth one keystroke.
    Declared after ORBIT_PLANETS below. */
const SPOTLIGHT_JUMPS: Array<{ label: string; view: string }> = [];

const ORBIT_PLANETS: {
  label: string;
  view: string;
  icon: AppIconName;
  ring: 0 | 1;
  angle: number;
  color: string;
  duration: number;
}[] = [
  { label: 'Chat', view: 'chats', icon: 'nav.chats', ring: 0, angle: 0, color: '#8b5cf6', duration: 48 },
  { label: 'Code', view: 'workspace', icon: 'home.code', ring: 0, angle: 72, color: '#22d3ee', duration: 48 },
  { label: 'Automate', view: 'automations', icon: 'nav.automations', ring: 0, angle: 144, color: '#34d399', duration: 48 },
  { label: 'Browser', view: 'browser', icon: 'agent.browser', ring: 0, angle: 216, color: '#38bdf8', duration: 48 },
  { label: 'PC Control', view: 'capabilities', icon: 'home.orchestrator', ring: 0, angle: 288, color: '#f472b6', duration: 48 },
  { label: 'Files', view: 'documents', icon: 'nav.files', ring: 1, angle: 20, color: '#2dd4bf', duration: 72 },
  { label: 'Terminal', view: 'terminal', icon: 'nav.terminal', ring: 1, angle: 65, color: '#a1a1aa', duration: 72 },
  { label: 'Memory', view: 'memory', icon: 'nav.memory', ring: 1, angle: 110, color: '#e879f9', duration: 72 },
  { label: 'Bots', view: 'bots', icon: 'nav.agents', ring: 1, angle: 155, color: '#fbbf24', duration: 72 },
  { label: 'Build', view: 'app-builder', icon: 'action.build', ring: 1, angle: 200, color: '#fb923c', duration: 72 },
  { label: 'Business', view: 'business', icon: 'home.business', ring: 1, angle: 245, color: '#a78bfa', duration: 72 },
  { label: 'Knowledge', view: 'knowledge', icon: 'home.learn', ring: 1, angle: 290, color: '#60a5fa', duration: 72 },
  { label: 'Deploy', view: 'deploy', icon: 'action.launch', ring: 1, angle: 325, color: '#4ade80', duration: 72 },
];

// Spotlight jumps: the orbit map plus the quick surfaces, de-duplicated by view.
SPOTLIGHT_JUMPS.push(
  ...ORBIT_PLANETS.map((p) => ({ label: p.label, view: p.view })),
  ...QUICK_ACTIONS.map((a) => ({ label: a.label, view: a.view })),
);

const PILLARS: { id: string; title: string; blurb: string; icon: AppIconName; accent: string; view?: string; items: string[] }[] = [
  {
    id: 'think',
    title: 'Think',
    blurb: 'Infinite AI is the brain — reasoning, code, research and decisions in plain language.',
    icon: 'action.ai',
    accent: 'from-violet-500 to-indigo-500',
    view: 'chats',
    items: ['Chat with full context', 'Deep research & summaries', 'Code that explains itself', 'Paired multi-model brains'],
  },
  {
    id: 'build',
    title: 'Build',
    blurb: 'From a sentence to a shipped artifact — apps, sites, charts, docs, quizzes.',
    icon: 'action.build',
    accent: 'from-orange-400 to-amber-500',
    view: 'creations',
    items: ['App & Website Builder', 'Canvas visual workflows', 'Artifacts library', 'One-click deploy'],
  },
  {
    id: 'automate',
    title: 'Automate',
    blurb: 'Trusted actions become scheduled jobs, standing orders and self-running routines.',
    icon: 'nav.automations',
    accent: 'from-cyan-400 to-blue-500',
    view: 'automations',
    items: ['Scheduled jobs', 'Standing orders', 'Task replay', 'Self-evolution learns you'],
  },
  {
    id: 'control',
    title: 'Control',
    blurb: 'The AI operates your PC and browser like a careful colleague — with permission gates.',
    icon: 'home.orchestrator',
    accent: 'from-pink-500 to-rose-500',
    view: 'capabilities',
    items: ['Browser automation', 'Desktop control', 'Terminal & files', 'Just ask — no page needed'],
  },
  {
    id: 'remember',
    title: 'Remember',
    blurb: 'A local brain that keeps preferences, projects, docs and lessons across sessions.',
    icon: 'nav.memory',
    accent: 'from-fuchsia-400 to-pink-500',
    view: 'memory',
    items: ['Active memory', 'Knowledge hub', 'Brain learning', 'Encrypted local store'],
  },
  {
    id: 'run',
    title: 'Run the business',
    blurb: 'CRM, invoices, leads, messaging and call center — personal operating tools.',
    icon: 'home.business',
    accent: 'from-violet-400 to-purple-500',
    view: 'business',
    items: ['Contacts & deals', 'Invoices & email', 'Telegram / WhatsApp', 'Enterprise board'],
  },
];

const PIPELINE: { n: number; title: string; desc: string; tone: string }[] = [
  { n: 1, title: 'You speak', desc: 'Type, capture or command — keyboard-first with ⌘K anywhere.', tone: '#a78bfa' },
  { n: 2, title: 'Infinite AI reasons', desc: 'The brain plans, picks tools, and asks before risky moves.', tone: '#22d3ee' },
  { n: 3, title: 'Tools execute', desc: '100+ safe tools touch files, browser, PC and services.', tone: '#34d399' },
  { n: 4, title: 'Results land as tabs', desc: 'Chats, apps, charts and deploys open as working surfaces.', tone: '#f472b6' },
  { n: 5, title: 'It learns you', desc: 'Self-evolution turns repeat behavior into skills you never coded.', tone: '#fbbf24' },
];

const LAYERS: { name: string; role: string; detail: string; color: string }[] = [
  { name: 'Interface', role: 'Sidebar, tabs, palette, chat', detail: 'React + Tailwind · ~270ms splash', color: '#8b5cf6' },
  { name: 'Orchestration', role: 'Agents, crew, permissions, IPC', detail: 'Main process · tool routing · failover', color: '#22d3ee' },
  { name: 'Providers', role: 'OpenRouter, OpenCode, Ollama…', detail: 'Keyless candidates · custom catalogs', color: '#34d399' },
  { name: 'Local core', role: 'SQLite, encrypt, FS, PTY', detail: 'Local-first · source-available', color: '#f472b6' },
];

const BEST: { title: string; desc: string }[] = [
  { title: 'All-in-one, not tab hell', desc: 'Chat, code, files, terminal, browser + PC automation in one native app.' },
  { title: 'Keyboard-first, instant', desc: '⌘K palette, idle-prefetched views, ~270ms startup — no spinner.' },
  { title: 'Local-first & private', desc: 'Ollama + local models, encrypted store, profile isolation.' },
  { title: 'Build, don’t configure', desc: 'App Builder, Website Builder, Canvas, Automations — ship from a prompt.' },
];

const FAQ: { q: string; a: string }[] = [
  { q: 'What is the Power Center?', a: 'The one screen you land on. The orbit maps every surface, and Spotlight, recents, capture and system pulse live here — everything is one keystroke away.' },
  { q: 'What is Infinite OS?', a: 'An AI-powered Windows workspace: chat, code, files, terminal, browser + PC control, automations, business tools and builders in one native app.' },
  { q: 'Does my data leave the machine?', a: 'Not unless you choose a cloud model. Sessions, memory and secrets stay encrypted on your PC with profile isolation.' },
  { q: 'How is this different from a chatbot tab?', a: 'Chatbots answer. Infinite OS acts — files, browser, PC, deploys, schedules — then shows the work in interactive tabs you can keep using.' },
  { q: 'Do I need to be a developer?', a: 'No. Prompt to build, automate and deploy. Developers get terminal, code editor and full tool access when they want control.' },
];

const SHORTCUTS: Array<{ keys: string; label: string }> = [
  { keys: '⌘ K', label: 'Command palette' },
  { keys: '⌘ N', label: 'New chat' },
  { keys: '/', label: 'Focus spotlight' },
  { keys: '⌘ `', label: 'Terminal' },
  { keys: '⌘ B', label: 'Toggle sidebar' },
];

const TIPS = [
  'Tip: Press ⌘K then type “deploy” to ship in seconds.',
  'Tip: Quick Capture (⌘⇧Y) saves any thought to your notes instantly.',
  'Tip: Bots can run as a crew — pair two models for crew mode.',
  'Tip: Canvas workflows persist locally and run real actions.',
  'Tip: Click any orbit node to jump straight into that surface.',
  'Tip: Say “build me a…” in chat — Infinite AI scaffolds it live.',
];

/** Drifting starfield for the hero — deterministic so it never re-shuffles. */
const STARS = Array.from({ length: 36 }, (_, i) => ({
  i,
  x: (i * 149.3) % 100,
  y: (i * 71.7) % 100,
  size: 1 + (i % 3),
  dur: 2.4 + (i % 5) * 0.7,
  delay: i * 0.13,
}));

const POWER_STYLES = `
@keyframes uni-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
@keyframes uni-chip-anti { from { transform: rotate(0deg); } to { transform: rotate(-360deg); } }
/* Brightens on top of the core's resting halo — the glow never fully vanishes,
   it just breathes. */
@keyframes uni-pulse-core {
  0%,100% { box-shadow: 0 0 0 1px rgba(139,92,246,0.30), 0 0 24px rgba(139,92,246,0.34), 0 0 56px rgba(34,211,238,0.18); }
  50% { box-shadow: 0 0 0 1px rgba(139,92,246,0.55), 0 0 34px rgba(139,92,246,0.5), 0 0 78px rgba(34,211,238,0.34); }
}
@keyframes uni-twinkle { 0%,100% { opacity: 0.15; transform: scale(0.85); } 50% { opacity: 0.9; transform: scale(1.1); } }
@keyframes uni-beam { 0% { background-position: 0% 50%; } 100% { background-position: 200% 50%; } }
@keyframes uni-sheen { 0% { transform: translateX(-120%); } 100% { transform: translateX(220%); } }
.uni-orbit { position: absolute; inset: 0; border-radius: 9999px; border: 1px dashed rgba(255,255,255,0.08); }
.uni-orbit-spin { position: absolute; inset: 0; animation: uni-spin linear infinite; }
.uni-node { position: absolute; left: 50%; top: 50%; width: 0; height: 0; }
.uni-anchor { position: absolute; left: 0; top: 0; }
/* The orbit spins the node, so the chip box anti-rotates itself — otherwise the
   pill turns sideways with the ring and only its text stays upright. */
.uni-chip-wrap { display: inline-block; transform: translate(-50%, -50%); transition: transform 0.2s; }
.uni-chip-wrap:hover { transform: translate(-50%, -50%) scale(1.06); }
.uni-chip { position: relative; display: inline-flex; align-items: center; gap: 6px; white-space: nowrap; padding: 6px 10px; border-radius: 9999px; border: 1px solid rgba(255,255,255,0.1); background: rgba(18,19,26,0.92); backdrop-filter: blur(8px); font-size: 11px; font-weight: 500; color: #e4e4e7; box-shadow: 0 8px 24px rgba(0,0,0,0.35); cursor: pointer; animation: uni-chip-anti linear infinite; transition: border-color 0.2s, box-shadow 0.2s; }
.uni-chip:hover { border-color: rgba(139,92,246,0.6); box-shadow: 0 10px 30px rgba(0,0,0,0.5); }
.uni-chip:focus-visible { outline: 2px solid rgba(139,92,246,0.7); outline-offset: 2px; }
.uni-chip-inner { display: inline-flex; align-items: center; gap: 6px; }
.uni-core { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); width: 88px; height: 88px; border-radius: 9999px; display: flex; flex-direction: column; align-items: center; justify-content: center; background: radial-gradient(circle at 30% 30%, #1e1b4b, #09090c 70%); border: 1px solid rgba(139,92,246,0.5); z-index: 2; /* The core's halo is part of the map, so it is painted even when motion is
   off — a still glow reads as "loaded", a missing one reads as broken. The base
   shadow lives here; the keyframes only brighten on top of it. */ box-shadow: 0 0 0 1px rgba(139,92,246,0.30), 0 0 24px rgba(139,92,246,0.34), 0 0 56px rgba(34,211,238,0.18); animation: uni-pulse-core 3.2s ease-in-out infinite; }
.uni-core:hover { border-color: rgba(34,211,238,0.6); }
.uni-panel { position: relative; border-radius: 1rem; border: 1px solid rgba(255,255,255,0.07); background: #12131a; padding: 14px 16px; transition: border-color 0.2s, background 0.2s; }
.uni-panel:hover { border-color: rgba(255,255,255,0.14); background: #171821; }
.pc-sheen::after { content: ''; position: absolute; inset: 0; pointer-events: none; background: linear-gradient(105deg, transparent 35%, rgba(255,255,255,0.07) 50%, transparent 65%); transform: translateX(-120%); }
.pc-sheen:hover::after { animation: uni-sheen 0.9s ease-out; }
@media (prefers-reduced-motion: reduce) {
  /* Reduced motion must not delete the map. globals.css flattens every animation
     under this preference (0.01ms duration, 1 iteration), which parked the rings
     and left the orbit as a still photo. The orbit is the centrepiece, so it
     keeps turning here — slowly — with the chips counter-rotated so their
     labels stay upright. Only the decorative motion (core pulse, card sheen)
     stops. Both properties must be re-asserted because the global rule wins
     with !important. */
  .uni-orbit-spin {
    animation-name: uni-spin !important;
    animation-duration: 300s !important;
    animation-iteration-count: infinite !important;
    animation-timing-function: linear !important;
  }
  .uni-chip {
    animation-name: uni-chip-anti !important;
    animation-duration: 300s !important;
    animation-iteration-count: infinite !important;
    animation-timing-function: linear !important;
  }
  /* The core keeps a slow breath rather than freezing: it is the one element
     that says "the brain is live", and a dead-looking core reads as broken. */
  .uni-core {
    animation-name: uni-pulse-core !important;
    animation-duration: 9s !important;
    animation-iteration-count: infinite !important;
  }
  .pc-sheen::after { animation: none !important; }
}
`;

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
  const tabs = useAiTabsStore((s) => s.tabs);
  const now = useClock();

  const [focusOn, setFocusOn] = useState(() => {
    try { return localStorage.getItem('infinite:focus') === '1'; } catch { return false; }
  });
  const [capture, setCapture] = useState('');
  const [saving, setSaving] = useState(false);
  const [savedPath, setSavedPath] = useState<string | null>(null);
  const [spotlight, setSpotlight] = useState('');
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const [mouse, setMouse] = useState({ x: 0.5, y: 0.5 });
  const spotlightRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    try { localStorage.setItem('infinite:focus', focusOn ? '1' : '0'); } catch { /* ignore */ }
    // Document hint so global styles dim the marketing layers in focus mode.
    try { document.documentElement.dataset.focus = focusOn ? 'on' : 'off'; } catch { /* ignore */ }
  }, [focusOn]);

  useEffect(() => {
    // Warm automations so recents are real — the Power Center never shows stale zeros.
    void loadWorkflows().catch(() => {});
  }, [loadWorkflows]);

  // Pointer parallax for the hero mesh + starfield.
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      setMouse({ x: e.clientX / window.innerWidth, y: e.clientY / window.innerHeight });
    };
    window.addEventListener('mousemove', onMove, { passive: true });
    return () => window.removeEventListener('mousemove', onMove);
  }, []);

  // "/" focuses the spotlight from anywhere on the Power Center.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing = !!target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
      if (e.key === '/' && !typing && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        spotlightRef.current?.focus();
      }
      if (e.key === 'Escape' && document.activeElement === spotlightRef.current) {
        setSpotlight('');
        spotlightRef.current?.blur();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const firstName = useMemo(() => user?.name?.split(' ')[0] || 'Anthony', [user?.name]);
  const dateLabel = useMemo(() => now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }), [now]);
  const timeLabel = useMemo(() => now.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }), [now]);

  const recentSessions = useMemo(() => [...sessions].sort((a, b) => b.updated_at - a.updated_at).slice(0, 4), [sessions]);
  const activeRuns = useMemo(() => runs.filter((r) => r.status === 'running').length, [runs]);
  const recentAutos = useMemo(() => {
    type W = { id: string; name: string; enabled: boolean; createdAt: number };
    const list = (workflows as unknown as W[]) ?? [];
    return [...list].sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0)).slice(0, 4);
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

  const stats = useMemo(() => ([
    { label: 'Chats', value: sessions.length, color: '#8b5cf6' },
    { label: 'Live agents', value: activeRuns, color: '#22d3ee' },
    { label: 'Automations', value: workflows.length, color: '#34d399' },
    { label: 'Open tabs', value: tabs.length, color: '#f472b6' },
  ]), [sessions.length, activeRuns, workflows.length, tabs.length]);

  const query = spotlight.trim().toLowerCase();
  const matches = useCallback(
    (...fields: Array<string | number | undefined>) => !query || fields.filter(Boolean).join(' ').toLowerCase().includes(query),
    [query],
  );

  const filteredSessions = useMemo(() => recentSessions.filter((s) => matches(s.title || 'Untitled chat')), [recentSessions, matches]);
  // Spotlight jump targets: what the typed query points at, de-duplicated so the
  // same surface never appears twice (the orbit already lists most of them).
  const filteredJumps = useMemo(() => {
    if (!query) return [];
    const seen = new Set<string>();
    const out: Array<{ label: string; view: string }> = [];
    for (const jump of SPOTLIGHT_JUMPS) {
      if (seen.has(jump.view)) continue;
      if (!matches(jump.label)) continue;
      seen.add(jump.view);
      out.push(jump);
      if (out.length >= 8) break;
    }
    return out;
  }, [query, matches]);
  const filteredAutos = useMemo(() => recentAutos.filter((w) => matches(w.name || w.id, w.enabled ? 'enabled on' : 'off disabled')), [recentAutos, matches]);
  const filteredPillars = useMemo(() => PILLARS.filter((p) => matches(p.title, p.blurb, ...p.items)), [matches]);

  const open = useCallback((view: string) => onViewChange(view), [onViewChange]);

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

  const handleDeploy = () => {
    if (onOpenDeploy) onOpenDeploy();
    else onViewChange('deploy');
  };

  const engineLive = enginePhase === 'active';

  return (
    <div className="flex-1 overflow-auto chat-scrollbar bg-[#09090c] animate-fade-in">
      <style>{POWER_STYLES}</style>

      {/* HERO — transparent: the OS, the brain and the living orbit float on open
          space. No card, no frame — just light, stars and the map. */}
      <motion.section
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45 }}
        className="relative overflow-hidden"
      >
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background: `
              radial-gradient(ellipse 70% 55% at ${40 + mouse.x * 18}% ${35 + mouse.y * 18}%, rgba(139,92,246,0.12) 0%, transparent 55%),
              radial-gradient(ellipse 55% 45% at ${70 - mouse.x * 12}% ${60 - mouse.y * 12}%, rgba(34,211,238,0.08) 0%, transparent 50%),
              radial-gradient(ellipse 40% 40% at 50% 100%, rgba(236,72,153,0.05) 0%, transparent 50%)
            `,
          }}
        />
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.35]"
          style={{
            backgroundImage: 'radial-gradient(circle, rgba(255,255,255,0.55) 1px, transparent 1px)',
            backgroundSize: '48px 48px',
            transform: `translate(${mouse.x * -24}px, ${mouse.y * -18}px)`,
            maskImage: 'radial-gradient(ellipse 80% 70% at 50% 30%, black, transparent)',
          }}
        />
        {STARS.map((star) => (
          <span
            key={star.i}
            className="pointer-events-none absolute rounded-full bg-white"
            style={{
              left: `${star.x}%`,
              top: `${star.y}%`,
              width: `${star.size}px`,
              height: `${star.size}px`,
              animation: `uni-twinkle ${star.dur}s ease-in-out ${star.delay}s infinite`,
            }}
          />
        ))}

        <div className="relative mx-auto max-w-[1200px] px-6 pb-8 pt-8 lg:px-8 lg:pt-11">
          {/* SPOTLIGHT — one field to jump anywhere */}
          <div className="flex items-center gap-2 rounded-2xl border border-white/[0.07] bg-white/[0.02] px-3 py-2">
            <AppIcon name="topbar.search" className="h-4 w-4 text-zinc-500" />
            <input
              ref={spotlightRef}
              value={spotlight}
              onChange={(e) => setSpotlight(e.target.value)}
              placeholder="Spotlight — jump anywhere, filter chats, automations & pillars…"
              className="flex-1 bg-transparent text-[13px] text-white placeholder:text-zinc-600 focus:outline-none"
              aria-label="Spotlight search"
            />
            {spotlight && (
              <button onClick={() => setSpotlight('')} className="rounded-lg bg-white/[0.06] px-2 py-1 text-[11px] text-zinc-400 hover:bg-white/[0.1] hover:text-zinc-200" aria-label="Clear spotlight">Clear</button>
            )}
            <span className="hidden rounded bg-white/[0.06] px-1.5 py-0.5 font-mono text-[10px] text-zinc-500 sm:inline">/</span>
            <span className="hidden rounded bg-white/[0.06] px-1.5 py-0.5 font-mono text-[10px] text-zinc-500 sm:inline">⌘K</span>
          </div>

          {/* Spotlight results — appear only while typing: jump straight to a
              surface. Clear the query to see every recency, automation and
              pillar again. */}
          {filteredJumps.length > 0 && (
            <div className="mb-8 mt-2 flex flex-wrap gap-1.5">
              {filteredJumps.map((jump) => (
                <button
                  key={jump.view}
                  onClick={() => open(jump.view)}
                  className="rounded-full border border-white/[0.08] bg-white/[0.03] px-3 py-1 text-[11px] text-zinc-300 transition-colors hover:border-violet-400/40 hover:bg-white/[0.07] hover:text-white"
                >
                  {jump.label}
                </button>
              ))}
            </div>
          )}
          {filteredJumps.length === 0 && <div className="mb-8" />}

          <div className="grid gap-8 lg:grid-cols-[1.05fr_1fr] lg:items-center">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-3">
                <div className="relative">
                  <div className="absolute inset-0 rounded-full bg-indigo-500/20 blur-xl" />
                  <InfiniteLogo className="relative h-8 w-16" variant="spectrum" animated />
                </div>
                <span className="inline-flex items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.04] px-3 py-1 text-[10px] font-medium tracking-wide text-zinc-300">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-cyan-400" /> The Power Center
                </span>
                <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-medium ${engineLive ? 'border-emerald-500/20 bg-emerald-500/15 text-emerald-300' : 'border-amber-500/20 bg-amber-500/15 text-amber-300'}`}>
                  <span className={`h-1.5 w-1.5 rounded-full ${engineLive ? 'bg-emerald-400' : 'animate-pulse bg-amber-400'}`} />
                  {engineLive ? 'Engine live 100%' : `Engine ${enginePhase} ${engineProgress}%`}
                </span>
              </div>
              <p className="mt-1.5 text-[11px] text-zinc-500">Everything you can do · one keystroke away</p>

              <h1 className="mt-4 text-[30px] font-semibold leading-[1.08] tracking-tight text-white lg:text-[40px]">
                {hero.greeting}, {firstName}{' '}
                <span className="text-zinc-600">—</span>{' '}
                <span className="bg-gradient-to-r from-violet-300 via-cyan-300 to-fuchsia-300 bg-clip-text bg-[length:200%_200%] text-transparent animate-gradient-shift">
                  {hero.accent}
                </span>
              </h1>
              <p className="mt-3 max-w-[58ch] text-[14px] leading-6 text-zinc-400">{hero.sub}</p>

              <div className="mt-5 flex flex-wrap gap-3">
                <button onClick={handleNewChat} className="inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2 text-[13px] font-semibold text-zinc-900 transition-colors hover:bg-zinc-100">
                  <AppIcon name="nav.chats" className="h-4 w-4" /> Talk to Infinite AI
                </button>
                <button onClick={() => onViewChange('automations')} className="inline-flex items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.06] px-4 py-2 text-[13px] font-medium text-white transition-colors hover:bg-white/[0.1]">
                  <AppIcon name="nav.automations" className="h-4 w-4" /> Automate
                </button>
                <button onClick={handleDeploy} className="inline-flex items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.04] px-4 py-2 text-[13px] font-medium text-zinc-300 transition-colors hover:bg-white/[0.07] hover:text-white">
                  <AppIcon name="action.launch" className="h-4 w-4" /> Deploy
                </button>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-zinc-500">
                <span>{dateLabel} · {timeLabel}</span>
                <span className="opacity-30">•</span>
                <span className="text-zinc-400">{tip}</span>
              </div>
            </div>

            {/* Orbit solar system — click any node, core opens chat */}
            <div className="relative mx-auto w-full max-w-[400px] aspect-square" style={{ containerType: 'inline-size' }}>
              <div className="absolute inset-[6%] rounded-full border border-white/[0.05] bg-[#0c0c12]/70" />
              <div className="uni-orbit" style={{ inset: '10%' }} />
              <div className="uni-orbit" style={{ inset: '24%' }} />

              {[0, 1].map((ringIdx) => {
                const radiusPct = ringIdx === 0 ? 40 : 26;
                const duration = ringIdx === 0 ? 48 : 72;
                return (
                  <div key={ringIdx} className="uni-orbit-spin" style={{ animationDuration: `${duration}s`, inset: 0 }}>
                    {ORBIT_PLANETS.filter((p) => p.ring === ringIdx).map((p) => (
                      <div
                        key={p.label}
                        className="uni-node"
                        style={{ transform: `rotate(${p.angle}deg) translateX(${radiusPct}cqw) rotate(${-p.angle}deg)` }}
                      >
                        <div className="uni-anchor">
                          <span className="uni-chip-wrap">
                            <button
                              type="button"
                              className="uni-chip"
                              style={{ borderColor: `${p.color}55`, animationDuration: `${duration}s` }}
                              onClick={() => open(p.view)}
                              title={`Open ${p.label}`}
                            >
                              <span className="uni-chip-inner">
                                <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: p.color, boxShadow: `0 0 8px ${p.color}` }} />
                                <AppIcon name={p.icon} className="h-3.5 w-3.5" strokeWidth={1.8} />
                                {p.label}
                              </span>
                            </button>
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                );
              })}

              <button type="button" className="uni-core" onClick={() => open('chats')} title="Infinite AI — the brain">
                <InfiniteLogo className="h-6 w-12" variant="spectrum" animated />
                <span className="mt-1 text-[9px] font-semibold uppercase tracking-[0.14em] text-zinc-300">Brain</span>
              </button>

              <div className="absolute bottom-0 left-1/2 -translate-x-1/2 whitespace-nowrap text-[10px] text-zinc-600">
                Click any orbit node · core opens chat
              </div>
            </div>
          </div>

          {/* Live counters — same floating cards as the rest of the map */}
          <div className="mt-7 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {stats.map((s) => (
              <StatCard key={s.label} label={s.label} value={s.value} color={s.color} />
            ))}
          </div>
        </div>
      </motion.section>

      <div className="relative mx-auto max-w-[1200px] px-6 pb-12 lg:px-8">

        {/* RECENTS · CAPTURE · PULSE */}
        <section className="mt-8 grid items-start gap-4 lg:grid-cols-[1.35fr_0.9fr]">
          <div className="rounded-2xl border border-white/[0.07] bg-[#12131a] p-4">
            <div className="flex items-center justify-between">
              <h3 className="text-[12px] font-semibold text-white">Recents</h3>
              <button onClick={() => onViewChange('chats')} className="text-[11px] text-zinc-500 transition-colors hover:text-zinc-300">View all →</button>
            </div>

            <div className="mt-3 space-y-2">
              {filteredSessions.length === 0 ? (
                query
                  ? <div className="rounded-xl border border-dashed border-white/[0.08] bg-white/[0.015] px-3 py-3 text-[12px] text-zinc-500">No chats match “{spotlight.trim()}”.</div>
                  : <EmptyRow label="No chats yet — start your first one" actionLabel="New Chat" onAction={() => void handleNewChat()} />
              ) : (
                filteredSessions.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => { selectSession(s.id); onViewChange('chats'); }}
                    className="flex w-full items-center justify-between gap-3 rounded-xl border border-white/[0.05] bg-white/[0.02] px-3 py-2.5 text-left transition-colors hover:border-white/[0.1] hover:bg-white/[0.05]"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-[12px] font-medium text-zinc-200">{(s.title || 'Untitled chat').slice(0, 64)}</span>
                      <span className="block text-[11px] text-zinc-500">{new Date(s.updated_at).toLocaleString()} · {s.message_count ?? 0} msgs</span>
                    </span>
                    <span className="ml-3 shrink-0 rounded-lg bg-white px-2 py-1 text-[11px] font-medium text-zinc-900">Open</span>
                  </button>
                ))
              )}
            </div>

            <div className="mt-4 pt-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-[11px] font-medium uppercase tracking-wide text-zinc-600">
                  Automations{query ? ` — ${filteredAutos.length} match${filteredAutos.length === 1 ? '' : 'es'}` : ''}
                </span>
                <button onClick={() => onViewChange('automations')} className="text-[11px] text-zinc-500 transition-colors hover:text-zinc-300">Manage →</button>
              </div>
              {filteredAutos.length === 0 ? (
                <div className="rounded-xl border border-dashed border-white/[0.08] bg-white/[0.015] px-3 py-3 text-[12px] text-zinc-500">
                  {query ? `No automations match “${spotlight.trim()}”.` : 'No workflows yet — create one in Automation Studio.'}
                </div>
              ) : (
                <div className="space-y-2">
                  {filteredAutos.map((w) => (
                    <div key={w.id} className="flex items-center justify-between rounded-xl border border-white/[0.05] bg-white/[0.02] px-3 py-2">
                      <span className="truncate text-[12px] text-zinc-300">{w.name || w.id}</span>
                      <span className={`ml-2 shrink-0 rounded-full px-2 py-0.5 text-[10px] ${w.enabled ? 'bg-emerald-500/15 text-emerald-300' : 'bg-zinc-500/15 text-zinc-400'}`}>
                        {w.enabled ? 'Enabled' : 'Off'}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="space-y-4">
            {/* Quick capture */}
            <div className="rounded-2xl border border-white/[0.07] bg-[#12131a] p-4">
              <h3 className="text-[12px] font-semibold text-white">Quick Capture</h3>
              <p className="mt-1 text-[11px] text-zinc-500">Drop a thought — saved instantly to your quick notes. Works offline.</p>
              <div className="mt-3 flex gap-2">
                <input
                  value={capture}
                  onChange={(e) => setCapture(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) void handleQuickCapture(); }}
                  placeholder="What should I remember?"
                  aria-label="Quick capture input"
                  className="flex-1 rounded-xl border border-white/[0.08] bg-black/30 px-3 py-2 text-[12px] text-white placeholder:text-zinc-600 focus:border-violet-500/40 focus:outline-none"
                />
                <button
                  onClick={() => void handleQuickCapture()}
                  disabled={saving || !capture.trim()}
                  className="rounded-xl bg-white px-3 py-2 text-[12px] font-semibold text-zinc-900 transition-colors hover:bg-zinc-100 disabled:opacity-40"
                  aria-label="Save quick capture"
                >
                  {saving ? '…' : 'Save'}
                </button>
              </div>
              {savedPath && <div className="mt-2 rounded-lg bg-emerald-500/10 px-2.5 py-1.5 text-[11px] text-emerald-300">Saved → {savedPath}</div>}
              <div className="mt-2 flex items-center gap-1.5">
                <button onClick={() => void window.api.quickCaptureOpen()} className="rounded-lg border border-white/[0.07] bg-white/[0.04] px-2.5 py-1 text-[11px] text-zinc-300 transition-colors hover:bg-white/[0.08]">Open notes</button>
                <span className="rounded-lg bg-white/[0.04] px-2 py-1 font-mono text-[10px] text-zinc-500">⌘⇧Y</span>
              </div>
            </div>

            {/* System pulse + focus */}
            <div className="rounded-2xl border border-white/[0.07] bg-[#12131a] p-4 focus-dim">
              <div className="flex items-center justify-between">
                <h3 className="text-[12px] font-semibold text-white">System pulse</h3>
                <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] ${engineLive ? 'bg-emerald-500/15 text-emerald-300' : 'bg-amber-500/15 text-amber-300'}`}>
                  <span className={`h-1.5 w-1.5 rounded-full ${engineLive ? 'bg-emerald-400' : 'animate-pulse bg-amber-400'}`} />
                  {engineLive ? 'Live' : enginePhase}
                </span>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 text-[11px]">
                <PulseRow label="Engine" value={engineLive ? 'Live' : enginePhase} ok={engineLive} />
                <PulseRow label="Chats" value={String(sessions.length)} />
                <PulseRow label="Active agents" value={String(activeRuns)} warn={activeRuns > 0} />
                <PulseRow label="Automations" value={String(workflows.length)} />
              </div>

              <div className="mt-3 flex items-center justify-between rounded-xl border border-white/[0.06] bg-black/20 px-3 py-2.5">
                <div>
                  <div className="text-[10px] uppercase tracking-wide text-zinc-500">Focus</div>
                  <div className="text-[11px] text-zinc-400">{focusOn ? 'Distractions dimmed' : 'Hide noise, keep chat + editor'}</div>
                </div>
                <button onClick={() => setFocusOn((v) => !v)} className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${focusOn ? 'bg-violet-600' : 'bg-white/15'}`} aria-label="Toggle focus mode" aria-pressed={focusOn}>
                  <span className={`inline-block h-4 w-4 rounded-full bg-white transition-transform ${focusOn ? 'translate-x-4' : 'translate-x-0.5'}`} />
                </button>
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
        </section>

        {/* EVERYTHING IT CAN DO */}
        <section className="mt-8">
          <SectionHead icon="home.canvas" title="Everything Infinite can do" sub="Six pillars · every module hangs off one of them" />
          <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {filteredPillars.map((p, i) => (
              <motion.button
                key={p.id}
                type="button"
                initial={{ opacity: 0, y: 14 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: '-40px' }}
                transition={{ duration: 0.32, delay: i * 0.05 }}
                onClick={() => p.view && open(p.view)}
                className="pc-sheen group relative overflow-hidden rounded-2xl border border-white/[0.07] bg-[#12131a] p-5 text-left transition-all hover:-translate-y-0.5 hover:border-white/[0.14] hover:bg-[#171821] focus:outline-none focus:ring-2 focus:ring-violet-500/30"
              >
                <div className={`pointer-events-none absolute inset-0 bg-gradient-to-br ${p.accent} opacity-0 transition-opacity group-hover:opacity-[0.08]`} />
                <div className="relative flex items-start justify-between gap-3">
                  <span className={`inline-flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br ${p.accent} text-white shadow-lg`}>
                    <AppIcon name={p.icon} className="h-5 w-5" />
                  </span>
                  {p.view && <span className="text-[11px] text-zinc-600 transition-colors group-hover:text-violet-400">Open →</span>}
                </div>
                <div className="relative mt-4 text-[15px] font-semibold text-white">{p.title}</div>
                <div className="relative mt-1.5 text-[12px] leading-4 text-zinc-500 transition-colors group-hover:text-zinc-400">{p.blurb}</div>
                <ul className="relative mt-3 space-y-1.5">
                  {p.items.map((item) => (
                    <li key={item} className="flex items-center gap-2 text-[11px] text-zinc-500">
                      <span className="h-1 w-1 rounded-full bg-zinc-600 transition-colors group-hover:bg-cyan-400" />
                      {item}
                    </li>
                  ))}
                </ul>
              </motion.button>
            ))}
          </div>
          {filteredPillars.length === 0 && (
            <div className="mt-3 rounded-2xl border border-dashed border-white/[0.08] bg-white/[0.015] px-4 py-6 text-center text-[13px] text-zinc-500">
              No pillars match “{spotlight.trim()}” — try “memory”, “build”, or “control”.
            </div>
          )}
        </section>

        {/* OS vs AI + pipeline */}
        <section className="mt-8 grid gap-4 lg:grid-cols-2">
          <DualityCard
            kicker="The application"
            tone="violet"
            title="Infinite OS"
            icon="nav.workspace"
            body="The full workspace shell: sidebar, chats, tabs, terminal, file explorer, builders, plugin store, business suite and local memory. If you can see it and click it, that is the OS."
            tags={['Native Windows app', 'Keyboard-first', '~270ms startup', 'Source-available']}
          />
          <DualityCard
            kicker="The brain"
            tone="cyan"
            title="Infinite AI"
            icon="topbar.engine"
            body="The reasoning engine: multi-provider models, agent crews, permission-aware tool calls, brain learning, and self-evolution that turns how you work into skills the OS runs for you."
            tags={['Multi-model', '100+ tools', 'Permission gates', 'Self-evolving']}
          />
        </section>

        <section className="mt-8">
          <SectionHead icon="automation.link" title="How a thought becomes reality" sub="The Infinite loop, end to end" />
          <div className="relative mt-3 grid gap-3 md:grid-cols-5">
            <div className="absolute left-0 right-0 top-[46px] hidden h-px bg-gradient-to-r from-violet-500/40 via-cyan-500/40 to-pink-500/40 md:block" />
            {PIPELINE.map((step, i) => (
              <motion.div
                key={step.n}
                initial={{ opacity: 0, y: 14 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.32, delay: i * 0.07 }}
                className="uni-panel relative z-10"
              >
                <div className="mb-3 inline-flex h-9 w-9 items-center justify-center rounded-full text-[12px] font-bold text-zinc-950" style={{ background: step.tone, boxShadow: `0 0 20px ${step.tone}55` }}>
                  {step.n}
                </div>
                <div className="text-[13px] font-semibold text-white">{step.title}</div>
                <div className="mt-1 text-[11px] leading-4 text-zinc-500">{step.desc}</div>
              </motion.div>
            ))}
          </div>
        </section>

        {/* Stack + why + FAQ */}
        <section className="mt-8 grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
          <div className="rounded-2xl border border-white/[0.07] bg-[#12131a] p-4 focus-dim">
            <div className="flex items-center gap-3">
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-white/[0.07] bg-white/[0.04]">
                <AppIcon name="topbar.engine" className="h-4 w-4 text-emerald-300" strokeWidth={1.7} gradient={BRAND_GRADIENT} />
              </span>
              <div>
                <h3 className="text-[15px] font-semibold text-white">Under the hood</h3>
                <p className="text-[11px] text-zinc-500">Four layers, one product</p>
              </div>
            </div>
            <div className="mt-4 space-y-2.5">
              {LAYERS.map((layer, i) => (
                <div
                  key={layer.name}
                  className="uni-panel flex flex-col gap-1.5 !px-3.5 !py-3 sm:flex-row sm:items-center sm:justify-between"
                  style={{ marginLeft: `${i * 2}%`, marginRight: `${(LAYERS.length - 1 - i) * 2}%`, borderColor: `${layer.color}33` }}
                >
                  <div className="flex items-center gap-3">
                    <span className="h-2 w-2 rounded-full" style={{ background: layer.color, boxShadow: `0 0 10px ${layer.color}` }} />
                    <div>
                      <div className="text-[13px] font-semibold text-white">{layer.name}</div>
                      <div className="text-[11px] text-zinc-500">{layer.role}</div>
                    </div>
                  </div>
                  <div className="font-mono text-[11px] text-zinc-400 sm:pr-1 sm:text-right">{layer.detail}</div>
                </div>
              ))}
            </div>

            <div className="mt-4 grid gap-2.5 sm:grid-cols-2">
              {BEST.map((b) => (
                <div key={b.title} className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-3.5 py-3">
                  <div className="text-[12px] font-semibold text-white">{b.title}</div>
                  <div className="mt-1 text-[11px] leading-4 text-zinc-500">{b.desc}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-white/[0.07] bg-[#12131a] p-4 focus-dim">
            <div className="flex items-center gap-3">
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-white/[0.07] bg-white/[0.04]">
                <AppIcon name="home.learn" className="h-4 w-4 text-amber-300" strokeWidth={1.7} gradient={BRAND_GRADIENT} />
              </span>
              <div>
                <h3 className="text-[15px] font-semibold text-white">Straight answers</h3>
                <p className="text-[11px] text-zinc-500">The questions everyone asks</p>
              </div>
            </div>
            <div className="mt-4 space-y-2">
              {FAQ.map((item, i) => {
                const isOpen = openFaq === i;
                return (
                  <div key={item.q} className={`uni-panel !py-3 ${isOpen ? 'border-white/[0.14] bg-[#171821]' : ''}`}>
                    <button type="button" onClick={() => setOpenFaq(isOpen ? null : i)} className="flex w-full items-start justify-between gap-3 text-left" aria-expanded={isOpen}>
                      <span className="text-[12.5px] font-semibold text-white">{item.q}</span>
                      <span className={`mt-0.5 text-[14px] text-zinc-500 transition-transform ${isOpen ? 'rotate-45 text-violet-400' : ''}`}>+</span>
                    </button>
                    <div className="grid transition-all duration-300" style={{ gridTemplateRows: isOpen ? '1fr' : '0fr', opacity: isOpen ? 1 : 0 }}>
                      <div className="overflow-hidden">
                        <p className="pt-2 text-[11.5px] leading-5 text-zinc-400">{item.a}</p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="mt-4 rounded-xl border border-cyan-400/20 bg-cyan-400/[0.07] px-3.5 py-3">
              <div className="flex items-center gap-2 text-[11px] font-medium text-cyan-300">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-cyan-400" /> Self-evolution engine
              </div>
              <p className="mt-1.5 text-[11px] leading-4 text-zinc-400">
                Infinite watches the patterns you repeat and proposes skills, standing orders and shortcuts. You approve; the OS runs them next time.
              </p>
              <div className="mt-2.5 flex flex-wrap gap-1.5">
                <button onClick={() => open('standing-orders')} className="rounded-lg border border-white/[0.08] bg-white/[0.05] px-2.5 py-1 text-[11px] text-zinc-200 transition-colors hover:bg-white/[0.09]">Standing Orders</button>
                <button onClick={() => open('active-memory')} className="rounded-lg border border-white/[0.08] bg-white/[0.05] px-2.5 py-1 text-[11px] text-zinc-200 transition-colors hover:bg-white/[0.09]">Active Memory</button>
                <button onClick={() => open('capabilities')} className="rounded-lg bg-white px-2.5 py-1 text-[11px] font-semibold text-zinc-900 transition-colors hover:bg-zinc-100">Tools &amp; Skills</button>
              </div>
            </div>
          </div>
        </section>

        {/* Footer */}
        <div className="mt-8 flex flex-col items-center justify-between gap-3 rounded-2xl border border-white/[0.07] bg-[#12131a] px-5 py-4 sm:flex-row">
          <div>
            <div className="text-[13px] font-semibold text-white">You are in the Power Center.</div>
            <div className="mt-1 text-[11px] text-zinc-500">Infinite OS v0.1.1 · Infinite AI always on · local-first</div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={() => open('infinite')} className="rounded-lg border border-violet-400/30 bg-violet-500/15 px-3.5 py-2 text-[12px] font-medium text-violet-100 transition-colors hover:bg-violet-500/25">Infinite</button>
            <button onClick={() => open('guide')} className="rounded-lg border border-white/[0.08] bg-white/[0.05] px-3.5 py-2 text-[12px] font-medium text-zinc-200 transition-colors hover:bg-white/[0.09]">Guide</button>
            <button onClick={() => open('overview')} className="rounded-lg border border-white/[0.08] bg-white/[0.05] px-3.5 py-2 text-[12px] font-medium text-zinc-200 transition-colors hover:bg-white/[0.09]">Overview</button>
            <button onClick={() => void handleNewChat()} className="rounded-lg bg-white px-3.5 py-2 text-[12px] font-semibold text-zinc-900 transition-colors hover:bg-zinc-100">Start chatting</button>
          </div>
        </div>

        <div className="mt-5 text-center text-[11px] text-zinc-600">
          <button onClick={() => window.dispatchEvent(new Event('infinite:open-settings'))} className="underline decoration-zinc-600 underline-offset-2 transition-colors hover:text-zinc-400">Settings</button>
          {' · '}
          <button onClick={() => onViewChange('capabilities')} className="underline decoration-zinc-600 underline-offset-2 transition-colors hover:text-zinc-400">Tools &amp; Skills</button>
          {' · '}
          <button onClick={() => onViewChange('plugins')} className="underline decoration-zinc-600 underline-offset-2 transition-colors hover:text-zinc-400">Plugins</button>
        </div>
      </div>
    </div>
  );
}

function SectionHead({ icon, title, sub }: { icon: AppIconName; title: string; sub: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-white/[0.07] bg-white/[0.04]">
        <AppIcon name={icon} className="h-4 w-4 text-zinc-300" strokeWidth={1.7} gradient={BRAND_GRADIENT} />
      </span>
      <div>
        <h2 className="text-[16px] font-semibold text-white">{title}</h2>
        <p className="text-[11.5px] text-zinc-500">{sub}</p>
      </div>
    </div>
  );
}

function StatCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="rounded-xl border border-white/[0.07] bg-[#12131a]/80 p-3.5 transition-colors hover:border-white/[0.12]">
      <div className="text-[10px] uppercase tracking-wide text-zinc-500">{label}</div>
      <div className="mt-1 text-[22px] font-semibold text-white">{value}</div>
      <div className="mt-2 h-0.5 w-full overflow-hidden rounded-full bg-white/[0.06]">
        <div className="h-full rounded-full transition-all duration-700" style={{ width: `${Math.min(100, 18 + value * 12)}%`, background: color }} />
      </div>
    </div>
  );
}

function PulseRow({ label, value, ok, warn }: { label: string; value: string; ok?: boolean; warn?: boolean }) {
  const tone = warn ? 'text-cyan-300' : ok ? 'text-emerald-300' : 'text-white';
  return (
    <div className="flex items-center justify-between rounded-lg border border-white/[0.06] bg-white/[0.02] px-2.5 py-2">
      <span className="text-zinc-500">{label}</span>
      <span className={`font-medium ${tone}`}>{value}</span>
    </div>
  );
}

function DualityCard({
  kicker,
  title,
  body,
  tags,
  icon,
  tone,
}: {
  kicker: string;
  title: string;
  body: string;
  tags: string[];
  icon: AppIconName;
  tone: 'violet' | 'cyan';
}) {
  const accent = tone === 'violet' ? 'from-violet-500 to-indigo-500' : 'from-cyan-500 to-sky-500';
  const kickerTone = tone === 'violet' ? 'text-violet-400' : 'text-cyan-400';
  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-60px' }}
      transition={{ duration: 0.35 }}
      className="uni-panel overflow-hidden"
    >
      <div className="flex items-center gap-3">
        <span className={`inline-flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br ${accent} text-white`}>
          <AppIcon name={icon} className="h-5 w-5" />
        </span>
        <div>
          <div className={`text-[10px] uppercase tracking-[0.16em] ${kickerTone}`}>{kicker}</div>
          <h3 className="text-[16px] font-semibold text-white">{title}</h3>
        </div>
      </div>
      <p className="mt-3 text-[13px] leading-5 text-zinc-400">{body}</p>
      <div className="mt-4 flex flex-wrap gap-2">
        {tags.map((t) => (
          <span key={t} className="rounded-full border border-white/[0.07] bg-white/[0.04] px-2.5 py-1 text-[10px] text-zinc-400">{t}</span>
        ))}
      </div>
    </motion.div>
  );
}

function EmptyRow({ label, actionLabel, onAction }: { label: string; actionLabel: string; onAction: () => void }) {
  return (
    <div className="flex items-center justify-between rounded-xl border border-dashed border-white/[0.08] bg-white/[0.015] px-3 py-3">
      <span className="text-[12px] text-zinc-500">{label}</span>
      <button onClick={onAction} className="rounded-lg bg-white px-2.5 py-1 text-[11px] font-medium text-zinc-900 transition-colors hover:bg-zinc-100">{actionLabel}</button>
    </div>
  );
}
