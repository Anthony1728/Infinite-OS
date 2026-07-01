import { useEffect, useState, useRef } from 'react';
import { useMultiAgentStore } from '../../../renderer/stores/multiAgent';
import { useAgentsStore } from '../../../renderer/stores/agents';
import { useNotificationStore } from '../../../renderer/stores/notifications';

type Tab = 'orchestrator' | 'teams' | 'tasks';

function AgentAvatar({ color, icon }: { color?: string; icon?: string }) {
  return (
    <div className={`w-8 h-8 rounded-lg bg-gradient-to-br ${color || 'from-indigo-500 to-violet-600'} flex items-center justify-center shadow-md flex-shrink-0`}>
      <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d={icon || 'M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09z'} />
      </svg>
    </div>
  );
}

export function MultiAgentView() {
  const {
    teams, tasks, stats,
    loadTeams, loadTasks, loadStats,
    createTeam, createTask, startTask, completeTask,
  } = useMultiAgentStore();
  const { types: agentTypes, runs: agentRuns, spawn } = useAgentsStore();
  const addToast = useNotificationStore((s) => s.addToast);

  const [tab, setTab] = useState<Tab>('orchestrator');
  const [showCreate, setShowCreate] = useState(false);
  const [createType, setCreateType] = useState<'team' | 'task'>('team');
  const [formData, setFormData] = useState({ name: '', description: '', assignTo: '' });
  const [orchestratorPrompt, setOrchestratorPrompt] = useState('');
  const [selectedAgents, setSelectedAgents] = useState<string[]>([]);
  const [dispatching, setDispatching] = useState(false);
  const [dispatchLog, setDispatchLog] = useState<{ agentId: string; task: string; status: 'pending' | 'running' | 'done' | 'failed' }[]>([]);
  const promptRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { loadTeams(); loadTasks(); loadStats(); }, []);

  // Refresh stats every 5s
  useEffect(() => {
    const t = setInterval(() => { loadStats(); loadTasks(); }, 5000);
    return () => clearInterval(t);
  }, []);

  const handleCreate = async () => {
    if (!formData.name.trim()) return;
    if (createType === 'team') {
      await createTeam({ name: formData.name, description: formData.description });
    } else {
      await createTask({ title: formData.name, description: formData.description });
    }
    setFormData({ name: '', description: '', assignTo: '' });
    setShowCreate(false);
    addToast({ type: 'success', title: `${createType === 'team' ? 'Team' : 'Task'} created` });
  };

  const handleDispatchOrchestration = async () => {
    if (!orchestratorPrompt.trim() || dispatching) return;
    const agentsToUse = selectedAgents.length > 0 ? selectedAgents : agentTypes.slice(0, 3).map((a) => a.id);
    if (agentsToUse.length === 0) {
      addToast({ type: 'error', title: 'No agents available', message: 'Load agents in the Agent Fleet first.' });
      return;
    }

    setDispatching(true);
    const prompt = orchestratorPrompt.trim();
    setOrchestratorPrompt('');

    // Build subtask log entries
    const logEntries = agentsToUse.map((agentId, i) => ({
      agentId,
      task: `[Subtask ${i + 1}] ${prompt}`,
      status: 'pending' as const,
    }));
    setDispatchLog(logEntries);

    addToast({ type: 'info', title: `Deploying ${agentsToUse.length} agents`, message: 'Starting parallel execution…' });

    // Dispatch each agent in parallel
    const results = await Promise.allSettled(
      agentsToUse.map((agentId, i) =>
        spawn(agentId, `${prompt} [Agent role: ${agentTypes.find((a) => a.id === agentId)?.name ?? agentId}]`).then((run) => {
          setDispatchLog((prev) =>
            prev.map((e, idx) => idx === i ? { ...e, status: run ? 'running' : 'failed' } : e)
          );
          return run;
        })
      )
    );

    const succeeded = results.filter((r) => r.status === 'fulfilled' && r.value).length;
    const failed = results.length - succeeded;

    setDispatchLog((prev) => prev.map((e) => e.status === 'running' ? { ...e, status: 'done' } : e));
    setDispatching(false);

    addToast({
      type: succeeded > 0 ? 'success' : 'error',
      title: `${succeeded} agent${succeeded !== 1 ? 's' : ''} dispatched${failed > 0 ? `, ${failed} failed` : ''}`,
    });
  };

  const handleStartTask = async (id: string, title: string) => {
    // Try to spawn an actual agent for this task
    if (agentTypes.length > 0) {
      const agentId = agentTypes[0].id;
      const run = await spawn(agentId, title);
      if (run) {
        addToast({ type: 'info', title: 'Task started', message: `Assigned to ${agentTypes[0].name}` });
      }
    }
    await startTask(id);
    addToast({ type: 'info', title: 'Task in progress' });
  };

  const toggleAgentSelect = (id: string) => {
    setSelectedAgents((prev) =>
      prev.includes(id) ? prev.filter((a) => a !== id) : [...prev, id]
    );
  };

  const activeRuns = agentRuns.filter((r) => r.status === 'running').length;

  const STAT_CARDS = [
    {
      label: 'Agent Teams',
      value: stats?.teams ?? teams.length,
      icon: 'M18 18.72a9.094 9.094 0 0 0 3.741-.479 3 3 0 0 0-4.682-2.72m.94 3.198.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0 1 12 21c-2.17 0-4.207-.576-5.969-1.584A6.005 6.005 0 0 1 12 15a15 15 0 0 1 4.682 2.72M12 12a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
      color: 'from-rose-500 to-pink-600',
    },
    {
      label: 'Total Tasks',
      value: stats?.tasks ?? tasks.length,
      icon: 'M8.25 6.75h12M8.25 12h12m-12 5.25h12M3.75 6.75h.007v.008H3.75V6.75zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0zM3.75 12h.007v.008H3.75V12zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0zm-.375 5.25h.007v.008H3.75v-.008zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0z',
      color: 'from-amber-500 to-orange-500',
    },
    {
      label: 'Completed',
      value: stats?.completedTasks ?? 0,
      icon: 'M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z',
      color: 'from-emerald-500 to-teal-500',
    },
    {
      label: 'Active Now',
      value: activeRuns,
      icon: 'M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z',
      color: 'from-indigo-500 to-violet-600',
      live: activeRuns > 0,
    },
  ];

  return (
    <div className="flex-1 overflow-y-auto p-6 animate-fade-in custom-scrollbar">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-textMain flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-rose-500 to-pink-600 flex items-center justify-center shadow-lg">
              <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 0 0 3.741-.479 3 3 0 0 0-4.682-2.72m.94 3.198.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0 1 12 21c-2.17 0-4.207-.576-5.969-1.584A6.005 6.005 0 0 1 12 15a15 15 0 0 1 4.682 2.72M12 12a3 3 0 1 0 0-6 3 3 0 0 0 0 6z" />
              </svg>
            </div>
            Multi-Agent System
          </h1>
          <p className="text-textMuted text-sm mt-1">Coordinate multiple AI agents for complex tasks in parallel.</p>
        </div>
        <button
          onClick={() => { setCreateType(tab === 'teams' ? 'team' : 'task'); setShowCreate(true); }}
          className="btn-premium flex items-center gap-2"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          New {tab === 'teams' ? 'Team' : tab === 'tasks' ? 'Task' : 'Mission'}
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {STAT_CARDS.map((stat, i) => (
          <div key={stat.label} className="card-premium animate-slide-up relative overflow-hidden" style={{ animationDelay: `${i * 40}ms` }}>
            <div className="flex items-center justify-between mb-3">
              <div className={`w-9 h-9 rounded-xl bg-gradient-to-br ${stat.color} flex items-center justify-center shadow-md`}>
                <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d={stat.icon} />
                </svg>
              </div>
              {stat.live && (
                <span className="flex items-center gap-1 text-[10px] text-indigo-300">
                  <span className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-live-pulse" />
                  Live
                </span>
              )}
            </div>
            <div className="text-2xl font-bold text-textMain">{stat.value}</div>
            <div className="text-xs text-textMuted mt-0.5">{stat.label}</div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-bgPanel p-1 rounded-xl w-max mb-6 border border-borderSubtle">
        {([
          { id: 'orchestrator', label: 'Orchestrator', icon: 'M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z' },
          { id: 'teams',        label: `Teams (${teams.length})`, icon: 'M18 18.72a9.094 9.094 0 0 0 3.741-.479 3 3 0 0 0-4.682-2.72m.94 3.198.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0 1 12 21c-2.17 0-4.207-.576-5.969-1.584A6.005 6.005 0 0 1 12 15a15 15 0 0 1 4.682 2.72M12 12a3 3 0 1 0 0-6 3 3 0 0 0 0 6z' },
          { id: 'tasks',        label: `Tasks (${tasks.length})`, icon: 'M8.25 6.75h12M8.25 12h12m-12 5.25h12M3.75 6.75h.007v.008H3.75V6.75zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0z' },
        ] as { id: Tab; label: string; icon: string }[]).map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-3 py-2 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-all ${
              tab === t.id ? 'bg-bgCard text-textMain border border-white/[0.04] shadow-sm' : 'text-textMuted hover:text-textMain'
            }`}
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d={t.icon} />
            </svg>
            {t.label}
          </button>
        ))}
      </div>

      {/* ── ORCHESTRATOR TAB ── */}
      {tab === 'orchestrator' && (
        <div className="space-y-5 animate-fade-in">
          {/* Mission Input */}
          <div className="bg-bgPanel border border-borderSubtle rounded-2xl p-5">
            <div className="flex items-start justify-between mb-4">
              <div>
                <h2 className="text-sm font-semibold text-textMain">Deploy Mission</h2>
                <p className="text-xs text-textMuted mt-1">Describe a complex goal and select which agents will work on it in parallel.</p>
              </div>
            </div>

            <textarea
              ref={promptRef}
              value={orchestratorPrompt}
              onChange={(e) => setOrchestratorPrompt(e.target.value)}
              placeholder="Describe the mission… e.g. 'Research competitors, draft a report, and build a summary dashboard'"
              rows={4}
              className="w-full bg-bgInput border border-borderSubtle rounded-xl px-4 py-3 text-sm text-textMain placeholder-textMuted resize-none focus:outline-none focus:border-indigo-500/50 transition-all mb-4"
              style={{ boxShadow: orchestratorPrompt ? '0 0 0 3px rgba(99,102,241,0.08)' : undefined }}
            />

            {/* Agent selection */}
            {agentTypes.length > 0 && (
              <div className="mb-4">
                <div className="text-xs text-textMuted mb-2 font-medium">Select agents to deploy <span className="text-indigo-400">(leave empty to auto-select)</span></div>
                <div className="flex flex-wrap gap-2">
                  {agentTypes.slice(0, 10).map((agent) => (
                    <button
                      key={agent.id}
                      onClick={() => toggleAgentSelect(agent.id)}
                      className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-medium transition-all ${
                        selectedAgents.includes(agent.id)
                          ? 'bg-indigo-500/20 border-indigo-500/50 text-indigo-200'
                          : 'bg-bgCard border-borderSubtle text-textMuted hover:text-textMain hover:border-indigo-500/30'
                      }`}
                    >
                      <div className={`w-4 h-4 rounded bg-gradient-to-br ${agent.color || 'from-indigo-500 to-violet-600'}`} />
                      {agent.name}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="flex items-center gap-3">
              <button
                onClick={handleDispatchOrchestration}
                disabled={!orchestratorPrompt.trim() || dispatching}
                className="btn-premium flex items-center gap-2 disabled:opacity-50"
              >
                {dispatching ? (
                  <>
                    <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    Dispatching agents…
                  </>
                ) : (
                  <>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" />
                    </svg>
                    Deploy {selectedAgents.length > 0 ? selectedAgents.length : agentTypes.slice(0,3).length} Agents
                  </>
                )}
              </button>
              {(selectedAgents.length > 0) && (
                <button onClick={() => setSelectedAgents([])} className="text-xs text-textMuted hover:text-textMain transition-all">
                  Clear selection
                </button>
              )}
            </div>
          </div>

          {/* Dispatch Log */}
          {dispatchLog.length > 0 && (
            <div className="bg-bgPanel border border-borderSubtle rounded-2xl p-5 animate-slide-up">
              <h3 className="text-sm font-semibold text-textMain mb-4 flex items-center gap-2">
                <svg className="w-4 h-4 text-indigo-400" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" />
                </svg>
                Mission Dispatch Log
              </h3>
              <div className="space-y-2">
                {dispatchLog.map((entry, i) => {
                  const agent = agentTypes.find((a) => a.id === entry.agentId);
                  return (
                    <div key={i} className="flex items-center gap-3 p-3 rounded-xl bg-bgCard border border-borderSubtle">
                      <AgentAvatar color={agent?.color} icon={agent?.icon} />
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-medium text-textMain">{agent?.name || entry.agentId}</div>
                        <div className="text-[10px] text-textMuted truncate">{entry.task.slice(0, 80)}</div>
                      </div>
                      <div className={`text-[10px] font-semibold uppercase px-2 py-0.5 rounded-full ${
                        entry.status === 'running' ? 'badge-running' :
                        entry.status === 'done'    ? 'badge-completed' :
                        entry.status === 'failed'  ? 'badge-failed' :
                        'badge-queued'
                      }`}>
                        {entry.status === 'running' ? 'Active' : entry.status}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Live agent runs */}
          {agentRuns.filter((r) => r.status === 'running').length > 0 && (
            <div className="bg-bgPanel border border-borderSubtle rounded-2xl p-5">
              <h3 className="text-sm font-semibold text-textMain mb-4 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-indigo-400 animate-live-pulse" />
                Live Agent Activity
              </h3>
              <div className="space-y-2">
                {agentRuns.filter((r) => r.status === 'running').map((run) => {
                  const agent = agentTypes.find((a) => a.id === run.agentId);
                  return (
                    <div key={run.id} className="flex items-center gap-3 p-3 rounded-xl bg-bgCard border border-indigo-500/20">
                      <AgentAvatar color={agent?.color} icon={agent?.icon} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-xs font-medium text-textMain">{agent?.name || run.agentId}</span>
                          <span className="badge-running">Running</span>
                          {run.toolCallCount > 0 && (
                            <span className="text-[10px] text-textMuted bg-white/5 px-1.5 py-0.5 rounded">{run.toolCallCount} tools</span>
                          )}
                        </div>
                        {run.preview && (
                          <div className="text-[10px] text-textMuted font-mono truncate">{run.preview.slice(-120)}</div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── TEAMS TAB ── */}
      {tab === 'teams' && (
        <div className="space-y-3 animate-fade-in">
          {teams.length === 0 ? (
            <div className="text-center py-16 bg-bgPanel border border-borderSubtle rounded-2xl">
              <svg className="w-10 h-10 mx-auto mb-3 opacity-20 text-textMuted" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 0 0 3.741-.479 3 3 0 0 0-4.682-2.72m.94 3.198.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0 1 12 21c-2.17 0-4.207-.576-5.969-1.584A6.005 6.005 0 0 1 12 15a15 15 0 0 1 4.682 2.72M12 12a3 3 0 1 0 0-6 3 3 0 0 0 0 6z" />
              </svg>
              <p className="text-sm text-textMuted">No teams yet. Create one to group agents.</p>
              <button onClick={() => { setCreateType('team'); setShowCreate(true); }} className="btn-premium mt-4 text-sm">
                Create First Team
              </button>
            </div>
          ) : teams.map((t, i) => (
            <div key={t.id} className="card-premium animate-slide-up" style={{ animationDelay: `${i * 30}ms` }}>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-rose-500 to-pink-600 flex items-center justify-center shadow-lg">
                  <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 0 0 3.741-.479 3 3 0 0 0-4.682-2.72m.94 3.198.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0 1 12 21c-2.17 0-4.207-.576-5.969-1.584A6.005 6.005 0 0 1 12 15a15 15 0 0 1 4.682 2.72M12 12a3 3 0 1 0 0-6 3 3 0 0 0 0 6z" />
                  </svg>
                </div>
                <div className="flex-1">
                  <div className="font-semibold text-textMain">{t.name}</div>
                  <div className="text-xs text-textMuted mt-0.5">{t.description || 'No description'} · {t.members?.length ?? 0} members</div>
                </div>
                <span className="text-[10px] text-textMuted bg-white/5 px-2 py-1 rounded-lg">{new Date(t.createdAt).toLocaleDateString()}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── TASKS TAB ── */}
      {tab === 'tasks' && (
        <div className="space-y-3 animate-fade-in">
          {tasks.length === 0 ? (
            <div className="text-center py-16 bg-bgPanel border border-borderSubtle rounded-2xl">
              <svg className="w-10 h-10 mx-auto mb-3 opacity-20 text-textMuted" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 6.75h12M8.25 12h12m-12 5.25h12" />
              </svg>
              <p className="text-sm text-textMuted">No tasks yet. Use the Orchestrator to deploy missions.</p>
              <button onClick={() => setTab('orchestrator')} className="btn-premium mt-4 text-sm">
                Open Orchestrator
              </button>
            </div>
          ) : tasks.map((t, i) => (
            <div key={t.id} className="card-premium animate-slide-up" style={{ animationDelay: `${i * 30}ms` }}>
              <div className="flex items-center justify-between">
                <div className="flex-1 min-w-0 mr-4">
                  <div className="font-semibold text-textMain truncate">{t.title}</div>
                  <div className="text-xs text-textMuted mt-0.5 truncate">{t.description || 'No description'}</div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span className={`text-[10px] font-semibold uppercase px-2 py-0.5 rounded-full ${
                    t.status === 'completed' ? 'badge-completed' :
                    t.status === 'in_progress' ? 'badge-running' :
                    t.status === 'failed' ? 'badge-failed' :
                    'badge-queued'
                  }`}>{t.status.replace('_', ' ')}</span>
                  {t.status === 'pending' && (
                    <button
                      onClick={() => handleStartTask(t.id, t.title)}
                      className="px-3 py-1.5 rounded-lg bg-indigo-500/15 text-indigo-300 text-xs font-medium hover:bg-indigo-500/25 transition-all border border-indigo-500/20"
                    >
                      Start Task
                    </button>
                  )}
                  {t.status === 'in_progress' && (
                    <button
                      onClick={() => { completeTask(t.id, 'Completed'); addToast({ type: 'success', title: 'Task completed' }); }}
                      className="px-3 py-1.5 rounded-lg bg-green-500/15 text-green-300 text-xs font-medium hover:bg-green-500/25 transition-all border border-green-500/20"
                    >
                      Mark Done
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create Modal */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 animate-fade-in" onClick={() => setShowCreate(false)}>
          <div className="card-premium w-full max-w-md animate-scale-in shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-semibold text-textMain mb-4">Create {createType === 'team' ? 'Agent Team' : 'Task'}</h3>
            <div className="space-y-3 mb-5">
              <input
                value={formData.name}
                onChange={(e) => setFormData((p) => ({ ...p, name: e.target.value }))}
                placeholder={createType === 'team' ? 'Team name (e.g. Research Squad)' : 'Task title'}
                className="input-premium w-full"
                autoFocus
                onKeyDown={(e) => { if (e.key === 'Enter') handleCreate(); if (e.key === 'Escape') setShowCreate(false); }}
              />
              <input
                value={formData.description}
                onChange={(e) => setFormData((p) => ({ ...p, description: e.target.value }))}
                placeholder="Description (optional)"
                className="input-premium w-full"
              />
            </div>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setShowCreate(false)} className="px-4 py-2 text-textMuted hover:text-textMain text-sm transition-all">Cancel</button>
              <button onClick={handleCreate} disabled={!formData.name.trim()} className="btn-premium text-sm disabled:opacity-50">
                Create {createType === 'team' ? 'Team' : 'Task'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

