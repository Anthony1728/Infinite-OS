import { useState } from 'react';
import { VoiceIndicator } from '../voice/VoiceIndicator';

export function AgentDock() {
  const [agents] = useState([
    { id: '1', name: 'Code Agent', status: 'idle', color: 'bg-blue-500' },
    { id: '2', name: 'File Watcher', status: 'active', color: 'bg-green-500' },
  ]);

  return (
    <div className="h-12 border-t border-borderSubtle bg-bgPanel/20 flex items-center justify-between px-5 flex-shrink-0">
      <div className="flex items-center gap-4">
        {agents.map((agent) => (
          <div key={agent.id} className="flex items-center gap-2 px-2 py-1 bg-bgMain rounded border border-borderSubtle">
            <div className={`w-2 h-2 rounded-full ${agent.color} ${agent.status === 'active' ? 'animate-pulse' : ''}`} />
            <span className="text-[10px] text-textMain">{agent.name}</span>
          </div>
        ))}
      </div>
      
      <div className="flex items-center gap-4">
        <VoiceIndicator />
      </div>
    </div>
  );
}

