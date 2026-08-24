import { useEffect, useMemo, useState } from 'react';
import { useAgentsStore } from '../../stores/agents';
import { CodeEditor } from '../workspace/CodeEditor';
import { AppIcon } from '../brand/AppIcon';

type PanelId = 'agents' | 'workspace' | 'tasks';
type AgentTab = 'ACTIVE' | 'IDLE' | 'ALL';

export function RightPanel({ onViewChange }: { onViewChange: (view: string) => void }) {
  const [expanded, setExpanded] = useState<PanelId | null>('tasks');
  const [agentTab, setAgentTab] = useState<AgentTab>('ACTIVE');
  const [workspaceTab, setWorkspaceTab] = useState<'chat' | 'code'>('code');
  const types = useAgentsStore((state) => state.types);
  const runs = useAgentsStore((state) => state.runs);
  const chatTasks = useAgentsStore((state) => state.chatTasks);
  const subTasks = useAgentsStore((state) => state.subTasks);
  const abort = useAgentsStore((state) => state.abort);

  const agents = useMemo(
    () =>
      types.map((type) => {
        const run = runs.find((item) => item.agentId === type.id && item.status === 'running');
        return { ...type, working: Boolean(run), task: run?.task || 'Awaiting assignment' };
      }),
    [types, runs],
  );
  const activeAgents = agents.filter((agent) => agent.working);
  const idleAgents = agents.filter((agent) => !agent.working);
  const visibleAgents = (agentTab === 'ACTIVE' ? activeAgents : agentTab === 'IDLE' ? idleAgents : agents).slice(0, 6);
  const tasks = [
    ...subTasks.map((task) => ({ id: task.id, title: task.description, status: task.status, startedAt: task.startedAt, error: task.error })),
    ...chatTasks.map((task) => ({ id: task.id, title: task.title, status: task.status, startedAt: task.startedAt, error: task.error })),
    ...runs
      .filter((run) => !subTasks.some((task) => task.description === run.task && Math.abs(task.startedAt - run.startedAt) < 5_000))
      .map((run) => ({ id: run.id, title: run.task, status: run.status, startedAt: run.startedAt, error: run.error, activity: run.activity, runId: run.id })),
  ].sort((a, b) => b.startedAt - a.startedAt).slice(0, 8);

  const hasActiveWork = tasks.some((task) => task.status === 'running' || task.status === 'working' || task.status === 'pending' || task.status === 'queued');
  useEffect(() => { if (hasActiveWork) setExpanded('tasks'); }, [hasActiveWork]);

  const toggle = (panel: PanelId) => setExpanded((current) => (current === panel ? null : panel));

  return (
    <aside className="os-right-panel flex w-[min(340px,42vw)] border-l border-white/[0.06] bg-[#090c13] flex-col h-full flex-shrink-0 p-4 gap-3 overflow-hidden">
      <section
        className={`os-right-panel-card flex flex-col rounded-xl border bg-[#0c1019] overflow-hidden transition-[flex,border-color,box-shadow] duration-300 ${expanded === 'agents' ? 'is-expanded flex-1 min-h-0 border-indigo-500/25 shadow-[0_16px_40px_rgba(0,0,0,.24)]' : 'flex-none border-white/[0.07]'}`}
      >
        <div className="h-14 px-4 flex items-center gap-3 flex-shrink-0">
          <button
            onClick={() => toggle('agents')}
            aria-expanded={expanded === 'agents'}
            className="flex-1 h-full flex items-center gap-3 text-left group"
          >
            <PanelIcon kind="agents" active={expanded === 'agents'} />
            <span className="min-w-0">
              <span className="block text-[11px] font-semibold text-zinc-200">Agents</span>
              <span className="block text-[9px] text-zinc-600">
                {activeAgents.length} active · {agents.length} configured
              </span>
            </span>
            <ExpandGlyph expanded={expanded === 'agents'} />
          </button>
          {expanded === 'agents' && (
            <button
              onClick={() => onViewChange('agents')}
              className="h-7 px-2 rounded-md border border-white/[0.07] bg-white/[0.03] text-[9px] text-zinc-400 hover:text-white"
            >
              ＋ New
            </button>
          )}
        </div>
        {expanded === 'agents' && (
          <>
            <div className="flex px-3 border-y border-white/[0.055] flex-shrink-0">
              {(['ACTIVE', 'IDLE', 'ALL'] as const).map((tab) => {
                const count =
                  tab === 'ACTIVE' ? activeAgents.length : tab === 'IDLE' ? idleAgents.length : agents.length;
                return (
                  <button
                    key={tab}
                    onClick={() => setAgentTab(tab)}
                    className={`flex-1 py-2 text-[9px] border-b transition-colors ${agentTab === tab ? 'text-zinc-100 border-indigo-500' : 'text-zinc-600 border-transparent hover:text-zinc-300'}`}
                  >
                    {tab} ({count})
                  </button>
                );
              })}
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar p-2.5">
              {visibleAgents.length === 0 ? (
                <EmptyPanel
                  title={`No ${agentTab.toLowerCase()} agents`}
                  action="Configure agents"
                  onAction={() => onViewChange('agents')}
                />
              ) : (
                visibleAgents.map((agent) => (
                  <button
                    key={agent.id}
                    onClick={() => onViewChange('agents')}
                    className="w-full flex items-center gap-2.5 rounded-lg px-2 py-2 text-left hover:bg-white/[0.035] transition-colors"
                  >
                    <span className="w-8 h-8 rounded-lg border border-white/[0.06] bg-white/[0.035] flex items-center justify-center">
                      <svg
                        className={agent.working ? 'w-4 h-4 text-emerald-400' : 'w-4 h-4 text-zinc-500'}
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.7"
                        viewBox="0 0 24 24"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" d={agent.icon} />
                      </svg>
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="block text-[10px] text-zinc-300 truncate">{agent.name}</span>
                      <span className="block text-[9px] text-zinc-600 truncate">{agent.task}</span>
                    </span>
                    <span className={agent.working ? 'text-[8px] text-amber-400' : 'text-[8px] text-zinc-600'}>
                      {agent.working ? 'Working' : 'Idle'}
                    </span>
                  </button>
                ))
              )}
            </div>
            <button
              onClick={() => onViewChange('agents')}
              className="h-9 border-t border-white/[0.055] text-[9px] text-zinc-500 hover:text-white flex-shrink-0"
            >
              View all agents →
            </button>
          </>
        )}
      </section>

      <section
        className={`os-right-panel-card flex flex-col rounded-xl border bg-[#0c1019] overflow-hidden transition-[flex,border-color,box-shadow] duration-300 ${expanded === 'workspace' ? 'is-expanded flex-1 min-h-0 border-cyan-500/25 shadow-[0_16px_40px_rgba(0,0,0,.24)]' : 'flex-none border-white/[0.07]'}`}
      >
        <div className="h-14 px-4 flex items-center gap-3 flex-shrink-0">
          <button
            onClick={() => toggle('workspace')}
            aria-expanded={expanded === 'workspace'}
            className="flex-1 h-full flex items-center gap-3 text-left"
          >
            <PanelIcon kind="workspace" active={expanded === 'workspace'} />
            <span className="min-w-0">
              <span className="block text-[11px] font-semibold text-zinc-200">Workspace</span>
              <span className="block text-[9px] text-zinc-600">Chat and code editor</span>
            </span>
            <ExpandGlyph expanded={expanded === 'workspace'} />
          </button>
          {expanded === 'workspace' && (
            <button
              onClick={() => onViewChange('workspace')}
              className="icon-button w-7 h-7"
              aria-label="Open full workspace"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="1.7" viewBox="0 0 24 24">
                <path d="M4 4h6v6H4V4Zm10 0h6v6h-6V4ZM4 14h6v6H4v-6Zm10 0h6v6h-6v-6Z" />
              </svg>
            </button>
          )}
        </div>
        {expanded === 'workspace' && (
          <>
            <div className="grid grid-cols-2 gap-1 p-2 border-y border-white/[0.055] flex-shrink-0">
              <button
                onClick={() => {
                  setWorkspaceTab('chat');
                  onViewChange('chats');
                }}
                className={`h-8 rounded-md text-[9px] border ${workspaceTab === 'chat' ? 'border-indigo-500/40 bg-indigo-500/10 text-zinc-200' : 'border-white/[0.05] text-zinc-500'}`}
              >
                Chat
              </button>
              <button
                onClick={() => setWorkspaceTab('code')}
                className={`h-8 rounded-md text-[9px] border ${workspaceTab === 'code' ? 'border-indigo-500/40 bg-indigo-500/10 text-zinc-200' : 'border-white/[0.05] text-zinc-500'}`}
              >
                〈/〉 Code Editor
              </button>
            </div>
            <div className="flex-1 min-h-0 bg-[#080b11] overflow-hidden">
              {workspaceTab === 'code' ? (
                <CodeEditor />
              ) : (
                <div className="h-full flex items-center justify-center text-[10px] text-zinc-600">
                  Chat is open in the main workspace
                </div>
              )}
            </div>
          </>
        )}
      </section>

      <section
        className={`os-right-panel-card flex flex-col rounded-xl border bg-[#0c1019] overflow-hidden transition-[flex,border-color,box-shadow] duration-300 ${expanded === 'tasks' ? 'is-expanded flex-1 min-h-0 border-violet-500/25 shadow-[0_16px_40px_rgba(0,0,0,.24)]' : 'flex-none border-white/[0.07]'}`}
      >
        <div className="h-14 px-4 flex items-center gap-3 flex-shrink-0">
          <button
            onClick={() => toggle('tasks')}
            aria-expanded={expanded === 'tasks'}
            className="flex-1 h-full flex items-center gap-3 text-left"
          >
            <PanelIcon kind="tasks" active={expanded === 'tasks'} />
            <span className="min-w-0">
              <span className="block text-[11px] font-semibold text-zinc-200">Tasks</span>
              <span className="block text-[9px] text-zinc-600">{tasks.length} recent tasks</span>
            </span>
            <ExpandGlyph expanded={expanded === 'tasks'} />
          </button>
          {expanded === 'tasks' && (
            <button onClick={() => onViewChange('agents')} className="text-[9px] text-indigo-400">
              View all
            </button>
          )}
        </div>
        {expanded === 'tasks' && (
          <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar border-t border-white/[0.055] p-4 space-y-4">
            {tasks.length === 0 ? (
              <EmptyPanel title="No tasks yet" action="Start from chat" onAction={() => onViewChange('chats')} />
            ) : (
              tasks.map((task) => {
                const complete = task.status === 'completed';
                const failed = task.status === 'failed' || task.status === 'cancelled';
                const running = task.status === 'running' || task.status === 'working';
                return (
                  <div key={task.id} title={failed ? task.error : undefined}>
                    <div className="flex items-center gap-2">
                      <span
                        className={`w-3.5 h-3.5 rounded-full border flex items-center justify-center text-[8px] ${complete ? 'border-emerald-500 bg-emerald-500 text-white' : failed ? 'border-red-500 text-red-400' : 'border-zinc-600'}`}
                      >
                        {complete ? '✓' : failed ? '×' : ''}
                      </span>
                      {running && 'runId' in task && task.runId && (
                        <button onClick={() => void abort(task.runId)} className="rounded border border-red-500/20 px-1.5 py-0.5 text-[8px] text-red-300 hover:bg-red-500/10">Stop</button>
                      )}
                      <span className="flex-1 text-[10px] text-zinc-300 truncate">{task.title}</span>
                      <span
                        className={`text-[8px] ${complete ? 'text-emerald-400' : failed ? 'text-red-400' : running ? 'text-indigo-400' : 'text-zinc-600'}`}
                      >
                        {complete ? 'Complete' : failed ? 'Failed' : running ? 'Working' : 'Queued'}
                      </span>
                    </div>
                    {running && (
                      <div className="ml-5.5 mt-1.5 h-0.5 bg-white/[0.05] rounded-full">
                        <div className="h-full w-1/3 bg-indigo-500 animate-pulse" />
                      </div>
                    )}
                    {'activity' in task && task.activity?.length ? (
                      <div className="ml-5.5 mt-2 space-y-1 border-l border-white/[0.06] pl-2">
                        {task.activity.slice(-4).map((item) => (
                          <div key={item.id} className="text-[9px] leading-4 text-zinc-500">
                            <span className={item.kind === 'error' ? 'text-red-400' : item.kind === 'result' ? 'text-emerald-400' : item.kind === 'tool' ? 'text-cyan-400' : 'text-indigo-400'}>{item.label}</span>
                            {item.detail && <div className="line-clamp-2 font-mono text-[8px] text-zinc-600">{item.detail}</div>}
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                );
              })
            )}
          </div>
        )}
      </section>
    </aside>
  );
}

function PanelIcon({ kind, active }: { kind: PanelId; active: boolean }) {
  return (
    <span
      className={`w-8 h-8 rounded-lg border flex items-center justify-center ${active ? 'border-indigo-500/30 bg-indigo-500/10 text-indigo-300' : 'border-white/[0.06] bg-white/[0.025] text-zinc-500'}`}
    >
      <AppIcon name={`panel.${kind}`} className="w-4 h-4" strokeWidth={1.7} />
    </span>
  );
}

function ExpandGlyph({ expanded }: { expanded: boolean }) {
  return (
    <svg
      className={`ml-auto w-3.5 h-3.5 text-zinc-600 transition-transform ${expanded ? 'rotate-180' : ''}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      viewBox="0 0 24 24"
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="m6.75 9 5.25 5.25L17.25 9" />
    </svg>
  );
}

function EmptyPanel({ title, action, onAction }: { title: string; action: string; onAction: () => void }) {
  return (
    <div className="h-full min-h-28 flex flex-col items-center justify-center text-center">
      <div className="text-[10px] text-zinc-600">{title}</div>
      <button onClick={onAction} className="mt-2 text-[9px] text-indigo-400 hover:text-indigo-300">
        {action}
      </button>
    </div>
  );
}
