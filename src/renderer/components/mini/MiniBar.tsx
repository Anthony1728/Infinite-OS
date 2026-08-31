import { useState, useRef, useEffect, useCallback } from 'react';
import { InfiniteLogo } from '../brand/InfiniteLogo';

declare global {
  interface Window {
    api: {
      miniRestore: () => Promise<void>;
      miniSend: (args: { sessionId: string; message: string; provider: string; model: string; cwd: string }) => Promise<unknown>;
      miniAbort: (args: { sessionId: string }) => Promise<{ ok: boolean }>;
      onMiniStreamEvent: (cb: (e: unknown) => void) => () => void;
      onMiniState: (cb: (e: unknown) => void) => () => void;
      listSessions: () => Promise<Array<{ id: string; title?: string }>>;
      createSession: (args: { cwd: string; model: string; provider: string }) => Promise<{ id: string }>;
      sendMessage: (args: { sessionId: string; message: unknown; provider: string; model: string; cwd: string }) => Promise<unknown>;
      onStreamEvent: (cb: (e: unknown) => void) => () => void;
    };
  }
}

/**
 * MiniBar — the "mini mode" companion window.
 *
 * Mirrors the main chat composer's design language: a quiet rounded surface,
 * hairline border, hairline focus ring, and the standard Infinite mark.
 * No colored glow washes, no gradient logo box — the surface is what carries it.
 */
