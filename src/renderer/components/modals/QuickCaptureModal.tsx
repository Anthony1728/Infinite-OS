/**
 * Quick Capture — the "drop a thought here in 5 seconds" surface.
 *
 * Replaces the old window.prompt()/alert() pair: the capture is now an
 * on-brand glass sheet with a live path confirmation, keyboard-first
 * (Enter saves, Shift+Enter newlines, Escape closes) and no jarring
 * native dialogs. Ctrl/Cmd+Shift+Y opens it from anywhere.
 */

import { useEffect, useRef, useState } from 'react';
import { AppIcon } from '../brand/AppIcon';

interface QuickCaptureModalProps {
  open: boolean;
  onClose: () => void;
}

export function QuickCaptureModal({ open, onClose }: QuickCaptureModalProps) {
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);
  const [savedPath, setSavedPath] = useState<string | null>(null);
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Fresh surface each open, focus ready before the user's next keystroke.
  useEffect(() => {
    if (open) {
      setText('');
      setSavedPath(null);
      setError('');
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const save = async () => {
    const trimmed = text.trim();
    if (!trimmed || saving) return;
    setSaving(true);
    setError('');
    try {
      const res = (await window.api.quickCaptureAppend({ text: trimmed })) as
        | { ok: true; path: string }
        | { ok: false; error: string };
      if (res.ok) {
        setSavedPath(res.path);
        setText('');
        window.setTimeout(() => onClose(), 1100);
      } else {
        setError(res.error);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the note');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[90] flex items-start justify-center pt-[18vh] p-6 animate-fade-in"
      role="dialog"
      aria-modal="true"
      aria-label="Quick Capture"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="absolute inset-0 bg-black/60" />
      <div className="os-glass-card relative w-full max-w-xl rounded-2xl border border-white/[0.09] bg-[#12131a] shadow-[0_24px_70px_rgba(0,0,0,0.55)] overflow-hidden animate-scale-in">
        {/* Brand edge — the same violet→cyan signature the rest of the OS uses */}
        <div className="h-0.5 w-full bg-gradient-to-r from-violet-500 via-cyan-400 to-fuchsia-400" />
        <div className="p-4">
          <div className="flex items-center justify-between">
            <span className="micro-label">Quick capture</span>
            <span className="rounded-lg bg-white/[0.05] px-1.5 py-0.5 font-mono text-[10px] text-zinc-500">⌘⇧Y</span>
          </div>
          <textarea
            ref={inputRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void save();
              }
            }}
            placeholder="Drop a thought — saved instantly to your quick notes…"
            rows={3}
            aria-label="Quick capture note"
            className="mt-2.5 w-full resize-none bg-transparent text-[14px] leading-6 text-white placeholder:text-zinc-600 focus:outline-none"
          />
          {savedPath && (
            <div className="mt-2 flex items-center gap-1.5 rounded-lg bg-emerald-500/10 px-2.5 py-1.5 text-[11px] text-emerald-300 animate-fade-in">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
              Saved → <span className="truncate font-mono">{savedPath}</span>
            </div>
          )}
          {error && (
            <div className="mt-2 rounded-lg bg-red-500/10 px-2.5 py-1.5 text-[11px] text-red-300">{error}</div>
          )}
          <div className="mt-3 flex items-center justify-between">
            <button
              onClick={() => void window.api.quickCaptureOpen()}
              className="text-[11px] text-zinc-500 transition-colors hover:text-zinc-300"
            >
              Open notes →
            </button>
            <div className="flex items-center gap-2">
              <span className="hidden rounded bg-white/[0.04] px-1.5 py-0.5 font-mono text-[10px] text-zinc-600 sm:inline">Enter to save</span>
              <button
                onClick={() => void save()}
                disabled={!text.trim() || saving}
                className="inline-flex items-center gap-1.5 rounded-xl bg-white px-3.5 py-1.5 text-[12px] font-semibold text-zinc-900 transition-colors hover:bg-zinc-100 disabled:opacity-40"
              >
                <AppIcon name="action.send" className="h-3.5 w-3.5" strokeWidth={2} />
                {saving ? 'Saving…' : 'Save note'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
