import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { StudioAiAction, StudioItem } from '../../../shared/studio';
import { STUDIO_KIND_LABEL } from '../../../shared/studio';
import { toCsv } from '../../../shared/csv';
import { cellMatrix } from '../../lib/sheet';
import { useStudioStore } from '../../stores/studio';
import { useNotificationStore } from '../../stores/notifications';
import { StudioIcon } from './Icons';
import {
  htmlToPlainText,
  parseDeckResult,
  plainTextToSheet,
  requestDocumentApply,
} from './studioUtils';

interface StudioAiPanelProps {
  item: StudioItem;
  onClose: () => void;
}

interface ActionChip {
  action: StudioAiAction;
  label: string;
  hint: string;
  needsSource?: boolean;
}

const DOCUMENT_ACTIONS: ActionChip[] = [
  { action: 'write', label: 'Write', hint: 'Write a first draft from your instruction' },
  { action: 'continue', label: 'Continue', hint: 'Continue from where the document stops', needsSource: true },
  { action: 'rewrite', label: 'Improve', hint: 'Make the selected text clearer and stronger', needsSource: true },
  { action: 'grammar', label: 'Grammar', hint: 'Correct spelling, grammar, and punctuation', needsSource: true },
  { action: 'summarize', label: 'Summarize', hint: 'Condense the text and keep the key facts', needsSource: true },
  { action: 'shorten', label: 'Shorten', hint: 'Tighten the text without losing meaning', needsSource: true },
  { action: 'expand', label: 'Expand', hint: 'Add useful detail to the text', needsSource: true },
  { action: 'formal', label: 'Formal', hint: 'Rewrite in a polished professional register', needsSource: true },
  { action: 'poem', label: 'Poem', hint: 'Write a poem about your subject' },
  { action: 'story', label: 'Story', hint: 'Write a short story from your premise' },
  { action: 'translate', label: 'Translate', hint: 'Translate the selection into another language', needsSource: true },
  { action: 'custom', label: 'Custom', hint: 'Follow your instruction exactly' },
];

const SHEET_ACTIONS: ActionChip[] = [
  { action: 'sheet', label: 'Build table', hint: 'Generate a table as CSV and place it in the grid' },
  { action: 'custom', label: 'Transform', hint: 'Reshape, clean, or analyze the current grid' },
  { action: 'summarize', label: 'Explain', hint: 'Summarize what the numbers say', needsSource: true },
];

const SLIDE_ACTIONS: ActionChip[] = [
  { action: 'deck', label: 'Outline deck', hint: 'Generate a 6–10 slide deck from your brief' },
  { action: 'write', label: 'Write slide', hint: 'Write content for the current slide' },
  { action: 'shorten', label: 'Tighten', hint: 'Shorten the current slide text', needsSource: true },
  { action: 'custom', label: 'Custom', hint: 'Follow your instruction exactly' },
];

