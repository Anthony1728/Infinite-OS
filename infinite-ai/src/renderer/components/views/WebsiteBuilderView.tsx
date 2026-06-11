import { useEffect, useState } from 'react';
import { useWebsiteStore } from '../../../renderer/stores/website';
import { useNotificationStore } from '../../../renderer/stores/notifications';

export function WebsiteBuilderView() {
  const { websites, templates, stats, loading, loadWebsites, loadTemplates, loadStats, createWebsite, publishWebsite, deployWebsite, deleteWebsite } = useWebsiteStore();
  const addToast = useNotificationStore((s) => s.addToast);
  const [showCreate, setShowCreate] = useState(false);
  const [newSite, setNewSite] = useState({ name: '', template: 'portfolio' });

  useEffect(() => { loadWebsites(); loadTemplates(); loadStats(); }, [loadWebsites, loadTemplates, loadStats]);

  const handleCreate = async () => {
    if (!newSite.name.trim()) return;
    await createWebsite({ name: newSite.name, template: newSite.template });
    setNewSite({ name: '', template: 'portfolio' }); setShowCreate(false);
    addToast({ type: 'success', title: 'Website created' });
  };

  return (
    <div className="flex-1 overflow-y-auto p-6 animate-fade-in">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-textMain flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-pink-500 to-rose-500 flex items-center justify-center shadow-lg">
              <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 017.843 4.582M12 3a8.997 8.997 0 00-7.843 4.582m15.686 0A11.953 11.953 0 0112 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0121 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0112 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 013 12c0-1.605.42-3.113 1.157-4.418" /></svg>
            </div>
            Website Builder
          </h1>
          <p className="text-textMuted text-sm mt-1">Build and deploy websites with AI assistance.</p>
        </div>
        <button onClick={() => setShowCreate(true)} className="btn-premium flex items-center gap-2">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>
          New Website
        </button>
      </div>

      <div className="grid grid-cols-3 gap-4 mb-6">
        {[
          { label: 'Total Websites', value: stats?.totalWebsites ?? websites.length },
          { label: 'Published', value: stats?.published ?? 0 },
          { label: 'Deployed', value: stats?.deployed ?? 0 },
        ].map((stat, i) => (
          <div key={i} className="card-premium animate-slide-up" style={{ animationDelay: `${i * 25}ms` }}>
            <div className="text-xs text-textMuted mb-1">{stat.label}</div>
            <div className="text-2xl font-bold text-textMain">{stat.value}</div>
          </div>
        ))}
      </div>

      {showCreate && (
        <div className="card-premium mb-6 border-pink-500/30 animate-scale-in">
          <h3 className="text-sm font-semibold text-textMain mb-3">Create Website</h3>
          <div className="flex gap-3 mb-3">
            <input value={newSite.name} onChange={(e) => setNewSite((p) => ({ ...p, name: e.target.value }))} placeholder="Website name" className="input-premium flex-1" />
            <select value={newSite.template} onChange={(e) => setNewSite((p) => ({ ...p, template: e.target.value }))} className="input-premium">
              {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
          <div className="flex gap-2 justify-end">
            <button onClick={() => setShowCreate(false)} className="px-3 py-1.5 text-textMuted hover:text-textMain text-xs">Cancel</button>
            <button onClick={handleCreate} className="btn-premium text-xs">Create Website</button>
          </div>
        </div>
      )}

      {/* Templates */}
      <div className="mb-6">
        <h2 className="text-sm font-semibold text-textMain mb-3">Templates</h2>
        <div className="grid grid-cols-3 gap-3">
          {templates.map((t, i) => (
            <div key={t.id} className="card-premium hover:border-pink-500/30 cursor-pointer animate-slide-up" style={{ animationDelay: `${i * 20}ms` }}
              onClick={() => { setNewSite({ name: '', template: t.id }); setShowCreate(true); }}>
              <div className="w-full h-24 rounded-lg bg-gradient-to-br from-pink-500/10 to-rose-500/10 flex items-center justify-center mb-3">
                <svg className="w-8 h-8 text-pink-400" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3" /></svg>
              </div>
              <div className="font-medium text-textMain text-sm">{t.name}</div>
              <div className="text-xs text-textMuted mt-1">{t.description}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Websites */}
      <div className="space-y-3">
        <h2 className="text-sm font-semibold text-textMain">Your Websites</h2>
        {websites.length === 0 ? (
          <div className="text-center py-12 text-textMuted">
            <p className="text-lg font-medium text-textMain">No websites yet</p>
            <p className="text-sm text-textMuted">Create your first website to get started</p>
          </div>
        ) : websites.map((site, i) => (
          <div key={site.id} className="card-premium animate-slide-up" style={{ animationDelay: `${i * 20}ms` }}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-pink-500 to-rose-500 flex items-center justify-center shadow-lg">
                  <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3" /></svg>
                </div>
                <div>
                  <div className="font-medium text-textMain">{site.name}</div>
                  <div className="text-xs text-textMuted">{site.template} &middot; {site.pages?.length ?? 0} pages</div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${site.status === 'deployed' ? 'bg-green-500/15 text-green-400' : site.status === 'published' ? 'bg-blue-500/15 text-blue-400' : 'bg-gray-500/15 text-gray-400'}`}>{site.status}</span>
                <button onClick={() => publishWebsite(site.id)} className="px-3 py-1.5 rounded-lg bg-bgCard border border-borderSubtle text-xs text-textMain hover:border-pink-500/30 transition-all">Publish</button>
                <button onClick={() => deployWebsite(site.id)} className="btn-premium text-xs">Deploy</button>
                <button onClick={() => deleteWebsite(site.id)} className="text-textMuted hover:text-brandRed transition-colors p-1">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" /></svg>
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
