import { useEffect, useState } from 'react';
import { useAutomationStore } from '../../../renderer/stores/automation';
import { useNotificationStore } from '../../../renderer/stores/notifications';

export function AutomationView() {
  const { workflows, templates, stats, loading, loadWorkflows, loadTemplates, loadStats, createWorkflow, runWorkflow, enableWorkflow, disableWorkflow } = useAutomationStore();
  const addToast = useNotificationStore((s) => s.addToast);
  const [showCreate, setShowCreate] = useState(false);
  const [newWorkflow, setNewWorkflow] = useState({ name: '', description: '', triggerType: 'manual', actionType: 'chat' });

  useEffect(() => { loadWorkflows(); loadTemplates(); loadStats(); }, [loadWorkflows, loadTemplates, loadStats]);

  const handleCreate = async () => {
    if (!newWorkflow.name.trim()) return;
    await createWorkflow({
      name: newWorkflow.name, description: newWorkflow.description,
      trigger: { type: newWorkflow.triggerType, config: {} },
      actions: [{ type: newWorkflow.actionType, config: {} }],
    });
    setNewWorkflow({ name: '', description: '', triggerType: 'manual', actionType: 'chat' });
    setShowCreate(false);
    addToast({ type: 'success', title: 'Workflow created' });
  };

  const handleRun = async (id: string) => {
    await runWorkflow(id);
    addToast({ type: 'info', title: 'Workflow started' });
  };

  return (
    <div className="flex-1 overflow-y-auto p-6 animate-fade-in">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-textMain flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-500 to-orange-500 flex items-center justify-center shadow-lg">
              <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" /></svg>
            </div>
            Automations
          </h1>
          <p className="text-textMuted text-sm mt-1">Create automated workflows to boost productivity.</p>
        </div>
        <button onClick={() => setShowCreate(true)} className="btn-premium flex items-center gap-2">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>
          New Workflow
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Total Workflows', value: stats?.totalWorkflows ?? workflows.length, color: 'from-amber-500 to-orange-500' },
          { label: 'Enabled', value: stats?.enabledWorkflows ?? 0, color: 'from-green-500 to-emerald-500' },
          { label: 'Total Runs', value: stats?.totalRuns ?? 0, color: 'from-purple-500 to-pink-500' },
          { label: 'Templates', value: templates.length, color: 'from-cyan-500 to-blue-500' },
        ].map((stat, i) => (
          <div key={i} className="card-premium animate-slide-up" style={{ animationDelay: `${i * 25}ms` }}>
            <div className="text-xs text-textMuted mb-1">{stat.label}</div>
            <div className="text-2xl font-bold text-textMain">{stat.value}</div>
          </div>
        ))}
      </div>

      {/* Create Form */}
      {showCreate && (
        <div className="card-premium mb-6 border-indigo-500/30 animate-scale-in">
          <h3 className="text-sm font-semibold text-textMain mb-3">Create Workflow</h3>
          <div className="grid grid-cols-2 gap-3 mb-3">
            <input value={newWorkflow.name} onChange={(e) => setNewWorkflow((p) => ({ ...p, name: e.target.value }))} placeholder="Workflow name" className="input-premium" />
            <input value={newWorkflow.description} onChange={(e) => setNewWorkflow((p) => ({ ...p, description: e.target.value }))} placeholder="Description" className="input-premium" />
            <select value={newWorkflow.triggerType} onChange={(e) => setNewWorkflow((p) => ({ ...p, triggerType: e.target.value }))} className="input-premium">
              <option value="manual">Manual Trigger</option>
              <option value="schedule">Schedule</option>
              <option value="event">Event</option>
            </select>
            <select value={newWorkflow.actionType} onChange={(e) => setNewWorkflow((p) => ({ ...p, actionType: e.target.value }))} className="input-premium">
              <option value="chat">AI Chat</option>
              <option value="code">Code Generation</option>
              <option value="deploy">Deploy</option>
              <option value="notify">Notification</option>
            </select>
          </div>
          <div className="flex gap-2 justify-end">
            <button onClick={() => setShowCreate(false)} className="px-3 py-1.5 text-textMuted hover:text-textMain text-xs">Cancel</button>
            <button onClick={handleCreate} className="btn-premium text-xs">Create Workflow</button>
          </div>
        </div>
      )}

      {/* Workflows */}
      <div className="space-y-3 mb-6">
        <h2 className="text-sm font-semibold text-textMain">Your Workflows</h2>
        {loading ? (
          <div className="text-center py-8"><div className="w-6 h-6 border-2 border-amber-500 border-t-transparent rounded-full animate-spin mx-auto" /></div>
        ) : workflows.length === 0 ? (
          <div className="text-center py-12 text-textMuted">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-amber-500/20 to-orange-500/20 flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-amber-400" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" /></svg>
            </div>
            <p className="text-lg font-medium text-textMain">No workflows yet</p>
            <p className="text-sm text-textMuted">Create your first automation workflow</p>
          </div>
        ) : workflows.map((wf, i) => (
          <div key={wf.id} className="card-premium animate-slide-up" style={{ animationDelay: `${i * 20}ms` }}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${wf.enabled ? 'from-green-500 to-emerald-500' : 'from-gray-500 to-gray-600'} flex items-center justify-center shadow-lg`}>
                  <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" /></svg>
                </div>
                <div>
                  <div className="font-medium text-textMain">{wf.name}</div>
                  <div className="text-xs text-textMuted">{wf.description || 'No description'} &middot; {wf.runs} runs</div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => handleRun(wf.id)} className="px-3 py-1.5 rounded-lg bg-indigo-500/15 text-indigo-400 text-xs font-medium hover:bg-indigo-500/25 transition-all">Run</button>
                <button onClick={() => wf.enabled ? disableWorkflow(wf.id) : enableWorkflow(wf.id)} className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${wf.enabled ? 'bg-green-500/15 text-green-400 hover:bg-green-500/25' : 'bg-gray-500/15 text-gray-400 hover:bg-gray-500/25'}`}>
                  {wf.enabled ? 'Enabled' : 'Disabled'}
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Templates */}
      <div>
        <h2 className="text-sm font-semibold text-textMain mb-3">Templates</h2>
        <div className="grid grid-cols-2 gap-3">
          {templates.map((t, i) => (
            <div key={t.id} className="card-premium cursor-pointer hover:border-amber-500/30 animate-slide-up" style={{ animationDelay: `${i * 20 + 50}ms` }}
              onClick={() => { setNewWorkflow({ name: t.name, description: t.description, triggerType: t.trigger.type, actionType: t.actions[0]?.type || 'chat' }); setShowCreate(true); }}>
              <div className="font-medium text-textMain text-sm">{t.name}</div>
              <div className="text-xs text-textMuted mt-1">{t.description}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
