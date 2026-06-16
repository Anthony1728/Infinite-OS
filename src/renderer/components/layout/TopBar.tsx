import { useEffect, useState } from 'react';
import { useAgentsStore } from '../../stores/agents';
import { useChatStore } from '../../stores/chat';
import { useAuthStore } from '../../stores/auth';

interface TopBarProps {
  onOpenCommand: () => void;
  onToggleSidebar: () => void;
  onToggleRightPanel: () => void;
  onOpenDeploy?: () => void;
}

interface SystemMetrics {
  cpu: number;
  cpuCores: number;
  ram: number;
  ramUsed: string;
  ramTotal: string;
}

export function TopBar({ onOpenCommand, onToggleSidebar, onToggleRightPanel, onOpenDeploy }: TopBarProps) {
  const [metrics, setMetrics] = useState<SystemMetrics | null>(null);
  const { runs } = useAgentsStore();
  const { streaming } = useChatStore();
  const { isAuthenticated, user } = useAuthStore();

  const activeAgents = runs.filter((r) => r.status === 'running').length;
  const [isOnline, setIsOnline] = useState(false);

  // Check online status
  useEffect(() => {
    const checkOnline = async () => {
      try {
        const settings = JSON.parse(localStorage.getItem('infinite:current') ?? '{}');
        const provider = settings.provider ?? 'openrouter';
        const hasKey = await window.api.hasProviderKey({ provider });
        setIsOnline(!!hasKey);
      } catch {
        setIsOnline(false);
      }
    };
    checkOnline();
    window.addEventListener('storage', checkOnline);
    return () => window.removeEventListener('storage', checkOnline);
  }, []);

  useEffect(() => {
    const fetchMetrics = async () => {
      try {
        const m = await window.api.getMetrics();
        setMetrics(m);
      } catch {
        setMetrics({ cpu: 0, cpuCores: 4, ram: 0, ramUsed: '0.0', ramTotal: '16.0' });
      }
    };

    fetchMetrics();
    const interval = setInterval(fetchMetrics, 3000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="h-10 border-b border-borderSubtle bg-bgPanel/90 backdrop-blur-lg flex items-center justify-between px-3 flex-shrink-0">
      {/* Left: sidebar toggle + search */}
      <div className="flex items-center gap-2">
        <button
          onClick={onToggleSidebar}
          className="w-7 h-7 rounded-lg hover:bg-white/5 flex items-center justify-center text-textMuted hover:text-textMain transition-all"
          title="Toggle sidebar (Ctrl+B)"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
          </svg>
        </button>
        <button
          onClick={onOpenCommand}
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/[0.03] border border-borderSubtle hover:border-indigo-500/30 hover:bg-white/[0.05] transition-all duration-200 text-textMuted text-xs min-w-[220px]"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607z" />
          </svg>
          <span className="flex-1 text-left">Search commands, files…</span>
          <span className="text-[9px] bg-white/5 px-1.5 py-0.5 rounded font-mono border border-white/5">Ctrl+K</span>
        </button>
      </div>

      {/* Center: System metrics + status */}
      <div className="flex items-center gap-4">
        {/* Online status */}
        <div className="flex items-center gap-1.5">
          <span className={`w-1.5 h-1.5 rounded-full ${isOnline ? 'bg-emerald-400 animate-live-pulse' : 'bg-amber-400'}`} />
          <span className="text-[10px] text-textMuted">{isOnline ? 'AI Online' : 'Brain Mode'}</span>
        </div>

        {/* CPU */}
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-textMuted uppercase tracking-wide">CPU</span>
          <span className="text-xs font-semibold text-textMain">{metrics?.cpu ?? 0}%</span>
          <div className="flex items-end gap-px h-3">
            {Array.from({ length: 6 }, (_, i) => (
              <div
                key={i}
                className="w-0.5 rounded-full bg-indigo-500/60"
                style={{ height: `${Math.max(20, (metrics?.cpu ?? 0) + (Math.random() - 0.5) * 20)}%` }}
              />
            ))}
          </div>
        </div>

        {/* RAM */}
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-textMuted uppercase tracking-wide">RAM</span>
          <span className="text-xs font-semibold text-textMain">{metrics?.ramUsed ?? '0.0'} GB</span>
        </div>

        {/* Active agents badge */}
        {activeAgents > 0 && (
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-indigo-500/10 border border-indigo-500/20">
            <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-live-pulse" />
            <span className="text-[10px] text-indigo-300 font-semibold">{activeAgents} agent{activeAgents !== 1 ? 's' : ''}</span>
          </div>
        )}

        {/* Streaming indicator */}
        {streaming && (
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-violet-500/10 border border-violet-500/20">
            <span className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-pulse" />
            <span className="text-[10px] text-violet-300 font-semibold">AI thinking…</span>
          </div>
        )}
      </div>

      {/* Right: panel toggle + deploy + avatar */}
      <div className="flex items-center gap-2">
        {/* Deploy shortcut - only visible when authenticated */}
        {isAuthenticated && (
          <button
            onClick={onOpenDeploy}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-medium text-textMuted hover:text-textMain bg-white/[0.02] border border-borderSubtle hover:border-indigo-500/30 transition-all"
            title="Deploy (Ctrl+D)"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.59 14.37a6 6 0 0 1-5.84 7.38v-4.8m5.84-2.58a14.98 14.98 0 0 0 6.16-12.12A14.98 14.98 0 0 0 9.631 8.41m5.96 5.96a14.926 14.926 0 0 1-5.841 2.58m-.119-8.54a6 6 0 0 0-7.381 5.84h4.8m2.581-5.84a14.927 14.927 0 0 0-2.58 5.84m2.699 2.7c-.103.021-.207.041-.311.06a15.09 15.09 0 0 1-2.448-2.448 14.9 14.9 0 0 1 .06-.312m-2.24 2.39a4.493 4.493 0 0 0-1.757 4.306 4.493 4.493 0 0 0 4.306-1.758M16.5 9a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0z" />
            </svg>
            Deploy
            <span className="text-[9px] bg-white/5 px-1 py-0.5 rounded font-mono">⌃D</span>
          </button>
        )}

        {/* Right panel toggle */}
        <button
          onClick={onToggleRightPanel}
          className="w-7 h-7 rounded-lg hover:bg-white/5 flex items-center justify-center text-textMuted hover:text-textMain transition-all"
          title="Toggle right panel"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 4.5v15m6-15v15m-10.875 0h15.75c.621 0 1.125-.504 1.125-1.125V5.625c0-.621-.504-1.125-1.125-1.125H4.125C3.504 4.5 3 5.004 3 5.625v12.75c0 .621.504 1.125 1.125 1.125z" />
          </svg>
        </button>

        {/* User avatar */}
        <div className="w-7 h-7 rounded-full bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 flex items-center justify-center text-white shadow-md cursor-pointer hover:shadow-lg hover:scale-105 transition-all" title={user?.name || 'User'}>
          <span className="text-[10px] font-semibold">{user?.name?.charAt(0)?.toUpperCase() || 'U'}</span>
        </div>
      </div>
    </div>
  );
}
