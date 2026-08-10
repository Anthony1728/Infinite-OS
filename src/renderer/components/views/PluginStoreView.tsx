import { useEffect, useState } from 'react';
import { usePluginStore } from '../../../renderer/stores/plugin';
import { useNotificationStore } from '../../../renderer/stores/notifications';

export function PluginStoreView() {
  const { plugins, stats, loading, loadPlugins, loadStats, installPlugin, createPlugin, uninstallPlugin, enablePlugin, disablePlugin } = usePluginStore();
  const addToast = useNotificationStore((s) => s.addToast);
  const [search, setSearch] = useState('');
  const [filterCategory, setFilterCategory] = useState('all');
  const [showCreate, setShowCreate] = useState(false);
  const [newPlugin, setNewPlugin] = useState({ name: '', description: '', category: 'other', version: '1.0.0' });

  useEffect(() => { loadPlugins(); loadStats(); }, [loadPlugins, loadStats]);

  const handleInstall = async (id: string) => {
    try { await installPlugin(id); addToast({ type: 'success', title: 'Plugin installed' }); }
    catch { addToast({ type: 'error', title: 'Install failed' }); }
  };

  const handleUninstall = async (id: string) => {
    try { await uninstallPlugin(id); addToast({ type: 'info', title: 'Plugin uninstalled' }); }
    catch { addToast({ type: 'error', title: 'Uninstall failed' }); }
  };

  const handleToggle = async (plugin: typeof plugins[0]) => {
    try {
      if (plugin.enabled) { await disablePlugin(plugin.id); addToast({ type: 'info', title: `${plugin.name} disabled` }); }
      else { await enablePlugin(plugin.id); addToast({ type: 'success', title: `${plugin.name} enabled` }); }
    } catch { addToast({ type: 'error', title: 'Toggle failed' }); }
  };

  const handleCreate = async () => {
    if (!newPlugin.name.trim()) return;
    try {
      await createPlugin(newPlugin);
      setNewPlugin({ name: '', description: '', category: 'other', version: '1.0.0' });
      setShowCreate(false);
      addToast({ type: 'success', title: `Plugin "${newPlugin.name}" created` });
    } catch { addToast({ type: 'error', title: 'Create failed' }); }
  };

  const filtered = plugins.filter((p) => {
    if (search && !p.name.toLowerCase().includes(search.toLowerCase()) && !p.description.toLowerCase().includes(search.toLowerCase())) return false;
    if (filterCategory !== 'all' && p.category !== filterCategory) return false;
    return true;
  });

  const categories = [...new Set(plugins.map((p) => p.category))];

  const categoryColors: Record<string, string> = {
    productivity: 'from-blue-500 to-indigo-500',
    development: 'from-green-500 to-emerald-500',
    communication: 'from-purple-500 to-pink-500',
    analytics: 'from-amber-500 to-orange-500',
    ai: 'from-violet-500 to-fuchsia-500',
    system: 'from-red-500 to-rose-500',
    other: 'from-gray-500 to-gray-600',
  };

  const categoryGlows: Record<string, string> = {
    productivity: 'shadow-blue-500/30',
    development: 'shadow-emerald-500/30',
    communication: 'shadow-pink-500/30',
    analytics: 'shadow-amber-500/30',
    ai: 'shadow-violet-500/30',
    system: 'shadow-red-500/30',
    other: 'shadow-gray-500/30',
  };

  return (
    <div className="flex-1 overflow-y-auto p-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-textMain flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-purple-500 flex items-center justify-center shadow-lg shadow-violet-500/25">
              <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M13.5 16.875h3.375m0 0h3.375m-3.375 0V13.5m0 3.375v3.375M6 10.5h2.25a2.25 2.25 0 002.25-2.25V6a2.25 2.25 0 00-2.25-2.25H6A2.25 2.25 0 003.75 6v2.25A2.25 2.25 0 006 10.5zm0 9.75h2.25A2.25 2.25 0 0010.5 18v-2.25a2.25 2.25 0 00-2.25-2.25H6a2.25 2.25 0 00-2.25 2.25V18A2.25 2.25 0 006 20.25zm9.75-9.75H18a2.25 2.25 0 002.25-2.25V6A2.25 2.25 0 0018 3.75h-2.25A2.25 2.25 0 0013.5 6v2.25a2.25 2.25 0 002.25 2.25z" /></svg>
            </div>
            Plugin Store
          </h1>
          <p className="text-textMuted text-sm mt-1">Create, install, and manage plugins for Infinite OS.</p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="px-4 py-2 bg-gradient-to-r from-violet-500 to-purple-500 text-white rounded-xl text-sm font-medium hover:from-violet-600 hover:to-purple-600 transition-all shadow-lg shadow-violet-500/25 flex items-center gap-2"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15"/></svg>
          Create Plugin
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        {[
          { label: 'Total Plugins', value: stats?.total ?? plugins.length, icon: 'M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z' },
          { label: 'Installed', value: stats?.installed ?? 0, icon: 'M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z' },
          { label: 'Enabled', value: stats?.enabled ?? 0, icon: 'M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z' },
        ].map((stat, i) => (
          <div key={i} className="bg-[#0c1018] border border-white/[0.06] rounded-xl p-4 animate-slide-up" style={{ animationDelay: `${i * 25}ms` }}>
            <div className="flex items-center gap-2 mb-2">
              <svg className="w-4 h-4 text-violet-400" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d={stat.icon} /></svg>
              <div className="text-xs text-textMuted">{stat.label}</div>
            </div>
            <div className="text-2xl font-bold text-textMain">{stat.value}</div>
          </div>
        ))}
      </div>

      {/* Create form */}
      {showCreate && (
        <div className="bg-[#0c1018] border border-violet-500/30 rounded-xl p-5 mb-6 shadow-lg shadow-violet-500/10">
          <h3 className="text-sm font-semibold text-textMain mb-4 flex items-center gap-2">
            <span className="w-6 h-6 rounded-lg bg-gradient-to-br from-violet-500 to-purple-500 flex items-center justify-center">
              <svg className="w-3.5 h-3.5 text-white" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15"/></svg>
            </span>
            Create New Plugin
          </h3>
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div>
              <label className="text-xs text-textMuted mb-1.5 block">Plugin Name *</label>
              <input
                type="text"
                value={newPlugin.name}
                onChange={(e) => setNewPlugin((p) => ({ ...p, name: e.target.value }))}
                className="w-full bg-bgInput border border-borderSubtle rounded-lg px-3 py-2 text-sm text-textMain placeholder-textMuted focus:outline-none focus:border-violet-500/50"
                placeholder="My Awesome Plugin"
              />
            </div>
            <div>
              <label className="text-xs text-textMuted mb-1.5 block">Version</label>
              <input
                type="text"
                value={newPlugin.version}
                onChange={(e) => setNewPlugin((p) => ({ ...p, version: e.target.value }))}
                className="w-full bg-bgInput border border-borderSubtle rounded-lg px-3 py-2 text-sm text-textMain placeholder-textMuted focus:outline-none focus:border-violet-500/50"
                placeholder="1.0.0"
              />
            </div>
          </div>
          <div className="mb-4">
            <label className="text-xs text-textMuted mb-1.5 block">Description</label>
            <textarea
              value={newPlugin.description}
              onChange={(e) => setNewPlugin((p) => ({ ...p, description: e.target.value }))}
              className="w-full bg-bgInput border border-borderSubtle rounded-lg px-3 py-2 text-sm text-textMain placeholder-textMuted h-16 resize-none focus:outline-none focus:border-violet-500/50"
              placeholder="What does this plugin do?"
            />
          </div>
          <div className="mb-4">
            <label className="text-xs text-textMuted mb-1.5 block">Category</label>
            <select
              value={newPlugin.category}
              onChange={(e) => setNewPlugin((p) => ({ ...p, category: e.target.value }))}
              className="w-full bg-bgInput border border-borderSubtle rounded-lg px-3 py-2 text-sm text-textMain focus:outline-none focus:border-violet-500/50"
            >
              <option value="productivity">Productivity</option>
              <option value="development">Development</option>
              <option value="communication">Communication</option>
              <option value="analytics">Analytics</option>
              <option value="ai">AI</option>
              <option value="system">System</option>
              <option value="other">Other</option>
            </select>
          </div>
          <div className="flex gap-2 justify-end">
            <button onClick={() => setShowCreate(false)} className="px-4 py-2 text-textMuted hover:text-textMain text-sm rounded-lg transition-colors">Cancel</button>
            <button
              onClick={handleCreate}
              disabled={!newPlugin.name.trim()}
              className="px-5 py-2 bg-gradient-to-r from-violet-500 to-purple-500 text-white rounded-lg text-sm font-medium hover:from-violet-600 hover:to-purple-600 disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-lg shadow-violet-500/20"
            >
              Create Plugin
            </button>
          </div>
        </div>
      )}

      {/* Search and filters */}
      <div className="flex items-center gap-3 mb-4">
        <div className="flex-1 relative">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-textMuted" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z"/></svg>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search plugins..."
            className="w-full bg-bgInput border border-borderSubtle rounded-lg pl-9 pr-3 py-2 text-sm text-textMain placeholder-textMuted focus:outline-none focus:border-violet-500/50"
          />
        </div>
        <div className="flex gap-1.5">
          <button
            onClick={() => setFilterCategory('all')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              filterCategory === 'all'
                ? 'bg-violet-500/15 text-violet-400 border border-violet-500/30'
                : 'bg-bgCard text-textMuted hover:text-textMain border border-borderSubtle'
            }`}
          >All</button>
          {categories.map((cat) => (
            <button
              key={cat}
              onClick={() => setFilterCategory(cat)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors capitalize ${
                filterCategory === cat
                  ? 'bg-violet-500/15 text-violet-400 border border-violet-500/30'
                  : 'bg-bgCard text-textMuted hover:text-textMain border border-borderSubtle'
              }`}
            >{cat}</button>
          ))}
        </div>
      </div>

      {/* Plugin grid */}
      {loading ? (
        <div className="text-center py-8"><div className="w-6 h-6 border-2 border-violet-500 border-t-transparent rounded-full animate-spin mx-auto" /></div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-textMuted">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-violet-500/20 to-purple-500/20 flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-violet-400" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M13.5 16.875h3.375m0 0h3.375m-3.375 0V13.5m0 3.375v3.375M6 10.5h2.25a2.25 2.25 0 002.25-2.25V6a2.25 2.25 0 00-2.25-2.25H6A2.25 2.25 0 003.75 6v2.25A2.25 2.25 0 006 10.5z" /></svg>
          </div>
          <p className="text-lg font-medium mb-1 text-textMain">No plugins found</p>
          <p className="text-sm">Create a new plugin or try a different search.</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4">
          {filtered.map((plugin, i) => (
            <div key={plugin.id} className="bg-[#0c1018] border border-white/[0.06] rounded-xl p-4 hover:border-violet-500/20 transition-all animate-slide-up" style={{ animationDelay: `${i * 20}ms` }}>
              <div className="flex items-start gap-3">
                <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${categoryColors[plugin.category] || categoryColors.other} flex items-center justify-center shadow-lg ${categoryGlows[plugin.category] || categoryGlows.other} flex-shrink-0`}>
                  <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M13.5 16.875h3.375m0 0h3.375m-3.375 0V13.5m0 3.375v3.375M6 10.5h2.25a2.25 2.25 0 002.25-2.25V6a2.25 2.25 0 00-2.25-2.25H6A2.25 2.25 0 003.75 6v2.25A2.25 2.25 0 006 10.5z" /></svg>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <div className="font-medium text-textMain">{plugin.name}</div>
                    <span className="text-[10px] text-textMuted bg-bgMain px-1.5 py-0.5 rounded">v{plugin.version}</span>
                  </div>
                  <div className="text-xs text-textMuted mt-1">{plugin.description}</div>
                  <span className="inline-block mt-2 px-2 py-0.5 bg-violet-500/10 text-violet-400 rounded text-[10px] capitalize">{plugin.category}</span>
                </div>
                <div className="flex flex-col gap-1.5">
                  {!plugin.installed ? (
                    <button onClick={() => handleInstall(plugin.id)} className="px-3 py-1.5 bg-gradient-to-r from-violet-500 to-purple-500 text-white rounded-lg text-[10px] font-medium hover:from-violet-600 hover:to-purple-600 transition-all shadow-md shadow-violet-500/20">Install</button>
                  ) : (
                    <>
                      <button onClick={() => handleToggle(plugin)} className={`px-3 py-1.5 rounded-lg text-[10px] font-medium transition-all ${plugin.enabled ? 'bg-green-500/15 text-green-400 shadow-md shadow-green-500/20' : 'bg-gray-500/15 text-gray-400'}`}>
                        {plugin.enabled ? 'Enabled' : 'Disabled'}
                      </button>
                      <button onClick={() => handleUninstall(plugin.id)} className="px-3 py-1.5 rounded-lg text-[10px] font-medium bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-all">
                        Uninstall
                      </button>
                    </>
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
