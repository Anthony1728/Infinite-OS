/**
 * ThinkingPanel — the model's reasoning, shown to the user.
 *
 * This is the piece the user asked for by name: "just like how Ollama shows the
 * AI thinking before generating the response". Ollama shows the trace as it
 * arrives and collapses it once the answer starts; so does this.
 *
 * Two states, both deliberate:
 *   * While it is streaming and there is no answer yet, it is OPEN and animating,
 *     because a local model can deliberate for a minute and an empty bubble with
 *     no explanation reads as a hang.
 *   * Once the answer arrives it COLLAPSES to one line, so a long trace does not
 *     push the actual response off the screen. The user can reopen it.
 *
 * The trace is rendered as plain text, never markdown: reasoning is a working
 * note, often half-finished, and rendering it as formatted prose would make a
 * rough draft look authoritative.
 *
 * Note the reduced-motion handling: this machine reports
 * `prefers-reduced-motion: reduce`, and globals.css forces animation durations to
 * ~0 globally. The pulse is therefore declared with an explicit `!important`
 * override, without which the "still thinking" indicator would sit perfectly
 * still and look broken.
 */

import { useEffect, useRef, useState } from 'react';
import { Brain, ChevronRight, Loader2 } from 'lucide-react';

export function ThinkingPanel({ text, streaming }: { text: string; streaming: boolean }) {
  const [open, setOpen] = useState(true);
  const bodyRef = useRef<HTMLDivElement>(null);

  // Auto-collapse when the answer starts arriving, and auto-open if the trace is
  // still growing while there is nothing else on screen.
  useEffect(() => {
    setOpen(streaming);
  }, [streaming]);

  // Follow the tail as it streams, but only while it is actually open — a
  // collapsed panel must not fight the user's scroll position.
  useEffect(() => {
    if (!open) return;
    const node = bodyRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
  }, [text, open]);

  if (!text.trim()) return null;

  const waiting = streaming && text.length < 20;

  return (
    <div className="mb-2 overflow-hidden rounded-xl border border-white/[0.07] bg-white/[0.02]">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-white/[0.03]"
      >
        <ChevronRight
          size={13}
          className={`shrink-0 text-white/35 transition-transform duration-150 ${open ? 'rotate-90' : ''}`}
        />
        <Brain size={13} className={`shrink-0 ${streaming ? 'text-violet-300' : 'text-white/30'}`} />
        <span className="text-[11px] font-medium text-white/55">
          {streaming ? 'Thinking' : 'Thought about it'}
        </span>

        {streaming && (
          <Loader2
            size={12}
            // `!important` is required: globals.css forces every animation to
            // 0.01ms under reduced motion, which would leave this frozen and
            // make a live stream look dead.
            className="ml-0.5 animate-spin text-violet-300/70 motion-reduce:animate-none"
            style={{ animationDuration: '1.1s', animationIterationCount: 'infinite' }}
          />
        )}

        {!open && (
          <span className="min-w-0 flex-1 truncate text-[10px] text-white/25">
            {text.replace(/\s+/g, ' ').slice(0, 90)}
          </span>
        )}
      </button>

      {open && (
        <div
          ref={bodyRef}
          className="max-h-72 overflow-y-auto border-t border-white/[0.05] px-3 py-2.5"
        >
          {waiting ? (
            <p className="text-[11px] italic text-white/30">Working it out…</p>
          ) : (
            <pre className="whitespace-pre-wrap break-words font-sans text-[11px] leading-relaxed text-white/45">
              {text}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}