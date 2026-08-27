/**
 * AppIcon — the single source of truth for every icon in Infinite OS.
 *
 * Brand-facing surfaces (navigation, modules, tabs, agents, panels) resolve
 * to the hand-drawn InfinityIcons set so the whole app carries the lemniscate
 * signature. Pure utilities (plus/close/send, file types, status spinners)
 * stay on Lucide, which matches the same 24×24 stroke discipline.
 *
 * Never inline ad-hoc SVG paths in views — add a semantic entry here instead
 * so the app stays visually coherent.
 */
import {
  Plus,
  X,
  ChevronDown,
  Rocket,
  Play,
  FileCode2,
  FileJson2,
  FileText,
  CheckCircle2,
  Circle,
  Loader2,
  ClipboardList,
  Clapperboard,
  ReceiptText,
  type LucideIcon,
} from 'lucide-react';
import { InfinityIcon, type InfinityIconName } from './InfinityIcons';

/**
 * Custom Infinite OS glyphs (hand-drawn in InfinityIcons.tsx) take priority
 * for brand-facing surfaces. Anything not listed here falls back to the
 * Lucide registry below.
 */
const CUSTOM: Record<string, InfinityIconName> = {
  // ── Primary navigation (sidebar) ────────────────────────────────
  'nav.chats': 'inf.chat',
  'nav.agents': 'inf.agent',
  'nav.projects': 'inf.project',
  'nav.files': 'inf.folder-tree',
  'nav.automations': 'inf.automation',
  'nav.memory': 'inf.memory',
  'nav.workspace': 'inf.dashboard',
  'nav.capabilities': 'inf.hex-stack',
  'nav.settings': 'inf.gear',

  // ── Top bar ─────────────────────────────────────────────────────
  'topbar.menu': 'inf.menu',
  'topbar.search': 'inf.search',
  'topbar.engine': 'inf.chip',
  'topbar.mic': 'inf.mic',
  'topbar.notifications': 'inf.bell',
  'topbar.panel': 'inf.panel',

  // ── Right panel ─────────────────────────────────────────────────
  'panel.agents': 'inf.agent',
  'panel.tasks': 'inf.tasks',
  'panel.workspace': 'inf.dashboard',

  // ── Home modules ────────────────────────────────────────────────
  'home.chat': 'inf.chat',
  'home.learn': 'inf.learn',
  'home.canvas': 'inf.canvas',
  'home.code': 'inf.code',
  'home.automation': 'inf.automation',
  'home.agents': 'inf.agent',
  'home.orchestrator': 'inf.orchestrator',
  'home.business': 'inf.business',
  'home.routines': 'inf.routines',
  'home.standing-orders': 'inf.shield',
  'home.memory': 'inf.memory',
  'home.plugins': 'inf.plugins',
  'home.cloud': 'inf.cloud',
  'home.capabilities': 'inf.hex-stack',

  // ── Common actions ──────────────────────────────────────────────
  'action.build': 'inf.build',
  'action.ai': 'inf.sparkle',
  'action.phone': 'inf.phone',

  // ── Agent categories ────────────────────────────────────────────
  'agent.coder': 'inf.code',
  'agent.researcher': 'inf.research',
  'agent.browser': 'inf.globe',
  'agent.writer': 'inf.writer',
  'agent.analyst': 'inf.data',
  'agent.ops': 'inf.devops',
  'agent.finance': 'inf.chart',
  'agent.design': 'inf.design',
  'agent.seo': 'inf.seo',
  'agent.security': 'inf.security',
  'agent.default': 'inf.agent',

  // ── Memory entries ──────────────────────────────────────────────
  'memory.preference': 'inf.preference',
  'memory.project': 'inf.project',
  'memory.document': 'inf.document',
  'memory.chat': 'inf.chat',
  'memory.note': 'inf.note',

  // ── Automations ─────────────────────────────────────────────────
  'automation.manual': 'inf.manual',
  'automation.once': 'inf.once',
  'automation.tool': 'inf.tool',
  'automation.notify': 'inf.bell',
  'automation.script': 'inf.terminal',
  'automation.pulse': 'inf.pulse',
  'automation.link': 'inf.link',
  'automation.trash': 'inf.trash',
  'automation.sun': 'inf.sun',

  // ── AI workspace tabs ───────────────────────────────────────────
  'tab.summary': 'inf.document',
  'tab.business': 'inf.business',
  'tab.feature': 'inf.sparkle',
  'tab.code': 'inf.code',
  'tab.research': 'inf.research',
  'tab.lesson': 'inf.cap',
  'tab.workspace': 'inf.dashboard',
  'tab.chart': 'inf.chart',
  'tab.document': 'inf.document',
  'tab.data': 'inf.data',
  'tab.dashboard': 'inf.dashboard',
  'tab.financial': 'inf.chart',
  'tab.custom': 'inf.gear',
};

const REGISTRY = {
  // ── Common actions / status ─────────────────────────────────────
  'action.add': Plus,
  'action.close': X,
  'action.expand': ChevronDown,
  'action.launch': Rocket,
  'action.send': Play,

  'file.code': FileCode2,
  'file.json': FileJson2,
  'file.text': FileText,

  // ── AI workspace tabs (kept on Lucide) ──────────────────────────
  'tab.quiz': ClipboardList,
  'tab.video': Clapperboard,
  'tab.invoice': ReceiptText,

  'status.done': CheckCircle2,
  'status.idle': Circle,
  'status.working': Loader2,
} satisfies Record<string, LucideIcon>;

export type AppIconName = keyof typeof REGISTRY | keyof typeof CUSTOM;

/** The brand spectrum used by the Infinite mark — violet → cyan.
    Applied to navigation glyphs so the rail reads as the OS identity. */
export const BRAND_GRADIENT: [string, string] = ['#8b5cf6', '#22d3ee'];

interface AppIconProps {
  name: AppIconName;
  className?: string;
  strokeWidth?: number;
  /** Spectrum stroke, applied when the name resolves to a brand glyph. */
  gradient?: [string, string];
}

export function AppIcon({ name, className = 'w-4 h-4', strokeWidth = 1.7, gradient }: AppIconProps) {
  const custom = (CUSTOM as Record<string, InfinityIconName>)[name];
  if (custom) return <InfinityIcon name={custom} className={className} strokeWidth={strokeWidth} gradient={gradient} />;
  const Icon = (REGISTRY as Record<string, LucideIcon>)[name];
  if (!Icon) return <InfinityIcon name="inf.chat" className={className} strokeWidth={strokeWidth} />;
  return <Icon className={className} strokeWidth={strokeWidth} aria-hidden="true" />;
}

export function getAppIcon(name: AppIconName): LucideIcon | typeof InfinityIcon {
  const custom = (CUSTOM as Record<string, InfinityIconName>)[name];
  if (custom) {
    const Bound = (props: { className?: string; strokeWidth?: number; gradient?: [string, string] }) => (
      <InfinityIcon
        name={custom}
        className={props.className}
        strokeWidth={props.strokeWidth}
        gradient={props.gradient}
      />
    );
    return Bound as unknown as typeof InfinityIcon;
  }
  return (REGISTRY as Record<string, LucideIcon>)[name];
}
