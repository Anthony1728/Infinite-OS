import { useEffect, useState } from 'react';
import { useChatStore } from '../../stores/chat';

const NAV = [
  { id: 'chats', label: 'Chats', icon: 'M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 01.865-.501c1.153-.086 2.294-.213 3.423-.379 1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z' },
  { id: 'agents', label: 'Agents', icon: 'M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456zM16.894 20.567L16.5 21.75l-.394-1.183a2.25 2.25 0 00-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 001.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 001.423 1.423l1.183.394-1.183.394a2.25 2.25 0 00-1.423 1.423z' },
  { id: 'projects', label: 'Projects', icon: 'M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z' },
  { id: 'documents', label: 'Documents', icon: 'M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z' },
  { id: 'automations', label: 'Automations', icon: 'M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z M15 12a3 3 0 11-6 0 3 3 0 016 0z' },
  { id: 'memory', label: 'Memory', icon: 'M12 18v-5.25m0 0a6.01 6.01 0 001.5-.189m-1.5.189a6.01 6.01 0 01-1.5-.189m3.75 7.478a12.06 12.06 0 01-4.5 0m3.75 2.383a14.406 14.406 0 01-3 0M14.25 18v-.192c0-.983.658-1.823 1.508-2.316a7.5 7.5 0 10-7.517 0c.85.493 1.509 1.333 1.509 2.316V18' },
  { id: 'workspace', label: 'Workspace', icon: 'M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z' },
  { id: 'settings', label: 'Settings', icon: 'M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z' },
];

const STARRED = [
  { name: 'E-commerce Platform', color: 'bg-indigo-500' },
  { name: 'Marketing Strategy', color: 'bg-cyan-500' },
  { name: 'Financial Analysis', color: 'bg-purple-500' },
  { name: 'Website Redesign', color: 'bg-pink-500' },
];

interface SidebarProps {
  activeView: string;
  onNavChange: (view: string) => void;
  onOpenSettings: () => void;
}

