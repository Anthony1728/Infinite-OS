import { useCallback, useEffect, useState } from 'react';
import { useNotificationStore } from '../../stores/notifications';

interface Creation {
  id: string;
  kind: 'app' | 'website';
  name: string;
  description?: string;
  status?: string;
  updatedAt?: number;
  outputPath?: string;
}

type Filter = 'all' | 'app' | 'website';

export function CreationsView() {
  const [items, setItems] = useState<Creation[]>([]);
  const [filter, setFilter] = useState<Filter>('all');
  const [loading, setLoading] = useState(true);
  const addToast = useNotificationStore((s) => s.addToast);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [apps, sites] = await Promise.all([
        (window.api.appListProjects() as Promise<Array<Record<string, unknown>>>).catch(() => []),
        (window.api.websiteList() as Promise<Array<Record<string, unknown>>>).catch(() => []),
      ]);
      const merged: Creation[] = [
        ...(Array.isArray(apps) ? apps : []).map((a) => ({
          id: String(a.id ?? ''),
          kind: 'app' as const,
          name: String(a.name ?? 'Untitled app'),
          description: typeof a.description === 'string' ? a.description : undefined,
          status: typeof a.status === 'string' ? a.status : undefined,
          updatedAt: typeof a.updatedAt === 'number' ? a.updatedAt : undefined,
          outputPath: typeof a.outputPath === 'string' ? a.outputPath : undefined,
        })),
        ...(Array.isArray(sites) ? sites : []).map((w) => ({
          id: String(w.id ?? ''),
          kind: 'website' as const,
          name: String(w.name ?? 'Untitled site'),
          description: typeof w.description === 'string' ? w.description : undefined,
          status: typeof w.status === 'string' ? w.status : undefined,
          updatedAt: typeof w.updatedAt === 'number' ? w.updatedAt : undefined,
          outputPath: typeof w.outputPath === 'string' ? w.outputPath : undefined,
        })),
      ].filter((c) => c.id);
      merged.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
      setItems(merged);
    } catch {
      /* gallery is advisory */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const reveal = async (item: Creation) => {
    if (!item.outputPath) {
      addToast({ title: 'No folder yet', message: item.kind === 'app' ? 'Build the project first — its folder appears after the first build.' : 'Generate the site first — its folder appears after generation.', type: 'error' });
      return;
    }
    try {
      const res = (await window.api.fileOpen({ path: item.outputPath })) as { ok?: boolean; error?: string };
      if (res?.error) addToast({ title: 'Open failed', message: res.error, type: 'error' });
    } catch (e) {
      addToast({ title: 'Open failed', message: e instanceof Error ? e.message : 'Unknown error', type: 'error' });
    }
  };

  const remove = async (item: Creation) => {
    if (!window.confirm(`Delete "${item.name}" and its generated files?`)) return;
    try {
      if (item.kind === 'app') await window.api.appDelete({ projectId: item.id });
      else await window.api.websiteDelete({ websiteId: item.id });
      addToast({ title: 'Deleted', message: item.name, type: 'success' });
      await refresh();
    } catch (e) {
      addToast({ title: 'Delete failed', message: e instanceof Error ? e.message : 'Unknown error', type: 'error' });
    }
  };

  const visible = filter === 'all' ? items : items.filter((c) => c.kind === filter);
  const appCount = items.filter((c) => c.kind === 'app').length;
  const siteCount = items.filter((c) => c.kind === 'website').length;

  return (
    <div className="flex-1 overflow-y-auto p-6 animate-fade-in min-h-0">
      <h1 className="text-2xl font-bold text-white leading-tight">AI Creations</h1>
      <p className="text-zinc-500 text-sm mb-4">
        Everything Infinite OS builds — apps and websites in one place.
        {items.length > 0 && ` ${appCount} app${appCount === 1 ? '' : 's'} · ${siteCount} site${siteCount === 1 ? '' : 's'}`}
      </p>

      <div className="flex items-center gap-1.5 mb-4">
        {(['all', 'app', 'website'] as Filter[]).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-all ${
              filter === f
                ? 'bg-gradient-to-r from-violet-500/20 via-cyan-500/10 to-transparent border-violet-500/40 text-violet-100'
                : 'bg-white/[0.03] border-white/[0.06] text-zinc-400 hover:bg-white/[0.06]'
            }`}
          >
            {f === 'all' ? 'All' : f === 'app' ? 'Apps' : 'Websites'}
          </button>
        ))}
        <button
          onClick={() => void refresh()}
          className="ml-auto rounded-lg px-3 py-1.5 text-xs font-medium bg-white/[0.03] border border-white/[0.06] text-zinc-400 hover:bg-white/[0.06] transition-colors"
        >
          Refresh
        </button>
      </div>

      {loading ? (
        <p className="text-sm text-zinc-500">Loading creations…</p>
      ) : visible.length === 0 ? (
        <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-8 text-center">
          <p className="text-sm text-zinc-300 font-medium mb-1">Nothing built yet</p>
          <p className="text-xs text-zinc-500">Ask the agent to build an app or a website — it will appear here.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {visible.map((item) => (
            <div
              key={`${item.kind}:${item.id}`}
              className="agent-card--static rounded-2xl border border-white/10 bg-white/[0.04] backdrop-blur-xl p-4"
            >
              <div className="flex items-center gap-2 mb-1.5">
                <span className="text-[9px] font-semibold uppercase tracking-wider px-1.5 py-px rounded bg-violet-500/15 text-violet-300 border border-violet-400/20">
                  {item.kind}
                </span>
                {item.status && (
                  <span className="text-[9px] font-semibold uppercase tracking-wider px-1.5 py-px rounded bg-cyan-500/15 text-cyan-300 border border-cyan-400/20">
                    {item.status}
                  </span>
                )}
                {item.updatedAt ? (
                  <span className="ml-auto text-[10px] text-zinc-600">{new Date(item.updatedAt).toLocaleDateString()}</span>
                ) : null}
              </div>
              <h2 className="text-sm font-semibold text-white truncate" title={item.name}>{item.name}</h2>
              {item.description && <p className="text-xs text-zinc-500 mt-1 line-clamp-2">{item.description}</p>}
              <div className="flex gap-2 mt-3">
                <button
                  onClick={() => void reveal(item)}
                  title={item.outputPath ?? 'No generated files yet'}
                  className="rounded-lg px-3 py-1.5 text-xs font-semibold bg-gradient-to-r from-violet-600 to-cyan-500 text-white hover:from-violet-500 hover:to-cyan-400 transition-all"
                >
                  {item.outputPath ? 'Open folder' : 'No folder yet'}
                </button>
                <button
                  onClick={() => void remove(item)}
                  className="rounded-lg px-3 py-1.5 text-xs font-medium bg-white/[0.04] border border-white/[0.08] text-zinc-400 hover:text-red-300 hover:border-red-500/30 transition-colors"
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
