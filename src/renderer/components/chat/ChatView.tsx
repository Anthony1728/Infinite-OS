import { useEffect, useRef, useState, useCallback, useMemo, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import type { ContentBlock, Message, ProviderInfo } from '../../../shared/types';
import { inferExecutionMode, useChatStore, INTENSITY_LABEL, type ActivityItem, type ChatExecutionMode, type Intensity } from '../../stores/chat';
import { ThinkingPanel } from './ThinkingPanel';
import { useAgentsStore } from '../../stores/agents';
import { useEditorStore } from '../../stores/editor';
import { useAuthStore } from '../../stores/auth';
import { useAiTabsStore, type AiTabKind } from '../../stores/aiTabs';
import { InfiniteLogo } from '../brand/InfiniteLogo';
import { CodeBlock } from './CodeBlock';
import { MessageContextMenu, type ContextMenuItem } from './MessageContextMenu';
import { AppIcon, type AppIconName } from '../brand/AppIcon';
import { ProjectCards } from '../layout/ProjectCards';
import { ToolCallCard } from '../tools/ToolCallCard';
import { LiveActivityFeed } from './LiveActivityFeed';
import { MediaBlocks } from './MediaBlocks';
import { QuizRenderer } from './QuizRenderer';
import { PairPanel, type PairSection } from './PairPanel';
import { BrainLearningPanel } from './BrainLearningPanel';
import { useVoiceAssistant } from '../../hooks/useVoiceAssistant';
import { appearanceFromPrompt, useUIStore } from '../../stores/ui';
import { estimateCost, formatCost } from '../../../main/providers/pricing';
import { composerDraft, saveComposerDraft } from '../../lib/composerDrafts';
import { creativeGreeting, dayOfYearSeed } from '../../lib/greeting';
import { useLayoutStore } from '../../stores/layout';
import { useNotificationStore } from '../../stores/notifications';

interface FenceQuestion {
  header: string;
  question: string;
  multiple: boolean;
  options: Array<{ label: string; description?: string }>;
}

/**
 * Parse a ```question fenced block into a card. This is the runtime-proof
 * question path: foreign runtimes (OpenCode local loop) can't call our
 * AskUserQuestion tool, but they CAN emit this fence per the system prompt —
 * and it renders as the same clickable card everywhere.
 * Returns null for anything malformed (renders as a plain code block).
 */
function parseQuestionFence(raw: string): FenceQuestion | null {
  try {
    const data = JSON.parse(raw.trim()) as Record<string, unknown>;
    const question = typeof data.question === 'string' ? data.question.trim().slice(0, 500) : '';
    const rawOptions = Array.isArray(data.options) ? data.options : [];
    const options = rawOptions
      .map((o) => {
        if (typeof o === 'string') return { label: o.trim().slice(0, 120) };
        const opt = o as Record<string, unknown>;
        if (typeof opt.label !== 'string') return null;
        return {
          label: opt.label.trim().slice(0, 120),
          ...(typeof opt.description === 'string' && opt.description.trim()
            ? { description: opt.description.trim().slice(0, 200) }
            : {}),
        };
      })
      .filter((o): o is { label: string; description?: string } => !!o && o.label.length > 0)
      .slice(0, 6);
    if (!question || options.length < 2) return null;
    return {
      header: typeof data.header === 'string' ? data.header.trim().slice(0, 60) : 'Question',
      question,
      multiple: data.multiple === true,
      options,
    };
  } catch {
    return null;
  }
}

function countQuestionFences(text: string): number {
  const matches = text.match(/```question[\s\S]*?```/g);
  return matches ? matches.length : 0;
}

function InteractiveQuestion({ block, onAnswer, onSkip, answeredCount, totalCount }: { block: { question: string; header?: string; options: Array<{ label: string; description?: string }>; allowCustom?: boolean; questionId: string; multiple?: boolean }; onAnswer: (answer: string) => void; onSkip?: () => void; answeredCount?: number; totalCount?: number }) {
  const [selected, setSelected] = useState<string[]>([]);
  const [customValue, setCustomValue] = useState('');
  const [customSelected, setCustomSelected] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [showCustomInput, setShowCustomInput] = useState(false);
  const isMultiple = !!(block as unknown as { multiple?: boolean }).multiple;
  const header = (block as unknown as { header?: string }).header;

  const toggle = (label: string) => {
    if (submitted) return;
    if (isMultiple) {
      setSelected((prev) => (prev.includes(label) ? prev.filter((l) => l !== label) : [...prev, label]));
    } else {
      setSelected([label]);
      setCustomSelected(false);
    }
  };
  const handleCustomToggle = () => {
    if (submitted) return;
    const next = !customSelected;
    setCustomSelected(next);
    setShowCustomInput(next);
    if (!isMultiple && next) setSelected([]);
    if (!next) setCustomValue('');
  };
  const canSubmit = !submitted && (selected.length > 0 || (customSelected && customValue.trim().length > 0));
  const submit = () => {
    if (!canSubmit) return;
    setSubmitted(true);
    const parts: string[] = [];
    if (selected.length > 0) parts.push(selected.join(', '));
    if (customSelected && customValue.trim()) parts.push(customValue.trim());
    onAnswer(parts.join(' | '));
  };
  const skip = () => {
    if (submitted) return;
    setSubmitted(true);
    if (onSkip) onSkip();
    else onAnswer('[skipped]');
  };
  const showProgress = typeof answeredCount === 'number' && typeof totalCount === 'number' && totalCount > 0;

  return (
    <div className="my-3 rounded-2xl border border-white/[0.06] bg-[#0c1018]/80 backdrop-blur-xl overflow-hidden shadow-[0_12px_32px_rgba(0,0,0,.35)]">
      {showProgress && (
        <div className="px-4 pt-3 text-[11px] text-zinc-500">
          {(answeredCount ?? 0) + (submitted ? 1 : 0)} of {totalCount} answered
        </div>
      )}
      <div className="px-4 pt-4 pb-3 border-b border-white/[0.05] bg-gradient-to-r from-violet-500/[0.06] via-cyan-500/[0.06] to-transparent">
        <div className="flex items-center gap-2">
          <span className="inline-flex h-5 w-5 items-center justify-center rounded-md bg-gradient-to-br from-violet-500 to-cyan-400 text-white text-[10px]">?</span>
          <span className="text-[10px] font-semibold tracking-[0.14em] uppercase text-violet-300">{header || 'Question'}</span>
          {isMultiple && <span className="ml-auto text-[10px] text-zinc-500 border border-white/10 rounded-full px-2 py-0.5">Multiple</span>}
        </div>
        <p className="mt-2 text-sm font-medium leading-6 text-zinc-100">{block.question}</p>
      </div>
      <div className="p-3 space-y-2">
        {block.options.map((opt, oi) => {
          const isSelected = selected.includes(opt.label);
          const letter = String.fromCharCode(65 + oi);
          return (
            <button
              key={opt.label}
              onClick={() => toggle(opt.label)}
              disabled={submitted}
              className={`w-full text-left rounded-xl border px-3 py-3 flex items-start gap-3 transition-all duration-150 ${isSelected ? 'bg-gradient-to-r from-violet-500/15 via-cyan-500/10 to-transparent border-violet-500/30 shadow-[0_4px_12px_rgba(139,92,246,.15)]' : 'bg-white/[0.03] border-white/[0.06] hover:bg-white/[0.05] hover:border-white/[0.09] hover:shadow-[0_4px_12px_rgba(0,0,0,.2)]'} ${submitted ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'}`}
            >
              <span className={`mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-md border text-[11px] font-bold transition-colors ${isSelected ? 'bg-gradient-to-br from-violet-500 to-cyan-400 border-transparent text-white' : 'border-white/15 bg-white/5 text-zinc-500'}`}>{letter}</span>
              <span className="min-w-0 flex-1">
                <span className={`block text-sm font-medium leading-5 ${isSelected ? 'text-violet-100' : 'text-zinc-200'}`}>{opt.label}</span>
                {opt.description && <span className="block text-xs leading-5 text-zinc-500 mt-0.5">{opt.description}</span>}
              </span>
            </button>
          );
        })}
        {block.allowCustom !== false && (
          <>
            <button
              onClick={handleCustomToggle}
              disabled={submitted}
              className={`w-full text-left rounded-xl border px-3 py-3 flex items-center gap-3 transition-all ${customSelected ? 'bg-gradient-to-r from-violet-500/15 via-cyan-500/10 to-transparent border-violet-500/30' : 'bg-white/[0.02] border-dashed border-white/10 hover:bg-white/[0.04] hover:border-white/15'} ${submitted ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'}`}
            >
              <span className={`flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-md border text-[11px] font-bold ${customSelected ? 'bg-gradient-to-br from-violet-500 to-cyan-400 border-transparent text-white' : 'border-white/15 bg-white/5 text-zinc-500'}`}>✎</span>
              <span className={`text-sm ${customSelected ? 'text-violet-100 font-medium' : 'text-zinc-400'}`}>Type your own answer</span>
              <span className="ml-auto text-xs text-zinc-600">Custom</span>
            </button>
            {showCustomInput && (
              <textarea
                value={customValue}
                onChange={(e) => setCustomValue(e.target.value)}
                disabled={submitted}
                placeholder="Type your answer here..."
                rows={2}
                className="w-full rounded-xl bg-[#080a10] border border-white/[0.07] px-3 py-2.5 text-sm text-zinc-100 placeholder:text-zinc-600 outline-none focus:border-violet-500/30 focus:bg-[#0a0a14] transition-colors resize-none"
                autoFocus
              />
            )}
          </>
        )}
      </div>
      <div className="px-3 pb-3 flex items-center justify-between">
        <span className="text-[11px] text-zinc-600">{submitted ? 'Answered — continuing…' : isMultiple ? 'Select one or more, or type your own' : 'Select one or type your own'}</span>
        <div className="flex items-center gap-2">
          {!submitted && (
            <button
              onClick={skip}
              className="rounded-full px-3 py-1.5 text-xs font-medium text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.05] transition-colors"
            >
              Skip
            </button>
          )}
          <button
            onClick={submit}
            disabled={!canSubmit}
            className={`inline-flex items-center gap-1.5 rounded-full px-4 py-1.5 text-xs font-semibold transition-all ${canSubmit ? 'bg-gradient-to-r from-violet-600 to-cyan-500 text-white shadow-[0_6px_16px_rgba(124,58,237,.3)] hover:from-violet-500 hover:to-cyan-400 active:scale-[0.98]' : 'bg-white/5 text-zinc-500 border border-white/5 cursor-not-allowed'}`}
          >
            {submitted ? 'Sent' : 'Confirm and continue'}
            {!submitted && <span aria-hidden>»</span>}
          </button>
        </div>
      </div>
    </div>
  );
}

interface DeploymentStepResult {
  name?: string;
  status?: string;
  output?: string;
}

interface DeploymentPipelineResult {
  id?: string;
  status?: string;
  steps?: DeploymentStepResult[];
}

interface DeploymentEntityResult {
  id: string;
}

interface DeploymentConfigResult {
  commands?: { test?: string };
}

interface ImagePreview {
  id: string;
  data: string;
  mediaType: string;
  name: string;
}
interface FilePreview {
  id: string;
  data: string;
  mimeType: string;
  name: string;
  size: number;
}

const SLASH_COMMANDS = [
  {
    id: 'teach',
    label: 'Teach Brain',
    description: 'Train the Infinite Brain for 10 minutes or 1 hour',
    icon: 'M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09Z',
  },
  {
    id: 'build',
    label: 'Build',
    description: 'Generate or rebuild an application',
    icon: 'M11.42 15.17l-5.1-5.1m0 0L11.42 4.97m-5.1 5.1H21',
  },
  {
    id: 'deploy',
    label: 'Deploy',
    description: 'Deploy to GitHub or cloud',
    icon: 'M15.59 14.37a6 6 0 01-5.84 7.38v-4.8m5.84-2.58a14.98 14.98 0 006.16-12.12A14.98 14.98 0 009.631 8.41m5.96 5.96a14.926 14.926 0 01-5.841 2.58m-.119-8.54a6 6 0 00-7.381 5.84h4.8m2.581-5.84a14.927 14.927 0 00-2.58 5.84m2.691 0a15.02 15.02 0 012.834 5.37',
  },
  {
    id: 'edit',
    label: 'Edit File',
    description: 'Open a file in the code editor',
    icon: 'M17.25 6.75L22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3l-4.5 16.5',
  },
  {
    id: 'video',
    label: 'Generate Video',
    description: 'Create video content with AI',
    icon: 'M15.75 10.5 20.47 5.78A.75.75 0 0121.75 6v12a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25h-9A2.25 2.25 0 002.25 7.5v9a2.25 2.25 0 002.25 2.25z',
  },
  {
    id: 'test',
    label: 'Run Tests',
    description: 'Generate and run tests',
    icon: 'M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19.8 15.3M14.25 3.104c.251.023.501.05.75.082M19.8 15.3l-1.57.393A9.065 9.065 0 0112 15a9.065 9.065 0 00-6.23.693L5 14.5m14.8.8 1.402 1.402c1.232 1.232.65 3.318-1.067 3.611A48.309 48.309 0 0112 21c-2.773 0-5.491-.235-8.135-.687-1.718-.293-2.3-2.379-1.067-3.61L5 14.5',
  },
  {
    id: 'browser',
    label: 'Browse Web',
    description: 'Search, open sites, and act online from chat',
    icon: 'M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 017.843 4.582M12 3a8.997 8.997 0 00-7.843 4.582m15.686 0A11.953 11.953 0 0112 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0121 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0112 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 013 12c0-1.605.42-3.113 1.157-4.418',
  },
  {
    id: 'learn',
    label: 'Learn',
    description: 'Teach a topic, PDF, business idea, or subject fast',
    icon: 'M4.5 6.75 12 3l7.5 3.75L12 10.5 4.5 6.75Zm0 4.5L12 15l7.5-3.75M6.75 13.5v3.75c0 1.24 2.35 2.25 5.25 2.25s5.25-1.01 5.25-2.25V13.5',
  },
  {
    id: 'quiz',
    label: 'Quiz',
    description: 'Create practice questions from notes or a PDF',
    icon: 'M9 9.75h6M9 13.5h3m-6.75 6h13.5A2.25 2.25 0 0 0 21 17.25V6.75A2.25 2.25 0 0 0 18.75 4.5H5.25A2.25 2.25 0 0 0 3 6.75v10.5A2.25 2.25 0 0 0 5.25 19.5Z',
  },
  {
    id: 'summarize',
    label: 'Summarize',
    description: 'Condense documents, pages, notes, and research',
    icon: 'M4.5 6.75h15M4.5 10.5h15M4.5 14.25h9M4.5 18h6',
  },
  {
    id: 'verify',
    label: 'Verify',
    description: 'Typecheck, lint & test the workspace after edits',
    icon: 'M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z',
  },
  {
    id: 'pc',
    label: 'Control PC',
    description: 'Open apps, click, type, capture screen, and automate',
    icon: 'M3.75 5.25h16.5v10.5H3.75V5.25Zm5.25 15h6m-3-4.5v4.5',
  },
  {
    id: 'code',
    label: 'Open Code',
    description: 'Open code editor in right panel',
    icon: 'M17.25 6.75L22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3l-4.5 16.5',
  },
  {
    id: 'agent',
    label: 'Create Agent',
    description: 'Spawn a new AI agent',
    icon: 'M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z',
  },
  {
    id: 'feature',
    label: 'Add Feature',
    description: 'Code a new capability into this workspace',
    icon: 'M12 3v18m9-9H3m13.5-7.5 3 3m-15 9 3 3',
  },
  {
    id: 'theme',
    label: 'Customize UI',
    description: 'Change colors, glow, glass, spacing, or template',
    icon: 'M12 3a9 9 0 1 0 9 9c0-1.1-.9-2-2-2h-1.2a2 2 0 0 1-2-2V6.8A3.8 3.8 0 0 0 12 3Zm-4 8h.01M10 7h.01M8 15h.01M13 17h.01',
  },
  {
    id: 'research',
    label: 'Deep Research',
    description: 'Research with reliable sources directly in chat',
    icon: 'M12 18v-5.25m0 0a6.01 6.01 0 001.5-.189m-1.5.189a6.01 6.01 0 01-1.5-.189m3.75 7.478a12.06 12.06 0 01-4.5 0m3.75 2.383a14.406 14.406 0 01-3 0M14.25 18v-.192c0-.983.658-1.823 1.508-2.316a7.5 7.5 0 10-7.517 0c.85.493 1.509 1.333 1.509 2.316V18',
  },
  {
    id: 'canvas',
    label: 'Infinite Canvas',
    description: 'Design and run visual AI workflows',
    icon: 'M4.5 4.5h6v6h-6v-6Zm9 0h6v6h-6v-6Zm-9 9h6v6h-6v-6Zm9 0h6v6h-6v-6Z',
  },
  {
    id: 'audit',
    label: 'Audit Infinite OS',
    description: 'Find bugs, run checks, and improve the app',
    icon: 'M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z',
  },
  {
    id: 'automate',
    label: 'Run Automation',
    description: 'Execute an automation workflow in chat',
    icon: 'M3.75 13.5L14.25 2.25 12 10.5h8.25L9.75 21.75 12 13.5H3.75z',
  },
  {
    id: 'schedule',
    label: 'Schedule Task',
    description: 'Schedule an action for later (e.g., tomorrow at 9am)',
    icon: 'M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z',
  },
];

const CHAT_MODE_STORAGE_KEY = 'infinite:chat-mode';
const CHAT_AGENT_STORAGE_KEY = 'infinite:chat-agent';
const CHAT_MODE_OPTIONS: Array<{
  id: ChatExecutionMode;
  label: string;
  description: string;
  color: string;
  path: string;
}> = [
  {
    id: 'chat', label: 'Chat Mode', description: 'Natural conversation and help', color: 'text-sky-400',
    path: 'M7.5 8.25h9m-9 3H12m-8.25 7.5 3.6-3.6c.42-.42.99-.66 1.59-.66h8.31A2.25 2.25 0 0 0 19.5 15V6A2.25 2.25 0 0 0 17.25 3.75H6A2.25 2.25 0 0 0 3.75 6v12.75Z',
  },
  {
    id: 'agent', label: 'Agent Mode', description: 'Plan, act, recover, and verify', color: 'text-cyan-400',
    path: 'M9.8 15.9 9 18.75l-.8-2.85a4.5 4.5 0 0 0-3.1-3.1L2.25 12l2.85-.8a4.5 4.5 0 0 0 3.1-3.1L9 5.25l.8 2.85a4.5 4.5 0 0 0 3.1 3.1l2.85.8-2.85.8a4.5 4.5 0 0 0-3.1 3.1Z',
  },
  {
    id: 'research', label: 'Research Mode', description: 'Deep research with reliable sources', color: 'text-violet-400',
    path: 'm21 21-4.35-4.35m2.1-5.4a7.5 7.5 0 1 1-15 0 7.5 7.5 0 0 1 15 0Z',
  },
  {
    id: 'code', label: 'Code Mode', description: 'Inspect, implement, and validate code', color: 'text-blue-400',
    path: 'm8.25 6.75-5.25 5.25 5.25 5.25m7.5-10.5L21 12l-5.25 5.25',
  },
  {
    id: 'build', label: 'Creative Mode', description: 'Create a complete working outcome', color: 'text-fuchsia-400',
    path: 'M12 3v18m9-9H3m13.5-7.5 3 3m-15 9 3 3',
  },
  {
    id: 'plan', label: 'Plan Mode', description: 'Read-only analysis then a step-by-step plan', color: 'text-emerald-400',
    path: 'M12 2.75 4.25 5.6v5.05c0 4.35 2.8 8.4 6.55 10.2.35.15.75.15 1.15 0 3.75-1.8 6.55-5.85 6.55-10.2V5.6Z M8.6 12.3l2.2 2.2 4.5-4.85',
  },
];

function initialChatMode(): ChatExecutionMode {
  const stored = localStorage.getItem(CHAT_MODE_STORAGE_KEY);
  return CHAT_MODE_OPTIONS.some((option) => option.id === stored) ? (stored as ChatExecutionMode) : 'chat';
}

/** Compact token count for the hover turn-stats pill: 940, 1.2k, 18.4k. */
function formatTokenCount(n: number): string {
  if (n < 1000) return String(n);
  if (n < 100_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
  return `${Math.round(n / 1000)}k`;
}

/**
 * Turn duration for an assistant reply: elapsed from the most recent user
 * message before it. Compaction notes and system inserts do not reset the
 * clock — only a real user turn does.
 */
function turnDurationFor(messages: Message[], index: number): number | undefined {
  const reply = messages[index];
  if (reply.role !== 'assistant') return undefined;
  for (let i = index - 1; i >= 0; i -= 1) {
    const msg = messages[i];
    if (msg.role !== 'user') continue;
    const delta = reply.timestamp - msg.timestamp;
    return delta > 0 ? delta : undefined;
  }
  return undefined;
}

/** 42s, 3m 20s — the duration half of the turn-stats pill. */
function formatTurnDuration(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

function initialChatAgent(): string {
  const stored = localStorage.getItem(CHAT_AGENT_STORAGE_KEY);
  // General is the default operator; migrate the legacy 'auto' default once.
  if (stored === null || stored === 'auto') {
    localStorage.setItem(CHAT_AGENT_STORAGE_KEY, 'general');
    return 'general';
  }
  return stored;
}

function workspaceTabForPrompt(text: string): { kind: AiTabKind; title: string } | null {
  const lower = text.toLowerCase();
  const wantsTab = /\b(tab|side\s*tab|workspace|panel)\b/.test(lower);
  const mentionsDocument = /\b(pdf|document|docx|notes|file|article|page|transcript|report)\b/.test(lower);

  if (/\b(quiz|test me|questions)\b/.test(lower)) {
    return { kind: 'quiz', title: 'Generated Quiz' };
  }

  if (/\b(business summary|business brief|business plan|market summary|startup summary)\b/.test(lower)) {
    return { kind: 'business', title: 'Business Summary' };
  }

  if (/\b(summarize|summary|brief|condense|extract key points)\b/.test(lower) && (wantsTab || mentionsDocument)) {
    return { kind: 'summary', title: 'Smart Summary' };
  }

  if (
    /\b(add|create|build|implement|edit|change)\b/.test(lower) &&
    /\b(feature|functionality|source code|codebase|sidebar|side tab|tab)\b/.test(lower)
  ) {
    return { kind: 'feature', title: 'Feature Build' };
  }

  if (wantsTab && /\b(teach|learn|explain|study|understand|soccer terms|formula)\b/.test(lower)) {
    return { kind: 'lesson', title: 'Learning Plan' };
  }

  // Only create a generic workspace when the user explicitly wants to create/open one,
  // not when they are searching for something that happens to contain the word "tab"
  // e.g. "search for something to test tab" should run a search, not create a placeholder workspace
  if (wantsTab && /\b(create|make|build|open|new|generate)\b/.test(lower)) {
    return { kind: 'workspace', title: 'AI Workspace' };
  }
  return null;
}

function ChatAgentIcon({ icon, className = 'h-3.5 w-3.5' }: { icon?: string; className?: string }) {
  const value = icon?.trim();
  const isSvgPath = Boolean(value && /^[Mm]\s*-?[\d.]/.test(value));

  if (isSvgPath) {
    return (
      <svg className={className} fill="none" stroke="currentColor" strokeWidth="1.7" viewBox="0 0 24 24" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" d={value} />
      </svg>
    );
  }

  return <span className="text-xs leading-none" aria-hidden="true">{value || 'A'}</span>;
}

export function ChatView({
  onViewChange,
  onOpenDeploy,
}: {
  onViewChange: (view: string) => void;
  onOpenDeploy: () => void;
}) {
  const messages = useChatStore((s) => s.messages);
  const currentSessionId = useChatStore((s) => s.currentSessionId);
  const streaming = useChatStore((s) => s.streaming);
  const initStreamListener = useChatStore((s) => s.initStreamListener);
  const loadSessions = useChatStore((s) => s.loadSessions);
  const sendMessage = useChatStore((s) => s.sendMessage);
  const openInEditor = useEditorStore((s) => s.openInEditor);
  const createAiTab = useAiTabsStore((s) => s.createTab);
  const [input, setInput] = useState('');
  const [chatMode, setChatMode] = useState<ChatExecutionMode>(initialChatMode);
  // Composer drafts: per-session unsent text that survives navigation and
  // relaunch. Restored when the session changes, saved as you type, cleared
  // when the message actually goes out.
  const draftSessionRef = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (draftSessionRef.current === currentSessionId) return;
    draftSessionRef.current = currentSessionId;
    setInput(composerDraft(currentSessionId));
  }, [currentSessionId]);
  useEffect(() => {
    if (draftSessionRef.current !== undefined) saveComposerDraft(draftSessionRef.current, input);
  }, [input]);
  const [selectedAgentId, setSelectedAgentId] = useState(initialChatAgent);
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  const selectChatMode = useCallback((mode: ChatExecutionMode) => {
    setChatMode(mode);
    localStorage.setItem(CHAT_MODE_STORAGE_KEY, mode);
  }, []);

  const selectAgent = useCallback((agentId: string) => {
    setSelectedAgentId(agentId);
    localStorage.setItem(CHAT_AGENT_STORAGE_KEY, agentId);
  }, []);

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);
  useEffect(() => {
    initStreamListener();
  }, [initStreamListener]);

  const handleSend = useCallback(
    (text: string, imageBlocks?: ContentBlock[]) => {
      if (!text.trim() && !imageBlocks?.length) return;

      const dispatch = (msg: string, mode?: ChatExecutionMode, agent?: string) => {
        sendMessage(msg, imageBlocks, mode, agent).catch((err) => {
          console.error('[chat] sendMessage failed:', err);
          useChatStore.setState({ streaming: false });
        });
      };

      // Convenience shortcuts (open email settings, tweak the UI) should only
      // fire for short, direct commands. A pasted prompt or longer task that
      // merely mentions these words must still be sent to the AI, otherwise
      // the message is silently swallowed and "nothing happens" (no streaming,
      // no tool calls, no response).
      const isShortCommand = text.trim().length <= 160;

      if (
        isShortCommand &&
        /\b(configure|setup|set up|connect|add)\b.*\b(email|mailbox|smtp|imap)\b/i.test(text)
      ) {
        window.dispatchEvent(new Event('infinite:open-settings'));
        setInput('');
        return;
      }

      const isAppearanceRequest =
        isShortCommand &&
        /\b(change|make|switch|customi[sz]e|set|use)\b.*\b(ui|interface|theme|sidebar|bar|color|glow|glass|layout|corners|spacing)\b/i.test(text);
      if (isAppearanceRequest) {
        const patch = appearanceFromPrompt(text);
        if (patch) {
          useUIStore.getState().setAppearance(patch);
          setInput('');
          return;
        }
        window.dispatchEvent(new CustomEvent('infinite:open-personalization', { detail: 'appearance' }));
        setInput('');
        return;
      }

      const openWorkspaceTab = (prompt: string, preferred?: { kind: AiTabKind; title: string }) => {
        const tabMeta = preferred || workspaceTabForPrompt(prompt);
        if (!tabMeta) return;
        const tab = createAiTab({ ...tabMeta, prompt });
        onViewChange(tab.id);
      };

      // Handle slash commands
      if (text.startsWith('/')) {
        const [cmd, ...args] = text.slice(1).split(' ');
        const arg = args.join(' ');

        switch (cmd) {
          case 'teach':
            dispatch(text);
            break;
          case 'build':
            dispatch(`Build me a ${arg || 'modern web application'} with best practices and clean architecture`);
            break;
          case 'deploy':
            (async () => {
              try {
                const settings = JSON.parse(localStorage.getItem('infinite:current') ?? '{}');
                const cwd = settings.cwd ?? '.';
                const result = await window.api.deployQuickPush({
                  cwd,
                  message: `deploy ${arg || new Date().toISOString().slice(0, 19)}`,
                });
                const pipeline = result as DeploymentPipelineResult;
                if (pipeline?.status === 'success') {
                  dispatch(
                    `Deployment complete! All steps succeeded:\n${pipeline.steps?.map((s) => `  - ${s.name}: ${s.status}`).join('\n')}`,
                  );
                } else {
                  const failed = pipeline?.steps?.find((s) => s.status === 'failed');
                  dispatch(`Deployment failed at step "${failed?.name}": ${failed?.output || 'unknown error'}`);
                }
              } catch (e: unknown) {
                dispatch(`Deployment error: ${e instanceof Error ? e.message : String(e)}`);
              }
            })();
            break;
          case 'edit':
            if (arg) {
              openInEditor(arg, `// Editing ${arg}\n// Make your changes here\n`, 'typescript');
            } else {
              openInEditor('untitled.ts', '// New file\n', 'typescript');
            }
            break;
          case 'video':
            dispatch(`Generate a video about: ${arg || 'a compelling product demo'}`);
            break;
          case 'test':
            (async () => {
              try {
                const settings = JSON.parse(localStorage.getItem('infinite:current') ?? '{}');
                const cwd = settings.cwd ?? '.';
                const detected = await window.api.deployDetectProject({ projectPath: cwd });
                const config = (await window.api.deployDefaultConfig({ type: detected || 'node' })) as DeploymentConfigResult;
                const target = await window.api.deployCreateTarget({ name: 'test-run', type: 'local', config: {} });
                const pipeline = await window.api.deployCreatePipeline({
                  name: 'Run Tests',
                  projectId: 'default',
                  targetId: (target as DeploymentEntityResult).id,
                  commands: [config.commands?.test || 'npx vitest run'],
                });
                const result = (await window.api.deployRunPipeline({ pipelineId: (pipeline as DeploymentEntityResult).id, cwd })) as DeploymentPipelineResult;
                if (result?.status === 'success') {
                  dispatch(`Tests passed!\n\n${result.steps?.map((s) => s.output).join('\n')}`);
                } else {
                  dispatch(
                    `Tests failed.\n\n${
                      result?.steps
                        ?.filter((s) => s.status === 'failed')
                        .map((s) => s.output)
                        .join('\n') || 'Unknown error'
                    }`,
                  );
                }
              } catch (e: unknown) {
                dispatch(`Test error: ${e instanceof Error ? e.message : String(e)}`);
              }
            })();
            break;
          case 'browser':
            dispatch(arg ? `Open Chrome and search the web for ${arg}` : 'Open Chrome and wait for my next instruction');
            break;
          case 'learn':
            openWorkspaceTab(text, { kind: 'lesson', title: 'Learning Plan' });
            dispatch(
              `Teach me ${arg || 'this topic'} clearly. Make it useful for a student, entrepreneur, or business owner, with examples, a short study plan, and checks for understanding.`,
            );
            break;
          case 'quiz':
            openWorkspaceTab(text, { kind: 'quiz', title: 'Generated Quiz' });
            dispatch(`Create a quiz from ${arg || 'the attached notes or PDF text'} with answers and explanations.`);
            break;
          case 'summarize':
            openWorkspaceTab(text, { kind: 'summary', title: 'Smart Summary' });
            dispatch(`Summarize ${arg || 'the attached document or notes'} into key ideas, actions, risks, and a study checklist.`);
            break;
          case 'pc':
            dispatch(arg || 'Open Chrome and wait for my next instruction');
            break;
          case 'code':
            dispatch(`Show me the code for: ${arg || 'the main component'}`);
            break;
          case 'agent':
            dispatch(`Create a new AI agent specialized in: ${arg || 'general tasks'}`);
            break;
          case 'feature':
            openWorkspaceTab(text, { kind: 'feature', title: 'Feature Build' });
            dispatch(
              `Implement this requested Infinite OS feature: ${arg || 'describe the feature with me first'}. Inspect the relevant files, make the smallest solid source-code changes, use BuildFeature or targeted edits where appropriate, run validation, and report changed files.`,
            );
            break;
          case 'theme': {
            const patch = appearanceFromPrompt(arg);
            if (patch) useUIStore.getState().setAppearance(patch);
            else window.dispatchEvent(new CustomEvent('infinite:open-personalization', { detail: 'appearance' }));
            break;
          }
          case 'research':
            dispatch(
              `Perform deep research on: ${arg || 'best practices for this project'}. Use reliable current sources, compare important viewpoints, include direct source links, and clearly separate verified facts from conclusions.`,
            );
            break;
          case 'canvas':
            onViewChange('canvas');
            break;
          case 'automate':
            dispatch(arg
              ? `Run this automation in the chat interface: ${arg}. Use the Automation tool to execute the workflow, spawn agents as needed, and report progress here.`
              : 'List all available automations and their status.');
            break;
          case 'schedule':
            dispatch(arg
              ? `Schedule this task: ${arg}. Use the Automation tool to create a scheduled workflow with the specified time and action.`
              : 'What would you like to schedule? Tell me the time and action (e.g., "tomorrow at 9am send email to john@example.com").');
            break;
          case 'audit':
            dispatch(
              'Run a full Infinite OS self-improvement audit now. Inspect the codebase, use the SelfImprove tool if available, fix clear bugs, run validation, and report the changed files.',
            );
            break;
          case 'verify':
            dispatch(
              arg
                ? `Run the Verify tool now, limited to these checks: ${arg}. Fix every failure and re-run until green before summarizing.`
                : 'Run the Verify tool on the current workspace now (quick checks first: typecheck, lint, test). Fix every failure and re-run until green before summarizing.',
            );
            break;
          default:
            dispatch(text);
        }
      } else {
        openWorkspaceTab(text);
        const inferredMode = inferExecutionMode(text);
        selectChatMode(inferredMode);
        dispatch(text, inferredMode, selectedAgentId === 'auto' ? undefined : selectedAgentId);
      }
      setInput('');
    },
    [sendMessage, openInEditor, createAiTab, onViewChange, selectChatMode, selectedAgentId],
  );

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex-1 min-h-0">
        {!currentSessionId ? (
          <DemoChat
            header={<ChatWorkspaceHeader onViewChange={onViewChange} />}
            input={input}
            setInput={setInput}
            inputRef={inputRef}
            onSend={handleSend}
            mode={chatMode}
            onModeChange={selectChatMode}
            selectedAgentId={selectedAgentId}
            onAgentChange={selectAgent}
            workspaceOpen={workspaceOpen}
            onWorkspaceOpenChange={setWorkspaceOpen}
            onOpenWorkspace={() => onViewChange('workspace')}
            onOpenDeploy={onOpenDeploy}
          />
        ) : (
          <RealChat
            header={<ChatWorkspaceHeader onViewChange={onViewChange} />}
            messages={messages}
            streaming={streaming}
            input={input}
            setInput={setInput}
            inputRef={inputRef}
            onSend={handleSend}
            mode={chatMode}
            onModeChange={selectChatMode}
            selectedAgentId={selectedAgentId}
            onAgentChange={selectAgent}
            workspaceOpen={workspaceOpen}
            onWorkspaceOpenChange={setWorkspaceOpen}
            onOpenWorkspace={() => onViewChange('workspace')}
            onOpenDeploy={onOpenDeploy}
          />
        )}
      </div>
    </div>
  );
}

