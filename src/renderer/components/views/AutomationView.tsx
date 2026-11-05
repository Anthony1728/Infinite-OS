import { useEffect, useState } from 'react';
import type { ProviderInfo } from '../../../shared/types';
import { useAutomationStore } from '../../../renderer/stores/automation';
import { useNotificationStore } from '../../../renderer/stores/notifications';
import { AppIcon, type AppIconName } from '../brand/AppIcon';
import { AutomationReviewCard } from '../automation/AutomationReviewCard';

const ACTION_TYPES: { type: string; label: string; desc: string; icon: AppIconName }[] = [
  { type: 'agent_run', label: 'AI Task', desc: 'Send a task to the AI agent', icon: 'home.agents' },
  { type: 'tool_call', label: 'Tool Call', desc: 'Execute a system tool', icon: 'automation.tool' },
  { type: 'notify', label: 'Notification', desc: 'Send a notification', icon: 'automation.notify' },
  { type: 'script', label: 'Script', desc: 'Run a script', icon: 'automation.script' },
];

interface DraftStep {
  id: string;
  type: string;
  task: string;
  provider: string;
  model: string;
  approvalRequired: boolean;
  afterApproval: string;
  onError: 'stop' | 'continue' | 'retry';
}

/** The model currently picked in Settings, used as each new step's default. */
function activeModelDefaults(): { provider: string; model: string } {
  try {
    const raw = localStorage.getItem('infinite:current');
    if (raw) {
      const current = JSON.parse(raw) as { provider?: string; model?: string };
      return {
        provider: (current.provider === 'local' ? 'ollama' : current.provider) ?? '',
        model: current.model ?? '',
      };
    }
  } catch { /* fall through to an empty explicit choice */ }
  return { provider: '', model: '' };
}

function makeStep(type = 'agent_run'): DraftStep {
  const defaults = activeModelDefaults();
  return {
    id: crypto.randomUUID(),
    type,
    task: '',
    provider: defaults.provider,
    model: defaults.model,
    approvalRequired: false,
    afterApproval: '',
    onError: 'stop',
  };
}

const TRIGGER_TYPES: { type: string; label: string }[] = [
  { type: 'manual', label: 'Manual' },
  { type: 'cron', label: 'Schedule' },
  { type: 'interval', label: 'Interval' },
  { type: 'once', label: 'One-shot' },
  { type: 'idle', label: 'When idle' },
];

// The three first-class recipes, mirroring the product's daily rhythm.
const FEATURED_TEMPLATE_IDS = ['standup_git_summary', 'ci_failures_report', 'documentation_sync_check'];

function describeNextRun(iso?: string): string {
  if (!iso) return '';
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return '';
  const now = new Date();
  const time = at.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const dayDiff = Math.round((new Date(at.getFullYear(), at.getMonth(), at.getDate()).getTime()
    - new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()) / 86_400_000);
  if (dayDiff === 0) return `Next: today ${time}`;
  if (dayDiff === 1) return `Next: tomorrow ${time}`;
  if (dayDiff > 1 && dayDiff < 7) return `Next: ${at.toLocaleDateString([], { weekday: 'long' })} ${time}`;
  return `Next: ${at.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${time}`;
}

