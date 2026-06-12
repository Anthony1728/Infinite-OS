import { useState } from 'react';
import { ChatView } from '../chat/ChatView';
import { InfiniteCanvas } from '../workspace/InfiniteCanvas';
import { CodeEditor } from '../workspace/CodeEditor';
import { FileManager } from '../workspace/FileManager';
import { MemoryPanel } from '../memory/MemoryPanel';
import { BrowserControlView } from '../views/BrowserControlView';

import { AutomationView } from '../views/AutomationView';
import { WebsiteBuilderView } from '../views/WebsiteBuilderView';
import { AppBuilderView } from '../views/AppBuilderView';
import { BusinessOSView } from '../views/BusinessOSView';
import { PluginStoreView } from '../views/PluginStoreView';
import { CloudSyncView } from '../views/CloudSyncView';
import { MultiAgentView } from '../views/MultiAgentView';
import { WorkspaceView } from '../views/WorkspaceView';
import { OSHomeView } from '../views/OSHomeView';


const TABS = [
  { id: 'chat', label: 'AI Chat', icon: 'M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 01.865-.501c1.153-.086 2.294-.213 3.423-.379 1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z' },
  { id: 'canvas', label: 'Infinite Canvas', icon: 'M2.25 7.125C2.25 6.504 2.754 6 3.375 6h6c.621 0 1.125.504 1.125 1.125v3.75c0 .621-.504 1.125-1.125 1.125h-6a1.125 1.125 0 01-1.125-1.125v-3.75zM14.25 8.625c0-.621.504-1.125 1.125-1.125h5.25c.621 0 1.125.504 1.125 1.125v8.25c0 .621-.504 1.125-1.125 1.125h-5.25a1.125 1.125 0 01-1.125-1.125v-8.25zM3.75 16.125c0-.621.504-1.125 1.125-1.125h5.25c.621 0 1.125.504 1.125 1.125v2.25c0 .621-.504 1.125-1.125 1.125h-5.25a1.125 1.125 0 01-1.125-1.125v-2.25z' },
  { id: 'code', label: 'Code', icon: 'M17.25 6.75L22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3l-4.5 16.5' },
  { id: 'analyze', label: 'Analyze', icon: 'M3.75 3v11.25A2.25 2.25 0 006 16.5h2.25M3.75 3h-1.5m1.5 0h16.5m0 0h1.5m-1.5 0v11.25A2.25 2.25 0 0118 16.5h-2.25m-7.5 0h7.5m-7.5 0l-1 3m8.5-3l1 3m0 0l.5 1.5m-.5-1.5h-9.5m0 0l-.5 1.5m.75-9l3-3 2.148 2.148A12.061 12.061 0 0116.5 7.605' },
  { id: 'automate', label: 'Automate', icon: 'M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z M15 12a3 3 0 11-6 0 3 3 0 016 0z' },
  { id: 'research', label: 'Research', icon: 'M12 18v-5.25m0 0a6.01 6.01 0 001.5-.189m-1.5.189a6.01 6.01 0 01-1.5-.189m3.75 7.478a12.06 12.06 0 01-4.5 0m3.75 2.383a14.406 14.406 0 01-3 0M14.25 18v-.192c0-.983.658-1.823 1.508-2.316a7.5 7.5 0 10-7.517 0c.85.493 1.509 1.333 1.509 2.316V18' },
  { id: 'design', label: 'Design', icon: 'M9.53 16.122a3 3 0 00-5.78 1.128 2.25 2.25 0 01-2.4 2.245 4.5 4.5 0 008.4-2.245c0-.399-.078-.78-.22-1.128zm0 0a15.998 15.998 0 003.388-1.62m-5.043-.025a15.994 15.994 0 011.622-3.395m3.42 3.42a15.995 15.995 0 004.764-4.648l3.876-5.814a1.151 1.151 0 00-1.597-1.597L14.146 6.32a15.996 15.996 0 00-4.649 4.763m3.42 3.42a6.776 6.776 0 00-3.42-3.42' },
];

