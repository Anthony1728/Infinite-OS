import { useState } from 'react';
import { useChatStore } from '../../stores/chat';

interface QuestionBlock {
  type: 'question';
  question: string;
  header?: string;
  options: Array<{ label: string; description?: string }>;
  allowCustom?: boolean;
  questionId: string;
  multiple?: boolean;
}

interface Props {
  block: QuestionBlock;
}

export function QuestionRenderer({ block }: Props) {
  const [selected, setSelected] = useState<string[]>([]);
  const [customValue, setCustomValue] = useState('');
  const [customSelected, setCustomSelected] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [showCustomInput, setShowCustomInput] = useState(false);
  const sendMessage = useChatStore((s) => s.sendMessage);

  const options = block.options || [];
  const isMultiple = !!block.multiple;

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

  const canSubmit = submitted ? false : (selected.length > 0 || (customSelected && customValue.trim().length > 0));

  const submit = () => {
    if (!canSubmit) return;
    setSubmitted(true);
    const parts: string[] = [];
    if (selected.length > 0) {
      const labels = selected.join(', ');
      parts.push(`Selected: ${labels}`);
    }
    if (customSelected && customValue.trim()) {
      parts.push(`Custom: ${customValue.trim()}`);
    }
    const answer = parts.join(' | ');
    const prompt = `Answer to "${block.question}" (${block.header || block.questionId}): ${answer}`;
    void sendMessage(prompt);
  };

  return (
    <div className="my-3 rounded-2xl border border-white/[0.06] bg-[#0c1018]/80 backdrop-blur-xl overflow-hidden shadow-[0_12px_32px_rgba(0,0,0,.35)]">
      {/* Header */}
      <div className="px-4 pt-4 pb-3 border-b border-white/[0.05] bg-gradient-to-r from-violet-500/[0.06] via-cyan-500/[0.06] to-transparent">
        <div className="flex items-center gap-2">
          <span className="inline-flex h-5 w-5 items-center justify-center rounded-md bg-gradient-to-br from-violet-500 to-cyan-400 text-white text-[10px]">?</span>
          <span className="text-[10px] font-semibold tracking-[0.14em] uppercase text-violet-300">
            {block.header || 'Question'}
          </span>
          {isMultiple && <span className="ml-auto text-[10px] text-zinc-500 border border-white/10 rounded-full px-2 py-0.5">Multiple</span>}
        </div>
        <p className="mt-2 text-sm font-medium leading-6 text-zinc-100">{block.question}</p>
      </div>

      {/* Options */}
      <div className="p-3 space-y-2">
        {options.map((opt) => {
          const isSelected = selected.includes(opt.label);
          return (
            <button
              key={opt.label}
              onClick={() => toggle(opt.label)}
              disabled={submitted}
              className={`w-full text-left rounded-xl border px-3 py-3 flex items-start gap-3 transition-all duration-150 ${
                isSelected
                  ? 'bg-gradient-to-r from-violet-500/15 via-cyan-500/10 to-transparent border-violet-500/30 shadow-[0_4px_12px_rgba(139,92,246,.15)]'
                  : 'bg-white/[0.03] border-white/[0.06] hover:bg-white/[0.05] hover:border-white/[0.09] hover:shadow-[0_4px_12px_rgba(0,0,0,.2)]'
              } ${submitted ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'}`}
            >
              <span
                className={`mt-0.5 flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full border text-[10px] transition-colors ${
                  isSelected
                    ? 'bg-gradient-to-br from-violet-500 to-cyan-400 border-transparent text-white'
                    : 'border-white/15 bg-white/5 text-transparent'
                }`}
              >
                ✓
              </span>
              <span className="min-w-0 flex-1">
                <span className={`block text-sm font-medium leading-5 ${isSelected ? 'text-violet-100' : 'text-zinc-200'}`}>{opt.label}</span>
                {opt.description && <span className="block text-xs leading-5 text-zinc-500 mt-0.5">{opt.description}</span>}
              </span>
            </button>
          );
        })}

        {/* Custom input */}
        <button
          onClick={handleCustomToggle}
          disabled={submitted}
          className={`w-full text-left rounded-xl border px-3 py-3 flex items-center gap-3 transition-all ${
            customSelected
              ? 'bg-gradient-to-r from-violet-500/15 via-cyan-500/10 to-transparent border-violet-500/30'
              : 'bg-white/[0.02] border-dashed border-white/10 hover:bg-white/[0.04] hover:border-white/15'
          } ${submitted ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'}`}
        >
          <span
            className={`flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full border text-[10px] ${
              customSelected ? 'bg-gradient-to-br from-violet-500 to-cyan-400 border-transparent text-white' : 'border-white/15 bg-white/5 text-transparent'
            }`}
          >
            ✓
          </span>
          <span className={`text-sm ${customSelected ? 'text-violet-100 font-medium' : 'text-zinc-400'}`}>Type your own answer</span>
          <span className="ml-auto text-xs text-zinc-600">Custom</span>
        </button>

        {showCustomInput && (
          <div className="animate-fade-in">
            <textarea
              value={customValue}
              onChange={(e) => setCustomValue(e.target.value)}
              disabled={submitted}
              placeholder="Type your answer here..."
              rows={2}
              className="w-full rounded-xl bg-[#080a10] border border-white/[0.07] px-3 py-2.5 text-sm text-zinc-100 placeholder:text-zinc-600 outline-none focus:border-violet-500/30 focus:bg-[#0a0a14] transition-colors resize-none"
              autoFocus
            />
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="px-3 pb-3 flex items-center justify-between">
        <span className="text-[11px] text-zinc-600">
          {submitted ? 'Answered — continuing…' : isMultiple ? 'Select one or more, or type your own' : 'Select one or type your own'}
        </span>
        <button
          onClick={submit}
          disabled={!canSubmit}
          className={`inline-flex items-center gap-1.5 rounded-full px-4 py-1.5 text-xs font-semibold transition-all ${
            canSubmit
              ? 'bg-gradient-to-r from-violet-600 to-cyan-500 text-white shadow-[0_6px_16px_rgba(124,58,237,.3)] hover:from-violet-500 hover:to-cyan-400 active:scale-[0.98]'
              : 'bg-white/5 text-zinc-500 border border-white/5 cursor-not-allowed'
          }`}
        >
          {submitted ? 'Sent ✓' : 'Submit'}
        </button>
      </div>
    </div>
  );
}
