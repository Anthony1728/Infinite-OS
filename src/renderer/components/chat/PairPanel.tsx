export interface PairSection {
  memberId: string;
  role: string;
  provider: string;
  model: string;
  text: string;
  status: 'running' | 'done' | 'error';
}

function shortModel(model: string): string {
  return model.split('/').pop()?.replace(/:free$/, '') ?? model;
}

function prettyProvider(provider: string): string {
  if (provider === 'opencode') return 'OpenCode Zen';
  return provider
    .split(/[-_]/)
    .map((part) => (part ? part[0].toUpperCase() + part.slice(1) : part))
    .join(' ');
}

function SectionStatus({ status }: { status: PairSection['status'] }) {
  if (status === 'running') {
    return (
      <span className="flex items-center gap-1.5 text-[11px] text-indigo-300">
        <span className="h-3 w-3 animate-spin rounded-full border-[1.5px] border-current/40 border-t-current" />
        streaming
      </span>
    );
  }
  if (status === 'error') {
    return (
      <span className="flex items-center gap-1.5 text-[11px] text-red-400">
        <span className="h-1.5 w-1.5 rounded-full bg-red-400" />
        failed
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1.5 text-[11px] text-zinc-500">
      <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
      done
    </span>
  );
}

/**
 * Paired-model panel: BOTH models stream visibly in one coherent card while
 * a crew/pair run is live. Same Infinite glass language as ToolCallCard —
 * dots and one spinner, no tick lists.
 */
export function PairPanel({ sections }: { sections: PairSection[] }) {
  if (sections.length === 0) return null;
  return (
    <div className="my-2 rounded-xl border border-white/[0.06] bg-[#0c1018] overflow-hidden">
      <div className="px-3 pt-2.5 pb-1 flex items-center gap-2">
        <span className="inline-flex h-5 w-5 items-center justify-center rounded-md bg-gradient-to-br from-violet-500 to-cyan-400 text-white text-[10px] font-semibold">
          ∞
        </span>
        <span className="text-[10px] font-semibold tracking-[0.14em] uppercase text-violet-300">
          Paired models
        </span>
      </div>
      <div className="px-3 pb-2.5 space-y-2.5">
        {sections.map((s) => (
          <div key={s.memberId} className="rounded-lg bg-white/[0.02] border border-white/[0.05] px-3 py-2.5">
            <div className="flex items-center gap-2 mb-1.5">
              <span className="text-xs font-medium text-zinc-100 truncate">{s.role}</span>
              <span className="text-[10px] text-zinc-500 truncate font-mono">
                {prettyProvider(s.provider)} · {shortModel(s.model)}
              </span>
              <span className="ml-auto flex-shrink-0">
                <SectionStatus status={s.status} />
              </span>
            </div>
            {s.text ? (
              <p className="text-[13px] leading-6 text-zinc-300 whitespace-pre-wrap break-words">
                {s.text}
                {s.status === 'running' && <span className="ml-0.5 inline-block h-3.5 w-[7px] translate-y-[3px] animate-pulse rounded-[1px] bg-cyan-300/80" />}
              </p>
            ) : (
              <p className="text-xs text-zinc-600">Working…</p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
