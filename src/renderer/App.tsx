import { useState, useEffect } from 'react';
import { useAuthStore } from './stores/auth';
import { useSessionStore } from './stores/session';
import { useAgentsStore } from './stores/agents';
import { useBrainStore } from './stores/brain';
import { useAiTabsStore } from './stores/aiTabs';
import { useLayoutStore } from './stores/layout';
import { useEditorStore } from './stores/editor';
import { LoginPage } from './components/auth/LoginPage';
import { RegisterPage } from './components/auth/RegisterPage';
import { OnboardingFlow } from './components/auth/OnboardingFlow';
import { TopBar } from './components/layout/TopBar';
import { TitleBar } from './components/layout/TitleBar';
import { Sidebar } from './components/layout/Sidebar';
import { SidebarClassic } from './components/layout/SidebarClassic';
import { RightPanel } from './components/layout/RightPanel';
import { MainView } from './components/layout/MainView';
import { CommandPalette } from './components/command/CommandPalette';
import { DeployModal } from './components/deploy/DeployModal';
import { SettingsModal } from './components/settings/SettingsModal';
import { ErrorBoundary } from './components/ErrorBoundary';
import { SettingsModalClassic } from './components/settings/SettingsModalClassic';
import { useUiTheme } from './theme/uiTheme';
import { ExperienceSettingsModal, type ExperienceSettingsSection } from './components/settings/ExperienceSettingsModal';
import { PermissionDialog } from './components/permissions/PermissionDialog';
import { PlanApprovalDialog } from './components/permissions/PlanApprovalDialog';
import { ToastContainer } from './components/notifications/ToastContainer';
import { StatusBar } from './components/layout/StatusBar';
import { InfiniteLogo } from './components/brand/InfiniteLogo';
import { ShortcutsModal } from './components/modals/ShortcutsModal';
import { syncActiveModelToMain } from './utils/active-model-sync';

type AuthView = 'login' | 'register';

const LOCAL_PRIMARY_CANDIDATES = ['minicpm-v4.6:latest', 'qwen3:4b', 'qwen2.5:3b', 'llama3.1:8b', 'mistral:7b'];

async function openQuickCapturePrompt(): Promise<void> {
  // Native prompt() is the lowest-friction path that needs zero new UI.
  // The intent is a "drop a thought here in 5 seconds" surface, not a modal.
  const text = typeof window !== 'undefined' ? window.prompt('Quick Capture — what did you want to remember?') : null;
  if (!text || !text.trim()) return;
  const res = (await window.api.quickCaptureAppend({ text: text.trim() })) as
    | { ok: true; path: string }
    | { ok: false; error: string };
  if (!res.ok) {
    console.warn('[quick-capture] append failed:', res.error);
    window.alert(`Quick Capture failed: ${res.error}`);
  } else {
    window.alert(`Saved to ${res.path}`);
  }
}
const LOCAL_PRIMARY_MIGRATION = 'infinite:local-primary-minicpm-v46';

