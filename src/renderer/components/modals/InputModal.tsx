/**
 * InputModal — the one glass input dialog for the whole OS.
 *
 * Replaces every window.prompt(): the native prompt is unthemed, blocks the
 * renderer, and reads as a debug leftover. This modal keeps the same
 * low-friction contract — open, type, Enter — but stays on-brand: glass card
 * over a scrim, micro-label field names, Enter to submit, Escape to cancel.
 */

import { useEffect, useRef, useState } from 'react';
import { AppIcon } from '../brand/AppIcon';

export interface InputModalField {
  key: string;
  label: string;
  placeholder?: string;
  /** Pre-filled value shown when the modal opens. */
  initial?: string;
  /** Multiline textarea instead of a single-line input. */
  multiline?: boolean;
  /** HTML type for single-line inputs (text, url, date, …). */
  type?: string;
  required?: boolean;
}

interface InputModalProps {
  title: string;
  /** One-line context shown under the title. */
  subtitle?: string;
  fields: InputModalField[];
  submitLabel?: string;
  cancelLabel?: string;
  onSubmit: (values: Record<string, string>) => void | Promise<void>;
  onClose: () => void;
}

export function InputModal({ title, subtitle, fields, submitLabel = 'Save', cancelLabel = 'Cancel', onSubmit, onClose }: InputModalProps) {
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(fields.map((f) => [f.key, f.initial ?? ''])),
  );
  const [busy, setBusy] = useState(false);
  const firstRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);

  // Focus the first field on open, and wire the two Escape hatches.
  useEffect(() => {
    firstRef.current?.focus();
    firstRef.current?.select?.();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const canSubmit = fields.every((f) => !f.required || (values[f.key] ?? '').trim().length > 0);

  const submit = async () => {
    if (!canSubmit || busy) return;
    setBusy(true);
    try {
      await onSubmit(values);
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center p-6 animate-fade-in"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="absolute inset-0 bg-black/60" />
      <div className="os-glass-card relative w-full max-w-md rounded-2xl border border-white/[0.09] bg-[#12131a] p-5 shadow-[0_24px_70px_rgba(0,0,0,0.55)] animate-scale-in">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-[15px] font-semibold text-white">{title}</h2>
            {subtitle && <p className="mt-0.5 text-[11.5px] leading-4 text-zinc-500">{subtitle}</p>}
          </div>
          <button onClick={onClose} className="icon-button w-7 h-7 flex-shrink-0" aria-label="Close dialog">
            <svg className="w-3.5 h-3.5 mx-auto" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </div>

        <div className="mt-4 space-y-3.5">
          {fields.map((field, i) => (
            <label key={field.key} className="block">
              <span className="micro-label mb-1.5 block">{field.label}</span>
              {field.multiline ? (
                <textarea
                  ref={i === 0 ? (el) => { firstRef.current = el; } : undefined}
                  value={values[field.key] ?? ''}
                  onChange={(e) => setValues((v) => ({ ...v, [field.key]: e.target.value }))}
                  onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void submit(); }}
                  placeholder={field.placeholder}
                  rows={3}
                  className="w-full resize-none rounded-xl border border-white/[0.08] bg-black/30 px-3 py-2 text-[12.5px] text-white placeholder:text-zinc-600 focus:border-violet-500/40 focus:outline-none transition-colors"
                />
              ) : (
                <input
                  ref={i === 0 ? (el) => { firstRef.current = el; } : undefined}
                  type={field.type ?? 'text'}
                  value={values[field.key] ?? ''}
                  onChange={(e) => setValues((v) => ({ ...v, [field.key]: e.target.value }))}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void submit(); } }}
                  placeholder={field.placeholder}
                  className="w-full rounded-xl border border-white/[0.08] bg-black/30 px-3 py-2 text-[12.5px] text-white placeholder:text-zinc-600 focus:border-violet-500/40 focus:outline-none transition-colors"
                />
              )}
            </label>
          ))}
        </div>

        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-xl border border-white/[0.08] bg-white/[0.04] px-3.5 py-2 text-[12px] font-medium text-zinc-300 transition-colors hover:bg-white/[0.08]"
          >
            {cancelLabel}
          </button>
          <button
            onClick={() => void submit()}
            disabled={!canSubmit || busy}
            className="inline-flex items-center gap-1.5 rounded-xl bg-white px-3.5 py-2 text-[12px] font-semibold text-zinc-900 transition-colors hover:bg-zinc-100 disabled:opacity-40"
          >
            <AppIcon name="action.add" className="h-3.5 w-3.5" strokeWidth={2} />
            {busy ? 'Saving…' : submitLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
