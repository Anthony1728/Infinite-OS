import { useState, useEffect, useRef } from 'react';
import { useAuthStore } from './stores/auth';
import { useSessionStore } from './stores/session';
import { useAgentsStore } from './stores/agents';
import { useBrainStore } from './stores/brain';
import { useAiTabsStore } from './stores/aiTabs';
import { useLayoutStore } from './stores/layout';
import { useEditorStore } from './stores/editor';
import { useChatStore } from './stores/chat';
import { usePlannerStore } from './stores/planner';
import { LoginPage } from './components/auth/LoginPage';
import { RegisterPage } from './components/auth/RegisterPage';
import { OnboardingFlow } from './components/auth/OnboardingFlow';
import { TopBar } from './components/layout/TopBar';
import { TitleBar } from './components/layout/TitleBar';
import { WallpaperLayer } from './components/layout/WallpaperLayer';
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
import { QuickCaptureModal } from './components/modals/QuickCaptureModal';
import { syncActiveModelToMain } from './utils/active-model-sync';
import { useVoiceSessionStore } from './stores/voice-session';
import { VoiceHud } from './components/voice/VoiceHud';
import { QuestionOverlay } from './components/chat/QuestionOverlay';
import { ResumeBanner } from './components/chat/ResumeBanner';
import { attachFullscreen, useFullscreenStore } from './stores/fullscreen';

type AuthView = 'login' | 'register';

const LOCAL_PRIMARY_CANDIDATES = ['minicpm-v4.6:latest', 'qwen3:4b', 'qwen2.5:3b', 'llama3.1:8b', 'mistral:7b'];

async function openQuickCapturePrompt(): Promise<void> {
  // The on-brand capture sheet lives in QuickCaptureModal; this shim keeps the
  // old "open capture from anywhere" call sites working (command palette).
  window.dispatchEvent(new Event('infinite:quick-capture'));
}
const LOCAL_PRIMARY_MIGRATION = 'infinite:local-primary-minicpm-v46';

/** Cross-fade out of the startup surface, shared by the timer and the style. */
const STARTUP_FADE_MS = 320;

