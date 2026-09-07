import { useAiTabsStore } from '../../stores/aiTabs';

// Artifacts — every AI-generated workspace tab (charts, docs, dashboards,
// research, code…) in one gallery. Same glass language as the rest of the OS.
export function ArtifactsView({ onOpenTab }: { onOpenTab: (view: string) => void }) {
  const tabs = useAiTabsStore((s) => s.tabs);
  const closeTab = useAiTabsStore((s) => s.closeTab);
  const clearTabs = useAiTabsStore((s) => s.clearTabs);

  return (
    <div className="flex-1 overflow-hidden p-6 animate-fade-in flex flex-col min-h-0">
      <div className="flex items-center gap-3 mb-1">
        <div>
          <h1 className="text-2xl font-bold text-white leading-tight">Artifacts</h1>
          <p className="text-zinc-500 text-sm">
            Everything Infinite AI built for you — open, revisit, or discard.
          </p>
        </div>
        {tabs.length > 0 && (
          <button
            onClick={clearTabs}
            className="ml-auto rounded-lg px-3 py-1.5 text-xs font-medium bg-white/[0.04] border border-white/[0.08] text-zinc-300 hover:bg-red-500/15 hover:border-red-500/40 hover:text-red-200 transition-colors"
          >
            Clear all
          </button>
        )}
      </div>

      <div className="mt-4 flex-1 min-h-0 overflow-y-auto custom-scrollbar">
        {tabs.length === 0 ? (
          <div className="h-full min-h-[240px] flex flex-col items-center justify-center gap-2 text-center rounded-xl bg-[#0c1018] border border-white/[0.06]">
            <div className="text-sm text-zinc-400 font-medium">No artifacts yet</div>
            <div className="text-xs text-zinc-600 max-w-sm">
              Ask in chat for a chart, summary, dashboard, lesson, or website — results land here automatically.
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3 pb-4">
            {tabs.map((t) => (
              <div
                key={t.id}
                className="agent-card agent-card--static !p-4 cursor-pointer"
                onClick={() => onOpenTab(t.id)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') onOpenTab(t.id);
                }}
              >
                <div className="flex items-center gap-2">
                  <span className="af-badge">{t.kind}</span>
                  <span className="ml-auto text-[10px] font-mono text-zinc-600">
                    {new Date(t.createdAt).toLocaleDateString()}
                  </span>
                </div>
                <div className="mt-2 text-sm font-semibold text-zinc-100 truncate" title={t.title}>
                  {t.title}
                </div>
                <div className="af-desc truncate" title={t.prompt}>
                  {t.prompt}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpenTab(t.id);
                    }}
                    className="af-action"
                  >
                    Open
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      closeTab(t.id);
                    }}
                    aria-label={`Discard ${t.title}`}
                    className="rounded-lg px-2.5 py-2 text-xs bg-white/[0.03] border border-white/[0.08] text-zinc-500 hover:bg-red-500/15 hover:border-red-500/40 hover:text-red-200 transition-colors"
                  >
                    ✕
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
