import { useEffect, useState } from 'react';
import { useAutomationStore } from '../../../renderer/stores/automation';
import { useNotificationStore } from '../../../renderer/stores/notifications';
import { AppIcon, type AppIconName } from '../brand/AppIcon';

const SCHEDULE_PRESETS: { type: string; label: string; desc: string; icon: AppIconName }[] = [
  { type: 'manual', label: 'Manual', desc: 'Run on demand', icon: 'automation.manual' },
  { type: 'interval', label: 'Interval', desc: 'Repeat every N minutes/hours', icon: 'home.routines' },
  { type: 'cron', label: 'Cron', desc: 'Precise schedule expression', icon: 'home.routines' },
  { type: 'once', label: 'One-shot', desc: 'Run once at specific time', icon: 'automation.once' },
];

const ACTION_TYPES: { type: string; label: string; desc: string; icon: AppIconName }[] = [
  { type: 'agent_run', label: 'AI Task', desc: 'Send a task to the AI agent', icon: 'home.agents' },
  { type: 'tool_call', label: 'Tool Call', desc: 'Execute a system tool', icon: 'automation.tool' },
  { type: 'notify', label: 'Notification', desc: 'Send a notification', icon: 'automation.notify' },
  { type: 'script', label: 'Script', desc: 'Run a script', icon: 'automation.script' },
];

const QUICK_ACTIONS: { name: string; desc: string; action: string; task: string; schedule: string; icon: AppIconName; color: string }[] = [
  { name: 'Daily Code Review', desc: 'Review all open changes every morning', action: 'agent_run', task: 'Review all recent changes in this project. Check for bugs, security issues, and code quality. Summarize findings.', schedule: '0 9 * * *', icon: 'home.code', color: 'from-blue-500 to-indigo-500' },
  { name: 'System Health', desc: 'Monitor CPU, memory, and disk', action: 'agent_run', task: 'Check system health: CPU usage, memory usage, disk space. Report any concerns.', schedule: '*/30 * * * *', icon: 'automation.pulse', color: 'from-emerald-500 to-teal-500' },
  { name: 'Security Audit', desc: 'Weekly vulnerability scan', action: 'agent_run', task: 'Run a security scan: check npm audit, scan for exposed secrets, review git history for sensitive data. Report all findings.', schedule: '0 8 * * 1', icon: 'home.standing-orders', color: 'from-red-500 to-rose-500' },
  { name: 'Performance', desc: 'Weekly build benchmark', action: 'agent_run', task: 'Run build and test suite. Measure bundle size, test duration, and pass rate. Compare with previous runs.', schedule: '0 6 * * 0', icon: 'home.automation', color: 'from-amber-500 to-orange-500' },
  { name: 'Dependencies', desc: 'Weekly update check', action: 'agent_run', task: 'Run npm outdated and npm audit. Categorize updates as major/minor/patch. Prioritize security fixes.', schedule: '0 9 * * 3', icon: 'automation.link', color: 'from-purple-500 to-violet-500' },
  { name: 'Git Sync', desc: 'Hourly fetch and status', action: 'tool_call', task: 'Run git fetch and check status. Report uncommitted changes, branch status, and any merge conflicts.', schedule: '0 * * * *', icon: 'home.routines', color: 'from-cyan-500 to-sky-500' },
  { name: 'Backup', desc: 'Daily file backup', action: 'tool_call', task: 'Copy important project files to backup location.', schedule: '0 2 * * *', icon: 'memory.document', color: 'from-teal-500 to-cyan-500' },
  { name: 'Cleanup', desc: 'Weekly temp file cleanup', action: 'tool_call', task: 'Remove temporary files and caches older than 7 days.', schedule: '0 3 * * 0', icon: 'automation.trash', color: 'from-slate-500 to-zinc-500' },
  { name: 'Code Quality', desc: 'Weekly lint analysis', action: 'agent_run', task: 'Run eslint and analyze code quality. Report linting errors, warnings, code complexity, and suggest improvements.', schedule: '0 7 * * 2', icon: 'agent.coder', color: 'from-indigo-500 to-blue-500' },
  { name: 'Disk Monitor', desc: 'Daily space check', action: 'agent_run', task: 'Check disk space usage. Alert if any drive is above 85% capacity. List largest files/folders.', schedule: '0 9 * * *', icon: 'agent.analyst', color: 'from-pink-500 to-rose-500' },
  { name: 'Documentation', desc: 'Weekly doc generation', action: 'agent_run', task: 'Scan codebase for undocumented exports. Generate JSDoc comments or markdown docs for public APIs.', schedule: '0 22 * * 5', icon: 'memory.document', color: 'from-violet-500 to-purple-500' },
  { name: 'Morning Brief', desc: 'Daily task summary', action: 'agent_run', task: 'Create a morning briefing: check calendar, review pending tasks, and suggest priorities for today.', schedule: '0 7 * * *', icon: 'automation.sun', color: 'from-yellow-500 to-amber-500' },
];