function BriefLoading({ onComplete }: { onComplete: () => void }) {
  // Starts at the same 40% the static splash bar rests at, so the cross-fade
  // between the two is invisible instead of a full→empty jump.
  const [progress, setProgress] = useState(40);
  const [statusText, setStatusText] = useState('Restoring workspace…');
  const [leaving, setLeaving] = useState(false);
  // `onComplete` is a fresh arrow on every App render. Depending on it directly
  // restarted this whole timer on each re-render — which reset the hold clock,
  // re-armed the interval, and stacked another pair of unmount timeouts. Read it
  // through a ref instead so the effect genuinely runs once.
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  useEffect(() => {
    // Tell the boot splash the React surface is on screen so it can fade out
    // on top of us — same mark, same position, no jump.
    window.dispatchEvent(new Event('infinite:startup-painted'));
  }, []);

  useEffect(() => {
    const statusTexts = [
      'Restoring workspace…',
      'Loading sessions…',
      'Initializing AI engine…',
      'Checking model providers…',
      'Almost ready…',
    ];
    // How long this surface stays up. This is the part of boot the user actually
    // watches: the mark with light running around it. It used to be 420ms, and
    // combined with a splash that faded the instant React painted, the whole
    // startup read as a flash rather than an arrival — so it was raised. 1400ms
    // then overshot in the other direction: with the static splash already
    // holding the mark for its own MIN_SPLASH_MS, every launch paid more than
    // two seconds of intros. 700ms keeps a beat of brand presence while the
    // workspace genuinely finishes restoring, and no longer.
    const MIN_VISIBLE_MS = 700;
    const FADE_MS = STARTUP_FADE_MS;
    const startedAt = Date.now();
    const timeouts: number[] = [];

    const interval = setInterval(() => {
      setProgress((prev) => {
        const next = Math.min(100, prev + 7);
        if (next >= 100) {
          clearInterval(interval);
          const hold = Math.max(0, MIN_VISIBLE_MS - (Date.now() - startedAt));
          // Fade out before unmounting so the shell fades in underneath — a hard
          // cut here reads as a blink.
          timeouts.push(window.setTimeout(() => setLeaving(true), hold));
          timeouts.push(window.setTimeout(() => onCompleteRef.current(), hold + FADE_MS));
          return 100;
        }
        // Spread the five stages evenly across the 40→100 span, so each one is
        // actually reached instead of two of them being skipped every time.
        const span = (next - 40) / 60;
        const textIndex = Math.min(Math.floor(span * statusTexts.length), statusTexts.length - 1);
        setStatusText(statusTexts[textIndex]);
        return next;
      });
      // Six steps a second: the bar reaches full at ~540ms, so the MIN_VISIBLE
      // hold is what decides when the surface leaves rather than the animation.
    }, 60);

    return () => {
      clearInterval(interval);
      for (const id of timeouts) window.clearTimeout(id);
    };
  }, []);

  return (
    <div
      className={`os-startup-loading min-h-screen bg-[#08080b] flex flex-col items-center justify-center transition-opacity ${leaving ? 'opacity-0' : 'opacity-100'}`}
      style={{ transitionDuration: `${STARTUP_FADE_MS}ms` }}
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
  const [quickCaptureOpen, setQuickCaptureOpen] = useState(false);
  const fullscreen = useFullscreenStore((s) => s.fullscreen);
  const [experienceSettingsOpen, setExperienceSettingsOpen] = useState(false);
  const [experienceSettingsSection, setExperienceSettingsSection] = useState<ExperienceSettingsSection>('profile');
  const [startupLoading, setStartupLoading] = useState(true);
  const aiTabs = useAiTabsStore((state) => state.tabs);
  const hydrateAiTabs = useAiTabsStore((state) => state.hydrate);
  const editorFile = useEditorStore((state) => state.openFile);

  // The chat stream listener must be attached at app level: views other than
  // ChatView (e.g. the Voice tab) send messages through the same pipeline and
  // would otherwise never receive stream events.
  useEffect(() => {
    useChatStore.getState().initStreamListener();
  }, []);

  // Always-on voice: subscribe once, here, so the HUD and the Voice page both
  // read the same main-process state from any view.
  useEffect(() => {
    const dispose = useVoiceSessionStore.getState().attach();
    return () => dispose();
  }, []);

  // Tabs. Main emits over a real channel now, and the tab it creates is opened
  // here — which is what lets the agent show the user a page from any view,
  // including while the user is on the Voice screen with no keyboard in reach.
  useEffect(() => {
    const api = window.api as unknown as {
      onTabCreate?: (cb: (tab: unknown) => void) => () => void;
      onTabUpdate?: (cb: (patch: { tabId: string; changes: Record<string, unknown>; metadata?: Record<string, unknown> }) => void) => () => void;
      tabIndexReplace?: (args: { tabs: unknown[] }) => Promise<unknown>;
      tabIndexUpsert?: (args: { tab: unknown }) => Promise<unknown>;
      tabIndexRemove?: (args: { id: string }) => Promise<unknown>;
    };
    const store = useAiTabsStore.getState();
    const offCreate = api.onTabCreate?.((tab) => {
      const created = store.createTab(tab as Parameters<typeof store.createTab>[0]);
      // Open it, so the user sees what the agent just showed them.
      setActiveView(created.id);
    });
    const offUpdate = api.onTabUpdate?.((patch) => {
      useAiTabsStore.getState().updateTab(patch.tabId, {
        ...(patch.changes as Record<string, unknown>),
        metadata: patch.metadata,
      });
    });

    // Mirror the open tabs into main. Without this the agent cannot list tabs
    // or read their real address — they lived only in renderer localStorage.
    const mirror = (list: typeof aiTabs) => {
      void api.tabIndexReplace?.({
        tabs: list.map((t) => ({
          id: t.id,
          title: t.title,
          kind: t.kind,
          url: (t.metadata as Record<string, unknown> | undefined)?.browserUrl as string | undefined,
          prompt: t.prompt,
          filePath: t.filePath,
          openedByAgent: (t.metadata as Record<string, unknown> | undefined)?.openedByAgent === true,
        })),
      });
    };
    mirror(aiTabs);
    const unsubscribe = useAiTabsStore.subscribe((state, prev) => {
      if (state.tabs !== prev.tabs) mirror(state.tabs);
    });

    return () => {
      offCreate?.();
      offUpdate?.();
      unsubscribe();
    };
  }, [aiTabs]);

  // Full screen: subscribe once so the title bar can get out of the way and
  // every surface reads the same state.
  useEffect(() => attachFullscreen(), []);

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
  // Main wins when it already has a selection: the Brain may have
  // auto-switched away from a dead model mid-run, and a stale local pick must
  // never revert that. (Every deliberate Settings change syncs immediately.)
  useEffect(() => {
    void (async () => {
      try {
        const raw = localStorage.getItem('infinite:current');
        if (!raw) return;
        const current = JSON.parse(raw) as { provider?: unknown; model?: unknown; cwd?: unknown };
        if (!current.provider && !current.model) return;
        const inMain = await window.api.getSetting({ key: 'provider' }).catch(() => null);
        if (typeof inMain === 'string' && inMain.trim()) return;
        syncActiveModelToMain(current);
      } catch {
        /* a corrupt selection must never block startup */
      }
    })();
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
    const openQuickCapture = () => setQuickCaptureOpen(true);
    window.addEventListener('infinite:quick-capture', openQuickCapture);
    return () => {
      window.removeEventListener('infinite:open-settings', openSettings);
      window.removeEventListener('infinite:open-personalization', openPersonalization);
      window.removeEventListener('infinite:quick-capture', openQuickCapture);
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
        case 'y':
          // Quick Capture: the OS-level "remember this" surface.
          if (e.shiftKey) {
            e.preventDefault();
            setQuickCaptureOpen(true);
          }
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

  // Reminders are an OS-level promise: check them even when Planner is closed.
  // The store guards against overlapping ticks, and a failed check simply
  // retries on the next one instead of surfacing a scary error.
  useEffect(() => {
    if (!isAuthenticated) return;
    let stopped = false;
    const tick = async () => {
      if (stopped) return;
      await usePlannerStore.getState().checkDue().catch(() => {});
    };
    void (async () => {
      await usePlannerStore.getState().load().catch(() => {});
      await tick();
    })();
    const timer = window.setInterval(() => void tick(), 15_000);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [isAuthenticated]);

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
      <WallpaperLayer />
      <div className="os-shell-content relative z-10 flex min-h-0 flex-1 flex-col">
      <TitleBar fullscreen={fullscreen} />
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
      {/* Always-on voice readout — mounted at the shell so it follows you into
          every view. Renders nothing while the setting is off. */}
      <VoiceHud onOpenVoice={() => setActiveView('voice')} />
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
      {/* A blocked agent's question must be answerable from ANY section, so this
          is mounted at the shell rather than inside ChatView. */}
      <QuestionOverlay />
      {/* Global, like the question overlay: a restart happens wherever the user
          happens to be, so "here is what I had done" must not be hidden inside
          the chat view they may not be looking at. */}
      <ResumeBanner />
      {settingsOpen && (uiTheme === 'classic'
        ? <SettingsModalClassic onClose={() => setSettingsOpen(false)} />
        : <SettingsModal onClose={() => setSettingsOpen(false)} />)}
      {experienceSettingsOpen && <ExperienceSettingsModal key={experienceSettingsSection} initialSection={experienceSettingsSection} onClose={() => setExperienceSettingsOpen(false)} />}
      <ShortcutsModal open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
      <QuickCaptureModal open={quickCaptureOpen} onClose={() => setQuickCaptureOpen(false)} />
      <PermissionDialog />
      <PlanApprovalDialog />
      <ToastContainer />
      </div>
      </div>
    </div>
    </ErrorBoundary>
  );
}