export function StudioAiPanel({ item, onClose }: StudioAiPanelProps) {
  const actions = item.kind === 'sheet' ? SHEET_ACTIONS : item.kind === 'slides' ? SLIDE_ACTIONS : DOCUMENT_ACTIONS;
  const [action, setAction] = useState<StudioAiAction>(actions[0].action);
  const [prompt, setPrompt] = useState('');
  const [language, setLanguage] = useState('');
  const [result, setResult] = useState('');
  const [applied, setApplied] = useState('');
  const selectionRef = useRef('');
  const [selectionLength, setSelectionLength] = useState(0);
  const runAi = useStudioStore((state) => state.runAi);
  const aiBusy = useStudioStore((state) => state.aiBusy);
  const update = useStudioStore((state) => state.update);
  const addToast = useNotificationStore((state) => state.addToast);
  const bodyRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    setAction(actions[0].action);
    setResult('');
    setApplied('');
    setPrompt('');
    selectionRef.current = '';
    setSelectionLength(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id]);

  useEffect(() => {
    const capture = () => {
      const selection = window.getSelection();
      const text = selection?.toString().trim() ?? '';
      const anchor = selection?.anchorNode;
      const editor = anchor instanceof Element ? anchor.closest('.studio-editor') : anchor?.parentElement?.closest('.studio-editor');
      if (text && editor) {
        selectionRef.current = text.slice(0, 12_000);
        setSelectionLength(text.length);
      }
    };
    // A writer often selects text first and then opens the panel. Pick up that
    // existing selection now rather than waiting for the next selection event.
    capture();
    document.addEventListener('selectionchange', capture);
    return () => document.removeEventListener('selectionchange', capture);
  }, []);

  const sheetContext = useMemo(() => {
    if (item.kind !== 'sheet' || !item.sheet) return '';
    const cells = item.sheet.cells;
    let lastRow = 0;
    for (const address of Object.keys(cells)) {
      const row = Number(address.replace(/[A-Z]+/g, '')) || 0;
      if (row > lastRow) lastRow = row;
    }
    const columns = Math.min(26, item.sheet.columns);
    const rows = Math.min(200, Math.max(12, lastRow + 1));
    return toCsv(cellMatrix(cells, columns, rows));
  }, [item.kind, item.sheet]);

  const buildContext = (chip: ActionChip): string => {
    if (chip.action === 'sheet') return prompt ? sheetContext.slice(0, 14_000) : '';
    if (item.kind === 'sheet') return sheetContext.slice(0, 14_000);
    if (item.kind === 'slides') {
      if (chip.action === 'write' || chip.action === 'shorten') {
        const slides = item.deck?.slides ?? [];
        const context = slides
          .map((slide, index) => `Slide ${index + 1}\nTitle: ${slide.title}\nBody: ${slide.body}\nNotes: ${slide.notes ?? ''}`)
          .join('\n\n');
        return (selectionRef.current || context).slice(0, 14_000);
      }
      return (selectionRef.current || (item.deck?.slides ?? []).map((slide) => `${slide.title}\n${slide.body}`).join('\n---\n')).slice(0, 14_000);
    }
    const whole = htmlToPlainText(item.html ?? '');
    if (chip.needsSource || chip.action === 'custom') return (selectionRef.current || whole).slice(0, 14_000);
    return selectionRef.current.slice(0, 14_000);
  };

  const generate = async () => {
    const chip = actions.find((candidate) => candidate.action === action) ?? actions[0];
    const instruction = prompt.trim() || (chip.needsSource ? `Please ${chip.label.toLowerCase()} this.` : '');
    if (!instruction && !chip.needsSource && chip.action !== 'sheet' && chip.action !== 'deck') {
      bodyRef.current?.focus();
      return;
    }
    setApplied('');
    const response = await runAi({
      action,
      prompt: instruction,
      context: buildContext(chip),
      language: action === 'translate' ? language.trim() || undefined : undefined,
      kind: item.kind,
    });
    if (response) setResult(response.text);
  };

  const applyDocument = (mode: 'insert' | 'replace' | 'replace-all') => {
    if (!result.trim()) return;
    requestDocumentApply({ itemId: item.id, text: result, mode });
    setApplied(mode === 'replace' ? 'Replaced selection' : mode === 'insert' ? 'Inserted' : 'Document replaced');
    addToast({ type: 'success', title: 'Applied to document' });
  };

  const applySheet = async (mode: 'replace' | 'insert') => {
    if (!result.trim() || !item.sheet) return;
    const sheet = plainTextToSheet(result, item.sheet.columns, item.sheet.rows);
    const cells = mode === 'replace' ? sheet.cells : { ...item.sheet.cells, ...sheet.cells };
    let rows = Math.max(item.sheet.rows, sheet.rows);
    let columns = Math.max(item.sheet.columns, sheet.columns);
    for (const address of Object.keys(cells)) {
      rows = Math.max(rows, Number(address.replace(/[A-Z]+/g, '')) || 0);
      const letters = /^[A-Z]+/.exec(address)?.[0] ?? 'A';
      let column = 0;
      for (const char of letters) column = column * 26 + (char.charCodeAt(0) - 64);
      columns = Math.max(columns, column);
    }
    const updated = await update(item.id, {
      sheet: {
        cells,
        rows: Math.min(500, rows + 2),
        columns: Math.min(64, columns + 1),
      },
    });
    if (updated) {
      setApplied(mode === 'replace' ? 'Sheet replaced' : 'Inserted at A1');
      addToast({ type: 'success', title: 'Applied to sheet' });
    }
  };

  const applyDeck = async (mode: 'replace' | 'append') => {
    if (!result.trim()) return;
    const slides = parseDeckResult(result);
    if (!slides.length) {
      addToast({ type: 'error', title: 'Could not read that deck', message: 'The model did not return slides.' });
      return;
    }
    const existing = item.deck?.slides ?? [];
    const next = mode === 'append' ? [...existing, ...slides] : slides;
    const updated = await update(item.id, { deck: { slides: next.slice(0, 120) } });
    if (updated) {
      setApplied(mode === 'replace' ? `Replaced with ${slides.length} slides` : `Added ${slides.length} slides`);
      addToast({ type: 'success', title: 'Applied to deck' });
    }
  };

  return (
    <aside className="flex w-[358px] shrink-0 flex-col border-l border-white/[0.07] bg-[#0f0f15]">
      <div className="flex items-center gap-2.5 border-b border-white/[0.06] px-4 py-3">
        <span className="grid h-7 w-7 place-items-center rounded-lg bg-gradient-to-br from-violet-500/25 to-cyan-400/15 text-violet-300 ring-1 ring-white/[0.08]">
          <StudioIcon name="sparkles" size={15} />
        </span>
        <div className="min-w-0">
          <div className="text-[12.5px] font-semibold text-zinc-100">Infinite AI</div>
          <div className="truncate text-[10.5px] text-zinc-500">
            Writing inside your {STUDIO_KIND_LABEL[item.kind].toLowerCase()}
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="ml-auto grid h-7 w-7 place-items-center rounded-md text-zinc-500 transition-colors hover:bg-white/[0.06] hover:text-zinc-200"
          aria-label="Close AI panel"
        >
          <StudioIcon name="x" size={15} />
        </button>
      </div>

      <div className="studio-scroll min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <div className="flex flex-wrap gap-1.5">
          {actions.map((chip) => (
            <button
              key={`${chip.action}-${chip.label}`}
              type="button"
              title={chip.hint}
              onClick={() => setAction(chip.action)}
              className={`rounded-full border px-2.5 py-1 text-[10.5px] font-medium transition-all ${
                action === chip.action
                  ? 'border-violet-400/40 bg-violet-500/15 text-violet-200'
                  : 'border-white/[0.07] bg-white/[0.02] text-zinc-400 hover:border-white/[0.14] hover:text-zinc-200'
              }`}
            >
              {chip.label}
            </button>
          ))}
        </div>

        <div className="mt-3 rounded-xl border border-white/[0.07] bg-white/[0.025] focus-within:border-violet-400/30">
          <textarea
            ref={bodyRef}
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                event.preventDefault();
                void generate();
              }
            }}
            rows={3}
            placeholder={
              item.kind === 'sheet'
                ? 'Describe the table: “A 12-month budget with income, rent, food, savings, and a total row.”'
                : item.kind === 'slides'
                  ? 'Describe the deck: “A 7-slide investor update for our Q4 launch.”'
                  : 'Tell me what to write, or select text above and ask for a change.'
            }
            className="w-full resize-y bg-transparent px-3 py-2.5 text-[12px] leading-relaxed text-zinc-200 outline-none placeholder:text-zinc-600"
          />
          <div className="flex items-center gap-2 border-t border-white/[0.05] px-2.5 py-2">
            {action === 'translate' ? (
              <input
                value={language}
                onChange={(event) => setLanguage(event.target.value)}
                placeholder="Language (Spanish…)"
                className="h-6 w-32 rounded border border-white/[0.07] bg-white/[0.03] px-2 text-[10.5px] text-zinc-300 outline-none placeholder:text-zinc-600"
              />
            ) : (
              <span className="text-[10px] text-zinc-600">
                {selectionLength > 0 ? `${selectionLength.toLocaleString()} chars selected` : '⌘↵ to generate'}
              </span>
            )}
            <button
              type="button"
              onClick={() => void generate()}
              disabled={aiBusy}
              className="ml-auto flex h-7 items-center gap-1.5 rounded-lg bg-gradient-to-r from-violet-500 to-indigo-500 px-3 text-[11px] font-semibold text-white shadow-lg shadow-violet-900/30 transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {aiBusy ? (
                <>
                  <span className="h-3 w-3 animate-spin rounded-full border-[1.5px] border-white/30 border-t-white" />
                  Writing…
                </>
              ) : (
                <>
                  <StudioIcon name="sparkles" size={12} /> Generate
                </>
              )}
            </button>
          </div>
        </div>

        {selectionLength > 0 && item.kind === 'document' && (
          <div className="mt-2 flex items-center gap-1.5 text-[10px] text-zinc-600">
            <StudioIcon name="quote" size={11} />
            Selection will be used for Improve, Grammar, Summarize, and Translate.
            <button
              type="button"
              onClick={() => { selectionRef.current = ''; setSelectionLength(0); }}
              className="ml-auto text-zinc-500 underline decoration-white/20 underline-offset-2 hover:text-zinc-300"
            >
              clear
            </button>
          </div>
        )}

        <div className="mt-4">
          <div className="mb-1.5 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.13em] text-zinc-600">
            <span>Result</span>
            {applied && <span className="ml-auto normal-case tracking-normal text-emerald-400/90">{applied}</span>}
          </div>
          {result ? (
            <div className="rounded-xl border border-white/[0.07] bg-[#121218]">
              <pre className="max-h-[42vh] overflow-auto whitespace-pre-wrap break-words px-3 py-3 font-sans text-[12px] leading-relaxed text-zinc-300">
                {result}
              </pre>
              <div className="flex flex-wrap items-center gap-1.5 border-t border-white/[0.06] px-2.5 py-2">
                {item.kind === 'document' && (
                  <>
                    <ApplyButton onClick={() => applyDocument('replace')} primary>Replace selection</ApplyButton>
                    <ApplyButton onClick={() => applyDocument('insert')}>Insert</ApplyButton>
                    <ApplyButton onClick={() => applyDocument('replace-all')}>Replace all</ApplyButton>
                  </>
                )}
                {item.kind === 'sheet' && (
                  <>
                    <ApplyButton onClick={() => void applySheet('replace')} primary>Replace sheet</ApplyButton>
                    <ApplyButton onClick={() => void applySheet('insert')}>Insert at A1</ApplyButton>
                  </>
                )}
                {item.kind === 'slides' && (
                  <>
                    <ApplyButton onClick={() => void applyDeck('replace')} primary>Replace deck</ApplyButton>
                    <ApplyButton onClick={() => void applyDeck('append')}>Add slides</ApplyButton>
                  </>
                )}
                <button
                  type="button"
                  onClick={() => {
                    void navigator.clipboard.writeText(result);
                    addToast({ type: 'success', title: 'Copied' });
                  }}
                  className="rounded-md px-2 py-1 text-[10.5px] text-zinc-500 transition-colors hover:bg-white/[0.06] hover:text-zinc-200"
                >
                  Copy
                </button>
              </div>
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-white/[0.07] px-4 py-6 text-center text-[11px] leading-relaxed text-zinc-600">
              Ask for a draft, a rewrite, a table, or a whole deck. Nothing changes until you apply it.
            </div>
          )}
        </div>
      </div>

      <div className="border-t border-white/[0.06] px-4 py-2.5 text-[10px] leading-relaxed text-zinc-600">
        AI writes into Studio, never around it. Review before exporting — you are the author.
      </div>
    </aside>
  );
}

function ApplyButton({
  children,
  onClick,
  primary,
}: {
  children: ReactNode;
  onClick: () => void;
  primary?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-md px-2.5 py-1 text-[10.5px] font-medium transition-colors ${
        primary
          ? 'bg-violet-500/20 text-violet-200 hover:bg-violet-500/30'
          : 'text-zinc-400 hover:bg-white/[0.06] hover:text-zinc-100'
      }`}
    >
      {children}
    </button>
  );
}

