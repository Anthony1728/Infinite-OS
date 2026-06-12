import { useEffect, useState } from 'react';
import { useWorkspaceStore } from '../../../renderer/stores/workspace';
import { useNotificationStore } from '../../../renderer/stores/notifications';

export function WorkspaceView() {
  const { workspaces, stats, activity, loadWorkspaces, loadStats, loadActivity, createWorkspace, deleteWorkspace } = useWorkspaceStore();
  const addToast = useNotificationStore((s) => s.addToast);
  const [showCreate, setShowCreate] = useState(false);
  const [formData, setFormData] = useState({ name: '', description: '' });
  const [selectedWorkspace, setSelectedWorkspace] = useState<string | null>(null);

  useEffect(() => { loadWorkspaces(); loadStats(); }, []);

  const handleCreate = async () => {
    if (!formData.name.trim()) return;
    await createWorkspace({ name: formData.name, description: formData.description });
    setFormData({ name: '', description: '' }); setShowCreate(false);
    addToast({ type: 'success', title: 'Workspace created' });
  };

  const handleSelect = async (id: string) => {
    setSelectedWorkspace(id);
    await loadActivity(id);
  };

  return (
    <div className="flex-1 overflow-y-auto p-6 animate-fade-in">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-textMain flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-teal-500 to-cyan-500 flex items-center justify-center shadow-lg">
              <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M3.75 5.25h16.5m-16.5 4.5h16.5m-16.5 4.5h16.5m-16.5 4.5h16.5" /></svg>
            </div>
            Team Workspaces
          </h1>
          <p className="text-textMuted text-sm mt-1">Collaborate with your team in shared workspaces.</p>
        </div>
        <button onClick={() => setShowCreate(true)} className="btn-premium flex items-center gap-2">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>
          New Workspace
        </button>
      </div>

      <div className="grid grid-cols-3 gap-4 mb-6">
        {[
          { label: 'Workspaces', value: stats?.total ?? workspaces.length },
          { label: 'Members', value: stats?.members ?? 0 },
          { label: 'Projects', value: stats?.projects ?? 0 },
        ].map((stat, i) => (
          <div key={i} className="card-premium animate-slide-up" style={{ animationDelay: `${i * 25}ms` }}>
            <div className="text-xs text-textMuted mb-1">{stat.label}</div>
            <div className="text-2xl font-bold text-textMain">{stat.value}</div>
          </div>
        ))}
      </div>

      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setShowCreate(false)}>
          <div className="card-premium w-full max-w-md animate-scale-in" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-sm font-semibold text-textMain mb-3">Create Workspace</h3>
            <div className="space-y-3 mb-4">
              <input value={formData.name} onChange={(e) => setFormData((p) => ({ ...p, name: e.target.value }))} placeholder="Workspace name" className="input-premium w-full" />
              <input value={formData.description} onChange={(e) => setFormData((p) => ({ ...p, description: e.target.value }))} placeholder="Description" className="input-premium w-full" />
            </div>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setShowCreate(false)} className="px-3 py-1.5 text-textMuted hover:text-textMain text-xs">Cancel</button>
              <button onClick={handleCreate} className="btn-premium text-xs">Create</button>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-6">
        {/* Workspaces */}
        <div>
          <h2 className="text-sm font-semibold text-textMain mb-3">Workspaces</h2>
          <div className="space-y-3">
            {workspaces.length === 0 ? <div className="text-center py-12 text-textMuted">No workspaces yet</div> : workspaces.map((w, i) => (
              <div key={w.id} className={`card-premium cursor-pointer animate-slide-up ${selectedWorkspace === w.id ? 'border-teal-500/50' : ''}`}
                style={{ animationDelay: `${i * 20}ms` }} onClick={() => handleSelect(w.id)}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-teal-500 to-cyan-500 flex items-center justify-center shadow-lg">
                      <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M3.75 5.25h16.5m-16.5 4.5h16.5m-16.5 4.5h16.5m-16.5 4.5h16.5" /></svg>
                    </div>
                    <div>
                      <div className="font-medium text-textMain">{w.name}</div>
                      <div className="text-xs text-textMuted">{w.description || 'No description'} · {w.members?.length ?? 0} members</div>
                    </div>
                  </div>
                  <button onClick={(e) => { e.stopPropagation(); deleteWorkspace(w.id); addToast({ type: 'info', title: 'Workspace deleted' }); }} className="text-textMuted hover:text-brandRed transition-colors p-1">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" /></svg>
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Activity */}
        <div>
          <h2 className="text-sm font-semibold text-textMain mb-3">Recent Activity</h2>
          <div className="space-y-2">
            {activity.length === 0 ? <div className="text-center py-12 text-textMuted text-sm">Select a workspace to see activity</div> : activity.map((a, i) => (
              <div key={a.id} className="card-premium animate-slide-up" style={{ animationDelay: `${i * 15}ms` }}>
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-teal-500/20 to-cyan-500/20 flex items-center justify-center">
                    <svg className="w-4 h-4 text-teal-400" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                  </div>
                  <div className="flex-1">
                    <div className="text-xs text-textMain">{a.action}</div>
                    <div className="text-[10px] text-textMuted">{a.user} · {new Date(a.timestamp).toLocaleString()}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
