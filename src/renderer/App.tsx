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

type AuthView = 'login' | 'register';

function BriefLoading({ onComplete }: { onComplete: () => void }) {
  const [progress, setProgress] = useState(0);
  const [statusText, setStatusText] = useState('Restoring workspace…');

  useEffect(() => {
    const statusTexts = [
      'Restoring workspace…',
      'Loading sessions…',
      'Preparing AI engine…',
      'Almost ready…',
    ];
    
    const interval = setInterval(() => {
      setProgress(prev => {
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
    <div className="min-h-screen bg-[#0a0a0f] flex flex-col items-center justify-center animate-fade-in">
      <svg className="w-20 h-20 mb-6" viewBox="0 0 200 100" fill="none">
        <defs>
          <linearGradient id="loadGrad" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#a855f7">
              <animate attributeName="stop-color" values="#a855f7;#06b6d4;#ec4899;#a855f7" dur="4s" repeatCount="indefinite"/>
            </stop>
            <stop offset="50%" stopColor="#06b6d4">
              <animate attributeName="stop-color" values="#06b6d4;#ec4899;#a855f7;#06b6d4" dur="4s" repeatCount="indefinite"/>
            </stop>
            <stop offset="100%" stopColor="#ec4899">
              <animate attributeName="stop-color" values="#ec4899;#a855f7;#06b6d4;#ec4899" dur="4s" repeatCount="indefinite"/>
            </stop>
          </linearGradient>
          <filter id="loadGlow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="4" result="blur"/>
            <feMerge>
              <feMergeNode in="blur"/>
              <feMergeNode in="SourceGraphic"/>
            </feMerge>
          </filter>
        </defs>
        <path 
          d="M50 50 C50 28, 68 15, 90 15 C112 15, 120 28, 120 50 C120 72, 138 85, 160 85 C182 85, 195 72, 195 50 C195 28, 182 15, 160 15 C138 15, 120 28, 120 50 C120 72, 100 85, 90 85 C68 85, 50 72, 50 50 Z"
          stroke="url(#loadGrad)" 
          strokeWidth="8" 
          strokeLinecap="round"
          fill="none"
          filter="url(#loadGlow)"
        />
      </svg>
      <div className="text-gray-500 text-sm mb-4">{statusText}</div>
      <div className="w-48 h-1 bg-white/5 rounded-full overflow-hidden">
        <div
          className="h-full bg-gradient-to-r from-purple-500 via-cyan-500 to-pink-500 transition-all duration-300"
          style={{ width: `${progress}%` }}
        />
      </div>
    </div>
  );
}

export function App() {
  const { isAuthenticated, isNewUser, user } = useAuthStore();
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
    <div className="h-screen w-full flex overflow-hidden text-[11px] selection:bg-indigo-500/30 bg-[#0a0a0f] animate-fade-in">
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
          <MainView activeView={activeView} onViewChange={setActiveView} />
        </main>
      </div>
      {rightPanelOpen && <RightPanel />}
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
