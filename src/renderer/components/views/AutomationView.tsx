import { useEffect, useState } from 'react';
import { useAutomationStore } from '../../../renderer/stores/automation';
import { useNotificationStore } from '../../../renderer/stores/notifications';
import { useChatStore } from '../../../renderer/stores/chat';

const SCHEDULE_PRESETS = [
  { type: 'manual', label: 'Manual', desc: 'Run on demand', icon: 'M15.042 21.672L13.684 16.6m0 0l-2.51 2.225.569-9.47 5.227 7.917-3.286-.672zM12 2.25V4.5m5.834.166l-1.591 1.591M20.25 10.5H18M7.757 14.743l-1.59 1.59M6 10.5H3.75m4.007-4.243l-1.59-1.59' },
  { type: 'interval', label: 'Interval', desc: 'Repeat every N minutes/hours', icon: 'M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182' },
  { type: 'cron', label: 'Cron', desc: 'Precise schedule expression', icon: 'M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z' },
  { type: 'once', label: 'One-shot', desc: 'Run once at specific time', icon: 'M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5' },
];

const ACTION_TYPES = [
  { type: 'agent_run', label: 'AI Task', desc: 'Send a task to the AI agent', icon: 'M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z' },
  { type: 'tool_call', label: 'Tool Call', desc: 'Execute a system tool', icon: 'M11.42 15.17l-5.1-5.1m0 0L11.42 4.97m-5.1 5.1H21M3 3v18' },
  { type: 'notify', label: 'Notification', desc: 'Send a notification', icon: 'M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0' },
  { type: 'script', label: 'Script', desc: 'Run a script', icon: 'M17.25 6.75L22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3l-4.5 16.5' },
];

const QUICK_ACTIONS = [
  { name: 'Daily Code Review', desc: 'Review all open changes every morning', action: 'agent_run', task: 'Review all recent changes in this project. Check for bugs, security issues, and code quality. Summarize findings.', schedule: '0 9 * * *', icon: 'M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25', color: 'from-blue-500 to-indigo-500' },
  { name: 'System Health', desc: 'Monitor CPU, memory, and disk', action: 'agent_run', task: 'Check system health: CPU usage, memory usage, disk space. Report any concerns.', schedule: '*/30 * * * *', icon: 'M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z', color: 'from-emerald-500 to-teal-500' },
  { name: 'Security Audit', desc: 'Weekly vulnerability scan', action: 'agent_run', task: 'Run a security scan: check npm audit, scan for exposed secrets, review git history for sensitive data. Report all findings.', schedule: '0 8 * * 1', icon: 'M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z', color: 'from-red-500 to-rose-500' },
  { name: 'Performance', desc: 'Weekly build benchmark', action: 'agent_run', task: 'Run build and test suite. Measure bundle size, test duration, and pass rate. Compare with previous runs.', schedule: '0 6 * * 0', icon: 'M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z', color: 'from-amber-500 to-orange-500' },
  { name: 'Dependencies', desc: 'Weekly update check', action: 'agent_run', task: 'Run npm outdated and npm audit. Categorize updates as major/minor/patch. Prioritize security fixes.', schedule: '0 9 * * 3', icon: 'M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m9.86-2.318a4.5 4.5 0 00-6.364 0l-4.5 4.5a4.5 4.5 0 001.242 7.244', color: 'from-purple-500 to-violet-500' },
  { name: 'Git Sync', desc: 'Hourly fetch and status', action: 'tool_call', task: 'Run git fetch and check status. Report uncommitted changes, branch status, and any merge conflicts.', schedule: '0 * * * *', icon: 'M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182', color: 'from-cyan-500 to-sky-500' },
  { name: 'Backup', desc: 'Daily file backup', action: 'tool_call', task: 'Copy important project files to backup location.', schedule: '0 2 * * *', icon: 'M20.25 6.375c0 2.278-3.694 4.125-8.25 4.125S3.75 8.653 3.75 6.375m16.5 0c0-2.278-3.694-4.125-8.25-4.125S3.75 4.097 3.75 6.375m16.5 0v11.25c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125V6.375', color: 'from-teal-500 to-cyan-500' },
  { name: 'Cleanup', desc: 'Weekly temp file cleanup', action: 'tool_call', task: 'Remove temporary files and caches older than 7 days.', schedule: '0 3 * * 0', icon: 'M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0H4.772m3.478 0V4.875A2.625 2.625 0 0110.875 2.25h2.25a2.625 2.625 0 012.625 2.625v.915', color: 'from-slate-500 to-zinc-500' },
  { name: 'Code Quality', desc: 'Weekly lint analysis', action: 'agent_run', task: 'Run eslint and analyze code quality. Report linting errors, warnings, code complexity, and suggest improvements.', schedule: '0 7 * * 2', icon: 'M11.42 15.17l-5.1-5.1m0 0L11.42 4.97m-5.1 5.1H21', color: 'from-indigo-500 to-blue-500' },
  { name: 'Disk Monitor', desc: 'Daily space check', action: 'agent_run', task: 'Check disk space usage. Alert if any drive is above 85% capacity. List largest files/folders.', schedule: '0 9 * * *', icon: 'M20.25 6.375c0 2.278-3.694 4.125-8.25 4.125S3.75 8.653 3.75 6.375m16.5 0c0-2.278-3.694-4.125-8.25-4.125S3.75 4.097 3.75 6.375m16.5 0v11.25c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125V6.375', color: 'from-pink-500 to-rose-500' },
  { name: 'Documentation', desc: 'Weekly doc generation', action: 'agent_run', task: 'Scan codebase for undocumented exports. Generate JSDoc comments or markdown docs for public APIs.', schedule: '0 22 * * 5', icon: 'M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z', color: 'from-violet-500 to-purple-500' },
  { name: 'Morning Brief', desc: 'Daily task summary', action: 'agent_run', task: 'Create a morning briefing: check calendar, review pending tasks, and suggest priorities for today.', schedule: '0 7 * * *', icon: 'M12 3v2.25m6.364.386l-1.591 1.591M21 12h-2.25m-.386 6.364l-1.591-1.591M12 18.75V21m-4.773-4.227l-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0z', color: 'from-yellow-500 to-amber-500' },
];

