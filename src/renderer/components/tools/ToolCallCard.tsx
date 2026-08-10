import { useState } from 'react';

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
}: {
  name: string;
  input: unknown;
  status: 'running' | 'done';
}) {
  const [open, setOpen] = useState(false);
  const running = status === 'running';

  return (
    <div
      className={`group my-2 rounded-xl border bg-[#0c1018] overflow-hidden transition-colors ${
        running ? 'border-indigo-500/40 animate-glow-border' : 'border-borderSubtle'
      }`}
    >
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-white/[0.03]"
      >
        <span
          className={`relative flex items-center justify-center w-7 h-7 rounded-lg flex-shrink-0 ${
            running ? 'bg-indigo-500/15 text-indigo-300' : 'bg-white/[0.04] text-zinc-300'
          }`}
        >
          {running && <span className="absolute inset-0 rounded-lg border border-indigo-400/50 animate-ping" />}
          <ToolIcon name={name} />
        </span>

        <span className="text-sm font-medium font-mono text-zinc-200 truncate">{name}</span>

        <span className="ml-auto flex items-center gap-2 text-xs flex-shrink-0">
          {running ? (
            <>
              <span className="w-3.5 h-3.5 rounded-full border-2 border-indigo-400/30 border-t-indigo-400 animate-spin" />
              <span className="text-indigo-300">running…</span>
            </>
          ) : (
            <>
              <svg
                className="w-3.5 h-3.5 text-emerald-400"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                viewBox="0 0 24 24"
              >
                <path d="M4.5 12.75l6 6 9-13.5" />
              </svg>
              <span className="text-emerald-400/80">done</span>
            </>
          )}
          <span className="text-textMuted ml-1">{open ? '▾' : '▸'}</span>
        </span>
      </button>

      {open && (
        <pre className="px-3 py-2 text-[11px] text-zinc-400 border-t border-borderSubtle overflow-x-auto bg-black/20">
          {JSON.stringify(input, null, 2)}
        </pre>
      )}
    </div>
  );
}
