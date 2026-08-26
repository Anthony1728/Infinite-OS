import { useEffect, useState } from 'react';
import { usePluginStore } from '../../../renderer/stores/plugin';
import { useNotificationStore } from '../../../renderer/stores/notifications';

type MarketplaceTab = 'installed' | 'public' | 'personal';

// Plugins the user created in this workspace live in ~/.infinite-ai/plugins;
// everything discovered from the bundled extensions directory is "public".
const PERSONAL_CATEGORIES = new Set(['other', 'custom']);

export function PluginStoreView() {
  const { plugins, stats, loading, loadPlugins, loadStats, installPlugin, createPlugin, uninstallPlugin, enablePlugin, disablePlugin } = usePluginStore();
  const addToast = useNotificationStore((s) => s.addToast);
  const [tab, setTab] = useState<MarketplaceTab>('installed');
  const [search, setSearch] = useState('');
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
      setTab('personal');
      addToast({ type: 'success', title: `Plugin "${newPlugin.name}" created` });
    } catch { addToast({ type: 'error', title: 'Create failed' }); }
  };

  const matchesSearch = (p: typeof plugins[0]) =>
    !search || p.name.toLowerCase().includes(search.toLowerCase()) || p.description.toLowerCase().includes(search.toLowerCase());

  const installed = plugins.filter((p) => p.installed && matchesSearch(p));
  const available = plugins.filter((p) => !p.installed && matchesSearch(p));
  const personal = plugins.filter((p) => PERSONAL_CATEGORIES.has(p.category) && matchesSearch(p));

  const visible = tab === 'installed' ? installed : tab === 'personal' ? personal : available;

  return (
    <div className="flex-1 overflow-y-auto p-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-5">
        <div>
          <h1 className="text-xl font-semibold text-textMain">Plugin Marketplace</h1>
          <p className="text-textMuted text-sm mt-1">Extend Infinite OS with tools, integrations, and commands.</p>
        </div>
        <button
          onClick={() => setShowCreate(!showCreate)}
          className="btn-premium px-3.5 py-2 text-xs flex items-center gap-1.5 flex-shrink-0"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2.2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15"/></svg>
          Create plugin
        </button>
      </div>

      {/* Installed summary strip */}
      {!loading && (
        <div className="flex items-center justify-between bg-bgPanel border border-white/[0.07] rounded-xl px-4 py-3 mb-5">
          <div>
            <div className="text-sm font-medium text-zinc-200">Installed</div>
            <div className="text-[11px] text-textMuted mt-0.5">
              {stats?.enabled ?? 0} active · {stats?.installed ?? 0} installed of {stats?.total ?? plugins.length} discovered
            </div>
          </div>
          <span className="text-[11px] text-zinc-500">Loaded from your extensions folder at startup</span>
        </div>
      )}

      {/* Tabs + search */}
      <div className="flex items-center justify-between gap-4 mb-5">
        <div className="flex items-center gap-1 bg-white/[0.03] border border-white/[0.07] rounded-lg p-0.5">
          {([
            ['installed', `Installed${installed.length ? ` ${installed.length}` : ''}`],
            ['public', 'Public'],
            ['personal', 'Personal'],
          ] as [MarketplaceTab, string][]).map(([id, label]) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                tab === id ? 'bg-white/[0.08] text-white' : 'text-zinc-500 hover:text-zinc-200'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <label className="w-64 h-8 rounded-lg border border-white/[0.07] bg-white/[0.02] flex items-center gap-2 px-2.5 focus-within:border-white/[0.2] transition-colors">
          <svg className="w-3.5 h-3.5 text-zinc-600 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
            <path strokeLinecap="round" d="m20 20-4-4m2-5a7 7 0 1 1-14 0 7 7 0 0 1 14 0Z" />
          </svg>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search marketplace"
            className="min-w-0 flex-1 bg-transparent text-[11px] text-zinc-300 placeholder:text-zinc-700 outline-none"
          />
        </label>
      </div>

      {/* Create form */}
      {showCreate && (
        <div className="bg-bgPanel border border-white/[0.09] rounded-xl p-5 mb-6 shadow-xl animate-scale-in">
          <h3 className="text-sm font-semibold text-textMain mb-4">Create New Plugin</h3>
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div>
              <label className="text-xs text-textMuted mb-1.5 block">Plugin Name *</label>
              <input
                type="text"
                value={newPlugin.name}
                onChange={(e) => setNewPlugin((p) => ({ ...p, name: e.target.value }))}
                className="w-full bg-bgInput border border-borderSubtle rounded-lg px-3 py-2 text-sm text-textMain placeholder-textMuted focus:outline-none focus:border-white/[0.25]"
                placeholder="My Awesome Plugin"
              />
            </div>
            <div>
              <label className="text-xs text-textMuted mb-1.5 block">Version</label>
              <input
                type="text"
                value={newPlugin.version}
                onChange={(e) => setNewPlugin((p) => ({ ...p, version: e.target.value }))}
                className="w-full bg-bgInput border border-borderSubtle rounded-lg px-3 py-2 text-sm text-textMain placeholder-textMuted focus:outline-none focus:border-white/[0.25]"
                placeholder="1.0.0"
              />
            </div>
          </div>
          <div className="mb-4">
            <label className="text-xs text-textMuted mb-1.5 block">Description</label>
            <textarea
              value={newPlugin.description}
              onChange={(e) => setNewPlugin((p) => ({ ...p, description: e.target.value }))}
              className="w-full bg-bgInput border border-borderSubtle rounded-lg px-3 py-2 text-sm text-textMain placeholder-textMuted h-16 resize-none focus:outline-none focus:border-white/[0.25]"
              placeholder="What does this plugin do?"
            />
          </div>
          <div className="mb-4">
            <label className="text-xs text-textMuted mb-1.5 block">Category</label>
            <select
              value={newPlugin.category}
              onChange={(e) => setNewPlugin((p) => ({ ...p, category: e.target.value }))}
              className="w-full bg-bgInput border border-borderSubtle rounded-lg px-3 py-2 text-sm text-textMain focus:outline-none focus:border-white/[0.25]"
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
              className="btn-premium px-5 py-2 text-sm disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Create Plugin
            </button>
          </div>
        </div>
      )}

      {/* Plugin grid */}
      {loading ? (
        <div className="text-center py-10"><div className="w-6 h-6 border-2 border-zinc-500 border-t-transparent rounded-full animate-spin mx-auto" /></div>
      ) : visible.length === 0 ? (
        <div className="text-center py-12 text-textMuted border border-dashed border-white/[0.08] rounded-xl">
          <svg className="w-7 h-7 mx-auto mb-3 text-zinc-600" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M13.5 16.875h3.375m0 0h3.375m-3.375 0V13.5m0 3.375v3.375M6 10.5h2.25a2.25 2.25 0 002.25-2.25V6a2.25 2.25 0 00-2.25-2.25H6A2.25 2.25 0 003.75 6v2.25A2.25 2.25 0 006 10.5zm0 9.75h2.25A2.25 2.25 0 0010.5 18v-2.25a2.25 2.25 0 00-2.25-2.25H6a2.25 2.25 0 00-2.25 2.25V18A2.25 2.25 0 006 20.25zm9.75-9.75H18a2.25 2.25 0 002.25-2.25V6A2.25 2.25 0 0018 3.75h-2.25A2.25 2.25 0 0013.5 6v2.25a2.25 2.25 0 002.25 2.25z" /></svg>
          <p className="text-sm font-medium text-zinc-300 mb-1">
            {tab === 'installed' ? 'Nothing installed yet' : tab === 'personal' ? 'No personal plugins yet' : 'All caught up'}
          </p>
          <p className="text-xs">
            {tab === 'installed'
              ? 'Install a public plugin or create your own.'
              : tab === 'personal'
                ? 'Plugins you create appear here.'
                : 'Every discovered plugin is installed.'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          {visible.map((plugin, i) => (
            <div key={plugin.id} className="group bg-bgPanel border border-white/[0.07] rounded-xl p-4 hover:border-white/[0.14] transition-colors animate-slide-up" style={{ animationDelay: `${i * 20}ms` }}>
              <div className="flex items-start gap-3">
                <div className="os-module-chip w-11 h-11 rounded-[12px] flex items-center justify-center flex-shrink-0">
                  <svg className="os-module-glyph w-5 h-5" fill="none" stroke="currentColor" strokeWidth="1.7" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M13.5 16.875h3.375m0 0h3.375m-3.375 0V13.5m0 3.375v3.375M6 10.5h2.25a2.25 2.25 0 002.25-2.25V6a2.25 2.25 0 00-2.25-2.25H6A2.25 2.25 0 003.75 6v2.25A2.25 2.25 0 006 10.5zm0 9.75h2.25A2.25 2.25 0 0010.5 18v-2.25a2.25 2.25 0 00-2.25-2.25H6a2.25 2.25 0 00-2.25 2.25V18A2.25 2.25 0 006 20.25zm9.75-9.75H18a2.25 2.25 0 002.25-2.25V6A2.25 2.25 0 0018 3.75h-2.25A2.25 2.25 0 0013.5 6v2.25a2.25 2.25 0 002.25 2.25z" /></svg>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <div className="font-medium text-zinc-200 text-sm truncate">{plugin.name}</div>
                    <span className="text-[9px] text-zinc-600 bg-white/[0.04] border border-white/[0.06] px-1.5 py-0.5 rounded font-mono">v{plugin.version}</span>
                  </div>
                  <div className="text-xs text-textMuted mt-1 line-clamp-2">{plugin.description}</div>
                  <span className="inline-block mt-2 px-2 py-0.5 bg-white/[0.04] border border-white/[0.06] text-zinc-500 rounded text-[10px] capitalize">{plugin.category}</span>
                </div>
                <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
                  {!plugin.installed ? (
                    <button onClick={() => handleInstall(plugin.id)} className="btn-premium px-3 py-1.5 text-[11px]">Install</button>
                  ) : (
                    <>
                      <button
                        role="switch"
                        aria-checked={plugin.enabled}
                        onClick={() => handleToggle(plugin)}
                        className={`relative w-9 h-5 rounded-full border transition-colors duration-150 ${
                          plugin.enabled ? 'bg-emerald-500/70 border-emerald-400/30' : 'bg-white/[0.06] border-white/[0.12]'
                        }`}
                        title={plugin.enabled ? 'Disable' : 'Enable'}
                      >
                        <span className={`absolute top-1/2 -translate-y-1/2 w-3.5 h-3.5 rounded-full transition-all duration-150 ${plugin.enabled ? 'left-[18px] bg-white' : 'left-[3px] bg-zinc-500'}`} />
                      </button>
                      <button onClick={() => handleUninstall(plugin.id)} className="text-[10px] text-zinc-600 hover:text-red-400 transition-colors">
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
