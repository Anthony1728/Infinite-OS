import { useEffect, useRef, useState, useCallback } from 'react';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import 'xterm/css/xterm.css';
import { useTerminalStore, nextTerminalTitle } from '../../stores/terminal';

// InfiniteOS terminal — Hermes-class PTY visuals in the native Infinite glass style.
// Violet → cyan brand spectrum, dark glass (#0c1018), fast canvas renderer.

const XTERM_THEME = {
  background: '#0c1018',
  foreground: '#e4e4e7',
  cursor: '#22d3ee',
  cursorAccent: '#0c1018',
  selectionBackground: 'rgba(139, 92, 246, 0.3)',
  selectionForeground: '#ffffff',
  black: '#18181b',
  red: '#f87171',
  green: '#34d399',
  yellow: '#fbbf24',
  blue: '#60a5fa',
  magenta: '#c084fc',
  cyan: '#22d3ee',
  white: '#e4e4e7',
  brightBlack: '#52525b',
  brightRed: '#fca5a5',
  brightGreen: '#6ee7b7',
  brightYellow: '#fcd34d',
  brightBlue: '#93c5fd',
  brightMagenta: '#d8b4fe',
  brightCyan: '#67e8f9',
  brightWhite: '#fafafa',
};

interface PtySession {
  sessionId: string;
  pid: number;
  cols: number;
  rows: number;
  cwd: string;
}

