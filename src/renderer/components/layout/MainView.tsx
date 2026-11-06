import { useEffect, lazy, Suspense } from 'react';
import { useSessionStore } from '../../stores/session';
import { useAiTabsStore } from '../../stores/aiTabs';
import { DynamicTabView } from './DynamicTabView';

// ChatView was the only statically imported view — its ~1.5MB chunk was the
// whole startup cost. It's lazy like everything else now; App.tsx idle-
// prefetches it the same way it does the Terminal chunk.
const ChatView = lazy(() => import('../chat/ChatView').then(m => ({ default: m.ChatView })));

// Lazy-load — 2026-09-01 v3: homepage removed, 6 X'd modules removed from bundle, side moved items as nav
// REMOVED from bundle: AgentsView, InfiniteCanvas, BusinessOSView, KnowledgeView, YouTubeLearningView, MultiAgentView, OSHomeView
// KEPT/MOVED to side: StandingOrdersView, ActiveMemoryView, PluginStoreView, CapabilitiesView (Tools & Skills)
// Routines scratched per latest image → removed; files kept on disk + .backups for restore
const FileManager = lazy(() => import('../workspace/FileManager').then(m => ({ default: m.FileManager })));
const SettingsView = lazy(() => import('../views/SettingsView').then(m => ({ default: m.SettingsView })));
const AutomationView = lazy(() => import('../views/AutomationView').then(m => ({ default: m.AutomationView })));
// Workers: Warmwind-style autonomous tasks — step lists, Teaching mode, app catalog, vault.
const WorkersView = lazy(() => import('../views/WorkersView').then(m => ({ default: m.WorkersView })));
const WorkspaceView = lazy(() => import('../views/WorkspaceView').then(m => ({ default: m.WorkspaceView })));
const ActivityTrackerView = lazy(() => import('../views/ActivityTrackerView').then(m => ({ default: m.ActivityTrackerView })));
const AppBuilderView = lazy(() => import('../views/AppBuilderView').then(m => ({ default: m.AppBuilderView })));
const ProjectsView = lazy(() => import('../views/ProjectsView').then(m => ({ default: m.ProjectsView })));
// The real Kanban board over the project/task store. The Project tool wrote
// this data all along, but ProjectsView is a scaffolding generator, so nothing
// ever showed the board itself.
const BoardView = lazy(() => import('../views/BoardView'));
const ArchiveView = lazy(() => import('../views/ArchiveView').then(m => ({ default: m.ArchiveView })));
const BrowserControlView = lazy(() => import('../views/BrowserControlView').then(m => ({ default: m.BrowserControlView })));
const CallCenterView = lazy(() => import('../views/CallCenterView').then(m => ({ default: m.CallCenterView })));
const CloudSyncView = lazy(() => import('../views/CloudSyncView').then(m => ({ default: m.CloudSyncView })));
const DeployView = lazy(() => import('../views/DeployView').then(m => ({ default: m.DeployView })));
const EnterpriseView = lazy(() => import('../views/EnterpriseView').then(m => ({ default: m.EnterpriseView })));
const PluginStoreView = lazy(() => import('../views/PluginStoreView').then(m => ({ default: m.PluginStoreView })));
const TaskReplayView = lazy(() => import('../views/TaskReplayView').then(m => ({ default: m.TaskReplayView })));
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
const InfiniteGuideView = lazy(() => import('../views/InfiniteGuideView').then(m => ({ default: m.InfiniteGuideView })));
const InfiniteOverviewView = lazy(() => import('../views/InfiniteOverviewView').then(m => ({ default: m.InfiniteOverviewView })));
const InfiniteTabView = lazy(() => import('../views/InfiniteTabView').then(m => ({ default: m.InfiniteTabView })));
// Power Center = the Infinite tab surface (route: home | universe)
const SpellForgeView = lazy(() => import('../views/SpellForgeView').then(m => ({ default: m.SpellForgeView })));
const JournalView = lazy(() => import('../views/JournalView').then(m => ({ default: m.JournalView })));
const StudioView = lazy(() => import('../studio/StudioView').then(m => ({ default: m.StudioView })));
const PlannerView = lazy(() => import('../planner/PlannerView').then(m => ({ default: m.PlannerView })));
const PagesView = lazy(() => import('../pages/PagesView').then(m => ({ default: m.PagesView })));
// Otto-grade insights + connections surfaces.
const DashboardsView = lazy(() => import('../views/DashboardsView').then(m => ({ default: m.DashboardsView })));
const ConnectorsView = lazy(() => import('../views/ConnectorsView').then(m => ({ default: m.ConnectorsView })));

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

  // Listen for custom navigation events from child views.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (typeof detail === 'string') onViewChange(detail);
    };
    window.addEventListener('infinite:navigate', handler);
    return () => window.removeEventListener('infinite:navigate', handler);
  }, [onViewChange]);

  const renderContent = () => {
    if (activeAiTab) return <DynamicTabView tab={activeAiTab} onViewChange={onViewChange} />;

    switch (activeView) {
      case 'home':
        return <PowerCenterView onViewChange={onViewChange} onOpenDeploy={onOpenDeploy} />;
      case 'chats':
        return <ChatView onViewChange={onViewChange} onOpenDeploy={onOpenDeploy} />;
      case 'projects':
        return <ProjectsView onOpenWorkspace={() => onViewChange('workspace')} />;
      case 'board':
        return <BoardView />;
      case 'archive':
        return <ArchiveView />;
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
      case 'workers':
        return <WorkersView />;
      case 'memory':
      case 'active-memory':
        return <ActiveMemoryView />;
      case 'workspace':
        return <WorkspaceView />;
      case 'browser':
        return <BrowserControlView />;
      case 'computer':
        // The standalone PC Control page was removed; the capability lives in
        // the agent's hands plus the live-desktop strip inside Browser Control.
        return <BrowserControlView />;
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
      case 'video':
        return <VideoView />;
      case 'voice':
        return <VoiceView onViewChange={onViewChange} />;
      case 'replay':
        return <TaskReplayView />;
      case 'standing-orders':
        return <StandingOrdersView />;
      case 'enterprise':
        return <EnterpriseView />;
      case 'business':
        return <BusinessOSView />;
      case 'knowledge':
        return <KnowledgeView />;
      case 'guide':
        return <InfiniteGuideView onViewChange={onViewChange} />;
            case 'overview':
        return <InfiniteOverviewView onViewChange={onViewChange} />;
      case 'infinite':
        return <InfiniteTabView onViewChange={onViewChange} />;
      case 'universe':
        return <PowerCenterView onViewChange={onViewChange} onOpenDeploy={onOpenDeploy} />;
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
      case 'spell':
        return <SpellForgeView />;
      case 'journal':
        return <JournalView />;
      case 'studio':
        return <StudioView />;
      case 'planner':
        return <PlannerView />;
      case 'pages':
        return <PagesView />;
      case 'dashboards':
        return <DashboardsView onViewChange={onViewChange} />;
      case 'connectors':
        return <ConnectorsView onViewChange={onViewChange} />;
      default:
        return <ChatView onViewChange={onViewChange} onOpenDeploy={onOpenDeploy} />;
    }
  };

  return <div className="flex flex-col h-full overflow-hidden animate-fade-in"><Suspense fallback={<div className="flex-1 flex items-center justify-center text-zinc-500 text-sm">Loading...</div>}>{renderContent()}</Suspense></div>;
}

