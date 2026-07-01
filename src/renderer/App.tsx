import { useState, useEffect } from 'react';
import { useAuthStore } from './stores/auth';
import { useSessionStore } from './stores/session';
import { useAgentsStore } from './stores/agents';
import { LoginPage } from './components/auth/LoginPage';
import { RegisterPage } from './components/auth/RegisterPage';
import { OnboardingFlow } from './components/auth/OnboardingFlow';
import { TopBar } from './components/layout/TopBar';
import { Sidebar } from './components/layout/Sidebar';
import { RightPanel } from './components/layout/RightPanel';
import { MainView } from './components/layout/MainView';
import { CommandPalette } from './components/command/CommandPalette';
import { DeployModal } from './components/deploy/DeployModal';
import { SettingsModal } from './components/settings/SettingsModal';
import { PermissionDialog } from './components/permissions/PermissionDialog';
import { ToastContainer } from './components/notifications/ToastContainer';
import { InfiniteLogo } from './components/brand/InfiniteLogo';

type AuthView = 'login' | 'register';

function BriefLoading({ onComplete }: { onComplete: () => void }) {
  const [progress, setProgress] = useState(0);
  const [statusText, setStatusText] = useState('Restoring workspace…');

  useEffect(() => {
    const statusTexts = ['Restoring workspace…', 'Loading sessions…', 'Preparing AI engine…', 'Almost ready…'];

    const interval = setInterval(() => {
      setProgress((prev) => {
        const newProgress = prev + 4;
        if (newProgress >= 100) {
          clearInterval(interval);
          setTimeout(onComplete, 200);
          return 100;
        }
        // Update status text based on progress
        const textIndex = Math.min(Math.floor(newProgress / 25), statusTexts.length - 1);
        setStatusText(statusTexts[textIndex]);
        return newProgress;
      });
    }, 40);
    return () => clearInterval(interval);
  }, [onComplete]);

  return (
    <div
      className="min-h-screen bg-[#08080b] flex flex-col items-center justify-center animate-fade-in"
      role="status"
      aria-live="polite"
    >
      <div className="relative mb-7">
        <div className="absolute inset-3 rounded-full bg-indigo-500/10 blur-2xl" />
        <InfiniteLogo className="relative w-28 h-16" animated labelled />
      </div>
      <div className="text-zinc-400 text-[13px] font-medium mb-4 tracking-[0.01em]">{statusText}</div>
      <div className="w-52 h-1 bg-white/[0.06] rounded-full overflow-hidden ring-1 ring-white/[0.04]">
        <div
          className="h-full bg-gradient-to-r from-violet-500 via-cyan-400 to-pink-500 transition-[width] duration-200 ease-out rounded-full"
          style={{ width: `${progress}%` }}
        />
      </div>
    </div>
  );
}

export function App() {
  const { isAuthenticated, isNewUser } = useAuthStore();
  const { restoreSession } = useSessionStore();
  const [authView, setAuthView] = useState<AuthView>('login');
  const [showLoading, setShowLoading] = useState(false);
  const [appReady, setAppReady] = useState(false);
  const [activeView, setActiveView] = useState('chats');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [rightPanelOpen, setRightPanelOpen] = useState(true);
  const [commandOpen, setCommandOpen] = useState(false);
  const [deployOpen, setDeployOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Handle loading completion
  const handleLoadingComplete = () => {
    restoreSession();
    setShowLoading(false);
    setAppReady(true);
  };

  // Initialize agents store on mount
  useEffect(() => {
    useAgentsStore.getState().init();
  }, []);

  // Show brief loading for returning users
  useEffect(() => {
    if (isAuthenticated && !isNewUser && !appReady) {
      setShowLoading(true);
    } else if (isAuthenticated && isNewUser) {
      // New users go through onboarding
    } else if (isAuthenticated && !isNewUser) {
      setAppReady(true);
    }
  }, [isAuthenticated, isNewUser, appReady]);

  // Auth flow
  if (!isAuthenticated) {
    return authView === 'login' ? (
      <LoginPage onSwitchToRegister={() => setAuthView('register')} />
    ) : (
      <RegisterPage onSwitchToLogin={() => setAuthView('login')} />
    );
  }

  // Brief loading for returning users
  if (showLoading) {
    return <BriefLoading onComplete={handleLoadingComplete} />;
  }

  // Onboarding flow for new users
  if (isNewUser) {
    return <OnboardingFlow />;
  }

  // Main app
  return (
    <div className="app-shell h-screen w-full flex overflow-hidden text-[12px] selection:bg-indigo-500/30 bg-[#09090c] animate-fade-in">
      <Sidebar
        activeView={activeView}
        onNavChange={setActiveView}
        onOpenSettings={() => setSettingsOpen(true)}
        collapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed((c) => !c)}
        starredItems={[]}
      />
      <div className="flex-1 flex flex-col min-w-0">
        <TopBar
          onOpenCommand={() => setCommandOpen(true)}
          onToggleSidebar={() => setSidebarCollapsed((c) => !c)}
          onToggleRightPanel={() => setRightPanelOpen((o) => !o)}
          onOpenDeploy={() => setDeployOpen(true)}
        />
        <main className="flex-1 min-h-0 overflow-hidden">
          <MainView activeView={activeView} onViewChange={setActiveView} onOpenDeploy={() => setDeployOpen(true)} />
        </main>
      </div>
      {rightPanelOpen && <RightPanel onViewChange={setActiveView} />}
      <CommandPalette
        open={commandOpen}
        onOpenChange={setCommandOpen}
        onCommand={(cmd) => {
          if (cmd === 'deploy') setDeployOpen(true);
          else setActiveView(cmd === 'home' ? 'chats' : cmd);
        }}
      />
      {deployOpen && <DeployModal onClose={() => setDeployOpen(false)} />}
      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
      <PermissionDialog />
      <ToastContainer />
    </div>
  );
}
