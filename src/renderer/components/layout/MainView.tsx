import { useEffect, lazy, Suspense } from 'react';
import { ChatView } from '../chat/ChatView';
import { useSessionStore } from '../../stores/session';
import { useAiTabsStore, type AiWorkspaceTab } from '../../stores/aiTabs';
import { useChatStore } from '../../stores/chat';
import { DynamicTabView } from './DynamicTabView';

// Lazy-load heavy views that aren't needed on initial load
const FileManager = lazy(() => import('../workspace/FileManager').then(m => ({ default: m.FileManager })));
const MemoryPanel = lazy(() => import('../memory/MemoryPanel').then(m => ({ default: m.MemoryPanel })));
const SettingsView = lazy(() => import('../views/SettingsView').then(m => ({ default: m.SettingsView })));
const AgentsView = lazy(() => import('../views/AgentsView').then(m => ({ default: m.AgentsView })));
const AutomationView = lazy(() => import('../views/AutomationView').then(m => ({ default: m.AutomationView })));
const WorkspaceView = lazy(() => import('../views/WorkspaceView').then(m => ({ default: m.WorkspaceView })));
const InfiniteCanvas = lazy(() => import('../workspace/InfiniteCanvas').then(m => ({ default: m.InfiniteCanvas })));
const ActivityTrackerView = lazy(() => import('../views/ActivityTrackerView').then(m => ({ default: m.ActivityTrackerView })));
const AppBuilderView = lazy(() => import('../views/AppBuilderView').then(m => ({ default: m.AppBuilderView })));
const ProjectsView = lazy(() => import('../views/ProjectsView').then(m => ({ default: m.ProjectsView })));
const BrowserControlView = lazy(() => import('../views/BrowserControlView').then(m => ({ default: m.BrowserControlView })));
const BusinessOSView = lazy(() => import('../views/BusinessOSView').then(m => ({ default: m.BusinessOSView })));
const CallCenterView = lazy(() => import('../views/CallCenterView').then(m => ({ default: m.CallCenterView })));
const CloudSyncView = lazy(() => import('../views/CloudSyncView').then(m => ({ default: m.CloudSyncView })));
const ComputerControlView = lazy(() => import('../views/ComputerControlView').then(m => ({ default: m.ComputerControlView })));
const DeployView = lazy(() => import('../views/DeployView').then(m => ({ default: m.DeployView })));
const EnterpriseView = lazy(() => import('../views/EnterpriseView').then(m => ({ default: m.EnterpriseView })));
const KnowledgeView = lazy(() => import('../views/KnowledgeView').then(m => ({ default: m.KnowledgeView })));
const MultiAgentView = lazy(() => import('../views/MultiAgentView').then(m => ({ default: m.MultiAgentView })));
const OSHomeView = lazy(() => import('../views/OSHomeView').then(m => ({ default: m.OSHomeView })));
const PluginStoreView = lazy(() => import('../views/PluginStoreView').then(m => ({ default: m.PluginStoreView })));
const TaskReplayView = lazy(() => import('../views/TaskReplayView').then(m => ({ default: m.TaskReplayView })));
const TestView = lazy(() => import('../views/TestView').then(m => ({ default: m.TestView })));
const VideoView = lazy(() => import('../views/VideoView').then(m => ({ default: m.VideoView })));
const VoiceView = lazy(() => import('../views/VoiceView').then(m => ({ default: m.VoiceView })));
const WebsiteBuilderView = lazy(() => import('../views/WebsiteBuilderView').then(m => ({ default: m.WebsiteBuilderView })));
const YouTubeLearningView = lazy(() => import('../views/YouTubeLearningView').then(m => ({ default: m.YouTubeLearningView })));
const StandingOrdersView = lazy(() => import('../views/StandingOrdersView').then(m => ({ default: m.StandingOrdersView })));
const ActiveMemoryView = lazy(() => import('../views/ActiveMemoryView').then(m => ({ default: m.ActiveMemoryView })));

interface MainViewProps {
  activeView: string;
  onViewChange: (view: string) => void;
  onOpenDeploy: () => void;
}