function ChatWorkspaceHeader({ onViewChange }: { onViewChange: (view: string) => void }) {
  const firstName = useAuthStore((state) => state.user?.name?.split(' ')[0] || 'there');
  const { greeting, sub } = useMemo(() => {
    const now = new Date();
    return creativeGreeting({
      firstName,
      hour: now.getHours(),
      weekday: now.getDay(),
      dayOfYear: dayOfYearSeed(now),
    });
  }, [firstName]);

  const modes: { label: string; view: string; icon: AppIconName }[] = [
    { label: 'Chat', view: 'chats', icon: 'home.chat' },
    { label: 'Code', view: 'workspace', icon: 'home.code' },
    { label: 'Canvas', view: 'canvas', icon: 'home.canvas' },
  ];
  return (
    <section className="px-6 pb-2 pt-5 lg:px-10" aria-label="Chat modes and greeting">
      <div className="mx-auto max-w-[660px] text-center">
        <h1 className="text-[20px] font-medium tracking-[-0.025em] text-zinc-100 leading-tight">
          {greeting}, <span className="os-accent-text font-semibold">{firstName}</span>
        </h1>
        <p className="mt-2 text-[12px] text-zinc-500">
          {sub}
        </p>
        <div className="mx-auto mt-4 grid grid-cols-3 gap-1.5 rounded-full border border-white/[0.07] bg-[#0b0f18]/95 p-1.5 shadow-[0_2px_8px_rgba(0,0,0,.35),0_0_0_0.5px_rgba(255,255,255,0.03)]">
          {modes.map((mode, index) => (
            <button
              key={mode.label}
              onClick={() => onViewChange(mode.view)}
              className={`flex h-7 min-w-0 items-center justify-center gap-1.5 rounded-full px-2 text-[10px] transition-all ${index === 0 ? 'os-active-mode text-zinc-100' : 'text-zinc-500 hover:bg-white/[0.04] hover:text-zinc-200'}`}
            >
              <AppIcon
                name={mode.icon}
                className={`h-3.5 w-3.5 flex-none ${index === 0 ? 'os-accent-text' : 'text-zinc-500'}`}
                strokeWidth={1.75}
              />
              {mode.label}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

function InputBar({
  input,
  setInput,
  inputRef,
  onSend,
  mode,
  onModeChange,
  selectedAgentId,
  onAgentChange,
  placeholder,
  isOnline = false,
  workspaceOpen,
  onWorkspaceOpenChange,
  onOpenWorkspace,
  onOpenDeploy,
  streaming = false,
  onAbort,
}: {
  input: string;
  setInput: (v: string) => void;
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
  onSend: (text: string, images?: ContentBlock[]) => void;
  mode: ChatExecutionMode;
  onModeChange: (mode: ChatExecutionMode) => void;
  selectedAgentId: string;
  onAgentChange: (agentId: string) => void;
  placeholder?: string;
  isOnline?: boolean;
  workspaceOpen: boolean;
  onWorkspaceOpenChange: (open: boolean) => void;
  onOpenWorkspace: () => void;
  onOpenDeploy: () => void;
  streaming?: boolean;
  onAbort?: () => void;
}) {
  const [showSlashMenu, setShowSlashMenu] = useState(false);
  const [selectedSlashIndex, setSelectedSlashIndex] = useState(0);
  // Custom /commands (user-defined Markdown files in the profile commands dir).
  const [customCommands, setCustomCommands] = useState<Array<{ id: string; label: string; description: string; icon: string; custom: true; template: string }>>([]);
  const [customCommandsDir, setCustomCommandsDir] = useState('');
  const customCommandsRef = useRef<Array<{ id: string; template: string }>>([]);
  const refreshCustomCommands = async () => {
    try {
      const res = (await window.api.customCommandsList()) as {
        ok: boolean;
        dir?: string;
        commands?: Array<{ name: string; description: string; template: string }>;
      };
      if (res.ok && Array.isArray(res.commands)) {
        const customs = res.commands.map((c) => ({
          id: c.name,
          label: `/${c.name}`,
          description: c.description,
          icon: 'M16 18l6-6-6-6M8 6l-6 6 6 6',
          custom: true as const,
          template: c.template,
        }));
        setCustomCommands(customs);
        customCommandsRef.current = res.commands.map((c) => ({ id: c.name, template: c.template }));
        if (res.dir) setCustomCommandsDir(res.dir);
      }
    } catch {
      /* custom commands are optional — built-ins always work */
    }
  };
  useEffect(() => {
    void refreshCustomCommands();
  }, []);
  useEffect(() => {
    if (showSlashMenu) void refreshCustomCommands();
  }, [showSlashMenu]);
  const [modeMenuOpen, setModeMenuOpen] = useState(false);
  const [agentMenuOpen, setAgentMenuOpen] = useState(false);
  const [model2MenuOpen, setModel2MenuOpen] = useState(false);
  const [intensityMenuOpen, setIntensityMenuOpen] = useState(false);
  const intensityMenuRef = useRef<HTMLDivElement | null>(null);
  const [model2Enabled, setModel2Enabled] = useState(false);
  const [model2, setModel2] = useState('');
  const [model2Label, setModel2Label] = useState('');
  const [opponentModels, setOpponentModels] = useState<Array<{ id: string; label: string; provider: string }>>([]);
  const [uncensoredMode, setUncensoredMode] = useState(false);
  const [uncensoredConfirmOpen, setUncensoredConfirmOpen] = useState(false);
  const [images, setImages] = useState<ImagePreview[]>([]);
  const [files, setFiles] = useState<FilePreview[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const [ghost, setGhost] = useState('');
  const slashMenuRef = useRef<HTMLDivElement>(null);
  const atMenuRef = useRef<HTMLDivElement>(null);
  // @-references (Hermes context-references): @query → workspace file attach.
  const [showAtMenu, setShowAtMenu] = useState(false);
  const [atQuery, setAtQuery] = useState('');
  const [atResults, setAtResults] = useState<Array<{ path: string; score?: number }>>([]);
  const [selectedAtIndex, setSelectedAtIndex] = useState(0);
  const atTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const atAnchorRef = useRef<{ start: number } | null>(null);
  const composerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dictationPrefixRef = useRef('');
  // Collapse low-priority controls when the notifications/activity panel is
  // open so everything fits perfectly. The collapse is a smooth width/opacity
  // fade — nothing jumps, nothing gets stuck.
  const activityPanelOpen = useLayoutStore((s) => s.activityPanelOpen);

  // ── Non-annoying ghost autofill: faint suffix (history + common starters), Tab to accept ──
  const COMMON_SUGGESTIONS = useMemo(() => [
    'create an AI agent specialized in ',
    'delete the agent ',
    'help me build a ',
    'explain ',
    'summarize ',
    'fix the bug where ',
    'add a feature to ',
    'search for ',
    'write a ',
    'generate a ',
    'what is ',
    'how do I ',
    'can you ',
    'deploy the project to ',
    'run the tests for ',
    'open the file ',
  ], []);
  useEffect(() => {
    if (input.startsWith('/') || showSlashMenu) { setGhost(''); return; }
    const trimmed = input;
    if (trimmed.length < 2 || trimmed.length > 80 || trimmed.includes('\n')) { setGhost(''); return; }
    const lower = trimmed.toLowerCase();
    // Prefer exact history match first (user's own phrasing)
    try {
      const hist = JSON.parse(localStorage.getItem('infinite:input-history') || '[]') as string[];
      for (const h of hist) {
        if (h.toLowerCase().startsWith(lower) && h.length > trimmed.length && h.length - trimmed.length <= 60) {
          setGhost(h.slice(trimmed.length));
          return;
        }
      }
    } catch { /* ignore */ }
    for (const c of COMMON_SUGGESTIONS) {
      if (c.toLowerCase().startsWith(lower) && c.length > trimmed.length) {
        setGhost(c.slice(trimmed.length));
        return;
      }
    }
    setGhost('');
  }, [input, showSlashMenu, COMMON_SUGGESTIONS]);

  // ── Second model ("work together") optional pairing ─────────────────────
  // Reads persist state on mount, syncs via the storage event.
  useEffect(() => {
    const read = () => {
      try {
        const cur = JSON.parse(localStorage.getItem('infinite:current') ?? '{}');
        setModel2Enabled(Boolean(cur.secondModelEnabled));
        setModel2(cur.model2 ?? '');
        setModel2Label(cur.model2Label ?? '');
      } catch { /* ignore */ }
    };
    read();
    window.addEventListener('storage', read);
    return () => window.removeEventListener('storage', read);
  }, []);

  const refreshOpponentModels = useCallback(async () => {
    try {
      const providers = (await window.api.listProviders()) as Array<ProviderInfo>;
      const list: Array<{ id: string; label: string; provider: string }> = [];
      // Only providers the user actually has access to: keyless ones are
      // always available (ollama/opencode), key-requiring ones need the key.
      const usable: typeof providers = [];
      for (const p of providers) {
        let hasAccess = true;
        if (p.requiresApiKey) {
          try {
            hasAccess = (await window.api.hasProviderKey({ provider: p.id })) as boolean;
          } catch {
            hasAccess = false;
          }
        }
        if (hasAccess) usable.push(p);
      }
      for (const p of usable) {
        try {
          const models = (await window.api.listProviderModels({ provider: p.id })) as Array<{ id: string; label?: string }>;
          for (const m of models.slice(0, 40)) {
            list.push({ id: m.id, label: m.label ?? m.id, provider: p.id });
          }
        } catch { /* provider may be unreachable — skip */ }
        if (list.length > 120) break;
      }
      // De-duplicate by model id (same model may appear under several
      // providers), keeping the first; sort by label for a stable list.
      const seen = new Set<string>();
      const deduped = list.filter((m) => {
        if (seen.has(m.id)) return false;
        seen.add(m.id);
        return true;
      });
      setOpponentModels(deduped);
    } catch { /* ignore */ }
  }, []);

  const persistModel2 = useCallback((patch: { enabled?: boolean; model2?: string; provider2?: string; model2Label?: string }) => {
    try {
      const cur = JSON.parse(localStorage.getItem('infinite:current') ?? '{}');
      const mapped: Record<string, unknown> = {};
      if (patch.enabled !== undefined) mapped.secondModelEnabled = patch.enabled;
      if (patch.model2 !== undefined) mapped.model2 = patch.model2;
      if (patch.provider2 !== undefined) mapped.provider2 = patch.provider2;
      if (patch.model2Label !== undefined) mapped.model2Label = patch.model2Label;
      const next = { ...cur, ...mapped };
      localStorage.setItem('infinite:current', JSON.stringify(next));
      window.dispatchEvent(new Event('storage'));
    } catch { /* ignore */ }
  }, []);

  const mimeFromExt = useCallback((name: string): string => {
    const ext = name.split('.').pop()?.toLowerCase() ?? '';
    const map: Record<string,string> = {
      pdf:'application/pdf', txt:'text/plain', md:'text/markdown', json:'application/json',
      csv:'text/csv', js:'text/javascript', ts:'text/plain', py:'text/x-python',
      html:'text/html', css:'text/css', doc:'application/msword',
      docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      xls:'application/vnd.ms-excel', xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      ppt:'application/vnd.ms-powerpoint', pptx:'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      zip:'application/zip', tar:'application/x-tar', gz:'application/gzip', rar:'application/x-rar-compressed',
      mp3:'audio/mpeg', wav:'audio/wav', mp4:'video/mp4', mov:'video/quicktime',
    };
    return map[ext] ?? 'application/octet-stream';
  }, []);

  const processFile = useCallback((file: File) => {
    const MAX_FILE_MB = 25;
    if (file.size > MAX_FILE_MB * 1024 * 1024) {
      try { useNotificationStore.getState().addToast({ title: 'File too large', message: `${file.name} is too large (max ${MAX_FILE_MB} MB)`, type: 'error' }); } catch { /* toast store unavailable */ }
      return;
    }
    const mime = file.type || mimeFromExt(file.name);
    if (mime.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = (e) => {
        const result = e.target?.result as string | undefined;
        const base64 = result?.split(',')[1];
        if (!base64) return;
        setImages((prev) => [...prev, { id: crypto.randomUUID(), data: base64, mediaType: mime, name: file.name }]);
      };
      reader.readAsDataURL(file);
      return;
    }
    // Any other file — attach as file block (base64)
    const reader = new FileReader();
    reader.onload = (e) => {
      const result = e.target?.result as string | undefined;
      const base64 = result?.split(',')[1];
      if (!base64) return;
      setFiles((prev) => [...prev, { id: crypto.randomUUID(), data: base64, mimeType: mime, name: file.name, size: file.size }]);
    };
    reader.readAsDataURL(file);
  }, [mimeFromExt]);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    Array.from(files).forEach(processFile);
    e.target.value = '';
  }, [processFile]);

  const removeImage = useCallback((id: string) => {
    setImages((prev) => prev.filter((img) => img.id !== id));
  }, []);
  const removeFile = useCallback((id: string) => {
    setFiles((prev) => prev.filter((f) => f.id !== id));
  }, []);

  const toImageBlocks = useCallback((): ContentBlock[] | undefined => {
    const out: ContentBlock[] = [];
    for (const img of images) out.push({ type: 'image' as const, source: { type: 'base64' as const, mediaType: img.mediaType, data: img.data } });
    for (const f of files) out.push({ type: 'file' as const, name: f.name, mimeType: f.mimeType, data: f.data });
    return out.length ? out : undefined;
  }, [images, files]);

  const send = useCallback(() => {
    if (!input.trim() && images.length === 0 && files.length === 0) return;
    // Expand @-referenced workspace files into quoted context (Hermes @-syntax).
    // Async but non-blocking: send immediately with whatever resolves fast.
    const raw = input;
    // Expand a custom /command into its template before anything else, so the
    // parent dispatch sees plain prompt text (built-ins are handled there).
    const slashMatch = /^\/([a-z0-9][a-z0-9-_]{0,31})([\s\S]*)$/.exec(raw.trim());
    const customHit = slashMatch ? customCommandsRef.current.find((c) => c.id === slashMatch[1]) : undefined;
    let rawExpanded = raw;
    if (customHit && slashMatch) {
      const argString = (slashMatch[2] ?? '').trim();
      const words = argString ? argString.split(/\s+/) : [];
      rawExpanded = customHit.template
        .replace(/\$ARGS\b/g, argString)
        .replace(/\$([1-9])\b/g, (_m, d) => words[Number(d) - 1] ?? '');
    }
    void (async () => {
      let text = rawExpanded;
      try {
        const refs = Array.from(new Set(Array.from(text.matchAll(/@([^\s@][^\s]*)/g)).map((m) => m[1]).slice(0, 5)));
        if (refs.length) {
          const parts: string[] = [];
          for (const ref of refs) {
            try {
              const res = (await window.api.fileRead({ path: ref })) as
                | { type: 'file'; content: string; isBinary?: boolean; mimeType?: string }
                | { type: 'directory'; entries: Array<{ name: string; isDirectory: boolean }> }
                | { error: string };
              if ('error' in res) continue;
              if (res.type === 'directory') {
                const names = res.entries.slice(0, 50).map((e) => `${e.name}${e.isDirectory ? '/' : ''}`).join('\n');
                parts.push(`[Attached directory: ${ref}]\n${names}`);
              } else if (!res.isBinary && res.content) {
                parts.push(`[Attached file: ${ref}]\n${res.content.slice(0, 12000)}`);
              }
            } catch {
              /* unreadable ref stays as plain text */
            }
          }
          if (parts.length) text = `${parts.join('\n\n')}\n\n${raw}`;
        }
      } catch {
        /* fall back to raw input */
      }
      const blocks = toImageBlocks();
      // Persist to history for ghost autofill (non-annoying: only suggests your own prior prompts)
      try {
        const hist = JSON.parse(localStorage.getItem('infinite:input-history') || '[]') as string[];
        const trimmed = raw.trim();
        if (trimmed.length >= 3 && hist[0] !== trimmed) {
          hist.unshift(trimmed);
          localStorage.setItem('infinite:input-history', JSON.stringify(hist.slice(0, 80)));
        }
      } catch { /* ignore */ }
      onSend(text, blocks);
    })();
    setInput('');
    setGhost('');
    setImages([]);
    setFiles([]);
    setShowSlashMenu(false);
    setShowAtMenu(false);
    if (inputRef.current) inputRef.current.style.height = '';
  }, [input, images, files, onSend, setInput, toImageBlocks, inputRef]);

  const handlePaste = useCallback((e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of Array.from(items)) {
      if (item.kind === 'file') {
        const file = item.getAsFile();
        if (file) {
          e.preventDefault();
          processFile(file);
        }
      }
    }
  }, [processFile]);

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    if (e.dataTransfer?.types.includes('Files')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      setDragActive(true);
    }
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragActive(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragActive(false);
    const files = e.dataTransfer?.files;
    if (!files) return;
    Array.from(files).forEach(processFile);
  }, [processFile]);

  // Prevent Electron from navigating when a file is dropped outside the composer,
  // and clear stuck drag overlay if the drag leaves the window.
  useEffect(() => {
    const onWindowDragOver = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes('Files')) e.preventDefault();
    };
    const onWindowDrop = (e: DragEvent) => e.preventDefault();
    const onWindowDragEnd = () => setDragActive(false);
    window.addEventListener('dragover', onWindowDragOver);
    window.addEventListener('drop', onWindowDrop);
    window.addEventListener('dragend', onWindowDragEnd);
    return () => {
      window.removeEventListener('dragover', onWindowDragOver);
      window.removeEventListener('drop', onWindowDrop);
      window.removeEventListener('dragend', onWindowDragEnd);
    };
  }, []);
  const {
    error: dictationError,
    interimTranscript,
    isListening,
    isSupported,
    startListening,
    stopListening,
    transcript,
  } = useVoiceAssistant();
  const agentTypes = useAgentsStore((state) => state.types);
  const announceUncensoredMode = useChatStore((state) => state.announceUncensoredMode);
  const untilDone = useChatStore((state) => state.untilDone);
  const setUntilDone = useChatStore((state) => state.setUntilDone);
  const intensity = useChatStore((state) => state.intensity);
  const setIntensity = useChatStore((state) => state.setIntensity);
  const activeMode = CHAT_MODE_OPTIONS.find((option) => option.id === mode) ?? CHAT_MODE_OPTIONS[1];
  const selectedAgent = agentTypes.find((agent) => agent.id === selectedAgentId);

  useEffect(() => {
    if (!transcript) return;
    const prefix = dictationPrefixRef.current;
    setInput(`${prefix}${prefix && !/\s$/.test(prefix) ? ' ' : ''}${transcript}`);
  }, [transcript, setInput]);

  useEffect(() => {
    let active = true;
    window.api.getSetting({ key: 'uncensoredMode' })
      .then((value: unknown) => {
        if (active) setUncensoredMode(value === true);
      })
      .catch(() => undefined);
    return () => { active = false; };
  }, []);

  const setUncensoredModePersisted = async (next: boolean) => {
    setUncensoredMode(next);
    const current = JSON.parse(localStorage.getItem('infinite:current') ?? '{}') as { cwd?: string };
    try {
      await window.api.setSetting({
        scope: 'user',
        key: 'uncensoredMode',
        value: next,
        cwd: current.cwd ?? '.',
      });
      if (next) await announceUncensoredMode();
    } catch {
      setUncensoredMode(!next);
    }
    setUncensoredConfirmOpen(false);
    inputRef.current?.focus();
  };

  const toggleUncensoredMode = () => {
    if (uncensoredMode) {
      void setUncensoredModePersisted(false);
      return;
    }
    setUncensoredConfirmOpen(true);
    setAgentMenuOpen(false);
    setModeMenuOpen(false);
  };

  const toggleDictation = () => {
    if (isListening) {
      stopListening();
      inputRef.current?.focus();
      return;
    }
    dictationPrefixRef.current = input;
    startListening();
  };

  const isSlashCommand = input.startsWith('/');
  const slashQuery = isSlashCommand ? input.slice(1).toLowerCase() : '';
  const allCommands = [...SLASH_COMMANDS, ...customCommands];
  const filteredCommands = allCommands.filter(
    (cmd) =>
      cmd.label.toLowerCase().includes(slashQuery) ||
      cmd.description.toLowerCase().includes(slashQuery) ||
      ('id' in cmd && String(cmd.id).toLowerCase().includes(slashQuery)),
  );

  const pickSlashCommand = (cmd: { id: string; custom?: boolean }) => {
    if (cmd.custom) {
      // Custom commands take arguments: complete the name and let the user type args.
      setInput(`/${cmd.id} `);
      setShowSlashMenu(false);
      setGhost('');
      requestAnimationFrame(() => inputRef.current?.focus());
      return;
    }
    onSend(`/${cmd.id}`);
    setInput('');
    setShowSlashMenu(false);
    setGhost('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (showAtMenu && atResults.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedAtIndex((prev) => (prev + 1) % atResults.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedAtIndex((prev) => (prev - 1 + atResults.length) % atResults.length);
        return;
      }
      if (e.key === 'Tab' || e.key === 'Enter') {
        e.preventDefault();
        const pick = atResults[selectedAtIndex];
        const anchor = atAnchorRef.current?.start ?? input.length - atQuery.length - 1;
        const next = `${input.slice(0, Math.max(0, anchor))}@${pick.path} ${input.slice((inputRef.current?.selectionStart ?? input.length))}`;
        setInput(next);
        setShowAtMenu(false);
        requestAnimationFrame(() => {
          if (inputRef.current) {
            const pos = Math.max(0, anchor) + pick.path.length + 2;
            inputRef.current.selectionStart = inputRef.current.selectionEnd = pos;
            inputRef.current.focus();
          }
        });
        return;
      }
      if (e.key === 'Escape') {
        setShowAtMenu(false);
        return;
      }
    }
    if (showSlashMenu && filteredCommands.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedSlashIndex((prev) => (prev + 1) % filteredCommands.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedSlashIndex((prev) => (prev - 1 + filteredCommands.length) % filteredCommands.length);
        return;
      }
      if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) {
        e.preventDefault();
        const cmd = filteredCommands[selectedSlashIndex];
        pickSlashCommand(cmd);
        return;
      }
      if (e.key === 'Escape') {
        setShowSlashMenu(false);
        return;
      }
    }

    // Ghost autofill: Tab or Right Arrow at end accepts faint suggestion (non-annoying: never auto-inserts, only on explicit key)
    if (ghost && !showSlashMenu) {
      if (e.key === 'Tab' || (e.key === 'ArrowRight' && inputRef.current?.selectionStart === input.length && inputRef.current?.selectionEnd === input.length)) {
        e.preventDefault();
        const next = input + ghost;
        setInput(next);
        setGhost('');
        // keep caret at end
        requestAnimationFrame(() => {
          if (inputRef.current) {
            inputRef.current.selectionStart = inputRef.current.selectionEnd = next.length;
          }
        });
        return;
      }
      if (e.key === 'Escape') {
        setGhost('');
        return;
      }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  // Debounce mode inference so every keystroke doesn't synchronously
  // re-render the mode picker (matches the fast visual feel of the
  // one-click Power Center buttons, which have no input at all).
  const modeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    setInput(value);
    setShowSlashMenu(value.startsWith('/'));
    setSelectedSlashIndex(0);
    // @-reference detection: @query before caret → workspace file search.
    const caret = e.target.selectionStart ?? value.length;
    const before = value.slice(0, caret);
    const at = before.match(/@([^\s@]*)$/);
    if (at) {
      const q = at[1];
      setAtQuery(q);
      setSelectedAtIndex(0);
      atAnchorRef.current = { start: caret - q.length - 1 };
      if (atTimerRef.current) clearTimeout(atTimerRef.current);
      atTimerRef.current = setTimeout(() => {
        void (async () => {
          try {
            const res = (await window.api.indexSearch({ query: q || '.', limit: 8 })) as {
              ok: boolean;
              results?: Array<{ file: { path: string }; score: number }>;
            };
            const list = (res.results ?? []).map((r) => ({ path: r.file.path, score: r.score }));
            setAtResults(list.slice(0, 8));
            setShowAtMenu(list.length > 0);
          } catch {
            setShowAtMenu(false);
          }
        })();
      }, 180);
    } else {
      setShowAtMenu(false);
    }
    if (!value.trim() || value.startsWith('/')) return;
    if (modeTimerRef.current) clearTimeout(modeTimerRef.current);
    modeTimerRef.current = setTimeout(() => onModeChange(inferExecutionMode(value)), 180);
  };

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (slashMenuRef.current && !slashMenuRef.current.contains(e.target as Node)) {
        setShowSlashMenu(false);
      }
      if (atMenuRef.current && !atMenuRef.current.contains(e.target as Node)) {
        setShowAtMenu(false);
      }
      if (intensityMenuRef.current && !intensityMenuRef.current.contains(e.target as Node)) {
        setIntensityMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (!workspaceOpen) return;
    const closeWorkspace = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent && event.key === 'Escape') {
        onWorkspaceOpenChange(false);
      } else if (event instanceof MouseEvent && !composerRef.current?.contains(event.target as Node)) {
        onWorkspaceOpenChange(false);
      }
    };
    document.addEventListener('mousedown', closeWorkspace);
    document.addEventListener('keydown', closeWorkspace);
    return () => {
      document.removeEventListener('mousedown', closeWorkspace);
      document.removeEventListener('keydown', closeWorkspace);
    };
  }, [workspaceOpen, onWorkspaceOpenChange]);

  return (
    <div ref={composerRef} className="w-full relative">
      {workspaceOpen && (
        <div className="absolute bottom-full left-0 right-0 z-40 mb-3 animate-fade-in">
          <ProjectCards
            onOpenWorkspace={onOpenWorkspace}
            onOpenDeploy={onOpenDeploy}
            expanded
            onExpandedChange={onWorkspaceOpenChange}
          />
        </div>
      )}
      {/* Slash command menu */}
      {showSlashMenu && filteredCommands.length > 0 && (
        <div
          ref={slashMenuRef}
          className="absolute bottom-full left-0 right-0 mb-2 bg-[#0d0d11] rounded-xl shadow-2xl overflow-hidden z-50"
        >
          <div className="px-3 py-2 text-[10px] text-textMuted uppercase tracking-wider border-b border-white/5">
            Commands
          </div>
          {filteredCommands.map((cmd, i) => (
            <button
              key={('custom' in cmd && cmd.custom ? 'custom:' : 'built-in:') + cmd.id}
              onClick={() => pickSlashCommand(cmd as { id: string; custom?: boolean })}
              className={`w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors ${
                i === selectedSlashIndex
                  ? 'bg-indigo-500/15 text-white'
                  : 'text-zinc-400 hover:bg-white/[0.04] hover:text-white'
              }`}
            >
              <svg
                className="w-4 h-4 flex-shrink-0 text-indigo-400"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d={cmd.icon} />
              </svg>
              <div>
                <div className="text-sm font-medium flex items-center gap-1.5">
                  {cmd.label}
                  {(cmd as { custom?: boolean }).custom === true && (
                    <span className="text-[9px] font-semibold uppercase tracking-wider px-1.5 py-px rounded bg-cyan-500/15 text-cyan-300 border border-cyan-400/20">
                      custom
                    </span>
                  )}
                </div>
                <div className="text-[10px] text-textMuted">{cmd.description}</div>
              </div>
            </button>
          ))}
          {customCommandsDir && (
            <div className="px-3 py-1.5 text-[10px] text-textMuted border-t border-white/5 truncate" title={customCommandsDir}>
              Custom /commands live in commands/ — add a .md file to create your own
            </div>
          )}
        </div>
      )}

      {/* @-reference menu (Hermes context-references): attach workspace files */}
      {showAtMenu && atResults.length > 0 && (
        <div
          ref={atMenuRef}
          className="absolute bottom-full left-0 right-0 mb-2 bg-[#0d0d11] rounded-xl shadow-2xl overflow-hidden z-50"
        >
          <div className="px-3 py-2 text-[10px] text-textMuted uppercase tracking-wider border-b border-white/5">
            Attach file — Tab to insert
          </div>
          {atResults.map((r, i) => (
            <button
              key={r.path}
              onClick={() => {
                const anchor = atAnchorRef.current?.start ?? input.length - atQuery.length - 1;
                const caret = inputRef.current?.selectionStart ?? input.length;
                const next = `${input.slice(0, Math.max(0, anchor))}@${r.path} ${input.slice(caret)}`;
                setInput(next);
                setShowAtMenu(false);
                inputRef.current?.focus();
              }}
              className={`w-full flex items-center gap-3 px-3 py-2 text-left transition-colors ${
                i === selectedAtIndex
                  ? 'bg-indigo-500/15 text-white'
                  : 'text-zinc-400 hover:bg-white/[0.04] hover:text-white'
              }`}
            >
              <svg
                className="w-4 h-4 flex-shrink-0 text-cyan-400"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.5 1.5 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
              </svg>
              <div className="min-w-0">
                <div className="text-sm font-medium truncate font-mono">{r.path}</div>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Input container with glow effect when online */}
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`os-chat-composer relative flex min-h-[104px] flex-col bg-[#0b101a] rounded-xl overflow-visible transition-all duration-300 ${dragActive ? 'ring-2 ring-indigo-400/30' : ''} ${streaming ? 'agent-aura' : ''}`}
        style={streaming ? ({ '--aura-tone': 'rgba(34, 211, 238, 0.75)' } as React.CSSProperties) : undefined}
      >
        {dragActive && (
          <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center rounded-xl bg-indigo-500/10">
            <span className="rounded-lg bg-[#0b101a]/90 px-3 py-1.5 text-xs font-medium text-indigo-300">
              Drop files to attach — images, PDFs, docs, anything
            </span>
          </div>
        )}
        <div className="relative w-full">
          {ghost && (
            <div aria-hidden="true" className="pointer-events-none absolute inset-0 max-h-40 overflow-hidden whitespace-pre-wrap break-words px-5 pt-4 pb-2 pr-4 text-sm leading-6">
              <span className="invisible whitespace-pre-wrap break-words">{input}</span>
              <span className="text-zinc-500/45">{ghost}</span>
            </div>
          )}
          <textarea
            ref={inputRef as React.RefObject<HTMLTextAreaElement>}
            value={input}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            onInput={(e) => {
              const t = e.currentTarget;
              if (!t.value) {
                t.style.height = '';
                return;
              }
              t.style.height = 'auto';
              t.style.height = `${Math.min(t.scrollHeight, 160)}px`;
            }}
            placeholder={placeholder || (isOnline ? 'Ask Infinite OS anything...' : 'Ask the Infinite AI Brain anything...')}
            rows={1}
            aria-label="Message Infinite OS"
            className="os-chat-textarea relative w-full min-h-[56px] max-h-40 overflow-y-auto bg-transparent text-textMain text-sm px-5 pt-4 pb-2 pr-4 outline-none resize-none placeholder:text-textMuted/50"
          />
          {ghost && (
            <span className="pointer-events-none absolute bottom-1 right-3 rounded border border-white/10 bg-white/[0.06] px-1.5 py-0.5 text-[9px] font-medium tracking-wide text-zinc-500">Tab ↹</span>
          )}
        </div>
        {(images.length > 0 || files.length > 0) && (
          <div className="flex flex-wrap gap-2 px-4 pt-1">
            {images.map((img) => (
              <div key={img.id} className="group relative">
                <img
                  src={`data:${img.mediaType};base64,${img.data}`}
                  alt={img.name}
                  className="h-16 w-16 rounded-lg border border-white/10 object-cover"
                />
                <button
                  type="button"
                  onClick={() => removeImage(img.id)}
                  aria-label={`Remove ${img.name}`}
                  title="Remove image"
                  className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full border border-white/15 bg-zinc-900 text-zinc-400 opacity-0 transition-opacity group-hover:opacity-100 hover:text-white"
                >
                  <svg className="h-2.5 w-2.5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            ))}
            {files.map((f) => (
              <div key={f.id} className="group relative flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-1.5">
                <svg className="h-4 w-4 flex-shrink-0 text-zinc-400" fill="none" stroke="currentColor" strokeWidth="1.7" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.5 1.5 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" /></svg>
                <span className="max-w-[120px] truncate text-[11px] text-zinc-300" title={f.name}>{f.name}</span>
                <span className="text-[9px] text-zinc-500">{(f.size / 1024).toFixed(f.size < 10240 ? 1 : 0)} KB</span>
                <button type="button" onClick={() => removeFile(f.id)} aria-label={`Remove ${f.name}`} className="ml-1 flex h-4 w-4 items-center justify-center rounded-full bg-white/10 text-zinc-400 hover:text-white"><svg className="h-2 w-2" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" /></svg></button>
              </div>
            ))}
          </div>
        )}
        <div className="mt-auto flex flex-wrap items-center gap-2 px-4 pb-3 pt-2">
          <input
            ref={fileInputRef}
            type="file"
            accept="*/*"
            multiple
            onChange={handleFileChange}
            className="hidden"
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            aria-label="Attach a file"
            title="Attach any file — images, PDFs, docs, code, anything. Drag-drop also works."
            className="flex h-8 w-8 flex-none items-center justify-center rounded-lg border border-white/[0.08] text-zinc-500 transition-colors hover:bg-white/[0.04] hover:text-zinc-200"
          >
            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.7" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="m2.25 15.75 5.159-5.159a2.25 2.25 0 0 1 3.182 0l5.159 5.159m-1.5-1.5 1.409-1.409a2.25 2.25 0 0 1 3.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 0 0 1.5-1.5V6a1.5 1.5 0 0 0-1.5-1.5H3.75A1.5 1.5 0 0 0 2.25 6v12a1.5 1.5 0 0 0 1.5 1.5Zm10.5-11.25h.008v.008h-.008V8.25Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z" />
            </svg>
          </button>
          <div className="relative">
            {uncensoredConfirmOpen && (
              <div className="os-uncensored-confirm absolute bottom-11 left-0 z-50 w-80 rounded-xl bg-[#11151f] p-4 shadow-2xl">
                <div className="os-accent-text text-xs font-semibold">Enable Uncensored mode?</div>
                <p className="mt-2 text-[10px] leading-relaxed text-zinc-400">
                  Infinite AI will use maximum authorized autonomy, respond more candidly, avoid unnecessary refusals, and actively try alternative tools when a method fails. Account authentication, tool permissions, privacy, user cancellation, and non-bypassable safety boundaries still apply.
                </p>
                <div className="mt-3 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setUncensoredConfirmOpen(false)}
                    className="rounded-md border border-white/10 px-3 py-1.5 text-[10px] text-zinc-400 hover:text-white"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => void setUncensoredModePersisted(true)}
                    className="os-uncensored-confirm-action rounded-md px-3 py-1.5 text-[10px] font-semibold"
                  >
                    Enable Uncensored
                  </button>
                </div>
              </div>
            )}
            <button
              type="button"
              onClick={toggleUncensoredMode}
              aria-pressed={uncensoredMode}
              aria-label={`Uncensored mode ${uncensoredMode ? 'on' : 'off'}`}
              title="Use maximum authorized autonomy and more candid responses."
              className={`os-uncensored-toggle flex h-8 items-center gap-1.5 rounded-lg border px-2 text-[10px] transition-colors ${uncensoredMode ? 'is-active' : ''}`}
            >
              <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.7" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 3c1.5 3-1 4.5 1 7 1.2 1.5 3 .8 3-1.2 2 2 3 4.1 3 6.2a7 7 0 1 1-14 0c0-2.5 1.3-5 4-7-.2 2.5.7 3.8 2 4.5-.5-3.5 2.5-5.5 1-9.5Z" />
              </svg>
              Uncensored {uncensoredMode ? 'On' : 'Off'}
            </button>
          </div>
          <div className="relative ml-1">
            {agentMenuOpen && (
              <div className="absolute bottom-10 left-0 z-50 max-h-64 w-64 overflow-y-auto rounded-lg bg-[#101521] p-1 shadow-2xl">
                <button
                  type="button"
                  onClick={() => {
                    onAgentChange('auto');
                    setAgentMenuOpen(false);
                    inputRef.current?.focus();
                  }}
                  className={`flex w-full items-center gap-2 rounded-md px-2 py-2 text-left transition-colors ${
                    selectedAgentId === 'auto'
                      ? 'os-mode-menu-active text-zinc-100'
                      : 'text-zinc-400 hover:bg-white/[0.05] hover:text-zinc-100'
                  }`}
                >
                  <span className="flex h-6 w-6 flex-none items-center justify-center rounded-md bg-cyan-500/10 text-cyan-300">&infin;</span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[10px] font-medium">Automatic agent</span>
                    <span className="block truncate text-[9px] text-zinc-600">Choose the best execution path automatically</span>
                  </span>
                  {selectedAgentId === 'auto' && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-cyan-400" />}
                </button>
                {agentTypes.map((agent) => (
                  <button
                    key={agent.id}
                    type="button"
                    onClick={() => {
                      onAgentChange(agent.id);
                      setAgentMenuOpen(false);
                      inputRef.current?.focus();
                    }}
                    className={`flex w-full items-center gap-2 rounded-md px-2 py-2 text-left transition-colors ${
                      selectedAgentId === agent.id
                        ? 'os-mode-menu-active text-zinc-100'
                        : 'text-zinc-400 hover:bg-white/[0.05] hover:text-zinc-100'
                    }`}
                  >
                    <span className="flex h-6 w-6 flex-none items-center justify-center overflow-hidden rounded-md bg-indigo-500/10 text-indigo-300">
                      <ChatAgentIcon icon={agent.icon} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[10px] font-medium">{agent.name}</span>
                      <span className="block truncate text-[9px] text-zinc-600">{agent.description}</span>
                    </span>
                    {selectedAgentId === agent.id && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-cyan-400" />}
                  </button>
                ))}
              </div>
            )}
            <button
              type="button"
              onClick={() => {
                setAgentMenuOpen((open) => !open);
                setModeMenuOpen(false);
              }}
              className="flex h-8 max-w-36 items-center gap-2 rounded-lg px-2 text-[10px] text-zinc-400 transition-colors hover:bg-white/[0.035] hover:text-zinc-200"
              aria-expanded={agentMenuOpen}
              aria-label={`Selected agent: ${selectedAgent?.name ?? 'Automatic'}`}
              title="Select the agent that will execute this request"
            >
              <span className="flex h-4 w-5 flex-none items-center justify-center overflow-visible text-white">
                {selectedAgent ? <ChatAgentIcon icon={selectedAgent.icon} /> : <InfiniteLogo className="h-3 w-5" variant="luminous" />}
              </span>
              <span className="truncate">{selectedAgent?.name ?? 'Auto agent'}</span>
              <svg className={`h-3 w-3 flex-none text-zinc-700 transition-transform ${agentMenuOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" strokeWidth="1.7" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="m6 9 6 6 6-6" />
              </svg>
            </button>
          </div>
          <div className="relative ml-1">
            {modeMenuOpen && (
              <div className="absolute bottom-10 left-0 z-50 w-52 overflow-hidden rounded-lg bg-[#101521] p-1 shadow-2xl">
                {CHAT_MODE_OPTIONS.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => {
                      onModeChange(option.id);
                      setModeMenuOpen(false);
                      inputRef.current?.focus();
                    }}
                    className={`flex w-full items-center gap-2 rounded-md px-2 py-2 text-left transition-colors ${
                      option.id === mode
                        ? 'os-mode-menu-active text-zinc-100'
                        : 'text-zinc-400 hover:bg-white/[0.05] hover:text-zinc-100'
                    }`}
                    aria-pressed={option.id === mode}
                  >
                    <svg className={`h-3.5 w-3.5 flex-none ${option.color}`} fill="none" stroke="currentColor" strokeWidth="1.7" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d={option.path} />
                    </svg>
                    <span className="min-w-0">
                      <span className="block text-[10px] font-medium">{option.label}</span>
                      <span className="block truncate text-[9px] text-zinc-600">{option.description}</span>
                    </span>
                    {option.id === mode && <span className="ml-auto h-1.5 w-1.5 flex-none rounded-full bg-cyan-400 shadow-[0_0_7px_rgba(34,211,238,.8)]" />}
                  </button>
                ))}
              </div>
            )}
            <button
              type="button"
              onClick={() => {
                setModeMenuOpen((open) => !open);
                setAgentMenuOpen(false);
              }}
              className="flex items-center gap-2 h-8 px-2 rounded-lg text-[10px] text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.035] transition-colors"
              aria-expanded={modeMenuOpen}
              aria-label={`Current mode: ${activeMode.label}`}
            >
            <svg
              className="os-accent-text w-3.5 h-3.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d={activeMode.path}
              />
            </svg>
              Auto · {activeMode.label}
              <svg className={`h-3 w-3 text-zinc-700 transition-transform ${modeMenuOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" strokeWidth="1.7" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="m6 9 6 6 6-6" />
              </svg>
            </button>
          </div>
          <div className="relative ml-1">
            {model2MenuOpen && (
              <div className="absolute bottom-10 left-0 z-50 w-72 overflow-hidden rounded-lg bg-[#101521] p-1 shadow-2xl">
                <button
                  type="button"
                  onClick={() => {
                    persistModel2({ enabled: false });
                    setModel2Enabled(false);
                    setModel2MenuOpen(false);
                    inputRef.current?.focus();
                  }}
                  className={`flex w-full items-center gap-2 rounded-md px-2 py-2 text-left transition-colors ${
                    !model2Enabled ? 'os-mode-menu-active text-zinc-100' : 'text-zinc-400 hover:bg-white/[0.05] hover:text-zinc-100'
                  }`}
                  aria-pressed={!model2Enabled}
                >
                  <svg className="h-3.5 w-3.5 flex-none text-zinc-500" fill="none" stroke="currentColor" strokeWidth="1.7" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v12m6-6H6" />
                  </svg>
                  <span className="min-w-0">
                    <span className="block text-[10px] font-medium">Single model</span>
                    <span className="block truncate text-[9px] text-zinc-600">Run with the selected model only</span>
                  </span>
                  {!model2Enabled && <span className="ml-auto h-1.5 w-1.5 flex-none rounded-full bg-cyan-400 shadow-[0_0_7px_rgba(34,211,238,.8)]" />}
                </button>
                <div className="mx-1 my-1 border-t border-white/[0.06]" />
                <button
                  type="button"
                  onClick={() => {
                    void refreshOpponentModels();
                  }}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[9px] font-medium text-cyan-300/80 transition-colors hover:bg-white/[0.05]"
                >
                  <svg className="h-3 w-3 flex-none" fill="none" stroke="currentColor" strokeWidth="1.7" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182" />
                  </svg>
                  Refresh model list
                </button>
                <div className="max-h-56 overflow-y-auto custom-scrollbar">
                  {opponentModels.length === 0 && (
                    <div className="px-2 py-2 text-[9px] text-zinc-600">Loading models across your providers…</div>
                  )}
                  {opponentModels.map((m) => {
                    const isSelected = model2Enabled && model2 === m.id;
                    return (
                      <button
                        key={`${m.provider}/${m.id}`}
                        type="button"
                        onClick={() => {
                          persistModel2({ enabled: true, model2: m.id, provider2: m.provider, model2Label: m.label });
                          setModel2Enabled(true);
                          setModel2(m.id);
                          setModel2Label(m.label);
                          setModel2MenuOpen(false);
                          inputRef.current?.focus();
                        }}
                        className={`flex w-full items-center gap-2 rounded-md px-2 py-2 text-left transition-colors ${
                          isSelected ? 'os-mode-menu-active text-zinc-100' : 'text-zinc-400 hover:bg-white/[0.05] hover:text-zinc-100'
                        }`}
                        aria-pressed={isSelected}
                      >
                        <span className="flex h-4 w-5 flex-none items-center justify-center text-[8px] font-bold uppercase text-cyan-300/70">
                          {m.provider.slice(0, 2)}
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate text-[10px] font-medium">{m.label}</span>
                          <span className="block truncate text-[9px] text-zinc-600">{m.provider}</span>
                        </span>
                        {isSelected && <span className="ml-auto h-1.5 w-1.5 flex-none rounded-full bg-cyan-400 shadow-[0_0_7px_rgba(34,211,238,.8)]" />}
                      </button>
                    );
                  })}
                </div>
                <div className="mx-1 my-1 border-t border-white/[0.06]" />
                <div className="px-2 py-1.5 text-[9px] leading-relaxed text-zinc-600">
                  With two models, the leader you picked runs the show and your chosen second model joins as a specialist — faster, higher quality, still optional.
                </div>
              </div>
            )}
            <button
              type="button"
              onClick={() => {
                setModel2MenuOpen((open) => !open);
                setModeMenuOpen(false);
                setAgentMenuOpen(false);
                void refreshOpponentModels();
              }}
              className={`os-toolbar-collapse flex items-center gap-2 h-8 px-2 rounded-lg text-[10px] text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.035] ${activityPanelOpen ? 'is-collapsed' : ''}`}
              aria-expanded={model2MenuOpen}
              aria-label={model2Enabled ? `Paired model: ${model2Label || model2}` : 'Pair a second model (optional)'}
              title="Optional: pair a second model to work together"
            >
              <svg className={`h-3.5 w-3.5 flex-none ${model2Enabled ? 'text-cyan-300' : 'text-zinc-500'}`} fill="none" stroke="currentColor" strokeWidth="1.7" viewBox="0 0 24 24">
                {model2Enabled ? (
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 2.25 2.25 7.5 12 12.75l9.75-5.25L12 2.25Zm0 10.5v9M18.75 11.75V21c0 .69-1.5 1.25-6.75 1.25s-6.75-.56-6.75-1.25v-9.25" />
                ) : (
                  <>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 12 3 12m0 0 4.5-4.5M3 12l4.5 4.5M9 18l6 0a3 3 0 0 0 3-3l0-6a3 3 0 0 0-3-3l-6 0" />
                  </>
                )}
              </svg>
              {model2Enabled ? '2 models' : 'Pair model'}
              <svg className={`h-3 w-3 text-zinc-700 transition-transform ${model2MenuOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" strokeWidth="1.7" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="m6 9 6 6 6-6" />
              </svg>
            </button>
          </div>

          <div className="flex-1" />
          <div className={`os-toolbar-collapse relative ${activityPanelOpen ? 'is-collapsed' : ''}`} ref={intensityMenuRef}>
            <button
              type="button"
              onClick={() => setIntensityMenuOpen((open) => !open)}
              aria-expanded={intensityMenuOpen}
              title="Intensity — how hard the agent works. Auto infers it from the request; force Low/Medium/High/Max if you want."
              className={`flex h-8 items-center gap-2 rounded-lg px-2.5 text-[10px] font-medium transition-colors ${
                intensity !== 'auto'
                  ? 'text-violet-300 bg-violet-500/15 ring-1 ring-violet-400/30'
                  : 'text-zinc-500 hover:bg-white/[0.035] hover:text-zinc-300'
              }`}
            >
              <span>Intensity</span>
              <span className="text-zinc-400">{INTENSITY_LABEL[intensity]}</span>
              <svg className={`h-3 w-3 text-zinc-600 transition-transform ${intensityMenuOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" strokeWidth="1.7" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="m6 9 6 6 6-6" />
              </svg>
            </button>
            {intensityMenuOpen && (
              <div className="absolute bottom-10 right-0 z-50 w-56 overflow-hidden rounded-xl border border-white/[0.08] bg-[#10141e] p-1 shadow-2xl">
                <div className="px-2 pt-1.5 text-[8px] uppercase tracking-[0.18em] text-zinc-600">Intensity</div>
                {(['auto', 'low', 'medium', 'high', 'max'] as Intensity[]).map((level) => (
                  <button
                    key={level}
                    type="button"
                    onClick={() => {
                      setIntensity(level);
                      setIntensityMenuOpen(false);
                    }}
                    className={`flex w-full items-center justify-between gap-4 rounded-md px-2 py-2 text-left text-[11px] transition-colors ${
                      intensity === level ? 'bg-violet-500/15 text-violet-200' : 'text-zinc-400 hover:bg-white/[0.04] hover:text-zinc-100'
                    }`}
                  >
                    <span>{INTENSITY_LABEL[level]}</span>
                    <span className="text-[8.5px] text-zinc-600">{level === 'auto' ? 'recommended' : level === 'max' ? 'deep work' : level === 'high' ? 'thorough' : level === 'medium' ? 'balanced' : 'quick'}</span>
                  </button>
                ))}
                <div className="border-t border-white/[0.06] px-2 py-1.5 text-[8.5px] leading-snug text-zinc-600">Auto ranges Low–Max and is chosen from your request.</div>
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={() => setUntilDone(!untilDone)}
            aria-pressed={untilDone}
            title="Keep working until done — raises this run's turn budget and instructs the agent to finish and verify every item before replying. Quality over speed."
            className={`os-toolbar-collapse flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[10px] font-medium transition-colors ${
              untilDone
                ? 'text-violet-300 bg-violet-500/15 ring-1 ring-violet-400/30'
                : 'text-zinc-500 hover:bg-white/[0.035] hover:text-zinc-300'
            } ${activityPanelOpen ? 'is-collapsed' : ''}`}
          >
            Until done
          </button>
          <div className="relative flex items-center gap-1.5">
            {(isListening || dictationError) && (
              <div className="os-dictation-status absolute bottom-11 right-0 z-40 w-72 rounded-xl border p-3 shadow-2xl" role="status">
                <div className="text-[10px] font-semibold text-zinc-200">
                  {isListening ? 'Listening — speak naturally' : 'Dictation needs attention'}
                </div>
                <div className="mt-1 text-[9px] leading-relaxed text-zinc-400">
                  {dictationError || interimTranscript || 'Your words will appear in the message box as you speak.'}
                </div>
              </div>
            )}
            <button
              type="button"
              disabled={!isSupported}
              onClick={toggleDictation}
              aria-pressed={isListening}
              aria-label={isListening ? 'Stop standalone dictation' : 'Start standalone dictation'}
              title={isSupported ? 'Standalone speech-to-text — no chat model is used' : 'Speech-to-text is unavailable on this system'}
              className={`os-toolbar-collapse os-dictation-button flex h-8 items-center gap-1.5 rounded-lg border px-2 text-[10px] ${isListening ? 'is-listening' : ''} ${activityPanelOpen ? 'is-collapsed' : ''}`}
              style={undefined}
            >
              <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.7" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 15.75a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v6.75a3 3 0 0 0 3 3Zm6-4.5v1.5a6 6 0 0 1-12 0v-1.5M12 18.75v3" />
              </svg>
              {isListening ? 'Stop' : 'Dictate'}
            </button>
          </div>
          {streaming && onAbort ? (
            <button
              onClick={onAbort}
              aria-label="Stop generating"
              title="Stop generating"
              className="w-9 h-9 rounded-lg flex items-center justify-center transition-all duration-200 bg-red-500/20 text-red-400 hover:bg-red-500/30 hover:text-red-300 animate-pulse"
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <rect x="6" y="6" width="12" height="12" rx="2" />
              </svg>
            </button>
          ) : (
            <button
              onClick={send}
              disabled={!input.trim() && images.length === 0}
              aria-label="Send message"
              className="os-send-button w-9 h-9 rounded-lg flex items-center justify-center transition-all duration-200 text-white disabled:cursor-not-allowed"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5"
                />
              </svg>
            </button>
          )}
          <button
            onClick={async () => { await window.api.miniToggle(); }}
            aria-label="Toggle mini mode"
            title="Mini mode — float a chat bar on your desktop"
            className={`os-toolbar-collapse w-9 h-9 rounded-lg flex items-center justify-center text-zinc-500 hover:text-zinc-200 hover:bg-white/[0.04] ${activityPanelOpen ? 'is-collapsed' : ''}`}
            style={undefined}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.7" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}

function RealChat({
  header,
  messages,
  streaming,
  input,
  setInput,
  inputRef,
  onSend,
  mode,
  onModeChange,
  selectedAgentId,
  onAgentChange,
  workspaceOpen,
  onWorkspaceOpenChange,
  onOpenWorkspace,
  onOpenDeploy,
}: {
  header: ReactNode;
  messages: Message[];
  streaming: boolean;
  input: string;
  setInput: (v: string) => void;
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
  onSend: (text: string) => void;
  mode: ChatExecutionMode;
  onModeChange: (mode: ChatExecutionMode) => void;
  selectedAgentId: string;
  onAgentChange: (agentId: string) => void;
  workspaceOpen: boolean;
  onWorkspaceOpenChange: (open: boolean) => void;
  onOpenWorkspace: () => void;
  onOpenDeploy: () => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const orchestratedTaskId = useChatStore((s) => s.orchestratedTaskId);
  const interject = useChatStore((s) => s.interject);
  const activity = useChatStore((s) => s.activity);
  const providerStatus = useChatStore((s) => s.providerStatus);
  const loadingSession = useChatStore((s) => s.loadingSession);
  const abortChat = useChatStore((s) => s.abort);
  const sessions = useChatStore((s) => s.sessions);
  const selectSession = useChatStore((s) => s.selectSession);
  const abortedCheckpoint = useChatStore((s) => s.abortedCheckpoint);
  const undoAbortedRun = useChatStore((s) => s.undoAbortedRun);
  const [isOnline, setIsOnline] = useState(false);
  const [statsExpanded, setStatsExpanded] = useState(false);

  const sessionStats = useMemo(() => {
    if (messages.length === 0) return null;
    let inputTokens = 0;
    let outputTokens = 0;
    let cacheRead = 0;
    let cost = 0;    const models = new Set<string>();
    for (const m of messages) {
      if (m.usage) {
        inputTokens += m.usage.input ?? 0;
        outputTokens += m.usage.output ?? 0;
        cacheRead += m.usage.cache_read ?? 0;
        // Spend estimate per message (Codex/Claude Code parity): list-price
        // math from providers/pricing.ts; unknown/free models count $0.
        cost += estimateCost({ provider: m.provider, model: m.model, input: m.usage.input ?? 0, output: m.usage.output ?? 0, cache_read: m.usage.cache_read });
      }
      if (m.model) models.add(m.model);
    }
    const first = messages[0]?.timestamp ?? 0;
    const last = messages[messages.length - 1]?.timestamp ?? 0;
    const durationMs = last - first;
    const mins = Math.floor(durationMs / 60_000);
    const secs = Math.floor((durationMs % 60_000) / 1000);
    return {
      inputTokens,
      outputTokens,
      cacheRead,
      cost: formatCost(cost),
      totalTokens: inputTokens + outputTokens,
      models: [...models],
      messageCount: messages.length,
      duration: mins > 0 ? `${mins}m ${secs}s` : `${secs}s`,
    };
  }, [messages]);

  // Check if AI model is online
  useEffect(() => {
    const checkOnlineStatus = async () => {
      try {
        const settings = JSON.parse(localStorage.getItem('infinite:current') ?? '{}');
        const provider = settings.provider ?? 'openrouter';
        const hasKey = await window.api.hasProviderKey({ provider });
        setIsOnline(Boolean(hasKey));
      } catch {
        setIsOnline(false);
      }
    };
    checkOnlineStatus();
    window.addEventListener('storage', checkOnlineStatus);
    return () => window.removeEventListener('storage', checkOnlineStatus);
  }, []);

  // Determine if we should show thinking bubble:
  // Show it only when streaming is active AND the last assistant message has
  // no text yet AND no tool is currently executing (a running tool is already
  // visible as a live ToolCallCard in the transcript).
  const lastMsg = messages[messages.length - 1];
  const isStreamingText =
    lastMsg?.role === 'assistant' &&
    lastMsg.content.some((b) => b.type === 'text' && 'text' in b && (b as { text: string }).text.trim());
  const runningToolIds = new Set(
    activity.filter((a) => a.status === 'running').map((a) => a.toolUseId),
  );
  // Per-tool metadata (streaming input, duration, result, error) is kept in
  // the activity feed so a ToolCallCard can render the complete story of a
  // call — not just the arguments the provider has already finished sending.
  const activityByToolId = useMemo(() => {
    const map = new Map<string, ActivityItem>();
    for (const item of activity) map.set(item.toolUseId, item);
    return map;
  }, [activity]);
  const hasRunningTool = runningToolIds.size > 0;
  // When the inline live-activity feed is showing steps, it carries the
  // "working" signal — don't also render the generic thinking bubble.
  const showThinking = streaming && !isStreamingText && !hasRunningTool && activity.length === 0;

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    // Empty chat (new session): start at the top so the greeting is visible.
    // Slamming to bottom here is what stranded new chats mid-page.
    if (messages.length === 0 && !streaming) el.scrollTop = 0;
    else el.scrollTop = el.scrollHeight;
  }, [messages, streaming, activity]);

  // Handle sending during streaming (interjection)
  const handleSendDuringStream = (text: string) => {
    if (!text.trim()) return;
    interject(text.trim());
    setInput('');
  };

  return (
    <div className="flex flex-col h-full">
      <div ref={scrollRef} className="flex-1 overflow-y-auto chat-scrollbar">
        {header}
        {sessionStats && messages.length > 2 && (
          <div className="mx-6 lg:mx-10 mb-2">
            <button
              onClick={() => setStatsExpanded(!statsExpanded)}
              className="w-full flex items-center gap-3 px-3 py-2 rounded-lg border border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.04] transition-colors text-left group"
            >
              <svg className={`w-3 h-3 text-zinc-500 transition-transform duration-200 ${statsExpanded ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
              </svg>
              <span className="text-[10px] font-medium text-zinc-500 uppercase tracking-wider">Session Stats</span>
              <span className="text-[10px] text-zinc-600">{sessionStats.messageCount} messages</span>
              <span className="text-[10px] text-zinc-600">{sessionStats.totalTokens.toLocaleString()} tokens</span>
              <span className="text-[10px] text-emerald-500/90" title="Estimated spend this session (list price)">{sessionStats.cost}</span>
              <span className="text-[10px] text-zinc-600">{sessionStats.duration}</span>
            </button>
            {statsExpanded && (
              <div className="mt-1 px-3 py-2.5 rounded-lg border border-white/[0.06] bg-white/[0.02] grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div>
                  <div className="text-[9px] text-zinc-600 uppercase tracking-wider">Input Tokens</div>
                  <div className="text-xs font-medium text-zinc-300">{sessionStats.inputTokens.toLocaleString()}</div>
                </div>
                <div>
                  <div className="text-[9px] text-zinc-600 uppercase tracking-wider">Output Tokens</div>
                  <div className="text-xs font-medium text-zinc-300">{sessionStats.outputTokens.toLocaleString()}</div>
                </div>
                <div>
                  <div className="text-[9px] text-zinc-600 uppercase tracking-wider">Cache Read</div>
                  <div className="text-xs font-medium text-zinc-300">{sessionStats.cacheRead.toLocaleString()}</div>
                </div>
                <div>
                  <div className="text-[9px] text-zinc-600 uppercase tracking-wider">Est. Spend</div>
                  <div className="text-xs font-medium text-emerald-400">{sessionStats.cost}</div>
                </div>
                <div>
                  <div className="text-[9px] text-zinc-600 uppercase tracking-wider">Model{sessionStats.models.length > 1 ? 's' : ''}</div>
                  <div className="text-xs font-medium text-zinc-300 truncate">{sessionStats.models.join(', ') || 'Unknown'}</div>
                </div>
              </div>
            )}
          </div>
        )}
        <BrainLearningPanel />
        <div className="flex w-full flex-col gap-5 px-6 py-5 lg:px-10">
          {messages.length === 0 && !streaming && (
            <div className="flex flex-col items-center justify-center py-6 text-center">
              <div className="mb-3 opacity-80">
                <svg width="44" height="44" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <circle cx="32" cy="32" r="30" stroke="currentColor" strokeWidth="1.5" opacity="0.3" />
                  <path d="M22 32L29 39L42 26" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" opacity="0.5" />
                </svg>
              </div>
              <h3 className="text-lg font-medium text-white/90 mb-1">What can I help you with?</h3>
              <p className="text-sm text-white/50 mb-3 max-w-md">I can write code, search the web, control your desktop, manage files, and much more. Just ask.</p>
              <div className="flex flex-wrap gap-2 justify-center max-w-lg">
                {[
                  { label: 'Write a Python script', icon: ' ' },
                  { label: 'Search the web', icon: ' ' },
                  { label: 'Open Chrome', icon: ' ' },
                  { label: 'Create a file', icon: ' ' },
                ].map((s) => (
                  <button
                    key={s.label}
                    onClick={() => { setInput(s.label); inputRef.current?.focus(); }}
                    className="px-3 py-1.5 text-xs rounded-lg border border-white/10 bg-white/5 text-white/70 hover:bg-white/10 hover:text-white/90 transition-colors cursor-pointer"
                  >
                    {s.icon} {s.label}
                  </button>
                ))}
              </div>
              {sessions.length > 0 && (
                <div className="mt-4 w-full max-w-md">
                  <div className="text-[9px] font-semibold text-zinc-600 uppercase tracking-wider mb-2">Recent conversations</div>
                  <div className="space-y-1">
                    {sessions.slice(0, 3).map((s) => (
                      <button
                        key={s.id}
                        onClick={() => selectSession(s.id)}
                        className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg border border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.05] transition-colors text-left group"
                      >
                        <svg className="w-3 h-3 text-zinc-600 group-hover:text-zinc-400 transition-colors" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M3 12.76c0 1.6 1.1 3 2.7 3.2 1.1.2 2.3.3 3.4.4L12 21l2.8-4.1c.2-.3.5-.5.9-.5 1.1-.1 2.3-.2 3.4-.4 1.6-.2 2.7-1.6 2.7-3.2V6.7c0-1.6-1.1-3-2.7-3.2A48 48 0 0 0 12 3c-2.4 0-4.7.2-7 .5C3.4 3.7 2.3 5.1 2.3 6.7v6Z" />
                        </svg>
                        <span className="truncate text-xs text-zinc-400 group-hover:text-zinc-200 transition-colors">{s.title || 'New Chat'}</span>
                        <span className="ml-auto text-[9px] text-zinc-700">{s.message_count} msgs</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <p className="text-xs text-white/30 mt-2">Type <kbd className="px-1.5 py-0.5 rounded bg-white/10 text-white/50 font-mono text-[10px]">/</kbd> for commands</p>
            </div>
          )}
          {loadingSession ? (
            <div className="flex items-center justify-center py-16">
              <span className="relative flex h-8 w-8">
                <span className="absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-25 animate-ping" />
                <span className="relative inline-flex rounded-full h-8 w-8 bg-indigo-500/30 border-2 border-transparent border-t-indigo-400 animate-spin" />
              </span>
              <span className="ml-3 text-sm text-zinc-400">Loading conversation…</span>
            </div>
          ) : messages.map((m, index) => (
            <MessageBubble
              key={m.id}
              message={m}
              // Turn duration: how long the assistant took from the question
              // it is answering (Otto's turn stats, approximated from
              // timestamps — good to the second, which is all it claims).
              turnDurationMs={m.role === 'assistant' ? turnDurationFor(messages, index) : undefined}
              runningToolIds={runningToolIds}
              activityByToolId={activityByToolId}
            />
          ))}
          {showThinking && <ThinkingBubble />}
          {/* A pending AskUserQuestion is rendered by the global QuestionOverlay
              (mounted in App.tsx) so it is reachable from every section, not just
              Chats. Rendering it here as well would show two sets of buttons for
              one blocked tool call. */}
          {abortedCheckpoint && !streaming && (
            <div className="my-2 flex items-center gap-3 rounded-xl border border-amber-400/20 bg-amber-400/[0.05] px-4 py-3">
              <svg className="h-4 w-4 flex-shrink-0 text-amber-300/80" fill="none" stroke="currentColor" strokeWidth="1.7" viewBox="0 0 24 24">
                <path d="M3 3v5h5M3 8a9 9 0 1 1-2.2 5.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span className="min-w-0 flex-1 text-xs text-amber-100/85">
                Run stopped — {abortedCheckpoint.files} file{abortedCheckpoint.files === 1 ? '' : 's'} were changed.
              </span>
              <button
                onClick={() => void undoAbortedRun()}
                className="flex-shrink-0 rounded-full border border-amber-400/30 bg-amber-400/10 px-3 py-1 text-[11px] font-semibold text-amber-200 transition-colors hover:bg-amber-400/20"
              >
                Undo changes
              </button>
            </div>
          )}
          <LiveActivityFeed />
          {streaming && !isStreamingText && activity.length === 0 && (
            <div className="flex items-center gap-2 text-xs text-indigo-400/80 py-1">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75 animate-ping" />
                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-indigo-400" />
              </span>
              {orchestratedTaskId
                ? 'Multiple agents working in parallel…'
                : providerStatus?.label
                  ? `${providerStatus.label}${providerStatus.detail ? ` — ${providerStatus.detail}` : ''}`
                  : 'Infinite AI is thinking…'}
            </div>
          )}
        </div>
      </div>
      <div className="flex-shrink-0 px-6 py-4 lg:px-10">
        <div>
          <InputBar
            input={input}
            setInput={setInput}
            inputRef={inputRef}
            onSend={streaming ? handleSendDuringStream : onSend}
            mode={mode}
            onModeChange={onModeChange}
            selectedAgentId={selectedAgentId}
            onAgentChange={onAgentChange}
            placeholder={streaming ? 'Send a suggestion or update...' : 'Continue the conversation...'}
            isOnline={isOnline}
            workspaceOpen={workspaceOpen}
            onWorkspaceOpenChange={onWorkspaceOpenChange}
            onOpenWorkspace={onOpenWorkspace}
            onOpenDeploy={onOpenDeploy}
            streaming={streaming}
            onAbort={() => void abortChat()}
          />
        </div>
      </div>
    </div>
  );
}

function MessageBubble({
  message,
  turnDurationMs,
  runningToolIds,
  activityByToolId,
}: {
  message: Message;
  turnDurationMs?: number;
  runningToolIds?: Set<string>;
  activityByToolId?: Map<string, ActivityItem>;
}) {
  const isUser = message.role === 'user';
  const isAssistant = message.role === 'assistant';
  const isToolResult = message.role === 'tool';
  const currentSessionId = useChatStore((state) => state.currentSessionId);
  const updateMessage = useChatStore((state) => state.updateMessage);
  const branchSession = useChatStore((state) => state.branchSession);
  const [editing, setEditing] = useState(false);
  const [copied, setCopied] = useState(false);
  const [checkpointState, setCheckpointState] = useState<'idle' | 'checking' | 'restoring'>('idle');
  const [checkpointToast, setCheckpointToast] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);

  const textBlocks = message.content.filter((b) => b.type === 'text');
  // The model's reasoning. Kept separate from `textBlocks` so it can be shown
  // as a collapsible "thinking" panel above the answer instead of being
  // indistinguishable from it.
  const thinkingBlocks = message.content.filter((b) => b.type === 'thinking');
  const thinkingText = thinkingBlocks
    .map((b) => (b.type === 'thinking' ? b.text : ''))
    .join('')
    .trim();
  const toolUseBlocks = message.content.filter((b) => b.type === 'tool_use');
  const imageBlocks = message.content.filter((b) => b.type === 'image');
  // Tool-generated media (ImageGenerator/VideoGen/MusicGen) arrives as `file`
  // blocks carrying a mediaPath; those render inline via MediaBlocks.
  const mediaBlocks = message.content.filter(
    (b) => b.type === 'file' && 'mediaPath' in b,
  ) as Array<Extract<ContentBlock, { type: 'file' }> & { mediaPath: string; mediaKind: 'image' | 'video' | 'audio' }>;
  const questionBlocks = message.content.filter((b) => b.type === 'question') as Array<{ type: 'question'; question: string; options: Array<{ label: string; description?: string }>; allowCustom?: boolean; questionId: string }>;
  const pairSections = message.content.filter((b) => b.type === 'pair') as PairSection[];
  const quizBlocks = message.content.filter((b) => b.type === 'quiz') as Array<{ type: 'quiz'; quizId: string; title: string; description?: string; questions: Array<{ id: string; question: string; options: Array<{ label: string; text: string; isCorrect: boolean }>; explanation?: string }> }>;
  const hasText = textBlocks.some((b) => b.type === 'text' && (b as { text: string }).text.trim());
  // "Still thinking" means the trace is growing and no answer has started yet —
  // exactly the state that used to look like a hang. Declared after `hasText`
  // because it depends on it.
  const thinkingLive = isAssistant && Boolean(thinkingText) && !hasText;
  const plainText = textBlocks
    .map((block) => (block.type === 'text' ? block.text : ''))
    .filter(Boolean)
    .join('\n\n');
  const [draft, setDraft] = useState(plainText);
  const providerName = message.provider === 'opencode'
    ? 'OpenCode Zen'
    : message.provider
        ?.split(/[-_]/)
        .map((part) => part ? part[0].toUpperCase() + part.slice(1) : part)
        .join(' ');
  const modelName = message.model?.split('/').pop()?.replace(/:free$/, '') ?? message.model;
  const provenance = isAssistant && providerName && modelName ? `${providerName} · ${modelName}` : '';
  const usedFallback = Boolean(
    message.requested_provider &&
    message.requested_model &&
    (message.provider !== message.requested_provider || message.model !== message.requested_model),
  );

  if (isToolResult) return null;
  // A message that is only a reasoning trace still has to render: on a local
  // model the whole point of showing thinking is that the user can watch it
  // while the answer is still being produced.
  if (
    !hasText &&
    thinkingBlocks.length === 0 &&
    imageBlocks.length === 0 &&
    mediaBlocks.length === 0 &&
    toolUseBlocks.length === 0 &&
    quizBlocks.length === 0 &&
    pairSections.length === 0
  ) return null;

  const contextMenuItems: ContextMenuItem[] = [
    {
      label: 'Copy text',
      icon: <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="1.7" viewBox="0 0 24 24"><path d="M8 8h11v11H8zM5 16H4V5h11v1" /></svg>,
      onClick: () => { void navigator.clipboard.writeText(plainText); setCopied(true); setTimeout(() => setCopied(false), 1500); },
    },
    ...(isUser ? [{
      label: 'Edit message',
      icon: <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="1.7" viewBox="0 0 24 24"><path d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>,
      onClick: () => setEditing(true),
    }] : []),
    ...(isAssistant && currentSessionId ? [{
      label: 'Branch from here',
      icon: <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="1.7" viewBox="0 0 24 24"><path d="M6 3v12M18 9a3 3 0 01-3 3h-4a3 3 0 00-3 3M6 21l4-8h8l4 8" /></svg>,
      onClick: () => void branchSession(currentSessionId, message.id),
    }] : []),
    ...(isAssistant && currentSessionId ? [{
      label: 'Restore files to here…',
      icon: <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="1.7" viewBox="0 0 24 24"><path d="M3 3v5h5M3 8a9 9 0 1 1-2.2 5.8M21 21v-5h-5" /></svg>,
      onClick: () => void restoreCheckpoint(),
    }] : []),
  ];

  /**
   * Rewind the workspace's files to how they were when this assistant message
   * was produced (Claude Code-style "restore checkpoint" on every message).
   * Finds the closest auto-checkpoint snapshot taken at or before this message.
   */
  const restoreCheckpoint = async () => {
    if (!currentSessionId) return;
    try {
      setCheckpointState('checking');
      const list = await window.api.checkpointList({ taskId: `run-${currentSessionId}`, limit: 20 });
      const checkpoints = (Array.isArray(list) ? list : []) as Array<{ id: string; name: string; timestamp: number }>;
      if (checkpoints.length === 0) {
        setCheckpointToast('No checkpoint available for this message yet.');
      } else {
        const atOrBefore = checkpoints.find((cp) => cp.timestamp <= message.timestamp) ?? checkpoints[checkpoints.length - 1];
        setCheckpointState('restoring');
        const result = (await window.api.checkpointRestore({ id: atOrBefore.id })) as { success?: boolean; rollbackActions?: string[]; error?: string };
        if (result?.success) {
          const n = result.rollbackActions?.length ?? 0;
          setCheckpointToast(n > 0 ? `Restored ${n} file${n === 1 ? '' : 's'} to this message's state.` : 'Workspace already matched this checkpoint.');
        } else {
          setCheckpointToast(result?.error ? `Restore failed: ${result.error}` : 'Restore failed.');
        }
      }
    } catch (err) {
      setCheckpointToast(`Restore failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setCheckpointState('idle');
      setTimeout(() => setCheckpointToast(null), 6000);
    }
  };

  return (
    <>
    <div
      className={`group/message flex gap-5 rounded-xl px-5 py-4 animate-rise-in ${isUser ? 'bg-blue-500/[0.04]' : 'bg-white/[0.02]'}`}
      onContextMenu={(e) => { e.preventDefault(); setContextMenu({ x: e.clientX, y: e.clientY }); }}
    >
      {isAssistant ? (
        <div className="brand-avatar w-8 h-8 flex-shrink-0 mt-0.5">
          <InfiniteLogo className="w-5 h-3" />
        </div>
      ) : isUser ? (
        <div className="w-8 h-8 rounded-full bg-blue-500/15 border border-blue-500/25 flex items-center justify-center text-blue-400 flex-shrink-0 mt-0.5">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z"
            />
          </svg>
        </div>
      ) : null}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className="font-semibold text-textMain text-sm">{isUser ? 'You' : 'Infinite OS'}</span>
          <span className="text-[10px] text-textMuted">
            {new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </span>
          {provenance && (
            <span
              className={`inline-flex min-w-0 max-w-[320px] items-center gap-1.5 rounded-full border px-2 py-0.5 text-[9px] font-medium ${
                usedFallback
                  ? 'border-amber-400/15 bg-amber-400/[0.045] text-amber-200/65'
                  : 'border-white/[0.08] bg-white/[0.035] text-zinc-500'
              }`}
              title={`${usedFallback ? 'Fallback used' : 'Answered by'}: ${message.provider} / ${message.model}`}
              aria-label={`${usedFallback ? 'Fallback used' : 'Answered by'} ${message.provider}, model ${message.model}`}
            >
              <span className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${usedFallback ? 'bg-amber-400/80' : 'bg-emerald-400/80'}`} />
              <span className="flex-shrink-0">{usedFallback ? 'Fallback' : 'Answered'}</span>
              <span aria-hidden="true">·</span>
              <span className="truncate">{provenance}</span>
            </span>
          )}
          {/* Turn stats — Otto-style: hover a reply to see how long it took
              and what it cost in tokens. Hidden while not hovering so the
              header stays calm. */}
          {!isUser && (message.usage || turnDurationMs !== undefined) && (
            <span
              className="hidden sm:inline-flex items-center gap-1 rounded-full border border-white/[0.07] bg-white/[0.03] px-2 py-0.5 font-mono text-[9px] tabular-nums text-zinc-500 opacity-0 group-hover/message:opacity-100 transition-opacity"
              title={`Turn stats${turnDurationMs !== undefined ? ` — took ${formatTurnDuration(turnDurationMs)}` : ''}${message.usage ? ` — ${message.usage.input ?? 0} in · ${message.usage.output ?? 0} out${message.usage.cache_read ? ` · ${message.usage.cache_read} cached` : ''} tokens` : ''}`}
            >
              {turnDurationMs !== undefined && <span>{formatTurnDuration(turnDurationMs)}</span>}
              {message.usage && (
                <>{turnDurationMs !== undefined && <span aria-hidden="true">·</span>}{formatTokenCount(message.usage.input ?? 0)}→{formatTokenCount(message.usage.output ?? 0)} tok</>
              )}
            </span>
          )}
          <div className="ml-auto flex items-center gap-1 opacity-0 group-hover/message:opacity-100 focus-within:opacity-100 transition-opacity">
            <button
              onClick={() => {
                void navigator.clipboard.writeText(plainText);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }}
              className="icon-button w-7 h-7"
              title={copied ? 'Copied!' : 'Copy message'}
              aria-label={copied ? 'Copied!' : 'Copy message'}
            >
              {copied ? (
                <svg className="w-3.5 h-3.5 text-emerald-400" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              ) : (
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="1.7" viewBox="0 0 24 24">
                  <path d="M8 8h11v11H8zM5 16H4V5h11v1" />
                </svg>
              )}
            </button>
            {isUser && (
              <button
                onClick={() => setEditing(true)}
                className="icon-button w-7 h-7"
                title="Edit message"
                aria-label="Edit message"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="1.7" viewBox="0 0 24 24">
                  <path d="m14 5 5 5M4 20l3.5-.8L19 7.7a1.8 1.8 0 0 0-2.6-2.6L5 16.5 4 20Z" />
                </svg>
              </button>
            )}
            {currentSessionId && (
              <button
                onClick={() => void branchSession(currentSessionId, message.id)}
                className="icon-button w-7 h-7"
                title="Branch conversation here"
                aria-label="Branch conversation here"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="1.7" viewBox="0 0 24 24">
                  <path d="M6 3v6a3 3 0 0 0 3 3h6m0 0-3-3m3 3-3 3M6 21v-3" />
                </svg>
              </button>
            )}
            {isAssistant && currentSessionId && (
              <button
                onClick={() => void restoreCheckpoint()}
                disabled={checkpointState !== 'idle'}
                className="icon-button w-7 h-7 disabled:opacity-40"
                title={checkpointState === 'checking' ? 'Finding checkpoint…' : checkpointState === 'restoring' ? 'Restoring files…' : 'Restore workspace files to this message (checkpoint rollback)'}
                aria-label="Restore files to here"
              >
                {checkpointState === 'restoring' ? (
                  <svg className="w-3.5 h-3.5 animate-spin" fill="none" stroke="currentColor" strokeWidth="1.7" viewBox="0 0 24 24">
                    <path d="M21 12a9 9 0 1 1-9-9" strokeLinecap="round" />
                  </svg>
                ) : (
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="1.7" viewBox="0 0 24 24">
                    <path d="M3 3v5h5M3 8a9 9 0 1 1-2.2 5.8M21 21v-5h-5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </button>
            )}
          </div>
        </div>
        {checkpointToast && (
          <div className="mb-2 flex items-center gap-2 rounded-lg border border-indigo-400/20 bg-indigo-400/[0.06] px-3 py-1.5 text-xs text-indigo-200/90">
            <svg className="h-3.5 w-3.5 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth="1.7" viewBox="0 0 24 24">
              <path d="M3 3v5h5M3 8a9 9 0 1 1-2.2 5.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {checkpointToast}
          </div>
        )}
        {editing ? (
          <div className="space-y-2">
            <textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              className="w-full min-h-24 rounded-lg border border-indigo-500/25 bg-black/20 p-3 text-sm text-zinc-200 outline-none focus:border-indigo-400/50 resize-y"
              autoFocus
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => {
                  setDraft(plainText);
                  setEditing(false);
                }}
                className="px-3 py-1.5 text-[10px] text-zinc-500 hover:text-zinc-200"
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  await updateMessage(message.id, draft);
                  setEditing(false);
                }}
                className="rounded-md bg-indigo-500/15 border border-indigo-400/25 px-3 py-1.5 text-[10px] text-indigo-200 hover:bg-indigo-500/25"
              >
                Save edit
              </button>
            </div>
          </div>
        ) : (
          // Chronological flow: text and tool calls render in the exact order
          // they happened (newest at the bottom) — never text-first grouping,
          // so follow-up narration after tools reads naturally without scrolling up.
          <>
          {/* The reasoning, above everything else in the bubble: it is what the
              model did first, and while it streams it is the only thing on screen.
              Collapsed automatically once the answer starts, so a long trace
              never pushes the actual response out of view. */}
          {thinkingText && <ThinkingPanel text={thinkingText} streaming={thinkingLive} />}
          {message.content
            .filter((b) => b.type === 'text' || b.type === 'tool_use' || b.type === 'thinking')
            .map((block, i) => {
              if (block.type === 'thinking') return null;
              if (block.type === 'tool_use') {
                const tu = block as { id: string; name: string; input: unknown };
                const live = activityByToolId?.get(tu.id);
                const isRunning = (live?.status ?? (runningToolIds?.has(tu.id) ? 'running' : 'done')) === 'running';
                return (
                  <div key={`tool-${tu.id || i}`} className="mt-2">
                    <ToolCallCard
                      name={tu.name}
                      input={live?.input ?? tu.input}
                      partialInput={live?.partialInput}
                      status={live?.status ?? (isRunning ? 'running' : 'done')}
                      startTime={live?.timestamp ?? (isRunning ? Date.now() - 1000 : undefined)}
                      endTime={live?.finishedAt}
                      result={live?.result}
                      error={live?.isError ? live.result : undefined}
                    />
                  </div>
                );
              }
              if (block.type !== 'text') return null;
              const text = (block as { text: string }).text;
              if (!text.trim()) return null;
              return (
              <div key={i} className="text-sm text-zinc-300 leading-relaxed">
                <ReactMarkdown
                  remarkPlugins={[remarkGfm, remarkMath]}
                  rehypePlugins={[rehypeKatex]}
                  components={{
                    code({ className, children, ...props }) {
                      const match = /language-(\w+)/.exec(className || '');
                      const rawCode = String(children).replace(/\n$/, '');
                      // ```question fences render as clickable multi-choice cards
                      // (runtime-proof path for foreign runtimes without our tools).
                      if (match?.[1] === 'question') {
                        const fence = parseQuestionFence(rawCode);
                        if (fence) {
                          const fenceTotal = Math.max(1, countQuestionFences(text));
                          return (
                            <InteractiveQuestion
                              block={{
                                question: fence.question,
                                header: fence.header,
                                options: fence.options,
                                multiple: fence.multiple,
                                questionId: `fence:${message.id}:${i}`,
                                allowCustom: true,
                              }}
                              answeredCount={i}
                              totalCount={fenceTotal}
                              onAnswer={(answer) => {
                                useChatStore.getState().sendMessage(`[Question Answer] ${fence.header}: ${answer}`);
                              }}
                              onSkip={() => {
                                useChatStore.getState().sendMessage(`[Question Skipped] ${fence.header}`);
                              }}
                            />
                          );
                        }
                      }
                      const isBlock = String(children).includes('\n');
                      if (isBlock) {
                        return (
                          <CodeBlock
                            code={String(children).replace(/\n$/, '')}
                            language={match?.[1]}
                          />
                        );
                      }
                      return (
                        <code className="px-1.5 py-0.5 rounded bg-white/[0.08] text-[12px] font-mono text-indigo-300" {...props}>
                          {children}
                        </code>
                      );
                    },
                    table({ children }) {
                      return (
                        <div className="my-3 overflow-x-auto rounded-lg border border-white/[0.08]">
                          <table className="w-full text-[12px]">{children}</table>
                        </div>
                      );
                    },
                    th({ children }) {
                      return (
                        <th className="px-3 py-2 text-left font-semibold text-zinc-300 bg-white/[0.04] border-b border-white/[0.08]">
                          {children}
                        </th>
                      );
                    },
                    td({ children }) {
                      return (
                        <td className="px-3 py-2 border-b border-white/[0.04] text-zinc-400">
                          {children}
                        </td>
                      );
                    },
                  }}
                >
                  {text}
                </ReactMarkdown>
              </div>
            );
          })
          }
          </>
        )}
        {questionBlocks.length > 0 && (
          <div className="mt-2 space-y-2">
            {questionBlocks.map((block, i) => (
              <InteractiveQuestion
                key={i}
                block={block}
                answeredCount={i}
                totalCount={questionBlocks.length}
                onAnswer={(answer) => {
                  const sendMessage = useChatStore.getState().sendMessage;
                  sendMessage(`[Question Answer] ${block.questionId}: ${answer}`);
                }}
                onSkip={() => {
                  const sendMessage = useChatStore.getState().sendMessage;
                  sendMessage(`[Question Skipped] ${block.questionId}`);
                }}
              />
            ))}
          </div>
        )}
        {pairSections.length > 0 && (
          <PairPanel sections={pairSections} />
        )}
        {quizBlocks.length > 0 && (
          <div className="mt-3 space-y-3">
            {quizBlocks.map((block, i) => (
              <QuizRenderer
                key={i}
                quiz={{
                  quizId: block.quizId,
                  title: block.title,
                  description: block.description,
                  questions: block.questions,
                }}
                onComplete={(results) => {
                  const sendMessage = useChatStore.getState().sendMessage;
                  sendMessage(
                    `[Quiz Complete] ${results.title}: ${results.correctAnswers}/${results.totalQuestions} correct (${Math.round((results.correctAnswers / results.totalQuestions) * 100)}%)`,
                  );
                }}
              />
            ))}
          </div>
        )}
        {imageBlocks.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2">
            {imageBlocks.map((block, i) => (
              <img
                key={i}
                src={`data:${block.source.mediaType};base64,${block.source.data}`}
                alt="Attached image"
                className="max-h-40 rounded-lg border border-white/10"
              />
            ))}
          </div>
        )}
        {/* Tool-generated media: inline image/video/audio previews with fullscreen lightbox. */}
        {mediaBlocks.length > 0 && <MediaBlocks blocks={mediaBlocks} />}
        {/* Tool calls render inline in the chronological flow above, not here. */}
      </div>
    </div>
    {contextMenu && (
      <MessageContextMenu
        items={contextMenuItems}
        x={contextMenu.x}
        y={contextMenu.y}
        onClose={() => setContextMenu(null)}
      />
    )}
    </>
  );
}

function ThinkingBubble() {
  // Show real progress from the main process (Connecting to …, Streaming
  // …, Switching providers …) instead of a frozen "Reasoning…" caption. If no
  // status has arrived yet, fall back to the original generic copy.
  const providerStatus = useChatStore((s) => s.providerStatus);
  const [elapsed, setElapsed] = useState(0);
  const startedAt = useRef<number>(Date.now());

  useEffect(() => {
    startedAt.current = Date.now();
    const interval = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startedAt.current) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const label = providerStatus?.label ?? 'Thinking';
  const detail = providerStatus?.detail
    ? `${providerStatus.detail} · ${elapsed}s`
    : `Reasoning through your request… · ${elapsed}s`;

  return (
    <div
      className="flex gap-3 items-center rounded-xl px-4 py-3 bg-white/[0.02] animate-in fade-in duration-200"
      role="status"
      aria-live="polite"
    >
      <div className="brand-avatar w-8 h-8 flex-shrink-0 relative">
        <InfiniteLogo className="w-5 h-3" />
        <span className="absolute inset-0 rounded-full border border-indigo-400/30 animate-ping" />
      </div>
      <div className="flex-1 min-w-0 px-1">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-zinc-300">
            {label}
          </span>
          <span className="h-3 w-3 animate-spin rounded-full border border-zinc-700 border-t-zinc-300" aria-hidden="true" />
          <span className="text-[10px] text-indigo-400/60 font-mono">{elapsed}s</span>
        </div>
        <div className="text-[10px] text-textMuted mt-0.5">{detail}</div>
      </div>
    </div>
  );
}

function DemoChat({
  header,
  input,
  setInput,
  inputRef,
  onSend,
  mode,
  onModeChange,
  selectedAgentId,
  onAgentChange,
  workspaceOpen,
  onWorkspaceOpenChange,
  onOpenWorkspace,
  onOpenDeploy,
}: {
  header: ReactNode;
  input: string;
  setInput: (v: string) => void;
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
  onSend: (text: string) => void;
  mode: ChatExecutionMode;
  onModeChange: (mode: ChatExecutionMode) => void;
  selectedAgentId: string;
  onAgentChange: (agentId: string) => void;
  workspaceOpen: boolean;
  onWorkspaceOpenChange: (open: boolean) => void;
  onOpenWorkspace: () => void;
  onOpenDeploy: () => void;
}) {
  const [isOnline, setIsOnline] = useState(false);

  // Check if AI model is online (has API key configured)
  useEffect(() => {
    const checkOnlineStatus = async () => {
      try {
        const settings = JSON.parse(localStorage.getItem('infinite:current') ?? '{}');
        const provider = settings.provider ?? 'openrouter';
        const hasKey = await window.api.hasProviderKey({ provider });
        setIsOnline(!!hasKey);
      } catch {
        setIsOnline(false);
      }
    };
    checkOnlineStatus();
    window.addEventListener('storage', checkOnlineStatus);
    return () => window.removeEventListener('storage', checkOnlineStatus);
  }, []);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      {header}
      <div className="min-h-0 flex-1">
        <div className="flex h-full flex-col items-center justify-center px-4 py-2 sm:px-8">
          {/* Canonical brand mark */}
          <div className="w-28 h-16 mb-3 flex items-center justify-center">
            <InfiniteLogo className="w-24 h-14" animated labelled />
          </div>

          <h2 className="text-base font-semibold text-textMain mb-1.5">What should Infinite do?</h2>
          <p className="text-xs text-textMuted mb-4">
            Learn, quiz, summarize, build, browse, or control the computer from chat.
          </p>

          {/* Minimal quick actions */}
          <div className="flex flex-wrap justify-center gap-2">
            <button
              onClick={() => {
                setInput('Create a quiz from this PDF: ');
                inputRef.current?.focus();
              }}
              className="px-3 py-1.5 rounded-lg bg-white/[0.03] border border-borderSubtle hover:border-indigo-500/30 hover:bg-white/[0.05] text-xs text-textMuted hover:text-textMain transition-all duration-200 flex items-center gap-2"
            >
              <svg
                className="w-4 h-4 text-indigo-400"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M11.42 15.17l-5.1-5.1m0 0L11.42 4.97m-5.1 5.1H21"
                />
              </svg>
              Create quiz
            </button>
            <button
              onClick={() => {
                setInput('Open Chrome and search Amazon for ');
                inputRef.current?.focus();
              }}
              className="px-3 py-1.5 rounded-lg bg-white/[0.03] border border-borderSubtle hover:border-indigo-500/30 hover:bg-white/[0.05] text-xs text-textMuted hover:text-textMain transition-all duration-200 flex items-center gap-2"
            >
              <svg
                className="w-4 h-4 text-cyan-400"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 18v-5.25m0 0a6.01 6.01 0 001.5-.189m-1.5.189a6.01 6.01 0 01-1.5-.189m3.75 7.478a12.06 12.06 0 01-4.5 0m3.75 2.383a14.406 14.406 0 01-3 0M14.25 18v-.192c0-.983.658-1.823 1.508-2.316a7.5 7.5 0 10-7.517 0c.85.493 1.509 1.333 1.509 2.316V18"
                />
              </svg>
              Browse for me
            </button>
            <button
              onClick={() => {
                setInput('Teach me this in soccer terms: ');
                inputRef.current?.focus();
              }}
              className="px-3 py-1.5 rounded-lg bg-white/[0.03] border border-borderSubtle hover:border-indigo-500/30 hover:bg-white/[0.05] text-xs text-textMuted hover:text-textMain transition-all duration-200 flex items-center gap-2"
            >
              <svg
                className="w-4 h-4 text-emerald-400"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M4.5 6.75 12 3l7.5 3.75L12 10.5 4.5 6.75Zm0 4.5L12 15l7.5-3.75M6.75 13.5v3.75c0 1.24 2.35 2.25 5.25 2.25s5.25-1.01 5.25-2.25V13.5"
                />
              </svg>
              Teach me
            </button>
          </div>
        </div>
      </div>

      {/* Input bar */}
      <div className="flex-shrink-0 px-4 py-3 sm:px-8 lg:px-10">
        <div>
          <InputBar
            input={input}
            setInput={setInput}
            inputRef={inputRef}
            onSend={onSend}
            mode={mode}
            onModeChange={onModeChange}
            selectedAgentId={selectedAgentId}
            onAgentChange={onAgentChange}
            isOnline={isOnline}
            workspaceOpen={workspaceOpen}
            onWorkspaceOpenChange={onWorkspaceOpenChange}
            onOpenWorkspace={onOpenWorkspace}
            onOpenDeploy={onOpenDeploy}
          />
        </div>
      </div>
    </div>
  );
}