export function AutomationView() {
  const { workflows, templates, stats, loading, activeRun, lastRun, initRunListener, clearRunResult, loadWorkflows, loadTemplates, loadStats, loadScheduler, schedulerStatus, setKeepAwake, createWorkflow, runWorkflow, enableWorkflow, disableWorkflow, deleteWorkflow } = useAutomationStore();
  const addToast = useNotificationStore((s) => s.addToast);
  const [showCreate, setShowCreate] = useState(false);
  const [showQuickActions, setShowQuickActions] = useState(false);
  const [keepAwakePending, setKeepAwakePending] = useState(false);
  const [newWorkflow, setNewWorkflow] = useState({
    name: '', description: '', triggerType: 'manual', actionType: 'agent_run',
    task: '', cron: '', intervalMinutes: 30, onceTime: '',
  });
  const [now, setNow] = useState(Date.now());

  useEffect(() => { initRunListener(); loadWorkflows(); loadTemplates(); loadStats(); loadScheduler(); }, [initRunListener, loadWorkflows, loadTemplates, loadStats, loadScheduler]);
  useEffect(() => {
    if (!activeRun) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [activeRun]);

  const buildScheduleConfig = () => {
    switch (newWorkflow.triggerType) {
      case 'cron': return { cron: newWorkflow.cron };
      case 'interval': return { intervalMs: newWorkflow.intervalMinutes * 60 * 1000 };
      case 'once': return { onceAt: newWorkflow.onceTime };
      default: return {};
    }
  };

  const handleCreate = async () => {
    if (!newWorkflow.name.trim()) return;
    const taskText = newWorkflow.task || newWorkflow.description || newWorkflow.name;
    const actionConfig: Record<string, Record<string, unknown>> = {
      agent_run: { agent: 'general', task: taskText },
      tool_call: { tool: 'bash', command: taskText },
      notify: { message: taskText },
      script: { script: taskText },
    };
    try {
      await createWorkflow({
        name: newWorkflow.name, description: newWorkflow.description,
        trigger: { type: newWorkflow.triggerType, config: buildScheduleConfig() },
        actions: [{ id: crypto.randomUUID(), type: newWorkflow.actionType, config: actionConfig[newWorkflow.actionType] || {} }],
      });
      setNewWorkflow({ name: '', description: '', triggerType: 'manual', actionType: 'agent_run', task: '', cron: '', intervalMinutes: 30, onceTime: '' });
      setShowCreate(false);
      addToast({ type: 'success', title: 'Workflow created' });
    } catch (error) {
      addToast({ type: 'error', title: 'Could not create workflow', message: error instanceof Error ? error.message : String(error) });
    }
  };

  const handleQuickCreate = async (qa: typeof QUICK_ACTIONS[0]) => {
    try {
      await createWorkflow({
        name: qa.name, description: qa.desc,
        trigger: { type: 'cron', config: { cron: qa.schedule } },
        actions: [{ id: crypto.randomUUID(), type: qa.action, config: qa.action === 'agent_run' ? { agent: 'general', task: qa.task } : { tool: 'bash', command: qa.task } }],
      });
      addToast({ type: 'success', title: `"${qa.name}" created and scheduled` });
    } catch (error) {
      addToast({ type: 'error', title: 'Could not create workflow', message: error instanceof Error ? error.message : String(error) });
    }
  };

  const handleRun = async (id: string) => {
    try {
      const result = await runWorkflow(id);
      await loadStats();
      if (result.status === 'completed') addToast({ type: 'success', title: 'Workflow completed', message: result.result });
      else addToast({ type: 'error', title: 'Workflow failed', message: result.error ?? result.result });
    } catch (error) {
      addToast({ type: 'error', title: 'Workflow failed', message: error instanceof Error ? error.message : String(error) });
    }
  };

  const handleToggle = async (id: string, enabled: boolean) => {
    try {
      await (enabled ? disableWorkflow(id) : enableWorkflow(id));
      await loadStats();
    } catch (error) {
      addToast({ type: 'error', title: 'Could not update workflow', message: error instanceof Error ? error.message : String(error) });
    }
  };

  const handleKeepAwakeToggle = async () => {
    setKeepAwakePending(true);
    try {
      await setKeepAwake(!(schedulerStatus?.keepAwake ?? false));
    } catch (error) {
      addToast({ type: 'error', title: 'Could not update keep-awake', message: error instanceof Error ? error.message : String(error) });
    } finally {
      setKeepAwakePending(false);
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!window.confirm(`Delete "${name}"?`)) return;
    try {
      await deleteWorkflow(id);
      addToast({ type: 'success', title: 'Workflow deleted' });
    } catch (error) {
      addToast({ type: 'error', title: 'Could not delete', message: error instanceof Error ? error.message : String(error) });
    }
  };

  const getScheduleLabel = (wf: { trigger: { type: string; config: unknown } }) => {
    const cfg = wf.trigger.config as Record<string, unknown>;
    switch (wf.trigger.type) {
      case 'cron': return `Cron: ${cfg.cron || '?'}`;
      case 'interval': return `Every ${cfg.intervalMs ? Math.round((cfg.intervalMs as number) / 60000) : '?'}min`;
      case 'once': return `Once: ${cfg.onceAt || '?'}`;
      case 'event': return 'Event-driven';
      case 'file_change': return 'File watch';
      default: return 'Manual';
    }
  };

  return (
    <div className="flex-1 overflow-y-auto p-6 animate-fade-in">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-textMain flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-500 to-orange-500 flex items-center justify-center shadow-lg shadow-amber-500/25">
              <AppIcon name="home.automation" className="w-5 h-5 text-white" strokeWidth={1.9} />
            </div>
            Automations
          </h1>
          <p className="text-textMuted text-sm mt-1">Schedule, automate, and orchestrate tasks.</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => void handleKeepAwakeToggle()}
            disabled={keepAwakePending}
            title="Keep this PC awake while Infinite OS is open, so scheduled automations always fire on time"
            className={`px-4 py-2 rounded-xl text-sm font-medium border transition-all flex items-center gap-2 disabled:opacity-50 ${
              schedulerStatus?.keepAwake
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                : 'bg-white/[0.04] border-white/[0.08] text-textMain hover:bg-white/[0.06]'
            }`}
          >
            <AppIcon name="automation.sun" className="w-4 h-4" strokeWidth={1.9} />
            {schedulerStatus?.keepAwake ? 'Keep awake: on' : 'Keep awake: off'}
          </button>
          <button onClick={() => setShowQuickActions(!showQuickActions)} className="px-4 py-2 bg-white/[0.04] border border-white/[0.08] text-textMain rounded-xl text-sm font-medium hover:bg-white/[0.06] transition-all flex items-center gap-2">
            <AppIcon name="home.automation" className="w-4 h-4 text-amber-400" strokeWidth={1.9} />
            Quick Actions
          </button>
          <button onClick={() => setShowCreate(true)} className="px-4 py-2 bg-gradient-to-r from-amber-500 to-orange-500 text-white rounded-xl text-sm font-medium hover:from-amber-600 hover:to-orange-600 transition-all shadow-lg shadow-amber-500/25 flex items-center gap-2">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>
            New Workflow
          </button>
        </div>
      </div>

      {/* Active run progress */}
      {(activeRun || lastRun) && (() => {
        const run = activeRun ?? lastRun!;
        const running = run.status === 'starting' || run.status === 'running';
        const progress = run.totalActions > 0 ? Math.round((run.completedActions / run.totalActions) * 100) : running ? 5 : 100;
        const elapsedMs = (run.completedAt ?? now) - run.startedAt;
        return (
          <section className={`mb-6 overflow-hidden rounded-xl border ${running ? 'border-indigo-400/30 bg-indigo-500/[0.06]' : run.status === 'completed' ? 'border-emerald-400/30 bg-emerald-500/[0.06]' : 'border-red-400/30 bg-red-500/[0.06]'}`}>
            <div className="flex items-start justify-between gap-4 px-4 py-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  {running && <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-indigo-400 shadow-[0_0_10px_rgba(129,140,248,.8)]" />}
                  <h2 className="truncate text-sm font-semibold text-textMain">{run.workflowName}</h2>
                  <span className={`rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase ${running ? 'bg-indigo-500/15 text-indigo-300' : run.status === 'completed' ? 'bg-emerald-500/15 text-emerald-300' : 'bg-red-500/15 text-red-300'}`}>
                    {run.status === 'starting' ? 'Starting' : run.status}
                  </span>
                </div>
                <p className="mt-1 text-[11px] text-textMuted">
                  {running ? `${run.currentAction ? `Running ${run.currentAction}` : 'Preparing'} · ${run.completedActions}/${run.totalActions}` : run.status === 'completed' ? run.result : run.error}
                </p>
              </div>
              <div className="flex items-center gap-3 text-[10px] text-textMuted">
                <span>{(elapsedMs / 1000).toFixed(1)}s</span>
                {!running && <button onClick={clearRunResult} className="rounded px-2 py-1 hover:bg-white/5">Dismiss</button>}
              </div>
            </div>
            <div className="h-1.5 bg-black/20">
              <div className={`h-full transition-all duration-300 ${run.status === 'failed' ? 'bg-red-400' : run.status === 'completed' ? 'bg-emerald-400' : 'bg-indigo-400'}`} style={{ width: `${progress}%` }} />
            </div>
            <div className="max-h-40 overflow-y-auto border-t border-white/[0.06] px-4 py-2 font-mono text-[10px] custom-scrollbar">
              {run.logs.length === 0 ? (
                <div className="py-2 text-textMuted">Waiting for automation engine...</div>
              ) : run.logs.map((log, idx) => (
                <div key={`${log.timestamp}-${idx}`} className="flex gap-3 py-0.5">
                  <span className="w-16 flex-none text-textMuted/60">{new Date(log.timestamp).toLocaleTimeString()}</span>
                  <span className={log.type === 'action_failed' ? 'text-red-300' : log.type === 'action_completed' ? 'text-emerald-300' : 'text-zinc-300'}>
                    {log.message}{log.result && log.type !== 'run_completed' ? ` — ${log.result}` : ''}
                  </span>
                </div>
              ))}
            </div>
          </section>
        );
      })()}

      {/* Quick Actions panel */}
      {showQuickActions && (
        <div className="mb-6 bg-[#0c1018] border border-amber-500/20 rounded-xl p-4 animate-scale-in">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-textMain">Quick Actions — One-click automations</h3>
            <button onClick={() => setShowQuickActions(false)} className="p-1 rounded-md hover:bg-white/[0.06]">
              <svg className="w-4 h-4 text-textMuted" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          </div>
          <div className="grid grid-cols-4 gap-3">
            {QUICK_ACTIONS.map((qa, i) => (
              <button key={i} onClick={() => handleQuickCreate(qa)} className="text-left bg-white/[0.02] border border-white/[0.06] rounded-xl p-3 hover:border-amber-500/30 hover:bg-amber-500/[0.04] transition-all group">
                <div className="flex items-center gap-2 mb-2">
                  <div className={`w-8 h-8 rounded-lg bg-gradient-to-br ${qa.color} flex items-center justify-center shadow-lg shadow-black/20`}>
                    <AppIcon name={qa.icon} className="w-4 h-4 text-white" strokeWidth={1.9} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-textMain text-xs group-hover:text-amber-300 transition-colors truncate">{qa.name}</div>
                    <div className="text-[10px] text-textMuted truncate">{qa.desc}</div>
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <div className="text-[9px] text-amber-400/70 font-mono">{qa.schedule}</div>
                  <div className="text-[9px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400 opacity-0 group-hover:opacity-100 transition-opacity">+ Add</div>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        {([
          { label: 'Workflows', value: stats?.totalWorkflows ?? workflows.length, icon: 'home.automation' as AppIconName, color: 'text-amber-400' },
          { label: 'Active', value: stats?.enabledWorkflows ?? 0, icon: 'status.working' as AppIconName, color: 'text-emerald-400' },
          { label: 'Total Runs', value: stats?.totalRuns ?? 0, icon: 'action.launch' as AppIconName, color: 'text-purple-400' },
          { label: 'Templates', value: templates.length, icon: 'memory.document' as AppIconName, color: 'text-cyan-400' },
        ]).map((stat, i) => (
          <div key={i} className="bg-[#0c1018] border border-white/[0.06] rounded-xl p-4 animate-slide-up" style={{ animationDelay: `${i * 25}ms` }}>
            <div className="flex items-center gap-2 mb-2">
              <AppIcon name={stat.icon} className={`w-4 h-4 ${stat.color}`} strokeWidth={1.9} />
              <div className="text-xs text-textMuted">{stat.label}</div>
            </div>
            <div className="text-2xl font-bold text-textMain">{stat.value}</div>
          </div>
        ))}
      </div>

      {/* Create Form */}
      {showCreate && (
        <div className="bg-[#0c1018] border border-amber-500/30 rounded-xl p-5 mb-6 shadow-lg shadow-amber-500/10 animate-scale-in">
          <h3 className="text-sm font-semibold text-textMain mb-4">Create Automation</h3>
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div>
              <label className="text-xs text-textMuted mb-1.5 block">Name *</label>
              <input value={newWorkflow.name} onChange={(e) => setNewWorkflow((p) => ({ ...p, name: e.target.value }))} placeholder="e.g. Daily code review" className="w-full bg-bgInput border border-borderSubtle rounded-lg px-3 py-2 text-sm text-textMain placeholder-textMuted focus:outline-none focus:border-amber-500/50" />
            </div>
            <div>
              <label className="text-xs text-textMuted mb-1.5 block">Description</label>
              <input value={newWorkflow.description} onChange={(e) => setNewWorkflow((p) => ({ ...p, description: e.target.value }))} placeholder="What does this do?" className="w-full bg-bgInput border border-borderSubtle rounded-lg px-3 py-2 text-sm text-textMain placeholder-textMuted focus:outline-none focus:border-amber-500/50" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4 mb-4">
            <div>
              <label className="text-xs text-textMuted mb-1.5 block">Action Type</label>
              <div className="grid grid-cols-2 gap-1.5">
                {ACTION_TYPES.map((at) => (
                  <button key={at.type} onClick={() => setNewWorkflow((p) => ({ ...p, actionType: at.type }))}
                    className={`px-2 py-1.5 rounded-lg text-[10px] font-medium transition-all text-left flex items-center gap-1.5 ${
                      newWorkflow.actionType === at.type ? 'bg-amber-500/15 text-amber-400 border border-amber-500/30' : 'bg-bgCard text-textMuted border border-borderSubtle hover:text-textMain'
                    }`}>
                    <AppIcon name={at.icon} className="w-3 h-3 flex-shrink-0" strokeWidth={1.9} />
                    {at.label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="text-xs text-textMuted mb-1.5 block">Schedule</label>
              <div className="grid grid-cols-2 gap-1.5">
                {SCHEDULE_PRESETS.map((sp) => (
                  <button key={sp.type} onClick={() => setNewWorkflow((p) => ({ ...p, triggerType: sp.type }))}
                    className={`px-2 py-1.5 rounded-lg text-[10px] font-medium transition-all text-left flex items-center gap-1.5 ${
                      newWorkflow.triggerType === sp.type ? 'bg-amber-500/15 text-amber-400 border border-amber-500/30' : 'bg-bgCard text-textMuted border border-borderSubtle hover:text-textMain'
                    }`}>
                    <AppIcon name={sp.icon} className="w-3 h-3 flex-shrink-0" strokeWidth={1.9} />
                    {sp.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {newWorkflow.triggerType === 'cron' && (
            <div className="mb-4">
              <label className="text-xs text-textMuted mb-1.5 block">Cron Expression</label>
              <input value={newWorkflow.cron} onChange={(e) => setNewWorkflow((p) => ({ ...p, cron: e.target.value }))} placeholder="0 9 * * * (daily at 9am)" className="w-full bg-bgInput border border-borderSubtle rounded-lg px-3 py-2 text-sm text-textMain placeholder-textMuted font-mono focus:outline-none focus:border-amber-500/50" />
              <div className="text-[10px] text-textMuted mt-1">min hour day month weekday — e.g. &quot;0 9 * * *&quot; = every day at 9am</div>
            </div>
          )}
          {newWorkflow.triggerType === 'interval' && (
            <div className="mb-4">
              <label className="text-xs text-textMuted mb-1.5 block">Repeat every (minutes)</label>
              <input type="number" value={newWorkflow.intervalMinutes} onChange={(e) => setNewWorkflow((p) => ({ ...p, intervalMinutes: Number(e.target.value) }))} min={1} className="w-full bg-bgInput border border-borderSubtle rounded-lg px-3 py-2 text-sm text-textMain focus:outline-none focus:border-amber-500/50" />
            </div>
          )}
          {newWorkflow.triggerType === 'once' && (
            <div className="mb-4">
              <label className="text-xs text-textMuted mb-1.5 block">Run at</label>
              <input type="datetime-local" value={newWorkflow.onceTime} onChange={(e) => setNewWorkflow((p) => ({ ...p, onceTime: e.target.value }))} className="w-full bg-bgInput border border-borderSubtle rounded-lg px-3 py-2 text-sm text-textMain focus:outline-none focus:border-amber-500/50" />
            </div>
          )}

          <div className="mb-4">
            <label className="text-xs text-textMuted mb-1.5 block">Task / Instructions</label>
            <textarea value={newWorkflow.task} onChange={(e) => setNewWorkflow((p) => ({ ...p, task: e.target.value }))} placeholder="What should the agent do? Be specific." className="w-full bg-bgInput border border-borderSubtle rounded-lg px-3 py-2 text-sm text-textMain placeholder-textMuted h-20 resize-none focus:outline-none focus:border-amber-500/50" />
          </div>

          <div className="flex gap-2 justify-end">
            <button onClick={() => setShowCreate(false)} className="px-4 py-2 text-textMuted hover:text-textMain text-sm rounded-lg transition-colors">Cancel</button>
            <button onClick={handleCreate} disabled={!newWorkflow.name.trim()} className="px-5 py-2 bg-gradient-to-r from-amber-500 to-orange-500 text-white rounded-lg text-sm font-medium hover:from-amber-600 hover:to-orange-600 disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-lg shadow-amber-500/20">
              Create Automation
            </button>
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
              <AppIcon name="home.automation" className="w-8 h-8 text-amber-400" strokeWidth={1.6} />
            </div>
            <p className="text-lg font-medium text-textMain">No workflows yet</p>
            <p className="text-sm text-textMuted">Use Quick Actions or create a custom workflow</p>
          </div>
        ) : workflows.map((wf, i) => (
          <div key={wf.id} className="bg-[#0c1018] border border-white/[0.06] rounded-xl p-4 hover:border-amber-500/20 transition-all animate-slide-up" style={{ animationDelay: `${i * 20}ms` }}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${wf.enabled ? 'from-amber-500 to-orange-500' : 'from-gray-500 to-gray-600'} flex items-center justify-center shadow-lg`}>
                  <AppIcon name="home.automation" className="w-5 h-5 text-white" strokeWidth={1.9} />
                </div>
                <div>
                  <div className="font-medium text-textMain text-sm">{wf.name}</div>
                  <div className="text-xs text-textMuted">{wf.description || 'No description'}</div>
                  <div className="flex items-center gap-3 mt-1">
                    <span className="text-[10px] text-amber-400/70 font-mono">{getScheduleLabel(wf)}</span>
                    <span className="text-[10px] text-textMuted">{wf.runs} runs</span>
                    {wf.lastRun && <span className="text-[10px] text-textMuted">Last: {new Date(wf.lastRun).toLocaleString()}</span>}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => handleRun(wf.id)} disabled={Boolean(activeRun)}
                  className="px-3 py-1.5 rounded-lg bg-gradient-to-r from-amber-500 to-orange-500 text-white text-xs font-medium hover:from-amber-600 hover:to-orange-600 transition-all shadow-md shadow-amber-500/20 disabled:opacity-40 disabled:cursor-not-allowed">
                  {activeRun?.workflowId === wf.id ? 'Running...' : 'Run'}
                </button>
                <button onClick={() => handleToggle(wf.id, wf.enabled)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${wf.enabled ? 'bg-green-500/15 text-green-400 hover:bg-green-500/25' : 'bg-gray-500/15 text-gray-400 hover:bg-gray-500/25'}`}>
                  {wf.enabled ? 'On' : 'Off'}
                </button>
                <button onClick={() => handleDelete(wf.id, wf.name)} className="p-1.5 rounded-lg text-textMuted hover:bg-red-500/10 hover:text-red-400">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.7" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0H4.772m3.478 0V4.875A2.625 2.625 0 0110.875 2.25h2.25a2.625 2.625 0 012.625 2.625v.915" /></svg>
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Templates */}
      {templates.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-textMain mb-3">Templates</h2>
          <div className="grid grid-cols-3 gap-3">
            {templates.map((t, i) => (
              <div key={t.id} className="bg-[#0c1018] border border-white/[0.06] rounded-xl p-3 cursor-pointer hover:border-amber-500/30 transition-all animate-slide-up" style={{ animationDelay: `${i * 20 + 50}ms` }}
                onClick={() => { setNewWorkflow((p) => ({ ...p, name: t.name, description: t.description, triggerType: t.trigger.type, actionType: t.actions[0]?.type || 'agent_run' })); setShowCreate(true); }}>
                <div className="font-medium text-textMain text-sm">{t.name}</div>
                <div className="text-xs text-textMuted mt-1">{t.description}</div>
                <div className="flex gap-1.5 mt-2">
                  {t.tags?.slice(0, 2).map((tag) => (
                    <span key={tag} className="px-1.5 py-0.5 bg-amber-500/10 text-amber-400 rounded text-[9px]">{tag}</span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
