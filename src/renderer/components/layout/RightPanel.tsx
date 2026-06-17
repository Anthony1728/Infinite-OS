import { useState } from 'react';
import { useAgentsStore } from '../../stores/agents';
import { CodeEditor } from '../workspace/CodeEditor';

export function RightPanel() {
  const [agentTab, setAgentTab] = useState<'ACTIVE' | 'IDLE' | 'ALL'>('ACTIVE');
  const [workspaceTab, setWorkspaceTab] = useState<'agents' | 'code'>('code');
  const { types, runs, chatTasks } = useAgentsStore();

  const activeRuns = runs.filter((r) => r.status === 'running');
  const activeAgentIds = new Set(activeRuns.map((r) => r.agentId));
  
  const mappedAgents = types.map(t => {
    const isWorking = activeAgentIds.has(t.id);
    const activeRun = activeRuns.find(r => r.agentId === t.id);
    return {
      ...t,
      status: isWorking ? 'working' : 'idle',
      currentTask: activeRun?.task || 'Awaiting assignment',
      color: t.color ? `from-[${t.color}] to-indigo-500` : 'from-indigo-500 to-purple-500',
    };
  });

  const activeAgents = mappedAgents.filter((a) => a.status === 'working');
  const idleAgents = mappedAgents.filter((a) => a.status === 'idle');
  const filteredAgents = agentTab === 'ACTIVE' ? activeAgents : agentTab === 'IDLE' ? idleAgents : mappedAgents;

  const recentChatTasks = chatTasks.slice(0, 10);

  return (
    <div className="w-80 border-l border-borderSubtle bg-bgPanel flex flex-col h-full flex-shrink-0">
      {/* Workspace tabs */}
      <div className="p-2 border-b border-borderSubtle/50">
        <div className="flex gap-1 bg-bgMain p-0.5 rounded-lg">
          <button onClick={() => setWorkspaceTab('agents')}
            className={`flex-1 px-2 py-1.5 rounded-md text-xs font-medium transition-all ${workspaceTab === 'agents' ? 'bg-bgCard text-textMain shadow-sm' : 'text-textMuted hover:text-textMain'}`}>
            Agents
          </button>
          <button onClick={() => setWorkspaceTab('code')}
            className={`flex-1 px-2 py-1.5 rounded-md text-xs font-medium transition-all ${workspaceTab === 'code' ? 'bg-bgCard text-textMain shadow-sm' : 'text-textMuted hover:text-textMain'}`}>
            Code Editor
          </button>
        </div>
      </div>

      {workspaceTab === 'code' ? (
        <div className="flex-1 min-h-0 overflow-hidden">
          <CodeEditor />
        </div>
      ) : (
        <>
          {/* Agents */}
          <div className="p-3 border-b border-borderSubtle/50">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-textMain">Agents</h2>
              <button className="text-[10px] text-indigo-400 hover:text-indigo-300 transition-colors flex items-center gap-1">
                <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>
                New Agent
              </button>
            </div>
            
            {/* Tabs */}
            <div className="flex gap-3 mb-3 border-b border-borderSubtle/50">
              {(['ACTIVE', 'IDLE', 'ALL'] as const).map((tab) => (
                <button key={tab} onClick={() => setAgentTab(tab)}
                  className={`pb-2 text-xs font-medium transition-all border-b-2 ${
                    agentTab === tab 
                      ? 'text-textMain border-indigo-500' 
                      : 'text-textMuted border-transparent hover:text-textMain'
                  }`}>
                  {tab} ({tab === 'ACTIVE' ? activeAgents.length : tab === 'IDLE' ? idleAgents.length : mappedAgents.length})
                </button>
              ))}
            </div>

            {/* Agent list */}
            <div className="space-y-2 max-h-48 overflow-y-auto custom-scrollbar">
              {filteredAgents.map((agent, i) => (
                <div key={i} className="flex items-center gap-2.5 p-2 rounded-lg hover:bg-white/[0.03] transition-all cursor-pointer group">
                  <div className={`w-8 h-8 rounded-lg bg-gradient-to-br ${agent.color} flex items-center justify-center shadow-md flex-shrink-0`}>
                    <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d={agent.icon} />
                    </svg>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium text-textMain truncate">{agent.name}</div>
                    <div className="text-[10px] text-textMuted truncate">{agent.currentTask}</div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {agent.status === 'working' ? (
                      <span className="text-[9px] text-amber-400 flex items-center gap-1">
                        <svg className="w-2.5 h-2.5 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>
                        Working
                      </span>
                    ) : (
                      <span className="text-[9px] text-textMuted flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-zinc-600" />
                        Idle
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>

            <button className="w-full text-center text-[10px] text-textMuted hover:text-textMain mt-2 py-1 transition-colors">
              View all agents
            </button>
          </div>

          {/* Tasks */}
          <div className="p-3 flex-1 overflow-y-auto custom-scrollbar">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-textMain">Tasks</h2>
              <span className="text-[10px] text-textMuted">{chatTasks.length} total</span>
            </div>

            <div className="space-y-2.5">
              {chatTasks.length === 0 && runs.length === 0 && (
                <div className="text-center py-6">
                  <div className="text-textMuted text-xs">No active tasks</div>
                  <div className="text-textMuted/50 text-[10px] mt-1">Send a message to start working</div>
                </div>
              )}
              {recentChatTasks.map((task) => {
                const isWorking = task.status === 'working';
                const isDone = task.status === 'completed';
                const isFailed = task.status === 'failed';
                return (
                  <div key={task.id} className="group">
                    <div className="flex items-center justify-between mb-1.5">
                      <div className="flex items-center gap-2 max-w-[80%]">
                        {isDone ? (
                          <svg className="w-3.5 h-3.5 flex-shrink-0 text-green-400" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5"/></svg>
                        ) : isFailed ? (
                          <svg className="w-3.5 h-3.5 flex-shrink-0 text-red-400" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
                        ) : (
                          <div className="w-3.5 h-3.5 rounded-full border-2 border-indigo-500/50 flex-shrink-0 animate-pulse" />
                        )}
                        <span className={`text-xs truncate ${isWorking ? 'text-textMain' : 'text-textMuted'}`}>{task.title}</span>
                      </div>
                      <span className={`text-[10px] ${isWorking ? 'text-indigo-400' : 'text-textMuted'}`}>
                        {isWorking ? 'working...' : isDone ? 'done' : 'failed'}
                      </span>
                    </div>
                    <div className="h-1 w-full rounded-full bg-white/5 overflow-hidden ml-5.5">
                      <div className={`h-full rounded-full transition-all duration-500 ${
                        isDone ? 'bg-green-500 w-full' :
                        isFailed ? 'bg-red-500 w-full' :
                        'bg-indigo-500 animate-pulse'
                      }`} style={{ width: isWorking ? '60%' : '100%' }} />
                    </div>
                    {task.filesCreated && task.filesCreated.length > 0 && (
                      <div className="ml-5.5 mt-1 flex flex-wrap gap-1">
                        {task.filesCreated.map((f, i) => (
                          <span key={i} className="text-[9px] px-1.5 py-0.5 rounded bg-green-500/10 text-green-400 border border-green-500/20">{f}</span>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
              {runs.slice(0, 3).map((run) => {
                const isDone = run.status === 'completed' || run.status === 'failed';
                return (
                <div key={run.id} className="group">
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center gap-2 max-w-[80%]">
                      {isDone ? (
                        <svg className={`w-3.5 h-3.5 flex-shrink-0 ${run.status === 'completed' ? 'text-green-400' : 'text-red-400'}`} fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d={run.status === 'completed' ? "M4.5 12.75l6 6 9-13.5" : "M6 18L18 6M6 6l12 12"}/></svg>
                      ) : (
                        <div className="w-3.5 h-3.5 rounded-full border-2 border-indigo-500/50 flex-shrink-0" />
                      )}
                      <span className={`text-xs truncate ${isDone ? 'text-textMuted' : 'text-textMain'}`}>{run.task}</span>
                    </div>
                    <span className="text-[10px] text-textMuted">{run.status}</span>
                  </div>
                  <div className="h-1 w-full rounded-full bg-white/5 overflow-hidden ml-5.5">
                    <div className={`h-full rounded-full transition-all duration-500 ${
                      run.status === 'completed' ? 'bg-green-500 w-full' : 
                      run.status === 'failed' ? 'bg-red-500 w-full' : 
                      'bg-indigo-500 w-1/2 animate-pulse'
                    }`} />
                  </div>
                </div>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