export function Sidebar({ activeView, onNavChange, onOpenSettings }: SidebarProps) {
  const { sessions, currentSessionId, loadSessions, createSession, selectSession, deleteSession } = useChatStore();
  const [hoveredItem, setHoveredItem] = useState<string | null>(null);
  const currentModel = 'Llama 3.3 70B';

  useEffect(() => { loadSessions(); }, [loadSessions]);

  const handleNewChat = async () => {
    const id = await createSession('New Chat');
    selectSession(id);
    onNavChange('chats');
  };

  const handleNavClick = (nav: { id: string }) => {
    onNavChange(nav.id);
  };

  const handleSelectSession = (id: string) => {
    selectSession(id);
    onNavChange('chats');
  };

  return (
    <aside className="w-52 bg-bgPanel border-r border-borderSubtle flex flex-col flex-shrink-0 h-full">
      {/* Logo */}
      <div className="px-3.5 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <svg className="w-7 h-7" viewBox="0 0 32 18" fill="none">
            <defs>
              <linearGradient id="infinityGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#818cf8" />
                <stop offset="50%" stopColor="#a78bfa" />
                <stop offset="100%" stopColor="#c084fc" />
              </linearGradient>
            </defs>
            <path d="M9 14.5C13.1421 14.5 16.5 11.1421 16.5 7C16.5 2.85786 19.8579 -0.5 24 -0.5C28.1421 -0.5 31.5 2.85786 31.5 7C31.5 11.1421 28.1421 14.5 24 14.5C19.8579 14.5 16.5 11.1421 16.5 7C16.5 2.85786 13.1421 -0.5 9 -0.5C4.85786 -0.5 1.5 2.85786 1.5 7C1.5 11.1421 4.85786 14.5 9 14.5Z" 
                  stroke="url(#infinityGrad)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          <span className="text-sm font-semibold text-textMain tracking-wide">INFINITY AI</span>
        </div>
        <button className="w-6 h-6 rounded-lg hover:bg-white/5 flex items-center justify-center transition-colors text-textMuted hover:text-textMain">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6z" /><path strokeLinecap="round" strokeLinejoin="round" d="M3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25z" /><path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6z" /><path strokeLinecap="round" strokeLinejoin="round" d="M13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" /></svg>
        </button>
      </div>

      {/* New Chat */}
      <div className="px-3 mb-3">
        <button onClick={handleNewChat}
          className="w-full py-2 px-3 rounded-lg border border-borderSubtle hover:border-indigo-500/40 bg-white/[0.02] hover:bg-white/[0.04] text-textMain flex items-center justify-between transition-all duration-200 text-xs">
          <span className="flex items-center gap-2">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>
            New Chat
          </span>
          <span className="text-[9px] text-textMuted bg-white/5 px-1.5 py-0.5 rounded font-mono">Ctrl+N</span>
        </button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-2 space-y-0.5 custom-scrollbar">
        {NAV.map((n) => (
          <a key={n.id} href="#"
            onClick={(e) => { e.preventDefault(); handleNavClick(n); }}
            onMouseEnter={() => setHoveredItem(n.id)}
            onMouseLeave={() => setHoveredItem(null)}
            className={`group flex items-center gap-2.5 px-2.5 py-2 rounded-lg transition-all duration-150 text-xs
              ${activeView === n.id 
                ? 'bg-white/[0.06] text-textMain font-medium' 
                : 'text-textMuted hover:text-textMain hover:bg-white/[0.03]'
              }`}>
            <svg className={`w-4 h-4 flex-shrink-0 ${activeView === n.id ? 'text-indigo-400' : 'text-textMuted group-hover:text-textMain'}`} fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d={n.icon} />
            </svg>
            {n.label}
          </a>
        ))}

        {/* Recent Sessions */}
        {sessions.length > 0 && (
          <>
            <div className="pt-4 pb-1 px-2.5 text-[9px] font-semibold text-textMuted uppercase tracking-widest">
              Recent
            </div>
            {sessions.slice(0, 5).map((s) => (
              <a key={s.id} href="#"
                onClick={(e) => { e.preventDefault(); handleSelectSession(s.id); }}
                className={`group flex items-center gap-2 px-2.5 py-1.5 rounded-lg transition-all duration-150 text-xs
                  ${currentSessionId === s.id
                    ? 'bg-white/[0.06] text-textMain'
                    : 'text-textMuted hover:text-textMain hover:bg-white/[0.03]'
                  }`}>
                <svg className="w-3 h-3 flex-shrink-0 opacity-50" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 01.865-.501c1.153-.086 2.294-.213 3.423-.379 1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z"/></svg>
                <span className="truncate">{s.title || 'New Chat'}</span>
                <button onClick={(e) => { e.stopPropagation(); deleteSession(s.id); }}
                  className="opacity-0 group-hover:opacity-100 ml-auto text-textMuted hover:text-red-400 text-[10px] transition-all"
                  title="Delete">
                  &#10005;
                </button>
              </a>
            ))}
          </>
        )}

        {/* Starred */}
        <div className="pt-4 pb-1 px-2.5 text-[9px] font-semibold text-textMuted uppercase tracking-widest">
          Starred
        </div>
        {STARRED.map((item, i) => (
          <a key={i} href="#" className="flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-xs text-textMuted hover:text-textMain hover:bg-white/[0.03] transition-all duration-150">
            <span className={`w-2 h-2 rounded-full ${item.color} flex-shrink-0`} />
            {item.name}
          </a>
        ))}
      </nav>

      {/* Bottom Section */}
      <div className="p-2.5 border-t border-borderSubtle/60 space-y-2.5">
        {/* Model Selector */}
        <button onClick={onOpenSettings}
          className="w-full flex items-center gap-2.5 px-2 py-2 rounded-lg hover:bg-white/[0.03] transition-all duration-150 text-left">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-indigo-500/20 to-purple-500/20 flex items-center justify-center flex-shrink-0">
            <svg className="w-3.5 h-3.5 text-indigo-400" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M21 7.5l-9-5.25L3 7.5m18 0l-9 5.25m9-5.25v9l-9 5.25M3 7.5l9 5.25M3 7.5v9l9 5.25m0-9v9" /></svg>
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[9px] text-textMuted uppercase">Model</div>
            <div className="text-xs font-medium text-textMain truncate">{currentModel}</div>
          </div>
          <svg className="w-3 h-3 text-textMuted" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" /></svg>
        </button>

        {/* Usage Bar */}
        <div className="px-1">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[9px] text-textMuted">Usage This Month</span>
            <span className="text-[9px] font-medium text-textMain">87%</span>
          </div>
          <div className="h-1.5 w-full rounded-full bg-white/5 overflow-hidden">
            <div className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-purple-500" style={{ width: '87%' }} />
          </div>
        </div>

        {/* Connected */}
        <div className="px-1">
          <div className="text-[9px] font-semibold text-textMuted uppercase tracking-widest mb-1.5">Connected</div>
          <div className="space-y-1">
            {[
              { label: 'Local PC', icon: 'M9 17.25v1.007a3 3 0 01-.879 2.122L7.5 21h9l-.621-.621A3 3 0 0115 18.257V17.25m6-12V15a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 15V5.25m18 0A2.25 2.25 0 0018.75 3H5.25A2.25 2.25 0 003 5.25m18 0V12a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 12V5.25' },
              { label: 'Browser', icon: 'M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 017.843 4.582M12 3a8.997 8.997 0 00-7.843 4.582' },
              { label: 'Files', icon: 'M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z' },
            ].map((item, i) => (
              <div key={i} className="flex items-center gap-2 text-[10px] text-textMuted">
                <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
                {item.label}
              </div>
            ))}
          </div>
        </div>

        {/* Profile */}
        <div className="flex items-center gap-2.5 pt-2 border-t border-borderSubtle/60 cursor-pointer hover:bg-white/[0.03] rounded-lg px-1.5 py-2 transition-all duration-150">
          <div className="w-7 h-7 rounded-full bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 flex items-center justify-center text-white shadow-md">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z"/></svg>
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-xs font-medium text-textMain truncate">Alex Johnson</div>
            <div className="text-[9px] text-textMuted">Pro Plan</div>
          </div>
          <svg className="w-3 h-3 text-textMuted" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" /></svg>
        </div>
      </div>
    </aside>
  );
}