function SingleTerminal({
  sessionId,
  visible,
  onExit,
}: {
  sessionId: string;
  visible: boolean;
  onExit: (code: number) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const onExitRef = useRef(onExit);
  onExitRef.current = onExit;

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const term = new Terminal({
      theme: XTERM_THEME,
      fontFamily: "'JetBrains Mono', 'Cascadia Code', Consolas, monospace",
      fontSize: 13,
      lineHeight: 1.35,
      cursorBlink: true,
      cursorStyle: 'bar',
      scrollback: 5000,
      allowTransparency: false,
      convertEol: true,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(el);
    termRef.current = term;
    fitRef.current = fit;

    // Fit after mount + on container resize (fast: rAF-throttled).
    let raf = 0;
    const doFit = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        try {
          fit.fit();
          const dims = fit.proposeDimensions();
          if (dims?.cols && dims?.rows) {
            void window.api.terminalResize({ sessionId, cols: dims.cols, rows: dims.rows });
          }
        } catch {
          /* terminal not ready */
        }
      });
    };
    doFit();
    const ro = new ResizeObserver(doFit);
    ro.observe(el);

    const offData = window.api.onTerminalData((payload: { sessionId: string; data: string }) => {
      if (payload.sessionId === sessionId) term.write(payload.data);
    });
    const offExit = window.api.onTerminalExit((payload: { sessionId: string; exitCode: number; signal: string }) => {
      if (payload.sessionId === sessionId) {
        term.write(`\r\n\x1b[90m[exit ${payload.exitCode}]\x1b[0m\r\n`);
        onExitRef.current(payload.exitCode);
      }
    });

    // PTY → xterm is subscribed main-side; keystrokes flow back.
    term.onData((data) => {
      void window.api.terminalWrite({ sessionId, data });
    });
    term.attachCustomKeyEventHandler((e) => {
      // Ctrl+Shift+C = copy, Ctrl+Shift+V = paste, Ctrl+L clear handled by shell.
      if (e.ctrlKey && e.shiftKey && e.code === 'KeyC' && term.hasSelection()) {
        void navigator.clipboard?.writeText(term.getSelection()).catch(() => {});
        return false;
      }
      return true;
    });

    void window.api.terminalSubscribe({ sessionId }).catch(() => {});

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      offData();
      offExit();
      term.dispose();
      termRef.current = null;
    };
  }, [sessionId]);

  useEffect(() => {
    if (visible) {
      // Re-fit when tab becomes visible (hidden divs measure 0).
      const t = setTimeout(() => {
        try {
          fitRef.current?.fit();
          termRef.current?.focus();
        } catch {
          /* noop */
        }
      }, 30);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [visible]);

  return <div ref={containerRef} className="h-full w-full" style={{ display: visible ? 'block' : 'none' }} />;
}

export function TerminalView() {
  const tabs = useTerminalStore((s) => s.tabs);
  const activeId = useTerminalStore((s) => s.activeId);
  const addTab = useTerminalStore((s) => s.addTab);
  const updateTab = useTerminalStore((s) => s.updateTab);
  const removeTab = useTerminalStore((s) => s.removeTab);
  const setActive = useTerminalStore((s) => s.setActive);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const spawn = useCallback(async () => {
    setBusy(true);
    setError('');
    try {
      const res = (await window.api.terminalCreateSession({ cols: 100, rows: 28 })) as
        | { ok: true; session: PtySession }
        | { error: string };
      if ('error' in res) {
        setError(res.error || 'PTY unavailable (node-pty missing). Use quick command below.');
        return;
      }
      addTab({
        id: res.session.sessionId,
        title: nextTerminalTitle(),
        cwd: res.session.cwd,
        pid: res.session.pid,
        status: 'running',
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to spawn terminal');
    } finally {
      setBusy(false);
    }
  }, [addTab]);

  // Auto-spawn first tab on mount (Hermes-style: terminal ready instantly).
  useEffect(() => {
    if (tabs.length === 0) void spawn();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const kill = useCallback(
    async (id: string) => {
      try {
        await window.api.terminalCloseSession({ sessionId: id });
      } catch {
        /* already dead */
      }
      removeTab(id);
    },
    [removeTab],
  );

  const active = tabs.find((t) => t.id === activeId) ?? null;

  return (
    <div className="flex-1 overflow-hidden p-6 animate-fade-in flex flex-col min-h-0">
      <div className="flex items-center gap-3 mb-4">
        <div>
          <h1 className="text-2xl font-bold text-white leading-tight">Terminal</h1>
          <p className="text-zinc-500 text-sm">
            Hermes-class PTY — multi-session, GPU-fast canvas, Infinite glass.
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => void spawn()}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold bg-gradient-to-r from-violet-600 to-cyan-500 text-white shadow-[0_6px_16px_rgba(124,58,237,.3)] hover:from-violet-500 hover:to-cyan-400 active:scale-[0.98] disabled:opacity-50 transition-all"
          >
            {busy ? 'Spawning…' : '+ New'}
          </button>
          {active && (
            <button
              onClick={() => void kill(active.id)}
              className="rounded-lg px-3 py-1.5 text-xs font-medium bg-white/[0.04] border border-white/[0.08] text-zinc-300 hover:bg-red-500/15 hover:border-red-500/40 hover:text-red-200 transition-colors"
            >
              Kill
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="mb-3 rounded-xl border border-amber-500/30 bg-amber-500/[0.07] px-3 py-2 text-xs text-amber-200">
          {error}
        </div>
      )}

      {/* Session tabs — Hermes busy-dot language, Infinite pill style */}
      <div className="flex items-center gap-1.5 mb-3 overflow-x-auto pb-1">
        {tabs.map((t) => {
          const isActive = t.id === activeId;
          const dot =
            t.status === 'running'
              ? 'bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,.8)]'
              : t.status === 'connecting'
                ? 'bg-amber-400 animate-pulse'
                : 'bg-zinc-600';
          return (
            <button
              key={t.id}
              onClick={() => setActive(t.id)}
              className={`group inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-medium whitespace-nowrap transition-all ${
                isActive
                  ? 'bg-gradient-to-r from-violet-500/20 via-cyan-500/10 to-transparent border-violet-500/40 text-violet-100'
                  : 'bg-white/[0.03] border-white/[0.06] text-zinc-400 hover:bg-white/[0.05] hover:text-zinc-200'
              }`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
              {t.title}
              <span className="text-zinc-600 font-mono text-[10px]">:{t.pid || '—'}</span>
              <span
                role="button"
                tabIndex={0}
                onClick={(e) => {
                  e.stopPropagation();
                  void kill(t.id);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.stopPropagation();
                    void kill(t.id);
                  }
                }}
                className="ml-1 rounded p-0.5 text-zinc-600 hover:bg-white/10 hover:text-zinc-200 opacity-0 group-hover:opacity-100 transition-opacity"
                aria-label={`Close ${t.title}`}
              >
                ✕
              </span>
            </button>
          );
        })}
        {tabs.length === 0 && !busy && (
          <span className="text-xs text-zinc-600">No sessions — hit + New.</span>
        )}
      </div>

      {/* Terminal surface */}
      <div className="min-h-0 flex-1 rounded-xl overflow-hidden bg-[#0c1018] border border-white/[0.06] shadow-[0_12px_32px_rgba(0,0,0,.35)] relative">
        <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-violet-500/50 via-cyan-400/40 to-transparent pointer-events-none" />
        {tabs.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center gap-3 text-center p-8">
            <div className="text-sm text-zinc-400 font-medium">No terminal session</div>
            <div className="text-xs text-zinc-600 max-w-sm">
              Spawn a full PTY shell. Each tab is an isolated shell with streaming I/O,
              resize-fit, and exit codes.
            </div>
            <button
              onClick={() => void spawn()}
              disabled={busy}
              className="mt-1 rounded-lg px-4 py-2 text-xs font-semibold bg-white/[0.05] border border-white/10 text-zinc-200 hover:bg-white/[0.08] disabled:opacity-50 transition-colors"
            >
              {busy ? 'Spawning…' : 'Spawn terminal'}
            </button>
          </div>
        ) : (
          tabs.map((t) => (
            <div key={t.id} className="h-full w-full p-2" style={{ display: t.id === activeId ? 'block' : 'none' }}>
              <SingleTerminal
                sessionId={t.id}
                visible={t.id === activeId}
                onExit={(code) => updateTab(t.id, { status: 'exited', exitCode: code })}
              />
            </div>
          ))
        )}
      </div>

      {/* Status bar — Hermes info density, Infinite tokens */}
      <div className="mt-2 flex items-center gap-3 text-[11px] font-mono text-zinc-500">
        <span className="inline-flex items-center gap-1.5">
          <span
            className={`h-1.5 w-1.5 rounded-full ${
              active?.status === 'running' ? 'bg-emerald-400' : active ? 'bg-zinc-600' : 'bg-zinc-700'
            }`}
          />
          {active ? `${active.status}${active.exitCode !== undefined ? ` (${active.exitCode})` : ''}` : 'idle'}
        </span>
        {active && (
          <>
            <span className="truncate max-w-[320px]" title={active.cwd}>
              {active.cwd}
            </span>
            <span className="ml-auto hidden sm:inline">Ctrl+Shift+C copy · shell handles Ctrl+L/Ctrl+C</span>
          </>
        )}
      </div>
    </div>
  );
}
