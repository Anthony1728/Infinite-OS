import { useState, useEffect } from 'react';
import { useAuthStore } from './stores/auth';
import { useSessionStore } from './stores/session';
import { useAgentsStore } from './stores/agents';
import { useBrainStore } from './stores/brain';
import { useAiTabsStore } from './stores/aiTabs';
import { useEditorStore } from './stores/editor';
import { LoginPage } from './components/auth/LoginPage';
import { RegisterPage } from './components/auth/RegisterPage';
import { OnboardingFlow } from './components/auth/OnboardingFlow';
import { TopBar } from './components/layout/TopBar';
import { TitleBar } from './components/layout/TitleBar';
import { Sidebar } from './components/layout/Sidebar';
import { RightPanel } from './components/layout/RightPanel';
import { MainView } from './components/layout/MainView';
import { CommandPalette } from './components/command/CommandPalette';
import { DeployModal } from './components/deploy/DeployModal';
import { SettingsModal } from './components/settings/SettingsModal';
import { ExperienceSettingsModal, type ExperienceSettingsSection } from './components/settings/ExperienceSettingsModal';
import { PermissionDialog } from './components/permissions/PermissionDialog';
import { ToastContainer } from './components/notifications/ToastContainer';
import { InfiniteLogo } from './components/brand/InfiniteLogo';

type AuthView = 'login' | 'register';

const LOCAL_PRIMARY_MODEL = 'minicpm-v4.6:latest';
const LOCAL_PRIMARY_MIGRATION = 'infinite:local-primary-minicpm-v46';

