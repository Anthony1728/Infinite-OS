import { useState } from 'react';
import { useAiTabsStore } from '../../stores/aiTabs';

// Artifacts — every AI-generated workspace tab (charts, docs, dashboards,
// research, code…) in one gallery. Same glass language as the rest of the OS.
export function ArtifactsView({ onOpenTab }: { onOpenTab: (view: string) => void }) {
  const tabs = useAiTabsStore((s) => s.tabs);
  const closeTab = useAiTabsStore((s) => s.closeTab);
  const clearTabs = useAiTabsStore((s) => s.clearTabs);

  const [search, setSearch] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  const filteredTabs = tabs
    .filter((t) =>
      search
        ? t.title.toLowerCase().includes(search.toLowerCase()) ||
          t.prompt.toLowerCase().includes(search.toLowerCase())
        : true
    )
    .sort((a, b) => b.createdAt - a.createdAt);

  const handleConfirmDelete = () => {
    if (deleteTarget) {
      closeTab(deleteTarget);
      setDeleteTarget(null);
    }
  };

  const handleCancelDelete = () => {
    setDeleteTarget(null);
  };

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

      {tabs.length > 0 && (
        <div className="mt-4">
          <input
            type="text"
            placeholder="Search artifacts..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-lg bg-white/[0.04] border border-white/[0.08] px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-white/20 transition-colors"
          />
        </div>
      )}

      <div className="mt-4 flex-1 min-h-0 overflow-y-auto custom-scrollbar">
        {filteredTabs.length === 0 ? (
          <div className="h-full min-h-[240px] flex flex-col items-center justify-center gap-2 text-center rounded-xl bg-[#0c1018] border border-white/[0.06]">
            {search ? (
              <>
                <div className="text-sm text-zinc-400 font-medium">No matching artifacts</div>
                <div className="text-xs text-zinc-600 max-w-sm">
                  Try a different search term
                </div>
              </>
            ) : (
              <>
                <div className="text-sm text-zinc-400 font-medium">No artifacts yet</div>
                <div className="text-xs text-zinc-600 max-w-sm">
                  Ask in chat for a chart, summary, dashboard, lesson, or website — results land here automatically.
                </div>
              </>
            )}
          </div>
        ) : (
          <>
            <div className="text-xs text-zinc-600 mb-3">
              Showing {filteredTabs.length} of {tabs.length} artifact{tabs.length !== 1 ? 's' : ''}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3 pb-4">
              {filteredTabs.map((t) => (
                <div
                  key={t.id}
                  className="agent-card agent-card--static !p-4 cursor-pointer hover:border-white/15 transition-colors"
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
                        setDeleteTarget(t.id);
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
          </>
        )}
      </div>

      {deleteTarget && (
        <div
          className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 animate-fade-in"
          onClick={handleCancelDelete}
        >
          <div
            className="bg-[#111827] rounded-xl border border-white/[0.08] p-5 max-w-sm w-full mx-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-semibold text-white mb-2">Discard artifact?</h3>
            <p className="text-sm text-zinc-400 mb-4">
              This will remove the artifact from your gallery. This action cannot be undone.
            </p>
            <div className="flex gap-2 justify-end">
              <button
                onClick={handleCancelDelete}
                className="rounded-lg px-3 py-1.5 text-xs font-medium bg-white/[0.04] border border-white/[0.08] text-zinc-300 hover:bg-white/[0.08] transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmDelete}
                className="rounded-lg px-3 py-1.5 text-xs font-medium bg-red-600/20 border border-red-500/40 text-red-200 hover:bg-red-600/30 transition-colors"
              >
                Discard
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