export function MainView({ activeView, onViewChange, onOpenDeploy }: MainViewProps) {
  const { restoreSession, setCurrentView } = useSessionStore();
  const aiTabs = useAiTabsStore((state) => state.tabs);
  const activeAiTab = aiTabs.find((tab) => tab.id === activeView);

  useEffect(() => {
    restoreSession();
  }, [restoreSession]);

  useEffect(() => {
    setCurrentView(activeView);
  }, [activeView, setCurrentView]);

  const renderContent = () => {
    if (activeAiTab) return <DynamicTabView tab={activeAiTab} onViewChange={onViewChange} />;

    switch (activeView) {
      case 'home':
        return <OSHomeView onOpenView={onViewChange} />;
      case 'chats':
        return <ChatView onViewChange={onViewChange} onOpenDeploy={onOpenDeploy} />;
      case 'agents':
        return <AgentsView />;
      case 'projects':
        return <ProjectsView onOpenWorkspace={() => onViewChange('workspace')} />;
      case 'documents':
        return (
          <div className="flex-1 overflow-hidden p-6 animate-fade-in flex flex-col">
            <h1 className="text-2xl font-bold mb-1 text-white">Infinite OS Explorer</h1>
            <p className="text-gray-500 text-sm mb-5">Browse, organize, open, and edit files without leaving Infinite OS.</p>
            <div
              className="min-h-0 flex-1 bg-[#1a1a1f] border border-white/[0.06] rounded-xl overflow-hidden"
            >
              <FileManager />
            </div>
          </div>
        );
      case 'automations':
        return <AutomationView />;
      case 'memory':
        return <MemoryPanel onClose={() => onViewChange('chats')} />;
      case 'workspace':
        return <WorkspaceView />;
      case 'canvas':
        return <InfiniteCanvas />;
      case 'learning':
      case 'knowledge':
        return <KnowledgeView />;
      case 'youtube-learning':
        return <YouTubeLearningView />;
      case 'browser':
        return <BrowserControlView />;
      case 'computer':
        return <ComputerControlView />;
      case 'research':
        return <ChatView onViewChange={onViewChange} onOpenDeploy={onOpenDeploy} />;
      case 'activity':
        return <ActivityTrackerView />;
      case 'multi-agent':
        return <MultiAgentView />;
      case 'cloud':
        return <CloudSyncView />;
      case 'business':
        return <BusinessOSView />;
      case 'callcenter':
        return <CallCenterView />;
      case 'plugins':
        return <PluginStoreView />;
      case 'app-builder':
        return <AppBuilderView />;
      case 'website-builder':
        return <WebsiteBuilderView />;
      case 'deploy':
        return <DeployView />;
      case 'testing':
        return <TestView />;
      case 'video':
        return <VideoView />;
      case 'voice':
        return <VoiceView />;
      case 'replay':
        return <TaskReplayView />;
      case 'standing-orders':
        return <StandingOrdersView />;
      case 'active-memory':
        return <ActiveMemoryView />;
      case 'enterprise':
        return <EnterpriseView />;
      case 'settings':
        return <SettingsView />;
      default:
        return <OSHomeView onOpenView={onViewChange} />;
    }
  };

  return <div className="flex flex-col h-full overflow-hidden animate-fade-in"><Suspense fallback={<div className="flex-1 flex items-center justify-center text-zinc-500 text-sm">Loading...</div>}>{renderContent()}</Suspense></div>;
}

