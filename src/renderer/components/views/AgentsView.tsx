import { useEffect, useState } from 'react';
import { useAgentsStore } from '../../stores/agents';
import { useNotificationStore } from '../../stores/notifications';
import { CreateAgentModal } from '../agents/CreateAgentModal';
import type { AppIconName } from '../brand/AppIcon';
import { NexusIcon } from '../brand/NexusIcon';

type FilterStatus = 'all' | 'running' | 'completed' | 'failed';

// Agent category icons — custom Infinite OS glyph set via the central registry
const CATEGORY_ICONS: Record<string, AppIconName> = {
  coder: 'agent.coder',
  developer: 'agent.coder',
  code: 'agent.coder',
  researcher: 'agent.researcher',
  research: 'agent.researcher',
  browser: 'agent.browser',
  web: 'agent.browser',
  writer: 'agent.writer',
  analyst: 'agent.analyst',
  data: 'agent.analyst',
  finance: 'agent.finance',
  ops: 'agent.ops',
  operator: 'agent.ops',
  devops: 'agent.ops',
  design: 'agent.design',
  designer: 'agent.design',
  seo: 'agent.seo',
  security: 'agent.security',
  default: 'agent.default',
};

function getAgentIconName(agent: { id: string; icon?: string }): AppIconName {
  const id = agent.id.toLowerCase();
  for (const [key, name] of Object.entries(CATEGORY_ICONS)) {
    if (key !== 'default' && id.includes(key)) return name;
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

/** Human-role badge text from agent id. */
function roleLabel(id: string): string {
  const label = (id.match(/[a-z0-9]+/g) ?? ['general']).join(' ');
  return label === 'general' ? 'general' : label;
}

/** Themed icon tile per agent id — violet/cyan/emerald/rose/indigo/amber. */
const THEME_FOR: Record<string, string> = {
  general: 'af-tile-purple',
  research: 'af-tile-cyan',
  code: 'af-tile-emerald',
  html: 'af-tile-emerald',
  design: 'af-tile-rose',
  data: 'af-tile-indigo',
  seo: 'af-tile-amber',
  finance: 'af-tile-emerald',
  marketing: 'af-tile-rose',
  tester: 'af-tile-cyan',
  security: 'af-tile-crimson',
  devops: 'af-tile-purple',
  writer: 'af-tile-gold',
  architect: 'af-tile-purple',
  mobile: 'af-tile-indigo',
  aieng: 'af-tile-cyan',
  business: 'af-tile-amber',
  automation: 'af-tile-emerald',
  desktop: 'af-tile-purple',
  student: 'af-tile-gold',
  music: 'af-tile-rose',
  creator: 'af-tile-amber',
  entrepreneur: 'af-tile-crimson',
  generalist: 'af-tile-purple',
};
function themeFor(agent: { id: string; color?: string }): string {
  const id = agent.id.toLowerCase();
  for (const [key, name] of Object.entries(THEME_FOR)) {
    if (id.includes(key)) return name;
  }
  return 'af-tile-custom';
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
    } catch (e: unknown) {
      const error = e instanceof Error ? e : new Error(String(e));
      addToast({ type: 'error', title: 'Agent error', message: error.message });
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
      {/* Shared gradient defs for themed agent icon tiles (reference visual). */}
      <svg style={{ width: 0, height: 0, position: 'absolute' }} aria-hidden="true">
        <defs>
          <linearGradient id="af-purple" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stopColor="#c084fc" /><stop offset="100%" stopColor="#7c3aed" /></linearGradient>
          <linearGradient id="af-cyan" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stopColor="#38bdf8" /><stop offset="100%" stopColor="#0284c7" /></linearGradient>
          <linearGradient id="af-emerald" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stopColor="#34d399" /><stop offset="100%" stopColor="#059669" /></linearGradient>
          <linearGradient id="af-rose" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stopColor="#f472b6" /><stop offset="100%" stopColor="#db2777" /></linearGradient>
          <linearGradient id="af-amber" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stopColor="#fbbf24" /><stop offset="100%" stopColor="#d97706" /></linearGradient>
          <linearGradient id="af-indigo" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stopColor="#818cf8" /><stop offset="100%" stopColor="#4f46e5" /></linearGradient>
          <linearGradient id="af-crimson" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stopColor="#fb7185" /><stop offset="100%" stopColor="#e11d48" /></linearGradient>
          <linearGradient id="af-gold" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stopColor="#fde047" /><stop offset="100%" stopColor="#ca8a04" /></linearGradient>
          <linearGradient id="af-custom" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stopColor="#38bdf8" /><stop offset="100%" stopColor="#a855f7" /></linearGradient>
        </defs>
      </svg>

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-textMain flex items-center gap-3">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-[#2a1b47] to-[#101226] border border-white/10 shadow-lg shadow-violet-900/30 flex items-center justify-center">
              <NexusIcon size={32} />
            </div>
            Agent Fleet
            {activeCount > 0 && (
              <span className="ml-1 flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-indigo-500/15 border border-indigo-500/20 text-indigo-300 text-xs font-medium">
                <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-live-pulse inline-block" />
                {activeCount} running
              </span>
            )}
          </h1>
          <p className="text-textMuted text-sm mt-1">A specialized roster ready to execute your tasks. Pick an agent, describe the task, it runs.</p>
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

      {/* Agent Grid — reference roster layout: branded card, themed icon tile,
          role badge, description, Assign Task. Clicking a card reveals an
          inline task input for that agent. */}
      <div className="mb-8">
        <h2 className="text-sm font-semibold mb-4 text-textMuted uppercase tracking-wider">Available Agents</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {types.map((agent) => (
            <div key={agent.id} className="agent-card group">
              <div>
                <div className="flex items-start gap-3.5 mb-3">
                  <div className={`af-tile ${themeFor(agent)}`}>
                    <svg viewBox="0 0 24 24" fill="none" stroke={`url(#af-${themeFor(agent).slice(8)})`} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d={agent.icon || 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z'} />
                    </svg>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-textMain truncate">{agent.name}</div>
                    <span className="af-badge">{roleLabel(agent.id)}</span>
                  </div>
                </div>
                <p className="af-desc">{agent.description}</p>
              </div>

              <div className="mt-auto">
                {selectedAgent === agent.id ? (
                  <div className="animate-slide-down space-y-2">
                    <input
                      type="text"
                      placeholder="Describe the task for this agent…"
                      className="af-task-input"
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
                    className="af-action"
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
                    <div className={`af-tile ${themeFor(agentInfo ?? { id: run.agentId })}`} style={{ width: 36, height: 36 }}>
                      <svg viewBox="0 0 24 24" fill="none" stroke={`url(#af-${themeFor(agentInfo ?? { id: run.agentId }).slice(8)})`} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 18, height: 18 }}>
                        <path d={agentInfo?.icon || getAgentIconName(agentInfo ?? { id: run.agentId }) === 'agent.default' ? 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z' : getAgentIconName(agentInfo ?? { id: run.agentId })} />
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
                  {isExpanded && (
                    <div className="border-t border-borderSubtle bg-bgCard/50 px-4 py-3 animate-slide-down">
                      <div className="text-[10px] uppercase tracking-wider text-textMuted mb-2 font-semibold">
                        {run.status === 'running' ? 'Live Output' : run.status === 'completed' ? 'Result' : 'Error'}
                      </div>
                      {run.activity?.length ? (
                        <div className="max-h-64 space-y-2 overflow-y-auto custom-scrollbar">
                          {run.activity.map((item) => (
                            <div key={item.id} className="flex gap-2 text-xs">
                              <span className={`mt-1 h-2 w-2 flex-none rounded-full ${item.kind === 'error' ? 'bg-red-400' : item.kind === 'result' ? 'bg-emerald-400' : item.kind === 'tool' ? 'bg-cyan-400' : 'bg-indigo-400'}`} />
                              <div className="min-w-0">
                                <div className="font-medium text-textMain">{item.label}</div>
                                {item.detail && <pre className="mt-0.5 whitespace-pre-wrap break-words font-mono text-[10px] leading-4 text-textMuted">{item.detail}</pre>}
                              </div>
                              <span className="ml-auto flex-none text-[9px] text-textMuted">{new Date(item.timestamp).toLocaleTimeString()}</span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <pre className="text-xs text-textMain/80 whitespace-pre-wrap break-words max-h-48 overflow-y-auto custom-scrollbar leading-relaxed font-mono">{run.result || run.error || run.preview || 'Starting…'}</pre>
                      )}
                      {(run.result || run.error) && <pre className="mt-3 border-t border-borderSubtle pt-3 text-xs text-textMain/80 whitespace-pre-wrap break-words max-h-48 overflow-y-auto custom-scrollbar leading-relaxed font-mono">{run.result || run.error}</pre>}
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
