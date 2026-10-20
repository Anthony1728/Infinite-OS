// AskUserQuestion — the cards an agent shows when it genuinely needs a decision
// from the user.
//
// These used to live inside ChatView, which meant the agent could block on a
// question and the cards were only reachable from the Chats tab. If you were in
// Voice, Files, the Terminal or anywhere else, the agent was silently waiting on
// a question you could not see — the worst possible failure mode for a blocked
// run. `QuestionOverlay` mounts once at the app shell, so the pending question
// surfaces wherever you happen to be.
//
// The card itself is the same component ChatView uses for in-message question
// blocks, so the two paths look identical.

import { useEffect, useState } from 'react';
import { useChatStore } from '../../stores/chat';

export interface QuestionCardBlock {
  question: string;
  header?: string;
  options: Array<{ label: string; description?: string }>;
  allowCustom?: boolean;
  questionId: string;
  multiple?: boolean;
}

export function QuestionCard({
  block,
  onAnswer,
  onSkip,
  answeredCount,
  totalCount,
}: {
  block: QuestionCardBlock;
  onAnswer: (answer: string) => void;
  onSkip?: () => void;
  answeredCount?: number;
  totalCount?: number;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [customValue, setCustomValue] = useState('');
  const [customSelected, setCustomSelected] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [showCustomInput, setShowCustomInput] = useState(false);
  const isMultiple = !!block.multiple;
  const header = block.header;

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

const OVERLAY_STYLES = `
@keyframes question-overlay-in {
  from { opacity: 0; transform: translateY(14px) scale(.985); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}
.question-overlay { animation: question-overlay-in .32s cubic-bezier(.16,1,.3,1) both; }
.question-overlay__pulse { animation: question-overlay-pulse 1.9s ease-in-out infinite; }
@keyframes question-overlay-pulse {
  0%,100% { opacity: .55; transform: scale(1); }
  50% { opacity: 1; transform: scale(1.15); }
}
@media (prefers-reduced-motion: reduce) {
  .question-overlay, .question-overlay__pulse { animation: none !important; }
}
`;

/**
 * The one place a blocked agent's question becomes visible.
 *
 * Mounted once at the app shell (see App.tsx) rather than inside ChatView, so
 * it appears over Voice, Files, the Terminal, anything. It is deliberately a
 * bottom-right stack rather than a centred modal: the run is blocked, not
 * finished, and you may still want to read what the agent has done so far
 * behind it. Answers resolve the blocked tool call in main — nothing here
 * starts a new message.
 */
export function QuestionOverlay() {
  const pendingQuestion = useChatStore((s) => s.pendingQuestion);
  const resolveQuestion = useChatStore((s) => s.resolveQuestion);
  const [dismissed, setDismissed] = useState(false);
  const requestId = pendingQuestion?.requestId ?? null;

  // A new question set must re-show the overlay even if the user collapsed the
  // previous one — otherwise a second question would arrive invisible.
  useEffect(() => {
    if (requestId) setDismissed(false);
  }, [requestId]);

  if (!pendingQuestion || dismissed) return null;
  const count = pendingQuestion.questions.length;

  return (
    <>
      <style>{OVERLAY_STYLES}</style>
      <div
        className="pointer-events-none fixed bottom-4 right-4 z-[70] flex w-[min(430px,calc(100vw-2rem))] flex-col"
        role="alertdialog"
        aria-live="assertive"
        aria-label="Infinite AI needs your input"
      >
        <div className="question-overlay pointer-events-auto overflow-hidden rounded-2xl border border-violet-400/25 bg-[#0b0d14]/95 shadow-[0_24px_70px_rgba(0,0,0,.66)] backdrop-blur-2xl">
          <div className="flex items-center gap-2.5 border-b border-white/[0.06] bg-gradient-to-r from-violet-500/[0.14] via-cyan-500/[0.08] to-transparent px-4 py-3">
            <span className="question-overlay__pulse inline-block h-2 w-2 rounded-full bg-violet-400" />
            <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-violet-200">
              Infinite AI needs your input
            </span>
            <span className="ml-auto text-[10px] text-zinc-500">
              {count === 1 ? '1 question' : `${count} questions`}
            </span>
            <button
              type="button"
              onClick={() => setDismissed(true)}
              title="Hide for now — the agent stays paused until you answer"
              aria-label="Hide the question"
              className="grid h-5 w-5 place-items-center rounded-md text-zinc-600 transition-colors hover:bg-white/[0.06] hover:text-zinc-300"
            >
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
                <path d="M1.5 1.5l7 7M8.5 1.5l-7 7" />
              </svg>
            </button>
          </div>

          {/* The fade mask matters: without it a card whose footer lands on the
              scroll boundary looks broken rather than scrollable. */}
          <div
            className="max-h-[min(58vh,500px)] overflow-y-auto px-3 py-1 custom-scrollbar"
            style={{
              maskImage: 'linear-gradient(to bottom, #000 0, #000 calc(100% - 28px), transparent 100%)',
              WebkitMaskImage: 'linear-gradient(to bottom, #000 0, #000 calc(100% - 28px), transparent 100%)',
            }}
          >
            {pendingQuestion.questions.map((q, i) => (
              <QuestionCard
                key={q.id}
                block={{
                  questionId: q.id,
                  header: q.header,
                  question: q.question,
                  multiple: q.multiple,
                  options: q.options,
                  allowCustom: q.allowCustom,
                }}
                answeredCount={i}
                totalCount={pendingQuestion.questions.length}
                onAnswer={(answer) => void resolveQuestion({ [q.id]: answer })}
                onSkip={() => void resolveQuestion({}, { [q.id]: true })}
              />
            ))}
          </div>

          <div className="border-t border-white/[0.06] px-4 py-2 text-[10px] leading-relaxed text-zinc-600">
            The agent is paused until you answer. It can be waiting from any section — this panel follows you.
          </div>
        </div>
      </div>
    </>
  );
}