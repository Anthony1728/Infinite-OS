import { useEffect, useState } from 'react';
import { useAgentsStore } from '../../stores/agents';
import { useNotificationStore } from '../../stores/notifications';
import { CreateAgentModal } from '../agents/CreateAgentModal';

type FilterStatus = 'all' | 'running' | 'completed' | 'failed';

// Icon paths for different agent categories (clean Heroicons — not AI-generated looking)
const CATEGORY_ICONS: Record<string, string> = {
  coder:   'M17.25 6.75 22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3-4.5 16.5',
  researcher: 'M21 21l-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607z',
  browser: 'M12 21a9.004 9.004 0 0 0 8.716-6.747M12 21a9.004 9.004 0 0 1-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3',
  writer:  'M16.862 4.487l1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931zm0 0L19.5 7.125',
  analyst: 'M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 0 1 3 19.875v-6.75zm7.5-9.75C10.5 2.754 11.004 2.25 11.625 2.25h2.25c.621 0 1.125.504 1.125 1.125v16.5c0 .621-.504 1.125-1.125 1.125h-2.25A1.125 1.125 0 0 1 10.5 19.875V3.375zm7.5 6.75c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-2.25A1.125 1.125 0 0 1 18 19.875v-9.75z',
  default: 'M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09z',
};

function getAgentIcon(agent: { id: string; icon?: string }): string {
  if (agent.icon) return agent.icon;
  const id = agent.id.toLowerCase();
  for (const [key, path] of Object.entries(CATEGORY_ICONS)) {
    if (id.includes(key)) return path;
  }
  return CATEGORY_ICONS.default;
}

function StatusBadge({ status }: { status: string }) {
  const cls =
    status === 'running'   ? 'badge-running' :
    status === 'completed' ? 'badge-completed' :
    status === 'failed'    ? 'badge-failed' :
    'badge-queued';
  return <span className={cls}>{status}</span>;
}