function BriefLoading({ onComplete }: { onComplete: () => void }) {
  const [progress, setProgress] = useState(0);
  const [statusText, setStatusText] = useState('Restoring workspace…');

  useEffect(() => {
    const statusTexts = ['Restoring workspace…', 'Loading sessions…', 'Initializing AI engine…', 'Checking model providers…', 'Almost ready…'];

    const interval = setInterval(() => {
      setProgress((prev) => {
        const newProgress = prev + 10;
        if (newProgress >= 100) {
          clearInterval(interval);
          setTimeout(onComplete, 40);
          return 100;
        }
        // Update status text based on progress
        const textIndex = Math.min(Math.floor(newProgress / 25), statusTexts.length - 1);
        setStatusText(statusTexts[textIndex]);
        return newProgress;
      });
    }, 90);
    return () => clearInterval(interval);
  }, [onComplete]);

  return (
    <div
      className="os-startup-loading min-h-screen bg-[#08080b] flex flex-col items-center justify-center animate-fade-in"
      role="status"
      aria-live="polite"
    >
      <div className="relative mb-7">
        <div className="absolute inset-3 rounded-full bg-indigo-500/10 blur-2xl" />
        <InfiniteLogo className="relative w-28 h-16" loading labelled />
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
  const [activeView, setActiveView] = useState('home');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [rightPanelOpen, setRightPanelOpen] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [deployOpen, setDeployOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [experienceSettingsOpen, setExperienceSettingsOpen] = useState(false);
  const [experienceSettingsSection, setExperienceSettingsSection] = useState<ExperienceSettingsSection>('profile');
  const [startupLoading, setStartupLoading] = useState(true);
  const aiTabs = useAiTabsStore((state) => state.tabs);
  const hydrateAiTabs = useAiTabsStore((state) => state.hydrate);
  const editorFile = useEditorStore((state) => state.openFile);

  // Right panel only opens via bell icon click, never auto-opens

  // Prefer the user's fast, tool-capable MiniCPM installation once. The
  // marker prevents future launches from overriding a later manual choice.
  useEffect(() => {
    if (localStorage.getItem(LOCAL_PRIMARY_MIGRATION) === 'done') return;
    window.api.listProviderModels({ provider: 'ollama' })
      .then((models: Array<{ id: string }>) => {
        const localPrimary = models.find((item) => item.id === LOCAL_PRIMARY_MODEL)
          ?? models.find((item) => item.id.toLowerCase().startsWith('minicpm-v4.6'));
        if (!localPrimary) return;
        let current: Record<string, unknown> = {};
        try { current = JSON.parse(localStorage.getItem('infinite:current') ?? '{}'); } catch { /* use defaults */ }
        localStorage.setItem('infinite:current', JSON.stringify({
          ...current,
          provider: 'ollama',
          model: localPrimary.id,
          ollamaModel: localPrimary.id,
          hasApiKey: false,
        }));
        localStorage.setItem(LOCAL_PRIMARY_MIGRATION, 'done');
        window.dispatchEvent(new Event('storage'));
      })
      .catch(() => {
        // Ollama may not be running yet. Leave the migration pending so the
        // next launch can select the installed model automatically.
      });
  }, []);

  useEffect(() => {
    const navigate = (event: Event) => {
      const view = (event as CustomEvent<string>).detail;
      if (view) setActiveView(view);
    };
    window.addEventListener('infinite:navigate', navigate);
    return () => window.removeEventListener('infinite:navigate', navigate);
  }, []);

  useEffect(() => {
    if (editorFile) setActiveView('workspace');
  }, [editorFile]);

  useEffect(() => {
    const openSettings = () => setSettingsOpen(true);
    const openPersonalization = (event: Event) => {
      const requested = (event as CustomEvent<ExperienceSettingsSection>).detail;
      setExperienceSettingsSection(['profile', 'appearance', 'designer'].includes(requested) ? requested : 'profile');
      setExperienceSettingsOpen(true);
    };
    window.addEventListener('infinite:open-settings', openSettings);
    window.addEventListener('infinite:open-personalization', openPersonalization);
    return () => {
      window.removeEventListener('infinite:open-settings', openSettings);
      window.removeEventListener('infinite:open-personalization', openPersonalization);
    };
  }, []);

  useEffect(() => {
    if (!isAuthenticated || isNewUser) return;
    void restoreSession();
    try {
      void useBrainStore.getState().refreshEngineStatus();
    } catch { /* startup continues without optional engine status */ }
  }, [isAuthenticated, isNewUser, restoreSession]);

  // Initialize agents store on mount
  useEffect(() => {
    useAgentsStore.getState().init();
    hydrateAiTabs();
  }, [hydrateAiTabs]);

  useEffect(() => {
    if (activeView.startsWith('ai-tab-') && !aiTabs.some((tab) => tab.id === activeView)) {
      setActiveView('chats');
    }
  }, [activeView, aiTabs]);

  if (startupLoading) {
    return <BriefLoading onComplete={() => setStartupLoading(false)} />;
  }

  // Auth flow
  if (!isAuthenticated) {
    return authView === 'login' ? (
      <LoginPage onSwitchToRegister={() => setAuthView('register')} />
    ) : (
      <RegisterPage onSwitchToLogin={() => setAuthView('login')} />
    );
  }

  // Onboarding flow for new users
  if (isNewUser) {
    return <OnboardingFlow />;
  }

  // Main app
  return (
    <div className="app-shell h-screen w-full flex flex-col overflow-hidden text-[12px] selection:bg-indigo-500/30 bg-[#09090c] animate-fade-in">
      <TitleBar />
      <div className="flex min-h-0 flex-1 overflow-hidden">
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
          onToggleRightPanel={() => setRightPanelOpen((open) => !open)}
          rightPanelOpen={rightPanelOpen}
          onOpenDeploy={() => setDeployOpen(true)}
        />
        <main className="flex-1 min-h-0 overflow-hidden">
          <MainView activeView={activeView} onViewChange={setActiveView} onOpenDeploy={() => setDeployOpen(true)} />
        </main>
      </div>
      {(activeView === 'chats' || activeView === 'research') && (
        <div
          className={`os-activity-panel-shell ${rightPanelOpen ? 'is-open' : 'is-closed'}`}
          aria-hidden={!rightPanelOpen}
        >
          <RightPanel onViewChange={setActiveView} />
        </div>
      )}
      <CommandPalette
        open={commandOpen}
        onOpenChange={setCommandOpen}
        onCommand={(cmd) => {
          if (cmd === 'deploy') setDeployOpen(true);
          else {
            const commandRoutes: Record<string, string> = {
              'new-chat': 'chats',
              'open-canvas': 'canvas',
              'open-code': 'workspace',
              'create-agent': 'agents',
            };
            setActiveView(commandRoutes[cmd] ?? cmd);
          }
        }}
      />
      {deployOpen && <DeployModal onClose={() => setDeployOpen(false)} />}
      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
      {experienceSettingsOpen && <ExperienceSettingsModal key={experienceSettingsSection} initialSection={experienceSettingsSection} onClose={() => setExperienceSettingsOpen(false)} />}
      <PermissionDialog />
      <ToastContainer />
      </div>
    </div>
  );
}
