import { useEffect } from 'react';
import { ChatView } from '../chat/ChatView';
import { CodeEditor } from '../workspace/CodeEditor';
import { FileManager } from '../workspace/FileManager';
import { MemoryPanel } from '../memory/MemoryPanel';
import { SettingsView } from '../views/SettingsView';
import { AgentsView } from '../views/AgentsView';
import { AutomationView } from '../views/AutomationView';
import { MultiAgentView } from '../views/MultiAgentView';
import { WorkspaceView } from '../views/WorkspaceView';
import { DeployView } from '../views/DeployView';
import { useSessionStore } from '../../stores/session';

interface MainViewProps {
  activeView: string;
  onViewChange: (view: string) => void;
}

export function MainView({ activeView, onViewChange }: MainViewProps) {
  const { restoreSession, setCurrentView, workspace } = useSessionStore();

  useEffect(() => {
    restoreSession();
  }, []);

  useEffect(() => {
    setCurrentView(activeView);
  }, [activeView]);

  const renderContent = () => {
    switch (activeView) {
      case 'chats':
        return <ChatView />;

      case 'code':
        return <div className="h-full overflow-hidden"><CodeEditor /></div>;

      case 'agents':
        return <AgentsView />;

      case 'automations':
        return <AutomationView />;

      case 'multi-agent':
        return <MultiAgentView />;

      case 'workspace':
        return <WorkspaceView />;

      case 'projects':
        return <ProjectsView />;

      case 'documents':
        return (
          <div className="flex-1 overflow-y-auto p-6 animate-fade-in">
            <h1 className="text-2xl font-bold mb-4 text-white">Documents</h1>
            <p className="text-gray-500 text-sm mb-6">Your files and documents.</p>
            <div className="bg-[#1a1a1f] border border-white/[0.06] rounded-xl p-4" style={{ height: 'calc(100vh - 200px)' }}>
              <FileManager />
            </div>
          </div>
        );

      case 'memory':
        return <MemoryPanel onClose={() => onViewChange('chats')} />;

      case 'deploy':
        return <DeployView />;

      case 'settings':
        return <SettingsView />;

      default:
        return <ChatView />;
    }
  };

  return (
    <div className="flex flex-col h-full overflow-hidden animate-fade-in">
      {renderContent()}
    </div>
  );
}

function ProjectsView() {
  return (
    <div className="flex-1 overflow-y-auto p-6 animate-fade-in">
      <h1 className="text-2xl font-bold mb-4 text-white">Projects</h1>
      <p className="text-gray-500 text-sm mb-6">Manage your projects and deployments.</p>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {[
          { name: 'SaaS Dashboard', status: 'Deployed', color: 'from-green-500 to-emerald-500', icon: 'M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z' },
          { name: 'E-commerce Platform', status: 'In Progress', color: 'from-amber-500 to-orange-500', icon: 'M2.25 3h1.386c.51 0 .955.343 1.087.835l.383 1.437M7.5 14.25a3 3 0 00-3 3h15.75m-12.75-3h11.218c1.121-2.3 2.1-4.684 2.924-7.138a60.114 60.114 0 00-16.536-1.84M7.5 14.25L5.106 5.272M6 20.25a.75.75 0 11-1.5 0 .75.75 0 011.5 0zm12.75 0a.75.75 0 11-1.5 0 .75.75 0 011.5 0z' },
          { name: 'Marketing Site', status: 'Draft', color: 'from-purple-500 to-pink-500', icon: 'M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 017.843 4.582M12 3a8.997 8.997 0 00-7.843 4.582m15.686 0A11.953 11.953 0 0112 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0121 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0112 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 013 12c0-1.605.42-3.113 1.157-4.418' },
        ].map((project, i) => (
          <div key={i} className="bg-[#1a1a1f] border border-white/[0.06] rounded-xl p-4 hover:border-white/[0.1] cursor-pointer transition-all">
            <div className="flex items-center gap-3 mb-3">
              <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${project.color} flex items-center justify-center shadow-lg`}>
                <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d={project.icon} /></svg>
              </div>
              <div className="flex-1">
                <div className="font-medium text-white">{project.name}</div>
              </div>
            </div>
            <div className="flex items-center justify-between">
              <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${project.status === 'Deployed' ? 'bg-green-500/15 text-green-400' : project.status === 'In Progress' ? 'bg-amber-500/15 text-amber-400' : 'bg-gray-500/15 text-gray-400'}`}>{project.status}</span>
              <span className="text-[10px] text-gray-600">Updated 2h ago</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
