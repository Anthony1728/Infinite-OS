import { useState, useRef, useEffect, useCallback } from 'react';

declare global {
  interface Window {
    api: {
      miniRestore: () => Promise<void>;
      miniSend: (args: { sessionId: string; message: string; provider: string; model: string; cwd: string }) => Promise<unknown>;
      onMiniStreamEvent: (cb: (e: unknown) => void) => () => void;
      onMiniState: (cb: (e: unknown) => void) => () => void;
      listSessions: () => Promise<Array<{ id: string; title?: string }>>;
      createSession: (args: { cwd: string; model: string; provider: string }) => Promise<{ id: string }>;
      sendMessage: (args: { sessionId: string; message: unknown; provider: string; model: string; cwd: string }) => Promise<unknown>;
      onStreamEvent: (cb: (e: unknown) => void) => () => void;
    };
  }
}

export function MiniBar() {
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [response, setResponse] = useState('');
  const [visible, setVisible] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const dragStart = useRef({ x: 0, y: 0 });
  const sessionIdRef = useRef<string>('');

  useEffect(() => {
    const t = setTimeout(() => {
      setVisible(true);
      inputRef.current?.focus();
    }, 50);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    // AgentEvent types arrive snake_case from the agent loop ('text_delta',
    // 'message_end'); accept legacy hyphenated spellings too.
    const unsub = window.api.onMiniStreamEvent((evt: unknown) => {
      const e = evt as { type?: string; text?: string; delta?: string; content?: string; error?: string };
      const t = (e.type ?? '').replace(/-/g, '_');
      if (t === 'text_delta' || t === 'content_delta') {
        setResponse((prev) => prev + (e.delta ?? e.text ?? e.content ?? ''));
        setSending(true);
      } else if (t === 'message_end') {
        setSending(false);
      } else if (t === 'error') {
        setSending(false);
        if (e.error) setResponse(`Error: ${e.error}`);
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
    setResponse('');
    setSending(true);

    try {
      const settings = JSON.parse(localStorage.getItem('infinite:current') ?? '{}');
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
        setResponse(`Error: ${result.error ?? 'Send failed'}`);
        setSending(false);
      }
    } catch (err) {
      setResponse(`Error: ${err instanceof Error ? err.message : String(err)}`);
      setSending(false);
    }
  }, [input, sending]);

  const handleRestore = useCallback(() => {
    setVisible(false);
    setTimeout(() => window.api.miniRestore(), 300);
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('input, button')) return;
    setDragging(true);
    dragStart.current = { x: e.clientX - pos.x, y: e.clientY - pos.y };
  }, [pos]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!dragging) return;
    setPos({ x: e.clientX - dragStart.current.x, y: e.clientY - dragStart.current.y });
  }, [dragging]);

  const handleMouseUp = useCallback(() => {
    setDragging(false);
  }, []);

  return (
    <div
      className="fixed inset-0 select-none"
      style={{ transform: `translate(${pos.x}px, ${pos.y}px)` }}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    >
      <style>{`
        @keyframes mini-slide-in {
          0% { opacity: 0; transform: translateY(20px) scale(0.95); filter: blur(4px); }
          100% { opacity: 1; transform: translateY(0) scale(1); filter: blur(0); }
        }
        @keyframes mini-slide-out {
          0% { opacity: 1; transform: translateY(0) scale(1); filter: blur(0); }
          100% { opacity: 0; transform: translateY(20px) scale(0.95); filter: blur(4px); }
        }
        @keyframes mini-glow-pulse {
          0%, 100% { opacity: 0.5; }
          50% { opacity: 1; }
        }
        @keyframes mini-send-pulse {
          0% { transform: scale(1); }
          50% { transform: scale(1.15); }
          100% { transform: scale(1); }
        }
      `}</style>

      {/* Main input row — fully transparent, no background block */}
      <div
        className="flex items-center gap-0 h-[48px] mx-2"
        style={{
          animation: visible
            ? 'mini-slide-in 0.35s cubic-bezier(0.16, 1, 0.3, 1) forwards'
            : 'mini-slide-out 0.25s cubic-bezier(0.7, 0, 0.84, 0) forwards',
          opacity: visible ? undefined : 0,
        }}
        onMouseDown={handleMouseDown}
      >
        {/* Glow layer behind the input — visible when focused or typing */}
        <div
          className="absolute inset-0 rounded-full pointer-events-none"
          style={{
            margin: '0 8px',
            background: focused || input
              ? 'linear-gradient(135deg, rgba(99,102,241,0.12) 0%, rgba(34,211,238,0.08) 100%)'
              : 'transparent',
            boxShadow: focused || input
              ? '0 0 24px rgba(99,102,241,0.18), 0 0 48px rgba(34,211,238,0.08), inset 0 0 12px rgba(99,102,241,0.06)'
              : '0 0 16px rgba(99,102,241,0.06)',
            border: `1px solid ${focused || input ? 'rgba(99,102,241,0.2)' : 'rgba(255,255,255,0.06)'}`,
            borderRadius: '9999px',
            transition: 'all 0.4s cubic-bezier(0.16, 1, 0.3, 1)',
          }}
        />

        {/* Infinite logo */}
        <button
          onClick={handleRestore}
          className="relative z-10 flex-shrink-0 w-8 h-8 ml-1 rounded-full flex items-center justify-center transition-all duration-300 hover:scale-110"
          style={{
            background: 'rgba(99,102,241,0.08)',
          }}
          title="Open Infinite OS"
        >
          <svg width="16" height="16" viewBox="0 0 64 64" fill="none">
            <path d="M17.2 20.8C17.2 28.7 23.6 35 32 35C40.4 35 46.8 28.7 46.8 20.8" stroke="#6366f1" strokeWidth="5" strokeLinecap="round" />
            <path d="M46.8 43.2C46.8 35.3 40.4 29 32 29C23.6 29 17.2 35.3 17.2 43.2" stroke="#22d3ee" strokeWidth="5" strokeLinecap="round" />
            <circle cx="17.2" cy="20.8" r="3.2" fill="#6366f1" />
            <circle cx="46.8" cy="43.2" r="3.2" fill="#22d3ee" />
          </svg>
        </button>

        {/* Input — transparent, no bg */}
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
          className="relative z-10 flex-1 bg-transparent text-[13px] text-zinc-100 outline-none placeholder:text-zinc-500/60 disabled:opacity-40 min-w-0 px-2 py-2"
          style={{ caretColor: '#6366f1' }}
        />

        {/* Send / Stop — pill shaped, glow on active */}
        <button
          onClick={sending ? () => { setSending(false); } : handleSend}
          disabled={!input.trim() && !sending}
          className="relative z-10 flex-shrink-0 w-8 h-8 mr-1 rounded-full flex items-center justify-center transition-all duration-300 disabled:opacity-20"
          style={{
            background: sending
              ? 'rgba(239,68,68,0.12)'
              : input.trim()
                ? 'linear-gradient(135deg, rgba(99,102,241,0.2) 0%, rgba(34,211,238,0.15) 100%)'
                : 'rgba(255,255,255,0.03)',
            boxShadow: input.trim() && !sending
              ? '0 0 12px rgba(99,102,241,0.15)'
              : 'none',
            animation: sending ? 'mini-send-pulse 1.5s ease-in-out infinite' : 'none',
          }}
        >
          {sending ? (
            <svg className="w-3.5 h-3.5 text-red-400" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          ) : (
            <svg className="w-3.5 h-3.5" style={{ color: input.trim() ? '#818cf8' : 'rgba(255,255,255,0.2)' }} fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
            </svg>
          )}
        </button>
      </div>

      {/* Response preview — floats below, also transparent */}
      {response && (
        <div
          className="mx-4 mt-1 px-3 py-2 rounded-xl text-xs text-zinc-300 max-h-16 overflow-y-auto leading-relaxed"
          style={{
            background: 'rgba(10,10,16,0.85)',
            border: '1px solid rgba(99,102,241,0.1)',
            boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
            animation: 'mini-slide-in 0.2s ease-out',
            backdropFilter: 'blur(12px)',
          }}
        >
          {response.length > 200 ? response.slice(-200) + '...' : response}
        </div>
      )}
    </div>
  );
}
