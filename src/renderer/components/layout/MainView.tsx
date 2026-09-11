import { useEffect, lazy, Suspense } from 'react';
import { ChatView } from '../chat/ChatView';
import { useSessionStore } from '../../stores/session';
import { useAiTabsStore } from '../../stores/aiTabs';
import { DynamicTabView } from './DynamicTabView';

// Lazy-load — 2026-09-01 v3: homepage removed, 6 X'd modules removed from bundle, side moved items as nav
// REMOVED from bundle: AgentsView, InfiniteCanvas, BusinessOSView, KnowledgeView, YouTubeLearningView, MultiAgentView, OSHomeView
// KEPT/MOVED to side: StandingOrdersView, ActiveMemoryView, PluginStoreView, CapabilitiesView (Tools & Skills)
// Routines scratched per latest image → removed; files kept on disk + .backups for restore
const FileManager = lazy(() => import('../workspace/FileManager').then(m => ({ default: m.FileManager })));
const MemoryPanel = lazy(() => import('../memory/MemoryPanel').then(m => ({ default: m.MemoryPanel })));
const SettingsView = lazy(() => import('../views/SettingsView').then(m => ({ default: m.SettingsView })));
const AutomationView = lazy(() => import('../views/AutomationView').then(m => ({ default: m.AutomationView })));
const WorkspaceView = lazy(() => import('../views/WorkspaceView').then(m => ({ default: m.WorkspaceView })));
const ActivityTrackerView = lazy(() => import('../views/ActivityTrackerView').then(m => ({ default: m.ActivityTrackerView })));
const AppBuilderView = lazy(() => import('../views/AppBuilderView').then(m => ({ default: m.AppBuilderView })));
const ProjectsView = lazy(() => import('../views/ProjectsView').then(m => ({ default: m.ProjectsView })));
const BrowserControlView = lazy(() => import('../views/BrowserControlView').then(m => ({ default: m.BrowserControlView })));
const CallCenterView = lazy(() => import('../views/CallCenterView').then(m => ({ default: m.CallCenterView })));
const CloudSyncView = lazy(() => import('../views/CloudSyncView').then(m => ({ default: m.CloudSyncView })));
const ComputerControlView = lazy(() => import('../views/ComputerControlView').then(m => ({ default: m.ComputerControlView })));
const DeployView = lazy(() => import('../views/DeployView').then(m => ({ default: m.DeployView })));
const EnterpriseView = lazy(() => import('../views/EnterpriseView').then(m => ({ default: m.EnterpriseView })));
const PluginStoreView = lazy(() => import('../views/PluginStoreView').then(m => ({ default: m.PluginStoreView })));
const TaskReplayView = lazy(() => import('../views/TaskReplayView').then(m => ({ default: m.TaskReplayView })));
const TestView = lazy(() => import('../views/TestView').then(m => ({ default: m.TestView })));
const VideoView = lazy(() => import('../views/VideoView').then(m => ({ default: m.VideoView })));
const VoiceView = lazy(() => import('../views/VoiceView').then(m => ({ default: m.VoiceView })));
const WebsiteBuilderView = lazy(() => import('../views/WebsiteBuilderView').then(m => ({ default: m.WebsiteBuilderView })));
const StandingOrdersView = lazy(() => import('../views/StandingOrdersView').then(m => ({ default: m.StandingOrdersView })));
const ActiveMemoryView = lazy(() => import('../views/ActiveMemoryView').then(m => ({ default: m.ActiveMemoryView })));
const CapabilitiesView = lazy(() => import('../views/CapabilitiesView').then(m => ({ default: m.CapabilitiesView })));
const BotsView = lazy(() => import('../views/BotsView').then(m => ({ default: m.BotsView })));
const ArtifactsView = lazy(() => import('../views/ArtifactsView').then(m => ({ default: m.ArtifactsView })));
const MessagingView = lazy(() => import('../views/MessagingView').then(m => ({ default: m.MessagingView })));
const CanvasBoard = lazy(() => import('../workspace/InfiniteCanvas').then(m => ({ default: m.InfiniteCanvas })));
const TerminalView = lazy(() => import('../views/TerminalView').then(m => ({ default: m.TerminalView })));
const PowerCenterView = lazy(() => import('../views/PowerCenterView').then(m => ({ default: m.PowerCenterView })));
const CreationsView = lazy(() => import('../views/CreationsView').then(m => ({ default: m.CreationsView })));
const BusinessOSView = lazy(() => import('../views/BusinessOSView').then(m => ({ default: m.BusinessOSView })));
const KnowledgeView = lazy(() => import('../views/KnowledgeView').then(m => ({ default: m.KnowledgeView })));

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
        return <PowerCenterView onViewChange={onViewChange} onOpenDeploy={onOpenDeploy} />;
      case 'chats':
        return <ChatView onViewChange={onViewChange} onOpenDeploy={onOpenDeploy} />;
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
      case 'browser':
        return <BrowserControlView />;
      case 'computer':
        return <ComputerControlView />;
      case 'research':
        return <ChatView onViewChange={onViewChange} onOpenDeploy={onOpenDeploy} />;
      case 'activity':
        return <ActivityTrackerView />;
      case 'cloud':
        return <CloudSyncView />;
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
      case 'business':
        return <BusinessOSView />;
      case 'knowledge':
        return <KnowledgeView />;
      case 'creations':
        return <CreationsView />;
      case 'capabilities':
        return <CapabilitiesView />;
      case 'bots':
        return <BotsView onViewChange={onViewChange} />;
      case 'artifacts':
        return <ArtifactsView onOpenTab={onViewChange} />;
      case 'messaging':
        return <MessagingView />;
      case 'canvas':
        return <CanvasBoard />;
      case 'terminal':
        return <TerminalView />;
      case 'settings':
        return <SettingsView />;
      default:
        return <ChatView onViewChange={onViewChange} onOpenDeploy={onOpenDeploy} />;
    }
  };

  return <div className="flex flex-col h-full overflow-hidden animate-fade-in"><Suspense fallback={<div className="flex-1 flex items-center justify-center text-zinc-500 text-sm">Loading...</div>}>{renderContent()}</Suspense></div>;
}

