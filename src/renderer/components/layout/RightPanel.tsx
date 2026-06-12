import { useState } from 'react';
import { useAgentsStore } from '../../stores/agents';

export function RightPanel() {
  const [agentTab, setAgentTab] = useState<'ACTIVE' | 'IDLE' | 'ALL'>('ACTIVE');
  const [workspaceTab, setWorkspaceTab] = useState<'chat' | 'code'>('chat');
  const { types, runs } = useAgentsStore();

  const activeRuns = runs.filter((r) => r.status === 'running');
  const activeAgentIds = new Set(activeRuns.map((r) => r.agentId));
  
  const mappedAgents = types.map(t => {
    const isWorking = activeAgentIds.has(t.id);
    const activeRun = activeRuns.find(r => r.agentId === t.id);
    return {
      ...t,
      status: isWorking ? 'working' : 'idle',
      currentTask: activeRun?.task || 'Awaiting assignment',
      color: t.color ? `from-[${t.color}] to-indigo-500` : 'from-indigo-500 to-purple-500', // fallback color
    };
  });

  const activeAgents = mappedAgents.filter((a) => a.status === 'working');
  const idleAgents = mappedAgents.filter((a) => a.status === 'idle');
  const filteredAgents = agentTab === 'ACTIVE' ? activeAgents : agentTab === 'IDLE' ? idleAgents : mappedAgents;

  return (
    <div className="w-72 border-l border-borderSubtle bg-bgPanel flex flex-col h-full flex-shrink-0">
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

      {/* Workspace */}
      <div className="p-3 border-b border-borderSubtle/50">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-textMain">Workspace</h2>
          <div className="flex gap-1">
            {[
              { id: 'grid', icon: 'M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6z' },
              { id: 'list', icon: 'M3.75 12h16.5m-16.5 3.75h16.5M3.75 19.5h16.5M5.625 4.5h12.75a1.875 1.875 0 010 3.75H5.625a1.875 1.875 0 010-3.75z' },
            ].map((btn) => (
              <button key={btn.id} className="w-6 h-6 rounded hover:bg-white/5 flex items-center justify-center text-textMuted hover:text-textMain transition-all">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d={btn.icon} /></svg>
              </button>
            ))}
          </div>
        </div>

        <div className="flex gap-1 mb-3 bg-bgMain p-0.5 rounded-lg">
          <button onClick={() => setWorkspaceTab('chat')}
            className={`flex-1 px-2 py-1.5 rounded-md text-xs font-medium transition-all ${workspaceTab === 'chat' ? 'bg-bgCard text-textMain shadow-sm' : 'text-textMuted hover:text-textMain'}`}>
            Chat
          </button>
          <button onClick={() => setWorkspaceTab('code')}
            className={`flex-1 px-2 py-1.5 rounded-md text-xs font-medium transition-all ${workspaceTab === 'code' ? 'bg-bgCard text-textMain shadow-sm' : 'text-textMuted hover:text-textMain'}`}>
            Code Editor
          </button>
        </div>

        {/* Code preview */}
        <div className="bg-bgMain border border-borderSubtle rounded-lg overflow-hidden">
          <div className="px-2.5 py-1.5 border-b border-borderSubtle/50 flex items-center gap-2">
            <svg className="w-3 h-3 text-textMuted" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M17.25 6.75L22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3l-4.5 16.5" /></svg>
            <span className="text-[10px] text-textMuted">dashboard.tsx</span>
          </div>
          <div className="p-2.5 font-mono text-[9px] leading-relaxed text-zinc-400 overflow-hidden max-h-28">
            <div><span className="text-purple-400">import</span> {"{ useState }"} <span className="text-purple-400">from</span> <span className="text-green-400">{"'react'"}</span></div>
            <div><span className="text-purple-400">import</span> {"{ LineChart, Bar }"} <span className="text-purple-400">from</span> <span className="text-green-400">{"'recharts'"}</span></div>
            <div>&nbsp;</div>
            <div><span className="text-purple-400">export default function</span> <span className="text-blue-400">Dashboard</span>() {"{"}</div>
            <div>&nbsp;&nbsp;<span className="text-purple-400">const</span> [data, setData] = useState([])</div>
            <div>&nbsp;&nbsp;<span className="text-purple-400">return</span> (</div>
            <div>&nbsp;&nbsp;&nbsp;&nbsp;&lt;<span className="text-blue-400">div</span> className=<span className="text-green-400">"p-6"</span>&gt;</div>
            <div>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&lt;<span className="text-blue-400">h1</span>&gt;Dashboard&lt;/<span className="text-blue-400">h1</span>&gt;</div>
            <div>&nbsp;&nbsp;&nbsp;&nbsp;&lt;/<span className="text-blue-400">div</span>&gt;</div>
            <div>&nbsp;&nbsp;)</div>
            <div>{"}"}</div>
          </div>
        </div>
      </div>

      {/* Tasks */}
      <div className="p-3 flex-1 overflow-y-auto custom-scrollbar">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-textMain">Tasks</h2>
          <button className="text-[10px] text-indigo-400 hover:text-indigo-300 transition-colors">View all</button>
        </div>

        <div className="space-y-2.5">
          {runs.slice(0, 5).map((run) => {
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
    </div>
  );
}
