import { useCallback, useEffect, useRef, useState } from 'react';
import type { StudioItem } from '../../../shared/studio';
import { useStudioStore } from '../../stores/studio';
import { StudioIcon, type StudioIconName } from './Icons';
import type { DocumentApplyDetail } from './studioUtils';
import './studio.css';

interface DocumentEditorProps {
  item: StudioItem;
}

interface ToolButton {
  icon: StudioIconName;
  label: string;
  command: string;
  value?: string;
  state?: string;
}

const HISTORY: ToolButton[] = [
  { icon: 'undo', label: 'Undo', command: 'undo' },
  { icon: 'redo', label: 'Redo', command: 'redo' },
];

const INLINE: ToolButton[] = [
  { icon: 'bold', label: 'Bold', command: 'bold', state: 'bold' },
  { icon: 'italic', label: 'Italic', command: 'italic', state: 'italic' },
  { icon: 'underline', label: 'Underline', command: 'underline', state: 'underline' },
];

const BLOCKS: ToolButton[] = [
  { icon: 'h1', label: 'Heading 1', command: 'formatBlock', value: 'h1' },
  { icon: 'h2', label: 'Heading 2', command: 'formatBlock', value: 'h2' },
  { icon: 'list', label: 'Bulleted list', command: 'insertUnorderedList', state: 'insertUnorderedList' },
  { icon: 'list-ordered', label: 'Numbered list', command: 'insertOrderedList', state: 'insertOrderedList' },
  { icon: 'quote', label: 'Quote', command: 'formatBlock', value: 'blockquote' },
];

const ALIGN: ToolButton[] = [
  { icon: 'align-left', label: 'Align left', command: 'justifyLeft' },
  { icon: 'align-center', label: 'Align center', command: 'justifyCenter' },
  { icon: 'align-right', label: 'Align right', command: 'justifyRight' },
];

