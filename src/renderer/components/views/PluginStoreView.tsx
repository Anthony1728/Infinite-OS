import { useEffect } from 'react';
import { usePluginStore } from '../../../renderer/stores/plugin';
import { useNotificationStore } from '../../../renderer/stores/notifications';

export function PluginStoreView() {
  const { plugins, stats, loading, loadPlugins, loadStats, installPlugin, enablePlugin, disablePlugin } = usePluginStore();
  const addToast = useNotificationStore((s) => s.addToast);

  useEffect(() => { loadPlugins(); loadStats(); }, [loadPlugins, loadStats]);

  const handleInstall = async (id: string) => {
    await installPlugin(id);
    addToast({ type: 'success', title: 'Plugin installed' });
  };

  const handleToggle = async (plugin: typeof plugins[0]) => {
    if (plugin.enabled) { await disablePlugin(plugin.id); addToast({ type: 'info', title: 'Plugin disabled' }); }
    else { await enablePlugin(plugin.id); addToast({ type: 'success', title: 'Plugin enabled' }); }
  };

  const categoryColors: Record<string, string> = {
    productivity: 'from-blue-500 to-indigo-500',
    development: 'from-green-500 to-emerald-500',
    communication: 'from-purple-500 to-pink-500',
    analytics: 'from-amber-500 to-orange-500',
    other: 'from-gray-500 to-gray-600',
  };

  return (
    <div className="flex-1 overflow-y-auto p-6 animate-fade-in">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-textMain flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-purple-500 flex items-center justify-center shadow-lg">
            <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M13.5 16.875h3.375m0 0h3.375m-3.375 0V13.5m0 3.375v3.375M6 10.5h2.25a2.25 2.25 0 002.25-2.25V6a2.25 2.25 0 00-2.25-2.25H6A2.25 2.25 0 003.75 6v2.25A2.25 2.25 0 006 10.5zm0 9.75h2.25A2.25 2.25 0 0010.5 18v-2.25a2.25 2.25 0 00-2.25-2.25H6a2.25 2.25 0 00-2.25 2.25V18A2.25 2.25 0 006 20.25zm9.75-9.75H18a2.25 2.25 0 002.25-2.25V6A2.25 2.25 0 0018 3.75h-2.25A2.25 2.25 0 0013.5 6v2.25a2.25 2.25 0 002.25 2.25z" /></svg>
          </div>
          Plugin Store
        </h1>
        <p className="text-textMuted text-sm mt-1">Extend InfiniteAI OS with powerful plugins.</p>
      </div>

      <div className="grid grid-cols-3 gap-4 mb-6">
        {[
          { label: 'Total Plugins', value: stats?.total ?? plugins.length },
          { label: 'Installed', value: stats?.installed ?? 0 },
          { label: 'Enabled', value: stats?.enabled ?? 0 },
        ].map((stat, i) => (
          <div key={i} className="card-premium animate-slide-up" style={{ animationDelay: `${i * 25}ms` }}>
            <div className="text-xs text-textMuted mb-1">{stat.label}</div>
            <div className="text-2xl font-bold text-textMain">{stat.value}</div>
          </div>
        ))}
      </div>

      {loading ? (
        <div className="text-center py-8"><div className="w-6 h-6 border-2 border-violet-500 border-t-transparent rounded-full animate-spin mx-auto" /></div>
      ) : (
        <div className="grid grid-cols-2 gap-4">
          {plugins.map((plugin, i) => (
            <div key={plugin.id} className="card-premium animate-slide-up" style={{ animationDelay: `${i * 20}ms` }}>
              <div className="flex items-start gap-3">
                <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${categoryColors[plugin.category] || categoryColors.other} flex items-center justify-center shadow-lg flex-shrink-0`}>
                  <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M13.5 16.875h3.375m0 0h3.375m-3.375 0V13.5m0 3.375v3.375M6 10.5h2.25a2.25 2.25 0 002.25-2.25V6a2.25 2.25 0 00-2.25-2.25H6A2.25 2.25 0 003.75 6v2.25A2.25 2.25 0 006 10.5z" /></svg>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <div className="font-medium text-textMain">{plugin.name}</div>
                    <span className="text-[10px] text-textMuted bg-bgMain px-1.5 py-0.5 rounded">v{plugin.version}</span>
                  </div>
                  <div className="text-xs text-textMuted mt-1">{plugin.description}</div>
                  <span className="inline-block mt-2 px-2 py-0.5 bg-violet-500/10 text-violet-400 rounded text-[10px]">{plugin.category}</span>
                </div>
                <div className="flex flex-col gap-1.5">
                  {!plugin.installed ? (
                    <button onClick={() => handleInstall(plugin.id)} className="btn-premium text-[10px]">Install</button>
                  ) : (
                    <button onClick={() => handleToggle(plugin)} className={`px-3 py-1.5 rounded-lg text-[10px] font-medium transition-all ${plugin.enabled ? 'bg-green-500/15 text-green-400' : 'bg-gray-500/15 text-gray-400'}`}>
                      {plugin.enabled ? 'Enabled' : 'Disabled'}
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