export function AutomationView() {
  const { workflows, templates, stats, loading, activeRun, lastRun, schedulerStatus, nextRuns,
    pendingApprovals, initRunListener, clearRunResult, loadWorkflows, loadTemplates, loadStats, loadScheduler,
    loadPendingApprovals, setKeepAwake, createWorkflow, runWorkflow, enableWorkflow, disableWorkflow, deleteWorkflow } = useAutomationStore();
  const addToast = useNotificationStore((s) => s.addToast);
  const [showCreate, setShowCreate] = useState<null | 'schedule' | 'idle'>(null);
  const [keepAwakePending, setKeepAwakePending] = useState(false);
  const [newWorkflow, setNewWorkflow] = useState(() => ({
    name: '', description: '', triggerType: 'manual',
    cron: '', intervalHours: 6, onceTime: '', idleMinutes: 15,
    steps: [makeStep('agent_run')] as DraftStep[],
  }));
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    initRunListener();
    void loadWorkflows();
    void loadTemplates();
    void loadStats();
    void loadScheduler();
    void loadPendingApprovals();
    void window.api.listProviders()
      .then((list: unknown) => setProviders(list as ProviderInfo[]))
      .catch(() => undefined);
  }, [initRunListener, loadWorkflows, loadTemplates, loadStats, loadScheduler, loadPendingApprovals]);

  // Keep "next run" labels honest while the page is open.
  useEffect(() => {
    const timer = window.setInterval(() => {
      setNow(Date.now());
      void loadScheduler();
    }, 60_000);
    return () => window.clearInterval(timer);
  }, [loadScheduler]);

  useEffect(() => {
    if (!activeRun) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [activeRun]);

  const buildTrigger = (kind: 'schedule' | 'idle') => {
    if (kind === 'idle') return { type: 'idle', config: { idleMinutes: Math.max(1, newWorkflow.idleMinutes) } };
    switch (newWorkflow.triggerType) {
      case 'cron': return { type: 'cron', config: { cron: newWorkflow.cron } };
      case 'interval': return { type: 'interval', config: { intervalMs: Math.max(1, newWorkflow.intervalHours) * 3_600_000 } };
      case 'once': return { type: 'once', config: { onceAt: newWorkflow.onceTime ? new Date(newWorkflow.onceTime).toISOString() : '' } };
      default: return { type: 'manual', config: {} };
    }
  };

  const closeCreate = () => {
    setShowCreate(null);
    setNewWorkflow({ name: '', description: '', triggerType: 'manual', cron: '', intervalHours: 6, onceTime: '', idleMinutes: 15, steps: [makeStep('agent_run')] });
  };

  const updateStep = (id: string, patch: Partial<DraftStep>) => {
    setNewWorkflow((previous) => ({
      ...previous,
      steps: previous.steps.map((step) => (step.id === id ? { ...step, ...patch } : step)),
    }));
  };

  const addStep = () => {
    setNewWorkflow((previous) => ({ ...previous, steps: [...previous.steps, makeStep('agent_run')] }));
  };

  const removeStep = (id: string) => {
    setNewWorkflow((previous) => ({
      ...previous,
      steps: previous.steps.length === 1 ? previous.steps : previous.steps.filter((step) => step.id !== id),
    }));
  };

  const stepIsReady = (step: DraftStep) => {
    if (!step.task.trim()) return false;
    if (step.type === 'agent_run' && (!step.provider.trim() || !step.model.trim())) return false;
    return true;
  };

  const handleCreate = async (kind: 'schedule' | 'idle') => {
    if (!newWorkflow.name.trim() || !newWorkflow.steps.every(stepIsReady)) return;
    const actions = newWorkflow.steps.map((step) => {
      const taskText = step.task.trim();
      const config: Record<string, unknown> = step.type === 'agent_run'
        ? {
            agent: 'general',
            task: taskText,
            provider: step.provider.trim(),
            model: step.model.trim(),
            approvalRequired: step.approvalRequired,
            ...(step.afterApproval.trim() ? { afterApproval: step.afterApproval.trim() } : {}),
          }
        : step.type === 'tool_call'
          ? { tool: 'bash', command: taskText }
          : step.type === 'notify'
            ? { message: taskText }
            : { script: taskText };
      return {
        id: crypto.randomUUID(),
        type: step.type,
        config,
        ...(step.approvalRequired ? { approvalRequired: true } : {}),
        onError: step.onError,
      };
    });
    try {
      await createWorkflow({
        name: newWorkflow.name, description: newWorkflow.description,
        trigger: buildTrigger(kind),
        actions,
      });
      closeCreate();
      addToast({ type: 'success', title: kind === 'idle' ? 'Idle task created' : 'Scheduled task created' });
    } catch (error) {
      addToast({ type: 'error', title: 'Could not create workflow', message: error instanceof Error ? error.message : String(error) });
    }
  };

  const handleInstallTemplate = async (templateId: string) => {
    const template = templates.find((t) => t.id === templateId);
    if (!template) return;
    try {
      await createWorkflow({
        name: template.name,
        description: template.description,
        trigger: template.trigger,
        actions: template.actions.map((action) => ({ ...action, id: crypto.randomUUID() })),
      });
      addToast({ type: 'success', title: `"${template.name}" added`, message: 'It will run automatically while Infinite OS is open.' });
    } catch (error) {
      addToast({ type: 'error', title: 'Could not add automation', message: error instanceof Error ? error.message : String(error) });
    }
  };

  const handleToggleKeepAwake = async () => {
    setKeepAwakePending(true);
    try {
      await setKeepAwake(!schedulerStatus?.keepAwake);
    } catch (error) {
      addToast({ type: 'error', title: 'Could not change keep-awake', message: error instanceof Error ? error.message : String(error) });
    } finally {
      setKeepAwakePending(false);
    }
  };

  const handleRun = async (id: string) => {
    try {
      const result = await runWorkflow(id);
      await Promise.all([loadStats(), loadScheduler()]);
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

  const handleDelete = async (id: string, name: string) => {
    if (!window.confirm(`Delete "${name}"?`)) return;
    try {
      await deleteWorkflow(id);
      addToast({ type: 'success', title: 'Automation deleted' });
    } catch (error) {
      addToast({ type: 'error', title: 'Could not delete', message: error instanceof Error ? error.message : String(error) });
    }
  };

  const getScheduleLabel = (wf: { trigger: { type: string; config: unknown } }) => {
    const cfg = wf.trigger.config as Record<string, unknown> ?? {};
    switch (wf.trigger.type) {
      case 'schedule':
      case 'cron': return `Cron · ${cfg.cron || '?'}`;
      case 'interval': return cfg.intervalMs ? `Every ${Math.round((cfg.intervalMs as number) / 60000)} min` : 'Interval';
      case 'once': return `Once · ${cfg.onceAt ? new Date(String(cfg.onceAt)).toLocaleString() : '?'}`;
      case 'idle': return `After ${cfg.idleMinutes ?? 10} min idle`;
      case 'event': return 'Event-driven';
      case 'file_change': return 'File watch';
      default: return 'Manual';
    }
  };

  const schedulable = Boolean(schedulerStatus?.running);
  const featured = FEATURED_TEMPLATE_IDS
    .map((id) => templates.find((t) => t.id === id))
    .filter((t): t is typeof templates[number] => Boolean(t));
  const otherTemplates = templates.filter((t) => !FEATURED_TEMPLATE_IDS.includes(t.id));

  return (
    <div className="flex-1 overflow-y-auto p-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-5">
        <div>
          <h1 className="text-xl font-semibold text-textMain">Automations</h1>
          <p className="text-textMuted text-sm mt-1">Tasks that run on a schedule, on an interval, or when you step away.</p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            onClick={() => { setNewWorkflow((p) => ({ ...p, triggerType: 'interval' })); setShowCreate('idle'); }}
            disabled={Boolean(activeRun)}
            className="px-3.5 py-2 bg-white/[0.04] border border-white/[0.08] text-zinc-300 rounded-lg text-xs font-medium hover:bg-white/[0.07] transition-colors"
          >
            New idle-time task
          </button>
          <button
            onClick={() => { setNewWorkflow((p) => ({ ...p, triggerType: 'cron' })); setShowCreate('schedule'); }}
            className="btn-premium px-3.5 py-2 text-xs flex items-center gap-1.5"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2.2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>
            New scheduled task
          </button>
        </div>
      </div>

      {/* Review queue — a run parks here until a person clears each gated step. */}
      {pendingApprovals.length > 0 && (
        <section className="mb-6">
          <div className="mb-3 flex items-center gap-2">
            <span className="text-[10px] uppercase tracking-[0.18em] text-amber-300/90">Needs you</span>
            <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-amber-500/15 px-1.5 text-[10px] font-medium text-amber-200">
              {pendingApprovals.length}
            </span>
            <span className="text-[10.5px] text-zinc-600">Nothing after these steps runs until you decide.</span>
          </div>
          <div className="grid gap-3 lg:grid-cols-2">
            {pendingApprovals.map((approval) => (
              <AutomationReviewCard key={approval.id} approval={approval} />
            ))}
          </div>
        </section>
      )}

      {/* Status strip: engine + keep awake */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 mb-6 text-[11px] text-textMuted">
        <span className="flex items-center gap-1.5">
          <span className={`w-1.5 h-1.5 rounded-full ${schedulable ? 'bg-emerald-400' : 'bg-zinc-600'}`} />
          Scheduler {schedulable ? `active · checks every ${Math.round((schedulerStatus?.tickMs ?? 30000) / 1000)}s` : 'starting…'}
        </span>
        <span>{stats?.totalWorkflows ?? workflows.length} automations</span>
        <span>{stats?.enabledWorkflows ?? 0} enabled</span>
        <span>{stats?.totalRuns ?? 0} total runs</span>
        <label className="ml-auto flex items-center gap-2.5 cursor-pointer select-none group">
          <span className="flex flex-col leading-tight">
            <span className="text-[11px] font-medium text-zinc-300 group-hover:text-white transition-colors">Keep this computer awake</span>
            <span className="text-[10px] text-zinc-600">Scheduled tasks can&apos;t fire while the display sleeps</span>
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={schedulerStatus?.keepAwake ?? false}
            disabled={keepAwakePending}
            onClick={() => void handleToggleKeepAwake()}
            className={`relative w-9 h-5 rounded-full border transition-colors duration-150 flex-shrink-0 ${
              schedulerStatus?.keepAwake
                ? 'bg-emerald-500/80 border-emerald-400/40'
                : 'bg-white/[0.06] border-white/[0.12]'
            } ${keepAwakePending ? 'opacity-50 cursor-wait' : ''}`}
          >
            <span
              className={`absolute top-1/2 -translate-y-1/2 w-3.5 h-3.5 rounded-full transition-all duration-150 ${
                schedulerStatus?.keepAwake ? 'left-[18px] bg-white' : 'left-[3px] bg-zinc-500'
              }`}
            />
          </button>
        </label>
      </div>

      {/* Active run progress */}
      {(activeRun || lastRun) && (() => {
        const run = activeRun ?? lastRun!;
        const running = run.status === 'starting' || run.status === 'running';
        const progress = run.totalActions > 0 ? Math.round((run.completedActions / run.totalActions) * 100) : running ? 5 : 100;
        const elapsedMs = (run.completedAt ?? now) - run.startedAt;
        return (
          <section className={`mb-6 overflow-hidden rounded-xl border ${running ? 'border-white/[0.12] bg-white/[0.03]' : run.status === 'completed' ? 'border-emerald-400/25 bg-emerald-500/[0.05]' : 'border-red-400/25 bg-red-500/[0.05]'}`}>
            <div className="flex items-start justify-between gap-4 px-4 py-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  {running && <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-400" />}
                  <h2 className="truncate text-sm font-semibold text-textMain">{run.workflowName}</h2>
                  <span className={`rounded-full px-2 py-0.5 text-[9px] font-medium uppercase tracking-wide ${running ? 'bg-white/[0.07] text-zinc-300' : run.status === 'completed' ? 'bg-emerald-500/15 text-emerald-300' : 'bg-red-500/15 text-red-300'}`}>
                    {run.status === 'starting' ? 'Starting' : run.status}
                  </span>
                </div>
                <p className="mt-1 text-[11px] text-textMuted">
                  {running ? `${run.currentAction ? `Running ${run.currentAction}` : 'Preparing'} · ${run.completedActions}/${run.totalActions}` : run.status === 'completed' ? run.result : run.error}
                </p>
              </div>
              <div className="flex items-center gap-3 text-[10px] text-textMuted flex-shrink-0">
                <span>{(elapsedMs / 1000).toFixed(1)}s</span>
                {!running && <button onClick={clearRunResult} className="rounded px-2 py-1 hover:bg-white/5">Dismiss</button>}
              </div>
            </div>
            <div className="h-1 bg-black/30">
              <div className={`h-full transition-all duration-300 ${run.status === 'failed' ? 'bg-red-400' : run.status === 'completed' ? 'bg-emerald-400' : 'bg-zinc-400'}`} style={{ width: `${progress}%` }} />
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

      {/* Create form */}
      {showCreate && (
        <div className="bg-bgPanel border border-white/[0.09] rounded-xl p-5 mb-6 shadow-xl animate-scale-in">
          <h3 className="text-sm font-semibold text-textMain mb-4">
            {showCreate === 'idle' ? 'New idle-time task' : 'New scheduled task'}
          </h3>
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div>
              <label className="text-xs text-textMuted mb-1.5 block">Name *</label>
              <input value={newWorkflow.name} onChange={(e) => setNewWorkflow((p) => ({ ...p, name: e.target.value }))} placeholder="e.g. Daily code review" className="w-full bg-bgInput border border-borderSubtle rounded-lg px-3 py-2 text-sm text-textMain placeholder-textMuted focus:outline-none focus:border-white/[0.25]" />
            </div>
            <div>
              <label className="text-xs text-textMuted mb-1.5 block">Description</label>
              <input value={newWorkflow.description} onChange={(e) => setNewWorkflow((p) => ({ ...p, description: e.target.value }))} placeholder="What does this do?" className="w-full bg-bgInput border border-borderSubtle rounded-lg px-3 py-2 text-sm text-textMain placeholder-textMuted focus:outline-none focus:border-white/[0.25]" />
            </div>
          </div>

          {showCreate === 'schedule' && (
            <div className="mb-4">
              <label className="text-xs text-textMuted mb-1.5 block">Runs</label>
              <div className="grid grid-cols-4 gap-1.5 max-w-md">
                {TRIGGER_TYPES.filter((t) => t.type !== 'idle').map((t) => (
                  <button key={t.type} onClick={() => setNewWorkflow((p) => ({ ...p, triggerType: t.type }))}
                    className={`px-2 py-1.5 rounded-lg text-[11px] font-medium transition-colors ${
                      newWorkflow.triggerType === t.type ? 'bg-white/[0.09] text-white border border-white/[0.16]' : 'bg-white/[0.03] text-textMuted border border-borderSubtle hover:text-textMain'
                    }`}>
                    {t.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {showCreate === 'schedule' && newWorkflow.triggerType === 'cron' && (
            <div className="mb-4">
              <label className="text-xs text-textMuted mb-1.5 block">Cron Expression</label>
              <input value={newWorkflow.cron} onChange={(e) => setNewWorkflow((p) => ({ ...p, cron: e.target.value }))} placeholder="30 8 * * 1-5 (weekdays at 8:30am)" className="w-full bg-bgInput border border-borderSubtle rounded-lg px-3 py-2 text-sm text-textMain placeholder-textMuted font-mono focus:outline-none focus:border-white/[0.25]" />
              <div className="text-[10px] text-textMuted mt-1">minute hour day month weekday — e.g. &quot;0 9 * * *&quot; = every day at 9am</div>
            </div>
          )}
          {showCreate === 'schedule' && newWorkflow.triggerType === 'interval' && (
            <div className="mb-4">
              <label className="text-xs text-textMuted mb-1.5 block">Repeat every (hours)</label>
              <input type="number" value={newWorkflow.intervalHours} onChange={(e) => setNewWorkflow((p) => ({ ...p, intervalHours: Number(e.target.value) }))} min={1} className="w-40 bg-bgInput border border-borderSubtle rounded-lg px-3 py-2 text-sm text-textMain focus:outline-none focus:border-white/[0.25]" />
            </div>
          )}
          {showCreate === 'schedule' && newWorkflow.triggerType === 'once' && (
            <div className="mb-4">
              <label className="text-xs text-textMuted mb-1.5 block">Run at</label>
              <input type="datetime-local" value={newWorkflow.onceTime} onChange={(e) => setNewWorkflow((p) => ({ ...p, onceTime: e.target.value }))} className="w-64 bg-bgInput border border-borderSubtle rounded-lg px-3 py-2 text-sm text-textMain focus:outline-none focus:border-white/[0.25]" />
            </div>
          )}
          {showCreate === 'idle' && (
            <div className="mb-4">
              <label className="text-xs text-textMuted mb-1.5 block">Run after being idle for (minutes)</label>
              <input type="number" value={newWorkflow.idleMinutes} onChange={(e) => setNewWorkflow((p) => ({ ...p, idleMinutes: Number(e.target.value) }))} min={1} className="w-40 bg-bgInput border border-borderSubtle rounded-lg px-3 py-2 text-sm text-textMain focus:outline-none focus:border-white/[0.25]" />
              <div className="text-[10px] text-textMuted mt-1">Fires once per idle period — it re-arms when you come back.</div>
            </div>
          )}

          <div className="mb-5">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <label className="text-xs text-textMuted">Steps</label>
              <span className="text-[10px] text-zinc-600">They run in order. Each AI step keeps its own model and approval gate.</span>
            </div>
            <div className="space-y-3">
              {newWorkflow.steps.map((step, index) => {
                const providerInfo = providers.find((provider) => provider.id === step.provider);
                const modelOptions = providerInfo?.freeModels?.map((model) => model.id) ?? [];
                const ready = stepIsReady(step);
                return (
                  <div key={step.id} className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-3">
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-zinc-500">Step {index + 1}</span>
                      <button
                        type="button"
                        onClick={() => removeStep(step.id)}
                        disabled={newWorkflow.steps.length === 1}
                        className="text-[10.5px] text-zinc-500 transition-colors hover:text-rose-300 disabled:cursor-not-allowed disabled:opacity-30"
                      >
                        Remove
                      </button>
                    </div>

                    <div className="mt-2 grid grid-cols-4 gap-1.5">
                      {ACTION_TYPES.map((at) => (
                        <button
                          key={at.type}
                          type="button"
                          onClick={() => updateStep(step.id, { type: at.type })}
                          className={`flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-left text-[11px] font-medium transition-colors ${
                            step.type === at.type ? 'bg-white/[0.09] text-white border border-white/[0.16]' : 'bg-white/[0.03] text-textMuted border border-borderSubtle hover:text-textMain'
                          }`}
                        >
                          <AppIcon name={at.icon} className="h-3 w-3 flex-shrink-0" strokeWidth={1.9} />
                          {at.label}
                        </button>
                      ))}
                    </div>

                    <textarea
                      value={step.task}
                      onChange={(event) => updateStep(step.id, { task: event.target.value })}
                      placeholder={step.type === 'agent_run' ? 'What should this step do? Be specific.' : step.type === 'notify' ? 'Message to send — use {{previous}} for the last step result.' : 'Command or script to run.'}
                      className="mt-2 h-20 w-full resize-none rounded-lg border border-borderSubtle bg-bgInput px-3 py-2 text-sm text-textMain placeholder-textMuted focus:border-white/[0.25] focus:outline-none"
                    />

                    {step.type === 'agent_run' && (
                      <>
                        <div className="mt-2 grid gap-2 sm:grid-cols-2">
                          <label className="block">
                            <span className="mb-1 block text-[10.5px] text-textMuted">Account / provider</span>
                            <select
                              value={step.provider}
                              onChange={(event) => updateStep(step.id, { provider: event.target.value, model: '' })}
                              className="w-full rounded-lg border border-borderSubtle bg-bgInput px-2.5 py-1.5 text-[12px] text-textMain focus:border-white/[0.25] focus:outline-none"
                            >
                              <option value="">Pick an account…</option>
                              {providers.map((provider) => (
                                <option key={provider.id} value={provider.id}>{provider.label} ({provider.id})</option>
                              ))}
                            </select>
                          </label>
                          <label className="block">
                            <span className="mb-1 block text-[10.5px] text-textMuted">Model</span>
                            <input
                              value={step.model}
                              onChange={(event) => updateStep(step.id, { model: event.target.value })}
                              list={`automation-models-${step.id}`}
                              placeholder="Exact model id"
                              className="w-full rounded-lg border border-borderSubtle bg-bgInput px-2.5 py-1.5 font-mono text-[12px] text-textMain placeholder-textMuted focus:border-white/[0.25] focus:outline-none"
                            />
                            <datalist id={`automation-models-${step.id}`}>
                              {modelOptions.map((model) => <option key={model} value={model} />)}
                            </datalist>
                          </label>
                        </div>
                        {(!step.provider.trim() || !step.model.trim()) && (
                          <p className="mt-1 text-[10px] text-amber-300/80">Pick an account and model — scheduled runs never fall back silently.</p>
                        )}

                        <label className="mt-2 flex cursor-pointer items-start gap-2 rounded-lg border border-white/[0.06] bg-black/20 px-2.5 py-2">
                          <input
                            type="checkbox"
                            checked={step.approvalRequired}
                            onChange={(event) => updateStep(step.id, { approvalRequired: event.target.checked })}
                            className="mt-0.5 h-3.5 w-3.5 accent-violet-500"
                          />
                          <span>
                            <span className="block text-[11px] font-medium text-zinc-300">Review on Home before this step runs</span>
                            <span className="block text-[10px] leading-4 text-zinc-600">The run parks with a draft. Nothing after it runs until you approve, comment, or reject.</span>
                          </span>
                        </label>

                        {step.approvalRequired && (
                          <label className="mt-2 block">
                            <span className="mb-1 block text-[10.5px] text-textMuted">Then (shown on the review card)</span>
                            <input
                              value={step.afterApproval}
                              onChange={(event) => updateStep(step.id, { afterApproval: event.target.value })}
                              placeholder="e.g. Send the brief and update the Home card"
                              className="w-full rounded-lg border border-borderSubtle bg-bgInput px-2.5 py-1.5 text-[12px] text-textMain placeholder-textMuted focus:border-white/[0.25] focus:outline-none"
                            />
                          </label>
                        )}
                      </>
                    )}

                    <div className="mt-2 flex items-center gap-2">
                      <label className="text-[10.5px] text-textMuted">If this step fails</label>
                      <select
                        value={step.onError}
                        onChange={(event) => updateStep(step.id, { onError: event.target.value as DraftStep['onError'] })}
                        className="rounded-lg border border-borderSubtle bg-bgInput px-2 py-1 text-[11px] text-textMain focus:border-white/[0.25] focus:outline-none"
                      >
                        <option value="stop">Stop the run</option>
                        <option value="continue">Continue to the next step</option>
                        <option value="retry">Retry up to 3 times</option>
                      </select>
                      {!ready && <span className="ml-auto text-[10px] text-zinc-600">Needs a task{step.type === 'agent_run' ? ', account, and model' : ''}</span>}
                    </div>
                  </div>
                );
              })}
            </div>
            <button
              type="button"
              onClick={addStep}
              className="mt-2 rounded-lg border border-dashed border-white/[0.12] px-3 py-1.5 text-[11px] text-zinc-400 transition-colors hover:border-white/[0.22] hover:text-white"
            >
              + Add step
            </button>
          </div>

          <div className="flex gap-2 justify-end">
            <button onClick={closeCreate} className="px-4 py-2 text-textMuted hover:text-textMain text-sm rounded-lg transition-colors">Cancel</button>
            <button
              onClick={() => void handleCreate(showCreate)}
              disabled={!newWorkflow.name.trim() || !newWorkflow.steps.every(stepIsReady)}
              className="btn-premium px-5 py-2 text-sm disabled:opacity-40 disabled:cursor-not-allowed"
              title={newWorkflow.steps.every(stepIsReady) ? undefined : 'Every step needs a task; AI steps also need an account and model.'}
            >
              {showCreate === 'idle' ? 'Create Idle Task' : 'Create Automation'}
            </button>
          </div>
        </div>
      )}

      {/* Featured templates */}
      {featured.length > 0 && (
        <section className="mb-6">
          <h2 className="text-sm font-semibold text-textMain mb-3">Ready-made routines</h2>
          <div className="grid grid-cols-3 gap-3">
            {featured.map((t) => {
              const installed = workflows.some((wf) => wf.name === t.name);
              return (
                <div key={t.id} className="bg-bgPanel border border-white/[0.07] rounded-xl p-4 hover:border-white/[0.14] transition-colors animate-slide-up">
                  <div className="font-medium text-textMain text-sm">{t.name}</div>
                  <div className="text-xs text-textMuted mt-1 leading-relaxed">{t.description}</div>
                  <button
                    onClick={() => void handleInstallTemplate(t.id)}
                    disabled={installed}
                    className={`mt-3 w-full h-8 rounded-lg text-xs font-medium transition-colors ${
                      installed
                        ? 'bg-white/[0.04] text-zinc-600 border border-white/[0.06] cursor-default'
                        : 'btn-premium'
                    }`}
                  >
                    {installed ? 'Added ✓' : 'Add'}
                  </button>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Workflows */}
      <section className="mb-6">
        <h2 className="text-sm font-semibold text-textMain mb-3">Your automations</h2>
        {loading ? (
          <div className="text-center py-8"><div className="w-6 h-6 border-2 border-zinc-500 border-t-transparent rounded-full animate-spin mx-auto" /></div>
        ) : workflows.length === 0 ? (
          <div className="text-center py-12 text-textMuted border border-dashed border-white/[0.08] rounded-xl">
            <AppIcon name="home.automation" className="w-7 h-7 text-zinc-600 mx-auto mb-3" strokeWidth={1.6} />
            <p className="text-sm font-medium text-zinc-300">No automations yet</p>
            <p className="text-xs mt-1">Add a ready-made routine above or create your own.</p>
          </div>
        ) : workflows.map((wf) => {
          const isRunningThis = activeRun?.workflowId === wf.id;
          const nextLabel = wf.enabled ? describeNextRun(nextRuns[wf.id]) : '';
          return (
            <div key={wf.id} className="group bg-bgPanel border border-white/[0.07] rounded-xl px-4 py-3 mb-2 hover:border-white/[0.13] transition-colors animate-slide-up">
              <div className="flex items-center justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${wf.enabled ? 'bg-emerald-400' : 'bg-zinc-700'}`} />
                    <div className="font-medium text-zinc-200 text-sm truncate">{wf.name}</div>
                    {!wf.enabled && <span className="text-[9px] uppercase tracking-wide text-zinc-600">paused</span>}
                  </div>
                  <div className="flex items-center gap-3 mt-1 pl-3.5 text-[11px] text-textMuted">
                    <span>{getScheduleLabel(wf)}</span>
                    {nextLabel && <span className="text-zinc-500">{nextLabel}</span>}
                    <span>{(wf.runs ?? 0)} run{(wf.runs ?? 0) !== 1 ? 's' : ''}</span>
                    {wf.lastRun && <span>Last: {new Date(wf.lastRun).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>}
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button
                    onClick={() => void handleRun(wf.id)}
                    disabled={Boolean(activeRun)}
                    className="px-3 py-1.5 rounded-lg bg-white/[0.07] border border-white/[0.1] text-zinc-200 text-xs font-medium hover:bg-white/[0.12] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {isRunningThis ? 'Running…' : 'Run'}
                  </button>
                  <button
                    role="switch"
                    aria-checked={wf.enabled}
                    title={wf.enabled ? 'Pause' : 'Resume'}
                    onClick={() => void handleToggle(wf.id, wf.enabled)}
                    className={`relative w-9 h-5 rounded-full border transition-colors duration-150 ${
                      wf.enabled ? 'bg-emerald-500/70 border-emerald-400/30' : 'bg-white/[0.06] border-white/[0.12]'
                    }`}
                  >
                    <span className={`absolute top-1/2 -translate-y-1/2 w-3.5 h-3.5 rounded-full transition-all duration-150 ${wf.enabled ? 'left-[18px] bg-white' : 'left-[3px] bg-zinc-500'}`} />
                  </button>
                  <button
                    onClick={() => void handleDelete(wf.id, wf.name)}
                    className="icon-button w-7 h-7 opacity-0 group-hover:opacity-100"
                    title="Delete automation"
                    aria-label={`Delete ${wf.name}`}
                  >
                    <svg className="w-3.5 h-3.5 mx-auto" fill="none" stroke="currentColor" strokeWidth="1.7" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0H4.772m3.478 0V4.875A2.625 2.625 0 0110.875 2.25h2.25a2.625 2.625 0 012.625 2.625v.915" /></svg>
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </section>

      {/* Other templates */}
      {otherTemplates.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-textMain mb-3">More templates</h2>
          <div className="grid grid-cols-3 gap-3">
            {otherTemplates.map((t) => (
              <div key={t.id} className="bg-bgPanel border border-white/[0.07] rounded-xl p-3 hover:border-white/[0.13] transition-colors animate-slide-up">
                <div className="font-medium text-zinc-200 text-xs">{t.name}</div>
                <div className="text-[11px] text-textMuted mt-1 leading-relaxed line-clamp-2">{t.description}</div>
                <button
                  onClick={() => void handleInstallTemplate(t.id)}
                  disabled={workflows.some((wf) => wf.name === t.name)}
                  className="mt-2 text-[10px] text-zinc-400 hover:text-white transition-colors disabled:text-zinc-700 disabled:hover:text-zinc-700"
                >
                  {workflows.some((wf) => wf.name === t.name) ? 'Added ✓' : '+ Add'}
                </button>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
