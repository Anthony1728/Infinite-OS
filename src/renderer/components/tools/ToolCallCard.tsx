import { useState, useEffect } from 'react';

export function ToolIcon({ name }: { name: string }) {
  const n = name.toLowerCase();
  let inner: React.ReactNode;

  if (/(file|read|write|edit|save|document|markdown)/.test(n)) {
    inner = (
      <>
        <path d="M7 3h7l5 5v11a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" />
        <path d="M14 3v5h5" />
      </>
    );
  } else if (/(shell|bash|terminal|command|exec|run|process)/.test(n)) {
    inner = (
      <>
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <path d="M7 9l3 3-3 3M13 15h4" />
      </>
    );
  } else if (/(browser|navigate|click|scroll|web|page|site|url)/.test(n)) {
    inner = (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M3 12h18M12 3c2.6 2.6 2.6 15.4 0 18M12 3c-2.6 2.6-2.6 15.4 0 18" />
      </>
    );
  } else if (/(search|fetch|scrape|crawl)/.test(n)) {
    inner = (
      <>
        <circle cx="11" cy="11" r="7" />
        <path d="M21 21l-4.3-4.3" />
      </>
    );
  } else if (/(memory|knowledge|recall|remember|brain|learn)/.test(n)) {
    inner = (
      <>
        <path d="M4 5a2 2 0 0 1 2-2h12v15H6a2 2 0 0 0-2 2V5z" />
        <path d="M4 20a2 2 0 0 1 2-2h12" />
      </>
    );
  } else if (/(git|branch|commit|repo|diff)/.test(n)) {
    inner = (
      <>
        <circle cx="6" cy="6" r="2.5" />
        <circle cx="6" cy="18" r="2.5" />
        <circle cx="18" cy="8" r="2.5" />
        <path d="M6 8.5v7M18 10.5c0 4-6 3-6 6.5" />
      </>
    );
  } else if (/(image|photo|picture|vision|draw|paint|design)/.test(n)) {
    inner = (
      <>
        <rect x="4" y="5" width="16" height="14" rx="2" />
        <circle cx="9" cy="10" r="1.5" />
        <path d="M5 17l4-4 3 3 3-4 4 4" />
      </>
    );
  } else if (/(agent|bot|assistant|orchestrat|subagent)/.test(n)) {
    inner = (
      <>
        <rect x="5" y="8" width="14" height="11" rx="2" />
        <path d="M12 8V5M9 3h6M9 13h.01M15 13h.01" />
      </>
    );
  } else {
    inner = <path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2 2-2-2 2-2z" />;
  }

  return (
    <svg
      className="w-4 h-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      viewBox="0 0 24 24"
    >
      {inner}
    </svg>
  );
}

export function ToolCallCard({
  name,
  input,
  status,
  startTime,
}: {
  name: string;
  input: unknown;
  status: 'running' | 'done';
  startTime?: number;
}) {
  const [open, setOpen] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const running = status === 'running';
  const summary = (() => {
    const i = (input ?? {}) as Record<string, unknown>;
    const s = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : String(v));
    const cmd = s(i.command ?? i.cmd ?? i.path ?? i.file_path ?? i.query ?? i.url ?? '').slice(0, 80);
    return cmd ? `· ${cmd}` : '';
  })();

  useEffect(() => {
    if (!running || !startTime) return;
    const interval = setInterval(() => {
      setElapsed(Date.now() - startTime);
    }, 100);
    return () => clearInterval(interval);
  }, [running, startTime]);

  const formatElapsed = (ms: number) => {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
  };

  return (
    <div
      className={`group my-2 rounded-xl border bg-[#0c1018] overflow-hidden transition-colors ${
        running ? 'border-indigo-500/40 animate-glow-border' : 'border-white/[0.06]'
      }`}
    >
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-white/[0.03]"
        title={summary || name}
      >
        <span
          className={`relative flex items-center justify-center w-7 h-7 rounded-lg flex-shrink-0 ${
            running ? 'bg-indigo-500/15 text-indigo-300' : 'bg-white/[0.04] text-zinc-400'
          }`}
        >
          {running && (
            <>
              <span className="absolute inset-0 rounded-lg border border-indigo-400/50 animate-ping" />
              <span className="absolute inset-0 rounded-lg border-2 border-transparent border-t-indigo-400 animate-spin" />
            </>
          )}
          <ToolIcon name={name} />
        </span>

        <span className="min-w-0 flex-1 truncate text-sm font-medium font-mono text-zinc-200">
          {name} <span className="font-sans text-xs font-normal text-zinc-500 truncate">{summary}</span>
        </span>

        <span className="ml-auto flex items-center gap-2 text-xs flex-shrink-0">
          {running ? (
            <>
              <span className="h-3 w-3 animate-spin rounded-full border-[1.5px] border-current/40 border-t-current text-indigo-300" />
              <span className="text-indigo-300">running</span>
              {elapsed > 0 && (
                <span className="text-indigo-400/60 font-mono text-[10px]">
                  {formatElapsed(elapsed)}
                </span>
              )}
            </>
          ) : (
            <>
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
              <span className="text-zinc-500">done</span>
            </>
          )}
          <span className="text-zinc-600 ml-1 text-[10px]">{open ? '▾' : '▸'}</span>
        </span>
      </button>

      {open && (
        <pre className="max-h-48 overflow-auto border-t border-white/[0.06] bg-black/20 px-3 py-2 font-mono text-[11px] leading-relaxed text-zinc-400">
          {(() => {
            try {
              return JSON.stringify(input, null, 2).slice(0, 4000);
            } catch {
              return String(input).slice(0, 4000);
            }
          })()}
        </pre>
      )}
    </div>
  );
}
