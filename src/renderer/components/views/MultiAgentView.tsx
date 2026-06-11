import { useEffect, useState } from 'react';
import { useMultiAgentStore } from '../../../renderer/stores/multiAgent';
import { useNotificationStore } from '../../../renderer/stores/notifications';

export function MultiAgentView() {
  const { teams, tasks, stats, loading, loadTeams, loadTasks, loadStats, createTeam, createTask, startTask, completeTask } = useMultiAgentStore();
  const addToast = useNotificationStore((s) => s.addToast);
  const [tab, setTab] = useState<'teams' | 'tasks'>('teams');
  const [showCreate, setShowCreate] = useState(false);
  const [createType, setCreateType] = useState<'team' | 'task'>('team');
  const [formData, setFormData] = useState({ name: '', description: '', assignTo: '' });

  useEffect(() => { loadTeams(); loadTasks(); loadStats(); }, []);

  const handleCreate = async () => {
    if (createType === 'team') { await createTeam({ name: formData.name, description: formData.description }); }
    else { await createTask({ title: formData.name, description: formData.description }); }
    setFormData({ name: '', description: '', assignTo: '' }); setShowCreate(false);
    addToast({ type: 'success', title: `${createType} created` });
  };

  return (
    <div className="flex-1 overflow-y-auto p-6 animate-fade-in">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-textMain flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-rose-500 to-pink-500 flex items-center justify-center shadow-lg">
              <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.969-1.584A6.005 6.005 0 0112 15a15 15 0 014.682 2.72m-.94 3.198l-.001.031m0 0L15.75 18M12 12a3 3 0 100-6 3 3 0 000 6z" /></svg>
            </div>
            Multi-Agent System
          </h1>
          <p className="text-textMuted text-sm mt-1">Coordinate multiple AI agents for complex tasks.</p>
        </div>
        <button onClick={() => { setCreateType(tab === 'teams' ? 'team' : 'task'); setShowCreate(true); }} className="btn-premium flex items-center gap-2">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>
          New {tab === 'teams' ? 'Team' : 'Task'}
        </button>
      </div>

      <div className="grid grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Teams', value: stats?.teams ?? teams.length },
          { label: 'Tasks', value: stats?.tasks ?? tasks.length },
          { label: 'Completed', value: stats?.completedTasks ?? 0 },
          { label: 'Active Agents', value: stats?.activeAgents ?? 0 },
        ].map((stat, i) => (
          <div key={i} className="card-premium animate-slide-up" style={{ animationDelay: `${i * 25}ms` }}>
            <div className="text-xs text-textMuted mb-1">{stat.label}</div>
            <div className="text-2xl font-bold text-textMain">{stat.value}</div>
          </div>
        ))}
      </div>

      <div className="flex gap-1 bg-bgPanel p-1 rounded-xl w-max mb-6 border border-borderSubtle">
        <button onClick={() => setTab('teams')} className={`px-4 py-2 rounded-lg text-xs font-medium transition-all ${tab === 'teams' ? 'bg-bgCard text-textMain border border-white/[0.03] shadow-sm' : 'text-textMuted hover:text-textMain'}`}>Teams ({teams.length})</button>
        <button onClick={() => setTab('tasks')} className={`px-4 py-2 rounded-lg text-xs font-medium transition-all ${tab === 'tasks' ? 'bg-bgCard text-textMain border border-white/[0.03] shadow-sm' : 'text-textMuted hover:text-textMain'}`}>Tasks ({tasks.length})</button>
      </div>

      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setShowCreate(false)}>
          <div className="card-premium w-full max-w-md animate-scale-in" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-sm font-semibold text-textMain mb-3">Create {createType}</h3>
            <div className="space-y-3 mb-4">
              <input value={formData.name} onChange={(e) => setFormData((p) => ({ ...p, name: e.target.value }))} placeholder={createType === 'team' ? 'Team name' : 'Task title'} className="input-premium w-full" />
              <input value={formData.description} onChange={(e) => setFormData((p) => ({ ...p, description: e.target.value }))} placeholder="Description" className="input-premium w-full" />
            </div>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setShowCreate(false)} className="px-3 py-1.5 text-textMuted hover:text-textMain text-xs">Cancel</button>
              <button onClick={handleCreate} className="btn-premium text-xs">Create</button>
            </div>
          </div>
        </div>
      )}

      <div className="space-y-3">
        {tab === 'teams' && (teams.length === 0 ? <div className="text-center py-12 text-textMuted">No teams yet</div> : teams.map((t, i) => (
          <div key={t.id} className="card-premium animate-slide-up" style={{ animationDelay: `${i * 20}ms` }}>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-rose-500 to-pink-500 flex items-center justify-center shadow-lg">
                <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.969-1.584A6.005 6.005 0 0112 15a15 15 0 014.682 2.72m-.94 3.198l-.001.031m0 0L15.75 18M12 12a3 3 0 100-6 3 3 0 000 6z" /></svg>
              </div>
              <div className="flex-1">
                <div className="font-medium text-textMain">{t.name}</div>
                <div className="text-xs text-textMuted">{t.description || 'No description'} · {t.members?.length ?? 0} members</div>
              </div>
            </div>
          </div>
        )))}

        {tab === 'tasks' && (tasks.length === 0 ? <div className="text-center py-12 text-textMuted">No tasks yet</div> : tasks.map((t, i) => (
          <div key={t.id} className="card-premium animate-slide-up" style={{ animationDelay: `${i * 20}ms` }}>
            <div className="flex items-center justify-between">
              <div className="flex-1">
                <div className="font-medium text-textMain">{t.title}</div>
                <div className="text-xs text-textMuted">{t.description || 'No description'}</div>
              </div>
              <div className="flex items-center gap-2">
                <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${t.status === 'completed' ? 'bg-green-500/15 text-green-400' : t.status === 'in_progress' ? 'bg-amber-500/15 text-amber-400' : 'bg-gray-500/15 text-gray-400'}`}>{t.status}</span>
                {t.status === 'pending' && <button onClick={() => { startTask(t.id); addToast({ type: 'info', title: 'Task started' }); }} className="px-3 py-1.5 rounded-lg bg-indigo-500/15 text-indigo-400 text-xs font-medium">Start</button>}
                {t.status === 'in_progress' && <button onClick={() => { completeTask(t.id, 'Completed by agent'); addToast({ type: 'success', title: 'Task completed' }); }} className="px-3 py-1.5 rounded-lg bg-green-500/15 text-green-400 text-xs font-medium">Complete</button>}
              </div>
            </div>
          </div>
        )))}
      </div>
    </div>
  );
}