export function AutomationView() {
  const { workflows, templates, stats, loading, activeRun, lastRun, initRunListener, clearRunResult, loadWorkflows, loadTemplates, loadStats, createWorkflow, runWorkflow, enableWorkflow, disableWorkflow, deleteWorkflow } = useAutomationStore();
  const addToast = useNotificationStore((s) => s.addToast);
  const sendMessage = useChatStore((s) => s.sendMessage);
  const [showCreate, setShowCreate] = useState(false);
  const [showQuickActions, setShowQuickActions] = useState(false);
  const [newWorkflow, setNewWorkflow] = useState({
    name: '', description: '', triggerType: 'manual', actionType: 'agent_run',
    task: '', cron: '', intervalMinutes: 30, onceTime: '',
  });
  const [now, setNow] = useState(Date.now());

  useEffect(() => { initRunListener(); loadWorkflows(); loadTemplates(); loadStats(); }, [initRunListener, loadWorkflows, loadTemplates, loadStats]);
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

  const handleRunAgent = async (task: string) => {
    addToast({ type: 'success', title: 'Sending task to agent...' });
    await sendMessage(task);
  };

  const handleToggle = async (id: string, enabled: boolean) => {
    try {
      await (enabled ? disableWorkflow(id) : enableWorkflow(id));
      await loadStats();
    } catch (error) {
      addToast({ type: 'error', title: 'Could not update workflow', message: error instanceof Error ? error.message : String(error) });
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
              <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" /></svg>
            </div>
            Automations
          </h1>
          <p className="text-textMuted text-sm mt-1">Schedule, automate, and orchestrate tasks.</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setShowQuickActions(!showQuickActions)} className="px-4 py-2 bg-white/[0.04] border border-white/[0.08] text-textMain rounded-xl text-sm font-medium hover:bg-white/[0.06] transition-all flex items-center gap-2">
            <svg className="w-4 h-4 text-amber-400" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" /></svg>
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
                    <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d={qa.icon} /></svg>
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
        {[
          { label: 'Workflows', value: stats?.totalWorkflows ?? workflows.length, icon: 'M3.75 12h16.5m-16.5 3.75h16.5M3.75 19.5h16.5M5.625 4.5h12.75a1.875 1.875 0 010 3.75H5.625a1.875 1.875 0 010-3.75z', color: 'text-amber-400' },
          { label: 'Active', value: stats?.enabledWorkflows ?? 0, icon: 'M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z', color: 'text-emerald-400' },
          { label: 'Total Runs', value: stats?.totalRuns ?? 0, icon: 'M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.348a1.125 1.125 0 010 1.971l-11.54 6.347a1.125 1.125 0 01-1.667-.985V5.653z', color: 'text-purple-400' },
          { label: 'Templates', value: templates.length, icon: 'M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z', color: 'text-cyan-400' },
        ].map((stat, i) => (
          <div key={i} className="bg-[#0c1018] border border-white/[0.06] rounded-xl p-4 animate-slide-up" style={{ animationDelay: `${i * 25}ms` }}>
            <div className="flex items-center gap-2 mb-2">
              <svg className={`w-4 h-4 ${stat.color}`} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d={stat.icon} /></svg>
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
                    <svg className="w-3 h-3 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d={at.icon} /></svg>
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
                    <svg className="w-3 h-3 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d={sp.icon} /></svg>
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
              <div className="text-[10px] text-textMuted mt-1">min hour day month weekday — e.g. "0 9 * * *" = every day at 9am</div>
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
              <svg className="w-8 h-8 text-amber-400" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" /></svg>
            </div>
            <p className="text-lg font-medium text-textMain">No workflows yet</p>
            <p className="text-sm text-textMuted">Use Quick Actions or create a custom workflow</p>
          </div>
        ) : workflows.map((wf, i) => (
          <div key={wf.id} className="bg-[#0c1018] border border-white/[0.06] rounded-xl p-4 hover:border-amber-500/20 transition-all animate-slide-up" style={{ animationDelay: `${i * 20}ms` }}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${wf.enabled ? 'from-amber-500 to-orange-500' : 'from-gray-500 to-gray-600'} flex items-center justify-center shadow-lg`}>
                  <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" /></svg>
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
