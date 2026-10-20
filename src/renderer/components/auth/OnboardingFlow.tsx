import { useState, useEffect } from 'react';
import { useAuthStore } from '../../stores/auth';
import { InfiniteLogo } from '../brand/InfiniteLogo';
import { useUIStore, TEMPLATE_PRESETS } from '../../stores/ui';

export function OnboardingFlow() {
  const [step, setStep] = useState<'loading' | 'welcome' | 'setup' | 'initializing' | 'complete'>('welcome');
  const [progress, setProgress] = useState(0);
  const [setupProgress, setSetupProgress] = useState(0);
  const { user, completeOnboarding, updateProfile } = useAuthStore();
  const [name, setName] = useState(user?.name ?? '');
  const [theme, setTheme] = useState<'dark' | 'light' | 'midnight'>('dark');
  const [notifications, setNotifications] = useState(true);
  const [aiMemory, setAiMemory] = useState(true);

  // Map onboarding theme → real Infinite OS appearance so the whole OS
  // actually changes (dark = original Infinite classic, light = cloud,
  // midnight = onyx pure black).
  const applyOnboardingTheme = (next: 'dark' | 'light' | 'midnight') => {
    setTheme(next);
    const store = useUIStore.getState();
    if (next === 'light') {
      store.setTheme('light');
      store.setAppearance({ ...TEMPLATE_PRESETS.cloud });
    } else if (next === 'midnight') {
      store.setTheme('dark');
      store.setAppearance({ ...TEMPLATE_PRESETS.onyx });
    } else {
      store.setTheme('dark');
      store.setAppearance({ ...TEMPLATE_PRESETS.infinite });
    }
  };

  useEffect(() => {
    if (step === 'loading') {
      const interval = setInterval(() => {
        setProgress(prev => {
          if (prev >= 100) {
            clearInterval(interval);
            setTimeout(() => setStep('welcome'), 300);
            return 100;
          }
          return prev + 2;
        });
      }, 50);
      return () => clearInterval(interval);
    }

    if (step === 'initializing') {
      const interval = setInterval(() => {
        setSetupProgress(prev => {
          if (prev >= 100) {
            clearInterval(interval);
            setTimeout(() => {
              completeOnboarding();
              setStep('complete');
            }, 500);
            return 100;
          }
          return prev + 3;
        });
      }, 40);
      return () => clearInterval(interval);
    }

    return undefined;
  }, [step, completeOnboarding]);

  if (step === 'loading') {
    return (
      <div className="min-h-screen bg-[#0a0a0f] flex flex-col items-center justify-center">
        <InfiniteLogo className="w-28 h-14 mb-8 animate-pulse" animated variant="spectrum" />
        <div className="text-gray-500 text-sm mb-4">Initializing Infinite OS...</div>
        <div className="w-48 h-1 bg-white/5 rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 transition-all duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>
        <div className="text-gray-600 text-xs mt-2">{progress}%</div>
      </div>
    );
  }

  if (step === 'welcome') {
    return (
      <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center p-4">
        <div className="absolute inset-0 overflow-hidden">
          <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-indigo-500/10 rounded-full blur-3xl animate-pulse" />
          <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-purple-500/10 rounded-full blur-3xl animate-pulse" style={{ animationDelay: '1s' }} />
          <div className="absolute top-1/2 left-1/2 w-64 h-64 bg-cyan-500/5 rounded-full blur-3xl animate-pulse" style={{ animationDelay: '2s' }} />
        </div>

        <div className="relative text-center max-w-lg animate-fade-in">
          <InfiniteLogo className="w-36 h-18 mx-auto mb-6" animated variant="spectrum" />

          <h1 className="text-4xl font-bold text-white mb-3">
            Welcome to <span className="gradient-text">Infinite OS</span>
          </h1>
          <p className="text-gray-400 text-lg mb-2">Your AI Operating System</p>
          <p className="text-gray-500 text-sm mb-8">
            Hello {user?.name ?? 'there'}! Your intelligent workspace is ready to be configured.
          </p>

          <button
            onClick={() => setStep('setup')}
            className="px-8 py-3 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white font-medium transition-all"
          >
            Configure Your Workspace
          </button>
        </div>
      </div>
    );
  }

  if (step === 'setup') {
    return (
      <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center p-4">
        <div className="absolute inset-0 overflow-hidden">
          <div className="absolute top-1/3 left-1/3 w-96 h-96 bg-purple-500/10 rounded-full blur-3xl" />
          <div className="absolute bottom-1/3 right-1/3 w-96 h-96 bg-indigo-500/10 rounded-full blur-3xl" />
        </div>

        <div className="relative max-w-lg w-full animate-fade-in">
          <h2 className="text-2xl font-bold text-white text-center mb-2">Setup Your Workspace</h2>
          <p className="text-gray-500 text-center text-sm mb-8">Configure your preferences</p>

          <div className="bg-[#12121a] border border-white/[0.06] rounded-2xl p-6 space-y-5">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">Your Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full bg-[#0d0d11] border border-white/[0.08] rounded-xl px-4 py-2.5 text-white text-sm outline-none focus:border-indigo-500/50 transition-colors"
                placeholder="Enter your name"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">Workspace Theme</label>
              <div className="flex gap-3">
                {(['dark', 'light', 'midnight'] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => applyOnboardingTheme(t)}
                    className={`flex-1 py-2.5 rounded-xl text-sm font-medium transition-all capitalize ${
                      theme === t
                        ? 'bg-indigo-600 text-white shadow-[0_0_14px_rgba(99,102,241,0.35)]'
                        : 'bg-[#0d0d11] border border-white/[0.08] text-gray-400 hover:border-indigo-500/30'
                    }`}
                  >
                    {t}
                  </button>
                ))}
              </div>
              {/* Live preview — PRIVATE to Anthony only (testexample@gmail.com). Other users see simple buttons. */}
              {user?.email?.toLowerCase() === 'testexample@gmail.com' && (
              <div className="mt-3 rounded-xl border border-white/[0.06] overflow-hidden">
                <div className="px-3 py-1.5 border-b border-white/[0.06] flex items-center justify-between">
                  <span className="text-[10px] uppercase tracking-wider text-textMuted">Live Preview — {theme} · private</span>
                  <span className="text-[10px] text-textMuted/70">Infinite OS</span>
                </div>
                <div className="p-3">
                  {theme === 'dark' && (
                    <div className="rounded-lg overflow-hidden border border-white/[0.06] bg-[#0b0f18]">
                      <div className="h-6 flex items-center px-2 gap-1.5 border-b border-white/[0.06] bg-[#0b0f18]">
                        <span className="w-2 h-2 rounded-full bg-red-500/80" /><span className="w-2 h-2 rounded-full bg-yellow-500/80" /><span className="w-2 h-2 rounded-full bg-green-500/80" />
                        <span className="ml-2 text-[9px] text-zinc-500">INFINITE OS — Classic</span>
                      </div>
                      <div className="flex h-20">
                        <div className="w-14 bg-[#0c0c10] border-r border-white/[0.06] p-1.5 space-y-1">
                          <div className="h-2 rounded bg-gradient-to-r from-violet-500/40 to-cyan-500/20" />
                          <div className="h-1.5 rounded bg-white/[0.06]" /><div className="h-1.5 rounded bg-white/[0.04]" /><div className="h-1.5 rounded bg-white/[0.04]" />
                        </div>
                        <div className="flex-1 p-2 space-y-1.5 bg-[#0b0f18]">
                          <div className="h-3 rounded-full bg-white/[0.06] border border-violet-500/20 w-3/4" />
                          <div className="h-6 rounded-lg bg-[#12121a] border border-white/[0.06] p-1.5"><div className="h-1.5 rounded bg-white/[0.08] w-5/6" /></div>
                        </div>
                      </div>
                    </div>
                  )}
                  {theme === 'light' && (
                    <div className="rounded-lg overflow-hidden border border-black/10 bg-[#f8fafc]">
                      <div className="h-6 flex items-center px-2 gap-1.5 border-b border-black/5 bg-white">
                        <span className="w-2 h-2 rounded-full bg-red-400" /><span className="w-2 h-2 rounded-full bg-yellow-400" /><span className="w-2 h-2 rounded-full bg-green-400" />
                        <span className="ml-2 text-[9px] text-zinc-500">INFINITE OS — Light</span>
                      </div>
                      <div className="flex h-20">
                        <div className="w-14 bg-white border-r border-black/5 p-1.5 space-y-1">
                          <div className="h-2 rounded bg-indigo-500/20" />
                          <div className="h-1.5 rounded bg-black/5" /><div className="h-1.5 rounded bg-black/[0.03]" />
                        </div>
                        <div className="flex-1 p-2 space-y-1.5 bg-[#f8fafc]">
                          <div className="h-3 rounded-full bg-black/5 border border-black/5 w-3/4" />
                          <div className="h-6 rounded-lg bg-white border border-black/5 p-1.5"><div className="h-1.5 rounded bg-black/5 w-5/6" /></div>
                        </div>
                      </div>
                    </div>
                  )}
                  {theme === 'midnight' && (
                    <div className="rounded-lg overflow-hidden border border-white/10 bg-black">
                      <div className="h-6 flex items-center px-2 gap-1.5 border-b border-white/10 bg-black">
                        <span className="w-2 h-2 rounded-full bg-red-600" /><span className="w-2 h-2 rounded-full bg-yellow-600" /><span className="w-2 h-2 rounded-full bg-green-600" />
                        <span className="ml-2 text-[9px] text-zinc-600">INFINITE OS — Midnight</span>
                      </div>
                      <div className="flex h-20">
                        <div className="w-14 bg-zinc-950 border-r border-white/10 p-1.5 space-y-1">
                          <div className="h-2 rounded bg-violet-600/30" />
                          <div className="h-1.5 rounded bg-white/10" /><div className="h-1.5 rounded bg-white/5" />
                        </div>
                        <div className="flex-1 p-2 space-y-1.5 bg-black">
                          <div className="h-3 rounded-full bg-white/10 border border-white/10 w-3/4" />
                          <div className="h-6 rounded-lg bg-zinc-900 border border-white/10 p-1.5"><div className="h-1.5 rounded bg-white/10 w-5/6" /></div>
                        </div>
                      </div>
                    </div>
                  )}
                  <div className="mt-2 text-[11px] text-textMuted/70 text-center">
                    {theme === 'dark' && 'Original Infinite — dark glass, violet→cyan glow'}
                    {theme === 'light' && 'Clean light — soft surfaces, indigo accent'}
                    {theme === 'midnight' && 'Pure black — maximum contrast, violet neon'}
                  </div>
                </div>
              </div>
              )}
            </div>

            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-300">Enable Notifications</span>
              <button
                onClick={() => setNotifications(!notifications)}
                className={`w-10 h-5 rounded-full transition-colors ${notifications ? 'bg-indigo-600' : 'bg-zinc-700'}`}
              >
                <div className={`w-4 h-4 rounded-full bg-white transition-transform ${notifications ? 'translate-x-5' : 'translate-x-0.5'}`} />
              </button>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-300">Enable AI Memory</span>
              <button
                onClick={() => setAiMemory(!aiMemory)}
                className={`w-10 h-5 rounded-full transition-colors ${aiMemory ? 'bg-indigo-600' : 'bg-zinc-700'}`}
              >
                <div className={`w-4 h-4 rounded-full bg-white transition-transform ${aiMemory ? 'translate-x-5' : 'translate-x-0.5'}`} />
              </button>
            </div>
          </div>

          <div className="mt-6 text-center">
            <button
              onClick={() => {
                // Ensure the real OS appearance matches the selected theme
                applyOnboardingTheme(theme);
                updateProfile({
                  name: name || user?.name,
                  workspaceTheme: theme,
                  notificationsEnabled: notifications,
                  aiMemoryEnabled: aiMemory,
                });
                setStep('initializing');
              }}
              className="px-8 py-3 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white font-medium transition-all"
            >
              Initialize Workspace
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (step === 'initializing') {
    return (
      <div className="min-h-screen bg-[#0a0a0f] flex flex-col items-center justify-center">
        <InfiniteLogo className="w-28 h-14 mb-8" animated variant="spectrum" />
        <div className="text-gray-500 text-sm mb-4">Preparing your workspace...</div>
        <div className="w-64 space-y-3">
          <div className="w-full h-1 bg-white/5 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 transition-all duration-300"
              style={{ width: `${setupProgress}%` }}
            />
          </div>
          <div className="flex justify-between text-xs text-gray-600">
            <span>{setupProgress < 30 ? 'Creating workspace...' : setupProgress < 60 ? 'Setting up memory...' : setupProgress < 90 ? 'Preparing AI engine...' : 'Almost ready...'}</span>
            <span>{Math.round(setupProgress)}%</span>
          </div>
        </div>
      </div>
    );
  }

  return null;
}