export function DocumentEditor({ item }: DocumentEditorProps) {
  const editorRef = useRef<HTMLDivElement | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRef = useRef<string | null>(null);
  const lastKnownRef = useRef(item.html ?? '');
  // Keep a clone of the last selection inside the editor. Clicking a button in
  // the AI panel moves focus out of the contentEditable, and Chromium may drop
  // the live range — the clone lets Insert/Replace still target the user's text.
  const savedRangeRef = useRef<Range | null>(null);
  const [active, setActive] = useState<Record<string, boolean>>({});
  const [words, setWords] = useState(0);
  const [empty, setEmpty] = useState(true);
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved'>('idle');

  const measure = useCallback(() => {
    const text = editorRef.current?.innerText ?? '';
    const count = text.trim() ? text.trim().split(/\s+/).length : 0;
    setWords(count);
    setEmpty(count === 0);
  }, []);

  const flush = useCallback((html: string) => {
    pendingRef.current = html;
    if (timerRef.current) clearTimeout(timerRef.current);
    setStatus('saving');
    timerRef.current = setTimeout(() => {
      const next = pendingRef.current;
      if (next === null) return;
      pendingRef.current = null;
      lastKnownRef.current = next;
      void useStudioStore.getState().update(item.id, { html: next }).then(() => {
        setStatus('saved');
        setTimeout(() => setStatus('idle'), 1_600);
      });
    }, 650);
  }, [item.id]);

  const sync = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) return;
    measure();
    flush(editor.innerHTML);
    const next: Record<string, boolean> = {};
    for (const button of [...INLINE, ...BLOCKS]) {
      if (!button.state) continue;
      try {
        next[button.state] = document.queryCommandState(button.state);
      } catch {
        next[button.state] = false;
      }
    }
    setActive(next);
  }, [flush, measure]);

  // Load only when the item changes. Re-rendering on every store update would
  // put the caret at the start of the document on each keystroke.
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.innerHTML = item.html && item.html.trim() ? item.html : '<p><br></p>';
    lastKnownRef.current = editor.innerHTML;
    measure();
    try {
      document.execCommand('defaultParagraphSeparator', false, 'p');
    } catch {
      // Not supported on every Chromium build; paragraph tags are the default.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id]);

  // An agent or the AI panel may replace the document while it is open.
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    if (item.html === lastKnownRef.current) return;
    if (document.activeElement === editor && pendingRef.current !== null) return;
    if (item.html !== undefined && item.html !== editor.innerHTML) {
      editor.innerHTML = item.html || '<p><br></p>';
      lastKnownRef.current = editor.innerHTML;
      measure();
    }
  }, [item.html, measure]);

  useEffect(() => {
    const onSelection = () => {
      const editor = editorRef.current;
      const selection = window.getSelection();
      if (!editor || !selection?.anchorNode || !editor.contains(selection.anchorNode)) return;
      if (selection.rangeCount > 0) savedRangeRef.current = selection.getRangeAt(0).cloneRange();
      const next: Record<string, boolean> = {};
      for (const button of [...INLINE, ...BLOCKS]) {
        if (!button.state) continue;
        try {
          next[button.state] = document.queryCommandState(button.state);
        } catch {
          next[button.state] = false;
        }
      }
      setActive(next);
    };
    document.addEventListener('selectionchange', onSelection);
    return () => document.removeEventListener('selectionchange', onSelection);
  }, []);

  useEffect(() => {
    const onApply = (event: Event) => {
      const detail = (event as CustomEvent<DocumentApplyDetail>).detail;
      if (!detail || detail.itemId !== item.id) return;
      const editor = editorRef.current;
      if (!editor) return;
      editor.focus();
      const html = htmlFromPlain(detail.text);
      if (detail.mode === 'replace-all') {
        editor.innerHTML = html;
        const end = document.createRange();
        end.selectNodeContents(editor);
        end.collapse(false);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(end);
      } else {
        const selection = window.getSelection();
        const live = selection?.rangeCount ? selection.getRangeAt(0) : null;
        const saved = savedRangeRef.current;
        const liveValid = Boolean(live && editor.contains(live.commonAncestorContainer));
        const savedValid = Boolean(saved && editor.contains(saved.commonAncestorContainer));
        // Prefer the saved non-collapsed selection for Replace: clicking the
        // panel button may have left a collapsed caret in the editor.
        const range = detail.mode === 'replace' && savedValid && saved && !saved.collapsed
          ? saved
          : liveValid
            ? live
            : savedValid
              ? saved
              : null;
        if (range) {
          selection?.removeAllRanges();
          selection?.addRange(range);
          if (detail.mode === 'replace' && !range.collapsed) {
            range.deleteContents();
          } else {
            range.collapse(false);
          }
          const fragment = range.createContextualFragment(html);
          const last = fragment.lastChild;
          range.insertNode(fragment);
          if (last) {
            const after = document.createRange();
            after.setStartAfter(last);
            after.collapse(true);
            selection?.removeAllRanges();
            selection?.addRange(after);
          }
          savedRangeRef.current = range.cloneRange();
        } else {
          editor.insertAdjacentHTML('beforeend', html);
        }
      }
      sync();
    };
    window.addEventListener('infinite:studio-document-apply', onApply);
    return () => window.removeEventListener('infinite:studio-document-apply', onApply);
  }, [item.id, sync]);

  // Save the last keystrokes when the view closes or another item is opened.
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      const pending = pendingRef.current;
      if (pending !== null) {
        void useStudioStore.getState().update(item.id, { html: pending });
      }
    };
  }, [item.id]);

  const run = (button: ToolButton) => {
    editorRef.current?.focus();
    try {
      document.execCommand(button.command, false, button.value);
    } catch {
      // A rejected command must not break typing.
    }
    sync();
  };

  const addLink = () => {
    const editor = editorRef.current;
    if (!editor) return;
    const selection = window.getSelection();
    const selected = selection?.toString() ?? '';
    const url = window.prompt('Link URL', selected.startsWith('http') ? selected : 'https://');
    if (!url) return;
    if (!/^https?:\/\//i.test(url)) {
      window.alert('Links must start with http:// or https://');
      return;
    }
    editor.focus();
    if (selection?.isCollapsed) {
      document.execCommand('insertHTML', false, `<a href="${url.replace(/"/g, '&quot;')}">${url}</a>`);
    } else {
      document.execCommand('createLink', false, url);
    }
    sync();
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-1 border-b border-white/[0.06] bg-[#101015]/80 px-4 py-2 backdrop-blur-xl">
        {HISTORY.map((button) => (
          <ToolbarButton key={button.label} button={button} onRun={run} />
        ))}
        <Divider />
        {INLINE.map((button) => (
          <ToolbarButton key={button.label} button={button} active={active[button.state ?? '']} onRun={run} />
        ))}
        <Divider />
        {BLOCKS.map((button) => (
          <ToolbarButton key={button.label} button={button} active={active[button.state ?? '']} onRun={run} />
        ))}
        <Divider />
        {ALIGN.map((button) => (
          <ToolbarButton key={button.label} button={button} onRun={run} />
        ))}
        <Divider />
        <button
          type="button"
          title="Insert link"
          onMouseDown={(event) => event.preventDefault()}
          onClick={addLink}
          className="grid h-8 w-8 place-items-center rounded-lg text-zinc-400 transition-colors hover:bg-white/[0.06] hover:text-zinc-100"
        >
          <StudioIcon name="link" />
        </button>
        <button
          type="button"
          title="Clear formatting"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            editorRef.current?.focus();
            document.execCommand('removeFormat');
            document.execCommand('formatBlock', false, 'p');
            sync();
          }}
          className="rounded-lg px-2 py-1 text-[11px] font-medium text-zinc-500 transition-colors hover:bg-white/[0.06] hover:text-zinc-200"
        >
          Clear
        </button>
        <div className="ml-auto flex items-center gap-3 pr-1 text-[11px] text-zinc-500">
          <span>{words.toLocaleString()} {words === 1 ? 'word' : 'words'}</span>
          <span className={status === 'saving' ? 'text-amber-400/80' : status === 'saved' ? 'text-emerald-400/80' : ''}>
            {status === 'saving' ? 'Saving…' : status === 'saved' ? 'Saved' : ''}
          </span>
        </div>
      </div>

      <div className="studio-paper-scroll min-h-0 flex-1 overflow-y-auto">
        <div className="studio-paper">
          <div
            ref={editorRef}
            className="studio-editor"
            contentEditable
            suppressContentEditableWarning
            spellCheck
            role="textbox"
            aria-multiline="true"
            aria-label="Document body"
            onInput={sync}
            onBlur={sync}
            onPaste={(event) => {
              // Paste rich content from the web, but never raw HTML that could
              // smuggle scripts into the editor. Plain text keeps control.
              const html = event.clipboardData.getData('text/html');
              if (html) {
                event.preventDefault();
                const text = event.clipboardData.getData('text/plain');
                document.execCommand('insertText', false, text);
                sync();
              }
            }}
          />
          {empty && (
            <div className="studio-placeholder">
              Start writing. Select text and ask the AI to improve it, or say “write the first draft for me.”
            </div>
          )}
          <div className="h-24" />
        </div>
      </div>
    </div>
  );
}

function ToolbarButton({
  button,
  active,
  onRun,
}: {
  button: ToolButton;
  active?: boolean;
  onRun: (button: ToolButton) => void;
}) {
  return (
    <button
      type="button"
      title={button.label}
      aria-label={button.label}
      aria-pressed={active}
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => onRun(button)}
      className={`grid h-8 min-w-8 place-items-center rounded-lg px-1.5 transition-colors ${
        active ? 'bg-white/[0.1] text-white' : 'text-zinc-400 hover:bg-white/[0.06] hover:text-zinc-100'
      }`}
    >
      <StudioIcon name={button.icon} />
    </button>
  );
}

function Divider() {
  return <span className="mx-1 h-5 w-px bg-white/[0.07]" />;
}

function htmlFromPlain(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}/)
    .map((block) =>
      `<p>${block
        .split('\n')
        .map((line) => line.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'))
        .join('<br>')}</p>`,
    )
    .join('');
}