function AiWorkspaceView({ tab, onViewChange }: { tab: AiWorkspaceTab; onViewChange: (view: string) => void }) {
  const sendMessage = useChatStore((state) => state.sendMessage);

  const continueInChat = (prompt: string) => {
    onViewChange('chats');
    void sendMessage(prompt);
  };

  const actions =
    tab.kind === 'feature'
      ? [
          {
            label: 'Build Feature',
            prompt: `Implement this Infinite OS feature now: ${tab.prompt}. Inspect the source code, edit files, create any required components or side tabs, run validation, and report changed files.`,
          },
          {
            label: 'Plan Changes',
            prompt: `Create a concise implementation plan for this Infinite OS feature before editing: ${tab.prompt}`,
          },
        ]
      : tab.kind === 'business'
        ? [
            { label: 'Expand Summary', prompt: `Turn this into a complete business summary with actions: ${tab.prompt}` },
            { label: 'Create Tasks', prompt: `Create a practical execution checklist from this business summary: ${tab.prompt}` },
          ]
        : tab.kind === 'research'
          ? [
              { label: 'Research Now', prompt: `Research this deeply and cite useful sources: ${tab.prompt}` },
              { label: 'Recommend Next', prompt: `Compare the options and recommend the best next move for: ${tab.prompt}` },
            ]
          : tab.kind === 'lesson'
            ? [
                { label: 'Teach Now', prompt: `Teach me this clearly with examples, an analogy, and a mini quiz: ${tab.prompt}` },
                { label: 'Quiz Me', prompt: `Quiz me one question at a time on: ${tab.prompt}` },
              ]
        : [
            { label: 'Generate Now', prompt: `Generate the ${tab.kind} for: ${tab.prompt}` },
            { label: 'Make Harder', prompt: `Make this ${tab.kind} more advanced and include answers: ${tab.prompt}` },
          ];

  return (
    <div className="flex h-full min-h-0 bg-[#080a10]">
      <section className="flex-1 min-w-0 overflow-y-auto chat-scrollbar px-10 py-8">
        <div className="max-w-4xl">
          <div className="mb-6 flex items-start justify-between gap-4">
            <div>
              <div className="text-[10px] uppercase tracking-[0.18em] text-cyan-400/70">AI Workspace</div>
              <h1 className="mt-2 text-2xl font-semibold text-zinc-100 tracking-[-0.02em]">{tab.title}</h1>
              <p className="mt-2 max-w-2xl text-sm text-zinc-500">{tab.prompt}</p>
            </div>
            <button
              onClick={() => onViewChange('chats')}
              className="h-8 rounded-lg border border-white/[0.07] bg-white/[0.025] px-3 text-[10px] text-zinc-400 hover:text-zinc-100"
            >
              Back to Chat
            </button>
          </div>

          <div className="rounded-xl border border-white/[0.07] bg-[#0c1018] p-5 shadow-[0_16px_44px_rgba(0,0,0,.22)]">
            <pre className="whitespace-pre-wrap font-sans text-sm leading-7 text-zinc-300">{tab.content}</pre>
          </div>
        </div>
      </section>

      <aside className="hidden lg:flex w-[310px] shrink-0 flex-col border-l border-white/[0.06] bg-[#0b0d14] p-4">
        <div className="rounded-xl border border-cyan-400/15 bg-cyan-400/[0.035] p-4">
          <div className="text-[10px] uppercase tracking-[0.16em] text-cyan-300/80">Chat Driver</div>
          <p className="mt-2 text-xs leading-5 text-zinc-400">
            Use chat to fill this tab, edit Infinite OS source code, add new functionality, or create more side workspaces.
          </p>
        </div>
        <div className="mt-4 space-y-2">
          {actions.map((action) => (
            <button
              key={action.label}
              onClick={() => continueInChat(action.prompt)}
              className="w-full rounded-lg border border-white/[0.07] bg-white/[0.025] px-3 py-2.5 text-left text-xs text-zinc-400 hover:border-cyan-400/25 hover:text-zinc-100 hover:bg-cyan-400/[0.035]"
            >
              {action.label}
            </button>
          ))}
        </div>
        <button
          onClick={() =>
            continueInChat(
              `Create another side tab related to this workspace. Current tab: ${tab.title}. Original request: ${tab.prompt}`,
            )
          }
          className="mt-auto rounded-lg border border-white/[0.07] bg-white/[0.025] px-3 py-2.5 text-xs text-zinc-400 hover:text-zinc-100"
        >
          Create Related Tab
        </button>
      </aside>
    </div>
  );
}