export function MiniBar() {
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [noteError, setNoteError] = useState('');
  const [visible, setVisible] = useState(false);
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const sessionIdRef = useRef<string>('');

  useEffect(() => {
    document.body.dataset.mini = 'true';
    const t = setTimeout(() => {
      setVisible(true);
      inputRef.current?.focus();
    }, 50);
    return () => {
      delete document.body.dataset.mini;
      clearTimeout(t);
    };
  }, []);

  useEffect(() => {
    // AgentEvent types arrive snake_case from the agent loop ('text_delta',
    // 'message_end'); accept legacy hyphenated spellings too.
    const unsub = window.api.onMiniStreamEvent((evt: unknown) => {
      const e = evt as { type?: string; text?: string; delta?: string; content?: string; error?: string };
      const t = (e.type ?? '').replace(/-/g, '_');
      if (t === 'text_delta' || t === 'content_delta') {
        setSending(true);
        setNoteError('');
      } else if (t === 'message_end') {
        setSending(false);
      } else if (t === 'error') {
        setSending(false);
        if (e.error) setNoteError(e.error);
      }
    });
    return unsub;
  }, []);

  useEffect(() => {
    const unsub = window.api.onMiniState((state: unknown) => {
      const s = state as { active?: boolean };
      setSending(Boolean(s?.active));
    });
    return unsub;
  }, []);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || sending) return;
    setInput('');
    setSending(true);
    setNoteError('');

    try {
      const settings = readSettings();
      // Dedicated mini channel: streams back to THIS window via
      // onMiniStreamEvent (CHAT_SEND only streams to the main window).
      const result = (await window.api.miniSend({
        sessionId: sessionIdRef.current,
        message: text,
        provider: settings.provider ?? 'openrouter',
        model: settings.model ?? 'meta-llama/llama-3.3-70b-instruct:free',
        cwd: settings.cwd ?? '.',
      })) as { ok?: boolean; sessionId?: string; error?: string };
      if (result?.sessionId) sessionIdRef.current = result.sessionId;
      if (result && result.ok === false) {
        setNoteError(result.error ?? 'Send failed');
        setSending(false);
      }
    } catch (err) {
      setNoteError(err instanceof Error ? err.message : String(err));
      setSending(false);
    }
  }, [input, sending]);

  const handleAbort = useCallback(async () => {
    const sid = sessionIdRef.current;
    if (!sid) {
      setSending(false);
      return;
    }
    try {
      await window.api.miniAbort({ sessionId: sid });
    } catch {
      // Best-effort: surface failure locally but always clear the spinner.
    }
    setSending(false);
    setNoteError('Stopped');
  }, []);

  function readSettings(): { provider?: string; model?: string; cwd?: string } {
    try {
      const raw = localStorage.getItem('infinite:current');
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      return typeof parsed === 'object' && parsed !== null ? parsed : {};
    } catch {
      return {};
    }
  }

  const handleRestore = useCallback(() => {
    setVisible(false);
    setTimeout(() => window.api.miniRestore(), 300);
  }, []);

  return (
    <div className="fixed inset-0 select-none">
      <style>{`
        @keyframes mini-slide-in {
          0% { opacity: 0; transform: translateY(20px) scale(0.95); }
          100% { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes mini-slide-out {
          0% { opacity: 1; transform: translateY(0) scale(1); }
          100% { opacity: 0; transform: translateY(20px) scale(0.95); }
        }
        @keyframes mini-dot-pulse {
          0%, 100% { opacity: 0.35; }
          50% { opacity: 1; }
        }
        /* Native OS drag region: the bar itself moves the whole window across
           the desktop. Interactive children must opt out or clicks die. */
        .mini-drag { -webkit-app-region: drag; }
        .mini-no-drag { -webkit-app-region: no-drag; }
      `}</style>

      {/* Chat bar — a floating, draggable bar. The surface is a soft rounded
          box (matching the main composer) sitting on a fully transparent
          window, so the box itself is the interface and the desktop shows
          through everywhere else. */}
      <div
        className="mini-drag relative flex items-center gap-0 h-[48px] mx-2 overflow-hidden rounded-xl"
        style={{
          background: 'rgba(8,11,20,0.85)',
          border: `1px solid ${focused ? 'rgba(255,255,255,0.16)' : 'rgba(255,255,255,0.08)'}`,
          boxShadow: '0 4px 18px rgba(0,0,0,0.35)',
          animation: visible
            ? 'mini-slide-in 0.35s cubic-bezier(0.16, 1, 0.3, 1) forwards'
            : 'mini-slide-out 0.25s cubic-bezier(0.7, 0, 0.84, 0) forwards',
          opacity: visible ? undefined : 0,
        }}
      >
        {/* Infinite mark */}
        <button
          onClick={handleRestore}
          className="mini-no-drag flex-shrink-0 w-8 h-8 ml-1.5 rounded-lg flex items-center justify-center transition-all duration-200 hover:bg-white/[0.04]"
          title="Open Infinite OS"
          aria-label="Open Infinite OS"
        >
          <InfiniteLogo className="h-3.5 w-6" variant="luminous" />
        </button>

        {/* Input */}
        <input
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder={sending ? 'Thinking...' : 'Ask Infinite OS anything...'}
          disabled={sending}
          className="mini-no-drag relative flex-1 bg-transparent text-[13px] text-white outline-none placeholder:text-zinc-500 disabled:opacity-40 min-w-0 px-2 py-2"
          style={{ caretColor: 'rgba(255,255,255,0.85)' }}
        />

        {sending && (
          <span className="mini-no-drag flex-shrink-0 pr-1 flex items-center gap-1.5">
            <span
              className="w-1.5 h-1.5 rounded-full bg-emerald-400"
              style={{ animation: 'mini-dot-pulse 1.2s ease-in-out infinite' }}
            />
            <span className="text-[10px] text-zinc-400">Notepad…</span>
          </span>
        )}
        {noteError && !sending && (
          <span className="mini-no-drag flex-shrink-0 pr-1 flex items-center gap-1.5 max-w-[160px]">
            <span className="w-1.5 h-1.5 rounded-full bg-red-400" />
            <span className="text-[10px] text-red-300 truncate">{noteError}</span>
          </span>
        )}

        {/* Send */}
        <button
          onClick={sending ? handleAbort : handleSend}
          disabled={!input.trim() && !sending}
          className="mini-no-drag flex-shrink-0 w-7 h-7 mr-1.5 rounded-lg flex items-center justify-center transition-all duration-200 disabled:opacity-20 hover:bg-white/[0.06]"
          style={{
            background: input.trim() ? 'rgba(255,255,255,0.08)' : 'transparent',
          }}
          aria-label={sending ? 'Stop' : 'Send'}
        >
          {sending ? (
            <svg className="w-3 h-3 text-zinc-400" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          ) : (
            <svg className="w-3 h-3" style={{ color: input.trim() ? '#e4e4e7' : 'rgba(255,255,255,0.25)' }} fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
            </svg>
          )}
        </button>
      </div>
    </div>
  );
}