interface MainViewProps {
  activeView: string;
  onViewChange: (view: string) => void;
}

export function MainView({ activeView, onViewChange }: MainViewProps) {
  const [tab, setTab] = useState('chat');

  const renderContent = () => {
    switch (activeView) {
      case 'home':
        return <OSHomeView onOpenView={onViewChange} />;

      case 'chats':
        return (
          <div className="flex flex-col h-full overflow-hidden">
            {/* Header */}
            <div className="px-5 pt-4 pb-3 flex-shrink-0">
              <h1 className="text-xl font-bold text-textMain mb-0.5">Good morning, Alex</h1>
              <p className="text-textMuted text-xs">InfiniteAI OS is ready to build, analyze and automate across your workspace.</p>
            </div>

            {/* Tabs */}
            <div className="px-5 pb-3 flex-shrink-0">
              <div className="flex gap-1 bg-bgPanel p-1 rounded-xl w-max border border-borderSubtle">
                {TABS.map((t) => (
                  <button key={t.id} onClick={() => setTab(t.id)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-all duration-200 ${tab === t.id ? 'bg-bgCard text-textMain border border-white/[0.04] shadow-sm' : 'text-textMuted hover:text-textMain hover:bg-white/[0.02]'}`}>
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d={t.icon} />
                    </svg>
                    {t.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Content */}
            <div className="flex-1 min-h-0 overflow-hidden">
              {tab === 'chat' && <ChatView />}
              {tab === 'canvas' && <div className="h-full overflow-y-auto px-5 pb-5 custom-scrollbar"><InfiniteCanvas /></div>}
              {tab === 'code' && <div className="h-full overflow-y-auto px-5 pb-5 custom-scrollbar"><CodeEditor /></div>}
              {tab === 'analyze' && <OperationalPanel title="Analysis Console" subtitle="Repository, project, and business signals" items={['Repository health', 'Project velocity', 'Customer trends', 'Knowledge gaps']} />}
              {tab === 'automate' && <div className="h-full overflow-y-auto px-5 pb-5 custom-scrollbar"><AutomationView /></div>}
              {tab === 'research' && <OperationalPanel title="Research Desk" subtitle="Tasks, sources, notes, and synthesis" items={['Market scan', 'Technical discovery', 'Competitor notes', 'Source brief']} />}
              {tab === 'design' && <OperationalPanel title="Creative Studio" subtitle="Writing, design, and campaign production" items={['Content drafts', 'Image prompts', 'Brand assets', 'Publishing queue']} />}
            </div>
          </div>
        );

      case 'agents':
        return <AgentsView />;

      case 'browser':
        return <BrowserControlView />;

case 'automations':
        return <AutomationView />;

      case 'website-builder':
        return <WebsiteBuilderView />;

      case 'app-builder':
        return <AppBuilderView />;

      case 'business':
        return <BusinessOSView />;

      case 'plugins':
        return <PluginStoreView />;

      case 'cloud':
        return <CloudSyncView />;

      case 'multi-agent':
        return <MultiAgentView />;

      case 'workspace':
        return <WorkspaceView />;

      case 'projects':
        return <ProjectsView />;

      case 'documents':
        return (
          <div className="flex-1 overflow-y-auto p-6 animate-fade-in">
            <h1 className="text-2xl font-bold mb-4 text-textMain">Documents</h1>
            <p className="text-textMuted text-sm mb-6">Your files and documents.</p>
            <div className="bg-bgCard border border-borderSubtle rounded-xl p-4" style={{ height: 'calc(100vh - 200px)' }}>
              <FileManager />
            </div>
          </div>
        );

      case 'memory':
        return <MemoryPanel onClose={() => onViewChange('chats')} />;

      case 'settings':
        return <SettingsView />;

      default:
        return (
          <div className="flex-1 flex items-center justify-center text-textMuted animate-fade-in">
            <div className="text-center">
              <div className="text-6xl mb-4 gradient-text font-bold">84</div>
              <div className="text-lg font-medium mb-1 text-textMain">AI Agents Ready</div>
              <div className="text-sm text-textMuted">Select a view from the sidebar to begin</div>
            </div>
          </div>
        );
    }
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {renderContent()}
    </div>
  );
}

function OperationalPanel({ title, subtitle, items }: { title: string; subtitle: string; items: string[] }) {
  return (
    <div className="h-full overflow-y-auto px-5 pb-5 custom-scrollbar">
      <div className="bg-bgPanel border border-borderSubtle rounded-2xl p-5">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h2 className="text-lg font-semibold text-textMain">{title}</h2>
            <p className="text-xs text-textMuted mt-1">{subtitle}</p>
          </div>
          <span className="px-2 py-1 rounded-full bg-green-500/15 text-green-400 text-[10px] font-medium">Ready</span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
          {items.map((item, index) => (
            <div key={item} className="bg-bgCard border border-borderSubtle rounded-xl p-4">
              <div className="w-9 h-9 rounded-lg bg-indigo-500/15 border border-indigo-500/20 flex items-center justify-center text-xs font-semibold text-indigo-400 mb-3">
                {index + 1}
              </div>
              <div className="font-medium text-textMain">{item}</div>
              <div className="text-xs text-textMuted mt-1">Active workspace signal</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function AgentsView() {
  return (
    <div className="flex-1 overflow-y-auto p-6 animate-fade-in">
      <h1 className="text-2xl font-bold mb-2 text-textMain">Agents</h1>
      <p className="text-textMuted text-sm mb-6">84 AI agents at your service.</p>
      <div className="grid grid-cols-3 gap-4">
        {[
          { name: 'Code Agent', desc: 'Writes and reviews code', color: 'from-green-500 to-emerald-500', icon: 'M17.25 6.75L22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3l-4.5 16.5' },
          { name: 'Research Agent', desc: 'Deep web research', color: 'from-blue-500 to-indigo-500', icon: 'M9.663 17h4.674M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z' },
          { name: 'Browser Agent', desc: 'Web automation', color: 'from-purple-500 to-pink-500', icon: 'M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 017.843 4.582M12 3a8.997 8.997 0 00-7.843 4.582' },
          { name: 'Desktop Agent', desc: 'Control your computer', color: 'from-amber-500 to-orange-500', icon: 'M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19.8 15.3M14.25 3.104c.251.023.501.05.75.082M19.8 15.3l-1.57.393A9.065 9.065 0 0112 15a9.065 9.065 0 00-6.23.693L5 14.5' },
          { name: 'Website Builder', desc: 'Build websites', color: 'from-pink-500 to-rose-500', icon: 'M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747' },
          { name: 'Business Agent', desc: 'Manage your business', color: 'from-emerald-500 to-teal-500', icon: 'M20.25 14.15v4.25c0 1.094-.787 2.036-1.872 2.18-2.087.277-4.216.42-6.378.42s-4.291-.143-6.378-.42c-1.085-.144-1.872-1.086-1.872-2.18v-4.25m16.5 0a2.18 2.18 0 00.75-1.661V8.706c0-1.081-.768-2.015-1.837-2.175a48.114 48.114 0 00-3.413-.387m4.5 8.006c-.194.165-.42.295-.673.38A23.978 23.978 0 0112 15.75c-2.648 0-5.195-.429-7.577-1.22a2.016 2.016 0 01-.673-.38m0 0A2.18 2.18 0 013 12.489V8.706c0-1.081.768-2.015 1.837-2.175a48.111 48.111 0 013.413-.387m7.5 0V5.25A2.25 2.25 0 0013.5 3h-3a2.25 2.25 0 00-2.25 2.25v.894m7.5 0a48.667 48.667 0 00-7.5 0' },
        ].map((agent, i) => (
          <div key={i} className="card-premium cursor-pointer hover-lift">
            <div className="flex items-center gap-3">
              <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${agent.color} flex items-center justify-center shadow-lg`}>
                <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d={agent.icon} /></svg>
              </div>
              <div>
                <div className="font-medium text-textMain">{agent.name}</div>
                <div className="text-xs text-textMuted">{agent.desc}</div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ProjectsView() {
  return (
    <div className="flex-1 overflow-y-auto p-6 animate-fade-in">
      <h1 className="text-2xl font-bold mb-4 text-textMain">Projects</h1>
      <p className="text-textMuted text-sm mb-6">Manage your projects and deployments.</p>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {[
          { name: 'SaaS Dashboard', status: 'Deployed', color: 'from-green-500 to-emerald-500', icon: 'M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z' },
          { name: 'E-commerce Platform', status: 'In Progress', color: 'from-amber-500 to-orange-500', icon: 'M2.25 3h1.386c.51 0 .955.343 1.087.835l.383 1.437M7.5 14.25a3 3 0 00-3 3h15.75m-12.75-3h11.218c1.121-2.3 2.1-4.684 2.924-7.138a60.114 60.114 0 00-16.536-1.84M7.5 14.25L5.106 5.272M6 20.25a.75.75 0 11-1.5 0 .75.75 0 011.5 0zm12.75 0a.75.75 0 11-1.5 0 .75.75 0 011.5 0z' },
          { name: 'Marketing Site', status: 'Draft', color: 'from-purple-500 to-pink-500', icon: 'M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 017.843 4.582M12 3a8.997 8.997 0 00-7.843 4.582m15.686 0A11.953 11.953 0 0112 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0121 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0112 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 013 12c0-1.605.42-3.113 1.157-4.418' },
        ].map((project, i) => (
          <div key={i} className="card-premium hover-lift cursor-pointer">
            <div className="flex items-center gap-3 mb-3">
              <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${project.color} flex items-center justify-center shadow-lg`}>
                <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d={project.icon} /></svg>
              </div>
              <div className="flex-1">
                <div className="font-medium text-textMain">{project.name}</div>
              </div>
            </div>
            <div className="flex items-center justify-between">
              <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${project.status === 'Deployed' ? 'bg-green-500/15 text-green-400' : project.status === 'In Progress' ? 'bg-amber-500/15 text-amber-400' : 'bg-gray-500/15 text-gray-400'}`}>{project.status}</span>
              <span className="text-[10px] text-textMuted">Updated 2h ago</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function SettingsView() {
  return (
    <div className="flex-1 overflow-y-auto p-6 animate-fade-in">
      <h1 className="text-2xl font-bold mb-4 text-textMain">Settings</h1>
      <p className="text-textMuted text-sm mb-6">Configure your InfiniteAI OS experience.</p>
      <div className="space-y-4 max-w-2xl">
        {[
          { title: 'API Provider', desc: 'Choose your AI provider', options: ['OpenRouter', 'Ollama (Local)', 'OpenAI', 'Anthropic'] },
          { title: 'Default Model', desc: 'Select the default model for conversations', options: ['Llama 3.3 70B (Free)', 'Claude 3.5 Sonnet', 'GPT-4o', 'Gemini Pro'] },
          { title: 'Theme', desc: 'Choose your preferred theme', options: ['Dark', 'Light', 'System'] },
        ].map((setting, i) => (
          <div key={i} className="card-premium">
            <h3 className="font-medium mb-1 text-textMain">{setting.title}</h3>
            <p className="text-xs text-textMuted mb-3">{setting.desc}</p>
            <div className="flex gap-2">
              {setting.options.map((opt, j) => (
                <button key={j} className={`px-4 py-2 rounded-lg text-sm transition-all ${j === 0 ? 'bg-indigo-500/15 border border-indigo-500/30 text-textMain' : 'bg-bgInput border border-borderSubtle text-textMuted hover:text-textMain'}`}>{opt}</button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