function BriefLoading({ onComplete }: { onComplete: () => void }) {
  const [progress, setProgress] = useState(0);
  const [statusText, setStatusText] = useState('Restoring workspace…');

  useEffect(() => {
    const statusTexts = ['Restoring workspace…', 'Loading sessions…', 'Initializing AI engine…', 'Checking model providers…', 'Almost ready…'];
    // Speed: 2× faster than before (was 90ms*10 = 900ms). Now 45ms*6 ≈ 270ms,
    // and we jump to 100 as soon as the interval hits, so the OS feels instant.
    const interval = setInterval(() => {
      setProgress((prev) => {
        const newProgress = Math.min(100, prev + 18);
        if (newProgress >= 100) {
          clearInterval(interval);
          setTimeout(onComplete, 20);
          return 100;
        }
        const textIndex = Math.min(Math.floor(newProgress / 25), statusTexts.length - 1);
        setStatusText(statusTexts[textIndex]);
        return newProgress;
      });
    }, 45);
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

/** Post-signup welcome: animated logo moment before entering the OS. */
function WelcomeSplash({ name, returning, onDone }: { name: string; returning: boolean; onDone: () => void }) {
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    const fade = setTimeout(() => setLeaving(true), 1500);
    const done = setTimeout(onDone, 2000);
    return () => {
      clearTimeout(fade);
      clearTimeout(done);
    };
  }, [onDone]);

  return (
    <div
      className={`min-h-screen bg-[#08080b] flex flex-col items-center justify-center transition-opacity duration-500 ${leaving ? 'opacity-0' : 'opacity-100 animate-fade-in'}`}
      role="status"
      aria-live="polite"
    >
      <div className="relative mb-7">
        <div className="absolute inset-3 rounded-full bg-indigo-500/15 blur-2xl" />
        <InfiniteLogo className="relative w-32 h-20" animated variant="spectrum" />
      </div>
      <div className="text-white text-xl font-semibold tracking-[0.01em] mb-1.5">{returning ? 'Welcome back' : 'Welcome'}, {name}</div>
      <div className="text-zinc-500 text-[13px] font-medium mb-5">{returning ? 'Opening your workspace…' : 'Preparing your Infinite OS…'}</div>
      <div className="w-52 h-1 bg-white/[0.06] rounded-full overflow-hidden ring-1 ring-white/[0.04]">
        <div className="h-full w-2/3 bg-gradient-to-r from-violet-500 via-cyan-400 to-pink-500 rounded-full animate-pulse" />
      </div>
    </div>
  );
}

export function App() {
  const { isAuthenticated, isNewUser, user, justRegistered, clearJustRegistered, isRestoringSession, welcomeBack } = useAuthStore();
  const uiTheme = useUiTheme((s) => s.theme);
  const { restoreSession } = useSessionStore();
  const [authView, setAuthView] = useState<AuthView>('login');
  const [activeView, setActiveView] = useState('home');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [rightPanelOpen, setRightPanelOpen] = useState(false);
  const setActivityPanelOpen = useLayoutStore((s) => s.setActivityPanelOpen);
  useEffect(() => { setActivityPanelOpen(rightPanelOpen); }, [rightPanelOpen, setActivityPanelOpen]);
  const [commandOpen, setCommandOpen] = useState(false);
  const [deployOpen, setDeployOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
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
    (async () => {
      try {
        // Only auto-switch to the local model when the user has NO configured
        // provider key. If they've already added keys, their choice is the
        // source of truth — never override a working remote setup with local.
        const providers = (await window.api.listProviders()) as Array<{ id: string; requiresApiKey: boolean }>;
        let hasRemoteKey = false;
        for (const p of providers) {
          if (!p.requiresApiKey) continue;
          const has = (await window.api.hasProviderKey({ provider: p.id })) as boolean;
          if (has) { hasRemoteKey = true; break; }
        }
        if (hasRemoteKey) {
          localStorage.setItem(LOCAL_PRIMARY_MIGRATION, 'done');
          return;
        }

        const models = (await window.api.listProviderModels({ provider: 'ollama' })) as Array<{ id: string }>;
        const localPrimary = LOCAL_PRIMARY_CANDIDATES
          .map((id) => models.find((item) => item.id === id))
          .find(Boolean)
          ?? models.find((item) => item.id.toLowerCase().startsWith('minicpm-v4.6'))
          ?? models[0];
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
      } catch {
        // Leave the migration pending — next launch retries safely.
      }
    })();
  }, []);

  // One-time backfill: selections saved before the main-process sync existed
  // only live in renderer localStorage. Push the current pick to the main
  // store once per launch so background turns (WhatsApp, Telegram, scheduled
  // runs) answer on the selected model from the very first message.
  useEffect(() => {
    try {
      const raw = localStorage.getItem('infinite:current');
      if (!raw) return;
      const current = JSON.parse(raw) as { provider?: unknown; model?: unknown; cwd?: unknown };
      if (current.provider || current.model) syncActiveModelToMain(current);
    } catch {
      /* a corrupt selection must never block startup */
    }
  }, []);
  // Netflix-style isolation, renderer side: device storage (provider pick,
  // bot chats, tabs, history, workspace UI) belongs to one account. When the
  // signed-in account differs from whoever used this window last, wipe it —
  // main already re-homed files + secrets; auth restores from main after.
  useEffect(() => {
    void (async () => {
      try {
        const sess = (await window.api.authGetSession()) as { user?: { email?: string } } | null;
        const email = sess?.user?.email?.toLowerCase() ?? '';
        if ((localStorage.getItem('infinite:last-email') ?? '') !== email) {
          localStorage.clear();
          localStorage.setItem('infinite:last-email', email);
        }
      } catch {
        /* storage stays as-is when the bridge is unavailable */
      }
    })();
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

  // Global keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;

      switch (e.key.toLowerCase()) {
        case 'k':
          e.preventDefault();
          setCommandOpen(true);
          break;
        case '`':
          e.preventDefault();
          setActiveView('terminal');
          break;
        case 'n':
          e.preventDefault();
          setActiveView('chats');
          window.dispatchEvent(new CustomEvent('infinite:new-chat'));
          break;
        case 'b':
          e.preventDefault();
          setSidebarCollapsed((c) => !c);
          break;
        case '.':
          e.preventDefault();
          setRightPanelOpen((o) => !o);
          break;
        case '/':
          e.preventDefault();
          setShortcutsOpen((o) => !o);
          break;
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
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
    // Idle-prefetch Terminal chunk so Ctrl+` opens instantly (Hermes-instant).
    // Separate chunk (vendor-xterm) keeps initial bundle lean.
    const idle = (window as unknown as { requestIdleCallback?: (cb: () => void) => number }).requestIdleCallback;
    const prefetch = () => {
      void import('./components/views/TerminalView').catch(() => {});
    };
    if (idle) idle(prefetch);
    else setTimeout(prefetch, 2500);
  }, [hydrateAiTabs]);

  useEffect(() => {
    if (activeView.startsWith('ai-tab-') && !aiTabs.some((tab) => tab.id === activeView)) {
      setActiveView('chats');
    }
  }, [activeView, aiTabs]);

  // Boot gate: splash art while starting, and hold it until the stored
  // session has been checked — no login flash for returning users.
  if (startupLoading || isRestoringSession) {
    return <BriefLoading onComplete={() => setStartupLoading(false)} />;
  }

  // Fresh signups land here once: logo moment, then straight into the OS.
  if (justRegistered) {
    return <WelcomeSplash name={user?.name?.split(' ')[0] ?? 'friend'} returning={welcomeBack} onDone={clearJustRegistered} />;
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
    <ErrorBoundary>
    <div className="app-shell h-screen w-full flex flex-col overflow-hidden text-[12px] selection:bg-indigo-500/30 bg-[#09090c] animate-fade-in">
      <TitleBar />
      <div className="flex min-h-0 flex-1 overflow-hidden">
      {uiTheme === 'classic' ? (
        <SidebarClassic
          activeView={activeView}
          onNavChange={setActiveView}
          onOpenSettings={() => setSettingsOpen(true)}
          collapsed={sidebarCollapsed}
          onToggleCollapse={() => setSidebarCollapsed((c) => !c)}
          starredItems={[]}
        />
      ) : (
        <Sidebar
          activeView={activeView}
          onNavChange={setActiveView}
          onOpenSettings={() => setSettingsOpen(true)}
          collapsed={sidebarCollapsed}
          onToggleCollapse={() => setSidebarCollapsed((c) => !c)}
          starredItems={[]}
        />
      )}
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
        <StatusBar />
      </div>
            {(activeView === 'chats' || activeView === 'research') && (
        <div
          className={`os-activity-panel-shell ${rightPanelOpen ? 'is-open' : 'is-closed'}`}
          aria-hidden={!rightPanelOpen}
        >
          <RightPanel onViewChange={setActiveView} />
        </div>
      )}      <CommandPalette
        open={commandOpen}
        onOpenChange={setCommandOpen}
        onCommand={(cmd) => {
          if (cmd === 'deploy') setDeployOpen(true);
          else if (cmd === 'quick-capture') {
            void openQuickCapturePrompt();
          } else if (cmd === 'quick-capture-open') {
            void window.api.quickCaptureOpen();
          } else {
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
      {settingsOpen && (uiTheme === 'classic'
        ? <SettingsModalClassic onClose={() => setSettingsOpen(false)} />
        : <SettingsModal onClose={() => setSettingsOpen(false)} />)}
      {experienceSettingsOpen && <ExperienceSettingsModal key={experienceSettingsSection} initialSection={experienceSettingsSection} onClose={() => setExperienceSettingsOpen(false)} />}
      <ShortcutsModal open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
      <PermissionDialog />
      <PlanApprovalDialog />
      <ToastContainer />
      </div>
    </div>
    </ErrorBoundary>
  );
}
