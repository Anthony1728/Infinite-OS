import { useEffect, useState } from 'react';

interface TopBarProps {
  onOpenCommand: () => void;
}

export function TopBar({ onOpenCommand }: TopBarProps) {
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
    <div className="h-12 border-b border-borderSubtle bg-bgPanel/80 backdrop-blur-lg flex items-center justify-between px-4 flex-shrink-0">
      {/* Search */}
      <button onClick={onOpenCommand}
        className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/[0.03] border border-borderSubtle hover:border-indigo-500/30 hover:bg-white/[0.05] transition-all duration-200 text-textMuted text-xs min-w-[280px]">
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" /></svg>
        <span className="flex-1 text-left">Search anything...</span>
        <span className="text-[9px] bg-white/5 px-1.5 py-0.5 rounded font-mono border border-white/5">Ctrl+K</span>
      </button>

      {/* Metrics */}
      <div className="flex items-center gap-5">
        {/* CPU */}
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-textMuted uppercase tracking-wide">CPU</span>
          <span className="text-xs font-semibold text-textMain">{Math.round(cpu)}%</span>
          <div className="flex items-end gap-px h-3">
            {Array.from({ length: 8 }, (_, i) => (
              <div key={i} className="w-0.5 rounded-full bg-indigo-500/60" style={{ height: `${30 + Math.random() * 70}%` }} />
            ))}
          </div>
        </div>

        {/* RAM */}
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-textMuted uppercase tracking-wide">RAM</span>
          <span className="text-xs font-semibold text-textMain">{ram.toFixed(1)} GB</span>
          <div className="flex items-end gap-px h-3">
            {Array.from({ length: 8 }, (_, i) => (
              <div key={i} className="w-0.5 rounded-full bg-purple-500/60" style={{ height: `${30 + Math.random() * 70}%` }} />
            ))}
          </div>
        </div>

        {/* Agents */}
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-textMuted uppercase tracking-wide">Agents</span>
          <span className="text-xs font-semibold text-textMain">12</span>
          <div className="flex items-end gap-px h-3">
            {Array.from({ length: 8 }, (_, i) => (
              <div key={i} className="w-0.5 rounded-full bg-cyan-500/60" style={{ height: `${30 + Math.random() * 70}%` }} />
            ))}
          </div>
        </div>

        {/* Tasks */}
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-textMuted uppercase tracking-wide">Tasks</span>
          <span className="text-xs font-semibold text-textMain">47</span>
          <div className="flex items-end gap-px h-3">
            {Array.from({ length: 8 }, (_, i) => (
              <div key={i} className="w-0.5 rounded-full bg-pink-500/60" style={{ height: `${30 + Math.random() * 70}%` }} />
            ))}
          </div>
        </div>
      </div>

      {/* Avatar */}
      <div className="flex items-center gap-3">
        <div className="relative">
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 flex items-center justify-center text-white shadow-md cursor-pointer hover:shadow-lg transition-shadow">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z"/></svg>
          </div>
          <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-green-500 border-2 border-bgPanel" />
        </div>
      </div>
    </div>
  );
}
