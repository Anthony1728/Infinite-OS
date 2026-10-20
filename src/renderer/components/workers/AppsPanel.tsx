import { useEffect, useState } from 'react';
import { useWorkersStore, type CatalogApp, type InstalledApp } from '../../stores/workers';
import { useNotificationStore } from '../../stores/notifications';

const CATEGORY_COLORS: Record<string, string> = {
  'Browsers': 'text-sky-300 border-sky-400/30',
  'Communication': 'text-emerald-300 border-emerald-400/30',
  'Productivity': 'text-violet-300 border-violet-400/30',
  'Development': 'text-amber-300 border-amber-400/30',
  'Media': 'text-rose-300 border-rose-400/30',
  'Utilities': 'text-gray-300 border-white/20',
  'Security': 'text-red-300 border-red-400/30',
  'AI': 'text-indigo-300 border-indigo-400/30',
};

export function AppsPanel() {
  const { catalog, installed, refreshApps } = useWorkersStore();
  const addToast = useNotificationStore((s) => s.addToast);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => void refreshApps(query), 250);
    return () => window.clearTimeout(timer);
  }, [query, refreshApps]);

  const guard = async (label: string, action: () => Promise<void>) => {
    setBusy(label);
    try {
      await action();
    } catch (error) {
      addToast({ type: 'error', title: 'App action failed', message: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(null);
    }
  };

  const install = (app: CatalogApp) =>
    guard(`install:${app.wingetId}`, async () => {
      addToast({ type: 'info', title: `Installing ${app.name}`, message: 'winget is running in the background — this can take a few minutes.' });
      const result = await window.api.appsInstall({ wingetId: app.wingetId }) as { ok: boolean; message?: string; error?: string };
      await refreshApps(query);
      if (!result.ok) throw new Error(result.error ?? 'winget reported a failure.');
      addToast({ type: 'success', title: `${app.name} installed`, message: result.message });
    });

  const launch = (app: InstalledApp) =>
    guard(`launch:${app.id}`, async () => {
      const result = await window.api.appsLaunch({ appId: app.id }) as { ok: boolean; error?: string };
      if (!result.ok) throw new Error(result.error ?? 'Could not launch the app.');
      addToast({ type: 'success', title: `Launched ${app.name}` });
    });

  return (
    <div className="flex flex-col gap-4 min-h-0 flex-1 overflow-y-auto pr-1">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-xl font-semibold text-white">Apps</h2>
          <p className="text-sm text-gray-500 mt-0.5">
            Install and launch the apps your workers sign in to — winget under the hood, one click here.
          </p>
        </div>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search apps…"
          className="w-64 bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-white/25"
        />
      </div>

      {installed.length > 0 && (
        <div>
          <div className="text-[11px] uppercase tracking-wide text-gray-500 mb-2">Installed on this PC ({installed.length})</div>
          <div className="flex flex-wrap gap-2">
            {installed.slice(0, 40).map((app) => (
              <button
                key={`${app.name}:${app.id}`}
                onClick={() => void launch(app)}
                disabled={busy === `launch:${app.id}`}
                className="text-xs px-3 py-1.5 rounded-lg border border-white/[0.08] bg-white/[0.04] text-gray-300 hover:bg-white/[0.08] disabled:opacity-50"
              >
                ▶ {app.name}
              </button>
            ))}
          </div>
        </div>
      )}

      <div>
        <div className="text-[11px] uppercase tracking-wide text-gray-500 mb-2">
          Catalog {catalog.length ? `(${catalog.length} matches)` : ''}
        </div>
        {!catalog.length && (
          <div className="rounded-xl border border-dashed border-white/15 p-6 text-center text-sm text-gray-500">
            No catalog matches. Try a shorter search — the catalog covers browsers, chat, office, dev tools, and AI apps.
          </div>
        )}
        <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-3">
          {catalog.map((app) => (
            <div key={app.wingetId} className="rounded-xl border border-white/[0.07] bg-white/[0.03] p-4 flex flex-col gap-2">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-white truncate">{app.name}</div>
                  <div className="text-[11px] text-gray-500 truncate">{app.publisher}</div>
                </div>
                <span className={`text-[10px] uppercase border rounded px-1.5 py-0.5 shrink-0 ${CATEGORY_COLORS[app.category] ?? CATEGORY_COLORS.Utilities}`}>
                  {app.category}
                </span>
              </div>
              <p className="text-xs text-gray-400 line-clamp-2 flex-1">{app.description}</p>
              <div className="flex items-center justify-between gap-2">
                <code className="text-[10px] text-gray-600 truncate">{app.wingetId}</code>
                <button
                  onClick={() => (app.installed ? void launch(app) : void install(app))}
                  disabled={busy === `install:${app.wingetId}`}
                  className={`text-xs px-3 py-1.5 rounded-lg font-medium disabled:opacity-50 ${
                    app.installed
                      ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-400/30 hover:bg-emerald-500/25'
                      : 'bg-indigo-500 hover:bg-indigo-400 text-white'
                  }`}
                >
                  {busy === `install:${app.wingetId}` ? 'Installing…' : app.installed ? 'Launch' : 'Install'}
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