export function AgentsView() {
  const { types, runs, init, spawn, abort, refreshRuns } = useAgentsStore();
  const addToast = useNotificationStore((s) => s.addToast);

  const [taskInput, setTaskInput] = useState('');
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [filter, setFilter] = useState<FilterStatus>('all');
  const [expandedRunId, setExpandedRunId] = useState<string | null>(null);
  const [spawning, setSpawning] = useState(false);

  useEffect(() => { init(); }, [init]);

  const handleSpawn = async (agentId: string) => {
    if (!taskInput.trim() || spawning) return;
    setSpawning(true);
    try {
      const run = await spawn(agentId, taskInput.trim());
      if (run) {
        setTaskInput('');
        setSelectedAgent(null);
        setExpandedRunId(run.id);
        setFilter('running');
        addToast({ type: 'success', title: `Agent dispatched`, message: `Running: ${taskInput.slice(0, 60)}` });
      } else {
        addToast({ type: 'error', title: 'Failed to spawn agent', message: 'Session could not be created.' });
      }
    } catch (e: any) {
      addToast({ type: 'error', title: 'Agent error', message: e?.message ?? 'Unknown error' });
    } finally {
      setSpawning(false);
    }
  };

  const handleAbort = async (runId: string) => {
    await abort(runId);
    addToast({ type: 'info', title: 'Agent stopped' });
  };

  const handleCopyResult = (result: string) => {
    navigator.clipboard.writeText(result);
    addToast({ type: 'success', title: 'Result copied to clipboard' });
  };

  const filteredRuns = filter === 'all' ? runs : runs.filter((r) => r.status === filter);
  const activeCount = runs.filter((r) => r.status === 'running').length;

  return (
    <div className="flex-1 overflow-y-auto p-6 animate-fade-in custom-scrollbar">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-textMain flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center shadow-lg">
              <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d={CATEGORY_ICONS.default} />
              </svg>
            </div>
            Agent Fleet
            {activeCount > 0 && (
              <span className="ml-1 flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-indigo-500/15 border border-indigo-500/20 text-indigo-300 text-xs font-medium">
                <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-live-pulse inline-block" />
                {activeCount} running
              </span>
            )}
          </h1>
          <p className="text-textMuted text-sm mt-1">Autonomous subagents ready to execute specialized tasks.</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => refreshRuns()}
            className="w-9 h-9 rounded-xl bg-bgCard border border-borderSubtle hover:border-indigo-500/30 flex items-center justify-center text-textMuted hover:text-textMain transition-all"
            title="Refresh runs"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99" />
            </svg>
          </button>
          <button
            onClick={() => setShowCreateModal(true)}
            className="btn-premium flex items-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            Custom Agent
          </button>
        </div>
      </div>

      {/* Agent Grid */}
      <div className="mb-8">
        <h2 className="text-sm font-semibold mb-4 text-textMuted uppercase tracking-wider">Available Agents</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {types.map((agent) => (
            <div key={agent.id} className="card-premium hover-lift flex flex-col justify-between group">
              <div>
                <div className="flex items-start gap-3 mb-3">
                  <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${agent.color || 'from-indigo-500 to-violet-600'} flex items-center justify-center shadow-lg flex-shrink-0`}>
                    <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d={getAgentIcon(agent)} />
                    </svg>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-textMain truncate">{agent.name}</div>
                    <div className="text-[10px] uppercase font-bold tracking-wider text-indigo-400 bg-indigo-400/10 px-1.5 py-0.5 rounded w-max mt-0.5">
                      {agent.id}
                    </div>
                  </div>
                </div>
                <div className="text-xs text-textMuted mb-4 line-clamp-2 min-h-[32px] leading-relaxed">{agent.description}</div>
              </div>

              <div className="mt-auto">
                {selectedAgent === agent.id ? (
                  <div className="animate-slide-down space-y-2">
                    <input
                      type="text"
                      placeholder="Describe the task for this agent…"
                      className="input-premium w-full text-xs"
                      value={taskInput}
                      onChange={(e) => setTaskInput(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) handleSpawn(agent.id); if (e.key === 'Escape') setSelectedAgent(null); }}
                      autoFocus
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={() => setSelectedAgent(null)}
                        className="flex-none px-3 py-1.5 text-xs text-textMuted hover:text-textMain rounded-lg hover:bg-white/5 transition-all"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={() => handleSpawn(agent.id)}
                        disabled={!taskInput.trim() || spawning}
                        className="btn-premium text-xs flex-1 disabled:opacity-50"
                      >
                        {spawning ? (
                          <span className="flex items-center justify-center gap-2">
                            <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                            </svg>
                            Dispatching…
                          </span>
                        ) : 'Start Task →'}
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => setSelectedAgent(agent.id)}
                    className="w-full px-4 py-2 rounded-xl bg-bgInput border border-borderSubtle text-sm font-medium text-textMain hover:border-indigo-500/40 hover:bg-indigo-500/5 transition-all group-hover:border-indigo-500/20"
                  >
                    Assign Task
                  </button>
                )}
              </div>
            </div>
          ))}

          {types.length === 0 && (
            <div className="col-span-3 text-center py-16 text-textMuted">
              <svg className="w-10 h-10 mx-auto mb-3 opacity-30" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09z" />
              </svg>
              <p className="text-sm">Loading agent fleet…</p>
            </div>
          )}
        </div>
      </div>

      {/* Run History */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-textMuted uppercase tracking-wider">Agent Runs</h2>
          {/* Filter tabs */}
          <div className="flex gap-1 bg-bgPanel border border-borderSubtle rounded-lg p-0.5">
            {(['all', 'running', 'completed', 'failed'] as FilterStatus[]).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-2.5 py-1 rounded-md text-[10px] font-medium capitalize transition-all ${
                  filter === f ? 'bg-bgCard text-textMain shadow-sm' : 'text-textMuted hover:text-textMain'
                }`}
              >
                {f} {f !== 'all' && runs.filter((r) => r.status === f).length > 0 && (
                  <span className="ml-0.5 opacity-60">({runs.filter((r) => r.status === f).length})</span>
                )}
              </button>
            ))}
          </div>
        </div>

        {filteredRuns.length === 0 ? (
          <div className="text-center py-12 bg-bgPanel border border-borderSubtle rounded-2xl">
            <svg className="w-8 h-8 mx-auto mb-2 opacity-20 text-textMuted" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 12h16.5m-16.5 3.75h16.5M3.75 19.5h16.5M5.625 4.5h12.75a1.875 1.875 0 0 1 0 3.75H5.625a1.875 1.875 0 0 1 0-3.75z" />
            </svg>
            <p className="text-textMuted text-sm">
              {filter === 'all' ? 'No agent runs yet. Assign a task above.' : `No ${filter} runs.`}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {filteredRuns.map((run, i) => {
              const agentInfo = types.find((t) => t.id === run.agentId);
              const isExpanded = expandedRunId === run.id;
              return (
                <div
                  key={run.id}
                  className="bg-bgPanel border border-borderSubtle rounded-xl overflow-hidden animate-slide-up transition-all"
                  style={{ animationDelay: `${i * 20}ms` }}
                >
                  <div
                    className="flex items-center gap-3 p-4 cursor-pointer hover:bg-white/[0.02]"
                    onClick={() => setExpandedRunId(isExpanded ? null : run.id)}
                  >
                    <div className={`w-9 h-9 rounded-lg bg-gradient-to-br ${agentInfo?.color || 'from-indigo-500 to-violet-600'} flex items-center justify-center shadow-md flex-shrink-0`}>
                      <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d={getAgentIcon(agentInfo ?? { id: run.agentId })} />
                      </svg>
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="font-medium text-textMain text-sm truncate">
                          {agentInfo?.name || run.agentId}
                        </span>
                        <StatusBadge status={run.status} />
                        {run.toolCallCount > 0 && (
                          <span className="text-[10px] text-textMuted bg-white/5 px-1.5 py-0.5 rounded">
                            {run.toolCallCount} tools
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-textMuted truncate max-w-2xl">{run.task}</div>
                    </div>

                    <div className="flex items-center gap-2 flex-shrink-0">
                      <div className="text-right">
                        <div className="text-[10px] text-textMuted">{new Date(run.startedAt).toLocaleTimeString()}</div>
                        {run.completedAt && (
                          <div className="text-[10px] text-textMuted">
                            {((run.completedAt - run.startedAt) / 1000).toFixed(1)}s
                          </div>
                        )}
                      </div>

                      {run.status === 'running' && (
                        <button
                          onClick={(e) => { e.stopPropagation(); handleAbort(run.id); }}
                          className="px-2.5 py-1 rounded-lg bg-red-500/10 text-red-400 text-[10px] font-medium hover:bg-red-500/20 transition-all border border-red-500/20"
                        >
                          Stop
                        </button>
                      )}
                      {run.status === 'completed' && run.result && (
                        <button
                          onClick={(e) => { e.stopPropagation(); handleCopyResult(run.result!); }}
                          className="px-2.5 py-1 rounded-lg bg-green-500/10 text-green-400 text-[10px] font-medium hover:bg-green-500/20 transition-all border border-green-500/20"
                        >
                          Copy
                        </button>
                      )}

                      <svg
                        className={`w-4 h-4 text-textMuted transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}
                        fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
                      </svg>
                    </div>
                  </div>

                  {/* Expanded preview */}
                  {isExpanded && (run.preview || run.result || run.error) && (
                    <div className="border-t border-borderSubtle bg-bgCard/50 px-4 py-3 animate-slide-down">
                      <div className="text-[10px] uppercase tracking-wider text-textMuted mb-2 font-semibold">
                        {run.status === 'running' ? 'Live Output' : run.status === 'completed' ? 'Result' : 'Error'}
                      </div>
                      <pre className="text-xs text-textMain/80 whitespace-pre-wrap break-words max-h-48 overflow-y-auto custom-scrollbar leading-relaxed font-mono">
                        {run.result || run.error || run.preview || '…'}
                      </pre>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Create Agent Modal */}
      {showCreateModal && (
        <CreateAgentModal
          onClose={() => {
            setShowCreateModal(false);
            init(); // Reload agent types after creation
          }}
        />
      )}
    </div>
  );
}
