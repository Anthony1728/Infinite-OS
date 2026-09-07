import { useEffect, useState } from 'react';
import { useAuthStore } from '../../stores/auth';
import { InfiniteLogo } from '../brand/InfiniteLogo';

interface LoginPageProps {
  onSwitchToRegister: () => void;
}

interface RosterProfile {
  name: string;
  email: string;
  avatar?: string;
  lastLoginAt: number;
}

export function LoginPage({ onSwitchToRegister }: LoginPageProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [roster, setRoster] = useState<RosterProfile[]>([]);
  const [profileError, setProfileError] = useState('');
  const { login, loginAs, isLoading } = useAuthStore();

  // Netflix-style picker: who's using Infinite OS on this machine?
  // Passwords never leave main — the roster carries names only.
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const list = (await window.api.authListProfiles()) as RosterProfile[];
        if (alive && Array.isArray(list)) setRoster(list);
      } catch {
        /* single-user machine — form stays as-is */
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // One click on a face = signed in. No password typing (Netflix-style).
  const handleProfileClick = async (profileEmail: string) => {
    setProfileError('');
    setEmail(profileEmail);
    const result = await loginAs(profileEmail);
    if (!result.success) {
      setProfileError(result.error ?? 'Could not open profile');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!email || !password) {
      setError('Please fill in all fields');
      return;
    }

    const result = await login(email, password);
    if (!result.success) {
      setError(result.error ?? 'Login failed');
    }
  };

  return (
    <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center p-4">
      {/* Background gradient */}
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-indigo-500/10 rounded-full blur-3xl" />
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-purple-500/10 rounded-full blur-3xl" />
      </div>

      <div className="relative w-full max-w-md">
        {/* Logo — original Infinite spectrum loop */}
        <div className="text-center mb-8">
          <InfiniteLogo className="w-24 h-12 mx-auto mb-5" animated variant="spectrum" />
          <h1 className="text-2xl font-bold text-white">Welcome back</h1>
          <p className="text-gray-500 text-sm mt-2">Sign in to Infinite OS</p>
        </div>

        {/* Who's using Infinite OS? */}
        {roster.length > 0 && (
          <div className="flex items-center justify-center gap-3 mb-6">
            {roster.slice(0, 5).map((p) => (
              <button
                key={p.email}
                onClick={() => void handleProfileClick(p.email)}
                disabled={isLoading}
                title={`${p.email} — click to enter`}
                className={`flex flex-col items-center gap-1.5 rounded-xl p-2 transition-colors disabled:opacity-60 ${
                  email === p.email ? 'bg-white/[0.07]' : 'hover:bg-white/[0.04]'
                }`}
              >
                {p.avatar ? (
                  <img src={p.avatar} alt="" className="h-11 w-11 rounded-full object-cover ring-2 ring-white/10" />
                ) : (
                  <span className="flex h-11 w-11 items-center justify-center rounded-full bg-gradient-to-br from-violet-600/60 to-cyan-500/60 text-base font-bold text-white ring-2 ring-white/10">
                    {(p.name || '?').charAt(0).toUpperCase()}
                  </span>
                )}
                <span className="max-w-[72px] truncate text-[11px] text-zinc-300">
                  {p.name.split(' ')[0]}
                </span>
              </button>
            ))}
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          {(error || profileError) && (
            <div className="bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-3 text-sm text-red-400">
              {error || profileError}
            </div>
          )}

          <div>
            <label className="block text-xs text-gray-400 mb-1.5">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="w-full bg-[#12121a] border border-white/[0.06] rounded-xl px-4 py-3 text-sm text-white placeholder:text-gray-600 focus:outline-none focus:border-indigo-500/50 transition-colors"
            />
          </div>

          <div>
            <label className="block text-xs text-gray-400 mb-1.5">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full bg-[#12121a] border border-white/[0.06] rounded-xl px-4 py-3 text-sm text-white placeholder:text-gray-600 focus:outline-none focus:border-indigo-500/50 transition-colors"
            />
          </div>

          <button
            type="submit"
            disabled={isLoading}
            className="w-full py-3 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white font-medium text-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {isLoading ? (
              <>
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Signing in...
              </>
            ) : (
              'Sign in'
            )}
          </button>
        </form>

        {/* Switch to register */}
        <p className="text-center text-sm text-gray-500 mt-6">
          Don&apos;t have an account?{' '}
          <button
            onClick={onSwitchToRegister}
            className="text-indigo-400 hover:text-indigo-300 transition-colors"
          >
            Create account
          </button>
        </p>
      </div>
    </div>
  );
}

