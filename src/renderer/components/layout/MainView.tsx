import { useEffect, lazy, Suspense } from 'react';
import { ChatView } from '../chat/ChatView';
import { useSessionStore } from '../../stores/session';
import { useAiTabsStore } from '../../stores/aiTabs';
import { useUiTheme } from '../../theme/uiTheme';
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
// Classic (original-look) variant kept for Home only. Automations + Plugin Marketplace
// now always use the modern UI blended into classic (per user request).
const OSHomeViewClassic = lazy(() => import('../views/OSHomeViewClassic').then(m => ({ default: m.OSHomeView })));
const TaskReplayView = lazy(() => import('../views/TaskReplayView').then(m => ({ default: m.TaskReplayView })));
const TestView = lazy(() => import('../views/TestView').then(m => ({ default: m.TestView })));
const VideoView = lazy(() => import('../views/VideoView').then(m => ({ default: m.VideoView })));
const VoiceView = lazy(() => import('../views/VoiceView').then(m => ({ default: m.VoiceView })));
const WebsiteBuilderView = lazy(() => import('../views/WebsiteBuilderView').then(m => ({ default: m.WebsiteBuilderView })));
const YouTubeLearningView = lazy(() => import('../views/YouTubeLearningView').then(m => ({ default: m.YouTubeLearningView })));
const StandingOrdersView = lazy(() => import('../views/StandingOrdersView').then(m => ({ default: m.StandingOrdersView })));
const ActiveMemoryView = lazy(() => import('../views/ActiveMemoryView').then(m => ({ default: m.ActiveMemoryView })));
const CapabilitiesView = lazy(() => import('../views/CapabilitiesView').then(m => ({ default: m.CapabilitiesView })));

interface MainViewProps {
  activeView: string;
  onViewChange: (view: string) => void;
  onOpenDeploy: () => void;
}

export function MainView({ activeView, onViewChange, onOpenDeploy }: MainViewProps) {
  const { restoreSession, setCurrentView } = useSessionStore();
  const aiTabs = useAiTabsStore((state) => state.tabs);
  const uiTheme = useUiTheme((s) => s.theme);
  const classic = uiTheme === 'classic';
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
        return classic ? <OSHomeViewClassic onOpenView={onViewChange} /> : <OSHomeView onOpenView={onViewChange} />;
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
        // Original Infinite OS look: always use the modern Automations UI
        // blended into classic via CSS variables — replaces the classic variant.
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
        // Original Infinite OS look: modern Plugin Marketplace blended to classic
        // palette — replaces the classic variant as requested.
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
      case 'capabilities':
        return <CapabilitiesView />;
      case 'settings':
        return <SettingsView />;
      default:
        return <OSHomeView onOpenView={onViewChange} />;
    }
  };

  return <div className="flex flex-col h-full overflow-hidden animate-fade-in"><Suspense fallback={<div className="flex-1 flex items-center justify-center text-zinc-500 text-sm">Loading...</div>}>{renderContent()}</Suspense></div>;
}

