import { useEffect, useState } from 'react';
import { useAgentsStore } from '../../stores/agents';

export function AgentsView() {
  const { types, runs, init, spawn } = useAgentsStore();
  const [taskInput, setTaskInput] = useState('');
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);

  useEffect(() => {
    init();
  }, [init]);

  const handleSpawn = async (id: string) => {
    if (!taskInput.trim()) {
      alert('Please enter a task before spawning the agent.');
      return;
    }
    const run = await spawn(id, taskInput);
    if (run) {
      setTaskInput('');
      setSelectedAgent(null);
    } else {
      alert('Could not spawn agent. Do you have an active chat session?');
    }
  };

  return (
    <div className="flex-1 overflow-y-auto p-6 animate-fade-in custom-scrollbar">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold mb-1 text-textMain">Agent Fleet</h1>
          <p className="text-textMuted text-sm">Autonomous subagents ready to execute specialized tasks.</p>
        </div>
        <button 
          onClick={() => alert('Create Agent Modal coming soon!')}
          className="btn-premium flex items-center gap-2"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>
          Custom Agent
        </button>
      </div>

      <div className="mb-8">
        <h2 className="text-lg font-semibold mb-4 text-textMain">Available Agents</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {types.map((agent) => (
            <div key={agent.id} className="card-premium hover-lift flex flex-col justify-between">
              <div>
                <div className="flex items-center gap-3 mb-3">
                  <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${agent.color || 'from-indigo-500 to-purple-500'} flex items-center justify-center shadow-lg`}>
                    {agent.icon ? (
                      <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d={agent.icon} />
                      </svg>
                    ) : (
                      <div className="text-white font-bold text-lg">{agent.name.charAt(0)}</div>
                    )}
                  </div>
                  <div>
                    <div className="font-medium text-textMain">{agent.name}</div>
                    <div className="text-[10px] uppercase font-bold tracking-wider text-indigo-400 bg-indigo-400/10 px-1.5 py-0.5 rounded w-max mt-1">
                      {agent.id}
                    </div>
                  </div>
                </div>
                <div className="text-sm text-textMuted mb-4 line-clamp-2 min-h-[40px]">{agent.description}</div>
              </div>
              
              <div className="mt-auto">
                {selectedAgent === agent.id ? (
                  <div className="animate-scale-in">
                    <input 
                      type="text" 
                      placeholder="What should this agent do?" 
                      className="input-premium w-full mb-2 text-xs"
                      value={taskInput}
                      onChange={(e) => setTaskInput(e.target.value)}
                      onKeyDown={(e) => { if(e.key === 'Enter') handleSpawn(agent.id) }}
                      autoFocus
                    />
                    <div className="flex gap-2">
                      <button onClick={() => setSelectedAgent(null)} className="px-3 py-1.5 text-xs text-textMuted hover:text-textMain w-1/3">Cancel</button>
                      <button onClick={() => handleSpawn(agent.id)} className="btn-premium text-xs flex-1">Start Task</button>
                    </div>
                  </div>
                ) : (
                  <button onClick={() => setSelectedAgent(agent.id)} className="w-full px-4 py-2 rounded-lg bg-bgInput border border-borderSubtle text-sm font-medium text-textMain hover:border-indigo-500/30 transition-all">
                    Assign Task
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div>
        <h2 className="text-lg font-semibold mb-4 text-textMain">Active & Recent Runs</h2>
        {runs.length === 0 ? (
          <div className="text-center py-10 bg-bgPanel border border-borderSubtle rounded-2xl">
            <p className="text-textMuted">No active or recent agent runs.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {runs.map(run => (
              <div key={run.id} className="bg-bgPanel border border-borderSubtle rounded-xl p-4 flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-medium text-textMain text-sm">{types.find(t => t.id === run.agentId)?.name || run.agentId}</span>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full uppercase font-bold tracking-wider ${
                      run.status === 'running' ? 'bg-indigo-500/15 text-indigo-400 animate-pulse' :
                      run.status === 'completed' ? 'bg-green-500/15 text-green-400' :
                      run.status === 'failed' ? 'bg-red-500/15 text-red-400' :
                      'bg-gray-500/15 text-gray-400'
                    }`}>
                      {run.status}
                    </span>
                  </div>
                  <div className="text-xs text-textMuted max-w-2xl truncate">{run.task}</div>
                </div>
                <div className="text-right flex flex-col items-end">
                  <div className="text-xs font-medium text-textMain">{run.toolCallCount} Tool Calls</div>
                  <div className="text-[10px] text-textMuted">{new Date(run.startedAt).toLocaleTimeString()}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
