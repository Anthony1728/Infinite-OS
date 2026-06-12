import { useEffect, useState } from 'react';

interface TopBarProps {
  onOpenCommand: () => void;
  onToggleSidebar: () => void;
  onToggleRightPanel: () => void;
}

export function TopBar({ onOpenCommand, onToggleSidebar, onToggleRightPanel }: TopBarProps) {
  const [cpu, setCpu] = useState(14);
  const [ram, setRam] = useState(6.2);

  useEffect(() => {
    const interval = setInterval(() => {
      setCpu((c) => Math.max(5, Math.min(35, c + (Math.random() - 0.5) * 6)));
      setRam((r) => Math.max(4, Math.min(10, r + (Math.random() - 0.5) * 0.4)));
    }, 3000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="h-10 border-b border-borderSubtle bg-bgPanel/80 backdrop-blur-lg flex items-center justify-between px-3 flex-shrink-0">
      {/* Left: sidebar toggle + search */}
      <div className="flex items-center gap-2">
        <button onClick={onToggleSidebar}
          className="w-7 h-7 rounded-lg hover:bg-white/5 flex items-center justify-center text-textMuted hover:text-textMain transition-all"
          title="Toggle sidebar (Ctrl+B)">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
          </svg>
        </button>
        <button onClick={onOpenCommand}
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/[0.03] border border-borderSubtle hover:border-indigo-500/30 hover:bg-white/[0.05] transition-all duration-200 text-textMuted text-xs min-w-[220px]">
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" /></svg>
          <span className="flex-1 text-left">Search commands, files...</span>
          <span className="text-[9px] bg-white/5 px-1.5 py-0.5 rounded font-mono border border-white/5">Ctrl+K</span>
        </button>
      </div>

      {/* Center: Metrics */}
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-textMuted uppercase">CPU</span>
          <span className="text-xs font-semibold text-textMain">{Math.round(cpu)}%</span>
          <div className="flex items-end gap-px h-3">
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="w-0.5 rounded-full bg-indigo-500/60" style={{ height: `${30 + Math.random() * 70}%` }} />
            ))}
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-textMuted uppercase">RAM</span>
          <span className="text-xs font-semibold text-textMain">{ram.toFixed(1)} GB</span>
        </div>
      </div>

      {/* Right: panel toggle + avatar */}
      <div className="flex items-center gap-2">
        <button onClick={onToggleRightPanel}
          className="w-7 h-7 rounded-lg hover:bg-white/5 flex items-center justify-center text-textMuted hover:text-textMain transition-all"
          title="Toggle right panel">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 21v-7.5a.75.75 0 01.75-.75h3a.75.75 0 01.75.75V21m-4.5 0H2.36m11.14 0H18m0 0h3.64m-1.39 0V9.349m-16.5 11.65V9.35m0 0a3.001 3.001 0 003.75-.615A2.993 2.993 0 009.75 9.75c.896 0 1.7-.393 2.25-1.016a2.993 2.993 0 002.25 1.016c.896 0 1.7-.393 2.25-1.016A3.001 3.001 0 0021 9.349" />
          </svg>
        </button>
        <div className="w-7 h-7 rounded-full bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 flex items-center justify-center text-white shadow-md cursor-pointer hover:shadow-lg transition-shadow">
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" /></svg>
        </div>
      </div>
    </div>
  );
}
