import { useMemo, useState } from 'react';
import { useAgentsStore } from '../../stores/agents';
import { CodeEditor } from '../workspace/CodeEditor';

type AgentTab = 'ACTIVE' | 'IDLE' | 'ALL';

export function RightPanel({ onViewChange }: { onViewChange: (view: string) => void }) {
  const [agentTab, setAgentTab] = useState<AgentTab>('ACTIVE');
  const [workspaceTab, setWorkspaceTab] = useState<'chat' | 'code'>('code');
  const { types, runs, chatTasks, subTasks } = useAgentsStore();

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
  const visibleAgents = (agentTab === 'ACTIVE' ? activeAgents : agentTab === 'IDLE' ? idleAgents : agents).slice(0, 5);

  const tasks = [
    ...subTasks.map((task) => ({ id: task.id, title: task.description, status: task.status })),
    ...chatTasks.map((task) => ({ id: task.id, title: task.title, status: task.status })),
    ...runs.map((run) => ({ id: run.id, title: run.task, status: run.status })),
  ].slice(0, 5);

  return (
    <aside className="hidden xl:flex w-[300px] border-l border-white/[0.06] bg-[#090c13] flex-col h-full flex-shrink-0 p-5 gap-5 overflow-y-auto custom-scrollbar">
      <section className="rounded-xl border border-white/[0.07] bg-[#0c1019] shadow-[0_12px_36px_rgba(0,0,0,.16)]">
        <div className="flex items-center justify-between px-5 pt-4">
          <h2 className="text-xs font-semibold text-zinc-100">Agents</h2>
          <button
            onClick={() => onViewChange('agents')}
            className="h-7 px-2.5 rounded-md border border-white/[0.07] bg-white/[0.035] text-[10px] text-zinc-300 hover:bg-white/[0.07] transition-colors"
          >
            <span className="mr-1">＋</span> New Agent
          </button>
        </div>
        <div className="flex px-4 mt-3.5 border-b border-white/[0.06]">
          {(['ACTIVE', 'IDLE', 'ALL'] as const).map((tab) => {
            const count = tab === 'ACTIVE' ? activeAgents.length : tab === 'IDLE' ? idleAgents.length : agents.length;
            return (
              <button
                key={tab}
                onClick={() => setAgentTab(tab)}
                className={`flex-1 pb-2 text-[9px] tracking-wide border-b transition-colors ${agentTab === tab ? 'text-zinc-100 border-indigo-500' : 'text-zinc-600 border-transparent hover:text-zinc-300'}`}
              >
                {tab} ({count})
              </button>
            );
          })}
        </div>
        <div className="px-3 py-2.5 min-h-[132px]">
          {visibleAgents.length === 0 ? (
            <div className="h-[116px] flex flex-col items-center justify-center text-center">
              <div className="text-[11px] text-zinc-500">No {agentTab.toLowerCase()} agents</div>
              <button
                onClick={() => onViewChange('agents')}
                className="mt-2 text-[10px] text-indigo-400 hover:text-indigo-300"
              >
                Configure agents
              </button>
            </div>
          ) : (
            visibleAgents.map((agent) => (
              <button
                key={agent.id}
                onClick={() => onViewChange('agents')}
                className="w-full flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-left hover:bg-white/[0.035] transition-colors"
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
                  <span className="block text-[11px] font-medium text-zinc-200 truncate">{agent.name}</span>
                  <span className="block text-[9px] text-zinc-600 truncate">{agent.task}</span>
                </span>
                {agent.working ? (
                  <span className="flex items-center gap-1 text-[9px] text-amber-400">
                    <svg
                      className="w-2.5 h-2.5"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="m13 2.75-8.25 10.5h6.5L11 21.25 19.25 10.5h-6.5L13 2.75Z"
                      />
                    </svg>
                    Working
                  </span>
                ) : (
                  <span className="flex items-center gap-1 text-[9px] text-zinc-600">
                    <span className="w-1.5 h-1.5 rounded-full border border-zinc-600" />
                    Idle
                  </span>
                )}
              </button>
            ))
          )}
        </div>
        <button
          onClick={() => onViewChange('agents')}
          className="w-full border-t border-white/[0.05] py-2 text-[9px] text-zinc-500 hover:text-zinc-200"
        >
          View all agents →
        </button>
      </section>

      <section className="rounded-xl border border-white/[0.07] bg-[#0c1019] overflow-hidden shadow-[0_12px_36px_rgba(0,0,0,.16)]">
        <div className="flex items-center justify-between px-5 py-3.5">
          <h2 className="text-xs font-semibold text-zinc-100">Workspace</h2>
          <button
            onClick={() => onViewChange('workspace')}
            className="icon-button w-6 h-6"
            aria-label="Open full workspace"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="1.6" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M3.75 3.75h6.5v6.5h-6.5v-6.5Zm10 0h6.5v6.5h-6.5v-6.5Zm-10 10h6.5v6.5h-6.5v-6.5Zm10 0h6.5v6.5h-6.5v-6.5Z"
              />
            </svg>
          </button>
        </div>
        <div className="grid grid-cols-2 gap-1 px-2 pb-2">
          <button
            onClick={() => {
              setWorkspaceTab('chat');
              onViewChange('chats');
            }}
            className={`h-8 rounded-md text-[10px] border transition-colors ${workspaceTab === 'chat' ? 'border-indigo-500/40 bg-indigo-500/10 text-zinc-200' : 'border-white/[0.05] text-zinc-500 hover:text-zinc-300'}`}
          >
            Chat
          </button>
          <button
            onClick={() => setWorkspaceTab('code')}
            className={`h-8 rounded-md text-[10px] border transition-colors ${workspaceTab === 'code' ? 'border-indigo-500/40 bg-indigo-500/10 text-zinc-200' : 'border-white/[0.05] text-zinc-500 hover:text-zinc-300'}`}
          >
            〈/〉 Code Editor
          </button>
        </div>
        <div className="h-[238px] border-t border-white/[0.05] bg-[#080b11] overflow-hidden">
          {workspaceTab === 'code' ? (
            <CodeEditor />
          ) : (
            <div className="h-full flex items-center justify-center text-[10px] text-zinc-600">
              Chat is open in the main workspace
            </div>
          )}
        </div>
      </section>

      <section className="rounded-xl border border-white/[0.07] bg-[#0c1019] p-4 shadow-[0_12px_36px_rgba(0,0,0,.16)]">
        <div className="flex items-center justify-between mb-3.5">
          <h2 className="text-xs font-semibold text-zinc-100">Tasks</h2>
          <button onClick={() => onViewChange('agents')} className="text-[9px] text-indigo-400 hover:text-indigo-300">
            View all →
          </button>
        </div>
        <div className="space-y-3.5">
          {tasks.length === 0 ? (
            <div className="py-5 text-center text-[10px] text-zinc-600">Tasks appear here when AI work starts.</div>
          ) : (
            tasks.map((task) => {
              const complete = task.status === 'completed';
              const failed = task.status === 'failed' || task.status === 'cancelled';
              const running = task.status === 'running' || task.status === 'working';
              return (
                <div key={task.id}>
                  <div className="flex items-center gap-2">
                    <span
                      className={`w-3.5 h-3.5 rounded-full border flex items-center justify-center ${complete ? 'border-emerald-500 bg-emerald-500 text-white' : failed ? 'border-red-500 text-red-400' : 'border-zinc-600'}`}
                    >
                      {complete ? '✓' : failed ? '×' : ''}
                    </span>
                    <span className="flex-1 min-w-0 text-[10px] text-zinc-300 truncate">{task.title}</span>
                    <span
                      className={`text-[9px] ${complete ? 'text-emerald-400' : failed ? 'text-red-400' : running ? 'text-indigo-400' : 'text-zinc-600'}`}
                    >
                      {complete ? '100%' : failed ? 'Failed' : running ? 'Active' : 'Queued'}
                    </span>
                  </div>
                  {running && (
                    <div className="ml-5.5 mt-1.5 h-0.5 rounded-full bg-white/[0.05] overflow-hidden">
                      <div className="h-full w-2/3 bg-gradient-to-r from-indigo-500 to-violet-500 animate-pulse" />
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </section>
    </aside>
  );
}
