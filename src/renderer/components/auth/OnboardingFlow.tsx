import { useState, useEffect } from 'react';
import { useAuthStore } from '../../stores/auth';

export function OnboardingFlow() {
  const [step, setStep] = useState<'loading' | 'welcome' | 'setup' | 'initializing' | 'complete'>('loading');
  const [progress, setProgress] = useState(0);
  const [setupProgress, setSetupProgress] = useState(0);
  const { user, completeOnboarding, updateProfile } = useAuthStore();
  const [name, setName] = useState(user?.name ?? '');
  const [theme, setTheme] = useState<'dark' | 'light' | 'midnight'>('dark');
  const [notifications, setNotifications] = useState(true);
  const [aiMemory, setAiMemory] = useState(true);

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
  }, [step, completeOnboarding]);

  if (step === 'loading') {
    return (
      <div className="min-h-screen bg-[#0a0a0f] flex flex-col items-center justify-center">
        <svg className="w-20 h-20 mb-8 animate-pulse" viewBox="0 0 200 100" fill="none">
          <defs>
            <linearGradient id="loadGrad" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#818cf8" />
              <stop offset="50%" stopColor="#14b8a6" />
              <stop offset="100%" stopColor="#ec4899" />
            </linearGradient>
            <filter id="loadGlow">
              <feGaussianBlur stdDeviation="3" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
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
        <div className="text-gray-500 text-sm mb-4">Initializing InfiniteAI OS...</div>
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
          <svg className="w-28 h-28 mx-auto mb-6" viewBox="0 0 200 100" fill="none">
            <defs>
              <linearGradient id="welcomeGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#818cf8" />
                <stop offset="50%" stopColor="#14b8a6" />
                <stop offset="100%" stopColor="#ec4899" />
              </linearGradient>
              <filter id="welcomeGlow">
                <feGaussianBlur stdDeviation="4" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>
            <path 
              d="M50 50 C50 28, 68 15, 90 15 C112 15, 120 28, 120 50 C120 72, 138 85, 160 85 C182 85, 195 72, 195 50 C195 28, 182 15, 160 15 C138 15, 120 28, 120 50 C120 72, 100 85, 90 85 C68 85, 50 72, 50 50 Z" 
              stroke="url(#welcomeGrad)" 
            strokeWidth="8" 
            strokeLinecap="round"
            fill="none"
            filter="url(#welcomeGlow)"
          />
        </svg>

          <h1 className="text-4xl font-bold text-white mb-3">
            Welcome to <span className="gradient-text">Infinite AI</span>
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
                    onClick={() => setTheme(t)}
                    className={`flex-1 py-2.5 rounded-xl text-sm font-medium transition-all capitalize ${
                      theme === t
                        ? 'bg-indigo-600 text-white'
                        : 'bg-[#0d0d11] border border-white/[0.08] text-gray-400 hover:border-indigo-500/30'
                    }`}
                  >
                    {t}
                  </button>
                ))}
              </div>
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
        <svg className="w-20 h-20 mb-8" viewBox="0 0 200 100" fill="none">
          <defs>
            <linearGradient id="initGrad" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#818cf8" />
              <stop offset="50%" stopColor="#14b8a6" />
              <stop offset="100%" stopColor="#ec4899" />
            </linearGradient>
          </defs>
          <path 
            d="M50 50 C50 28, 68 15, 90 15 C112 15, 120 28, 120 50 C120 72, 138 85, 160 85 C182 85, 195 72, 195 50 C195 28, 182 15, 160 15 C138 15, 120 28, 120 50 C120 72, 100 85, 90 85 C68 85, 50 72, 50 50 Z" 
            stroke="url(#initGrad)" 
            strokeWidth="8" 
            strokeLinecap="round"
            fill="none"
          />
        </svg>
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
