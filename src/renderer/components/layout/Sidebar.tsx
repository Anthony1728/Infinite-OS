import { useEffect, useState } from 'react';
import { useChatStore } from '../../stores/chat';
import { useAgentsStore } from '../../stores/agents';
import { useAuthStore } from '../../stores/auth';
import { InfiniteLogo } from '../brand/InfiniteLogo';

const NAV = [
  {
    id: 'chats',
    label: 'Chats',
    icon: 'M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 01.865-.501c1.153-.086 2.294-.213 3.423-.379 1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z',
    color: 'text-indigo-400',
  },
  {
    id: 'agents',
    label: 'Agents',
    icon: 'M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z',
    color: 'text-violet-400',
  },
  {
    id: 'projects',
    label: 'Projects',
    icon: 'M3.75 9.776c.112-.017.227-.026.344-.026h15.812c.117 0 .232.009.344.026m-16.5 0a2.25 2.25 0 00-1.883 2.542l.857 6a2.25 2.25 0 002.227 1.932H19.05a2.25 2.25 0 002.227-1.932l.857-6a2.25 2.25 0 00-1.883-2.542m-16.5 0V6A2.25 2.25 0 016 3.75h3.879a1.5 1.5 0 011.06.44l2.122 2.12a1.5 1.5 0 001.06.44H18A2.25 2.25 0 0120.25 9v.776',
    color: 'text-emerald-400',
  },
  {
    id: 'documents',
    label: 'Documents',
    icon: 'M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z',
    color: 'text-slate-400',
  },
  {
    id: 'automations',
    label: 'Automations',
    icon: 'M3.75 13.5L14.25 2.25 12 10.5h8.25L9.75 21.75 12 13.5H3.75z',
    color: 'text-amber-400',
  },
  {
    id: 'memory',
    label: 'Memory',
    icon: 'M8.25 3v1.5M4.5 8.25H3m18 0h-1.5M4.5 12H3m18 0h-1.5m-15 3.75H3m18 0h-1.5M8.25 19.5V21M12 3v1.5m0 15V21m3.75-18v1.5m0 15V21m-9-1.5h10.5a2.25 2.25 0 002.25-2.25V6.75a2.25 2.25 0 00-2.25-2.25H6.75A2.25 2.25 0 004.5 6.75v10.5a2.25 2.25 0 002.25 2.25zm.75-12h9v9h-9v-9z',
    color: 'text-purple-400',
  },
  {
    id: 'workspace',
    label: 'Workspace',
    icon: 'M3.75 21h16.5M4.5 3h15M5.25 3v18m13.5-18v18M9 6.75h1.5m-1.5 3h1.5m-1.5 3h1.5m3-6H15m-1.5 3H15m-1.5 3H15M9 21v-3.375c0-.621.504-1.125 1.125-1.125h3.75c.621 0 1.125.504 1.125 1.125V21',
    color: 'text-teal-400',
  },
  {
    id: 'settings',
    label: 'Settings',
    icon: 'M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z',
    color: 'text-slate-400',
  },
];

interface SidebarProps {
  activeView: string;
  onNavChange: (view: string) => void;
  onOpenSettings: () => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
  starredItems?: { name: string; color: string }[];
}

export function Sidebar({
  activeView,
  onNavChange,
  onOpenSettings,
  collapsed,
  onToggleCollapse,
  starredItems = [],
}: SidebarProps) {
  const { sessions, currentSessionId, loadSessions, createSession, selectSession, deleteSession } = useChatStore();
  const { runs } = useAgentsStore();
  const { user, logout } = useAuthStore();
  const [currentModel, setCurrentModel] = useState('gemma-4-31b-it');

  const activeAgents = runs.filter((r) => r.status === 'running').length;

  useEffect(() => {
    loadSessions();
    const updateModel = () => {
      try {
        const cur = JSON.parse(localStorage.getItem('infinite:current') ?? '{}');
        if (cur.model) {
          const name =
            cur.model
              .split('/')
              .pop()
              ?.replace(/:free$/, '') ?? cur.model;
          setCurrentModel(name);
        }
      } catch {
        /* ignore */
      }
    };
    updateModel();
    window.addEventListener('storage', updateModel);
    return () => window.removeEventListener('storage', updateModel);
  }, [loadSessions]);

  const handleNewChat = async () => {
    const settings = JSON.parse(localStorage.getItem('infinite:current') ?? '{}');
    const session = await createSession(
      settings.cwd ?? '.',
      settings.model ?? 'meta-llama/llama-3.3-70b-instruct:free',
      settings.provider ?? 'openrouter',
    );
    selectSession(session.id);
    onNavChange('chats');
  };

  const handleSelectSession = (id: string) => {
    selectSession(id);
    onNavChange('chats');
  };

  return (
    <aside
      className={`${collapsed ? 'w-14' : 'w-60'} bg-[#0c0c10] border-r border-white/[0.055] flex flex-col flex-shrink-0 h-full transition-[width] duration-200`}
    >
      {/* Logo + collapse toggle */}
      <div
        className={`${collapsed ? 'px-2 py-3' : 'px-4 py-3'} flex items-center ${collapsed ? 'justify-center' : 'justify-between'}`}
      >
        {!collapsed && (
          <button
            onClick={() => onNavChange('chats')}
            className="flex items-center gap-2.5 min-w-0 text-left rounded-lg"
            aria-label="Open chats"
          >
            <span className="w-8 h-7 rounded-lg bg-white/[0.035] border border-white/[0.07] flex items-center justify-center shadow-sm">
              <InfiniteLogo className="w-6 h-4" />
            </span>
            <span className="text-[13px] font-semibold text-zinc-100 tracking-[-0.01em] truncate">InfiniteAI</span>
          </button>
        )}
        <button onClick={onToggleCollapse} className="icon-button w-7 h-7" title={collapsed ? 'Expand' : 'Collapse'}>
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            {collapsed ? (
              <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
            ) : (
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
            )}
          </svg>
        </button>
      </div>

      {/* New Chat Button */}
      {!collapsed && (
        <div className="px-3 mb-3">
          <button
            onClick={handleNewChat}
            className="w-full h-9 px-3 rounded-lg border border-white/[0.08] hover:border-indigo-400/30 bg-white/[0.025] hover:bg-white/[0.045] text-zinc-200 flex items-center justify-between transition-all duration-150 text-xs shadow-sm"
          >
            <span className="flex items-center gap-2">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
              New Chat
            </span>
            <span className="text-[9px] text-gray-500 bg-white/5 px-1.5 py-0.5 rounded font-mono">Ctrl+N</span>
          </button>
        </div>
      )}

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-2 space-y-0.5 custom-scrollbar">
        {NAV.map((n) => {
          const isActive = activeView === n.id;
          return (
            <button
              key={n.id}
              onClick={() => onNavChange(n.id)}
              title={collapsed ? n.label : undefined}
              className={`group relative w-full flex items-center ${collapsed ? 'justify-center' : 'gap-2.5'} px-2.5 py-2 rounded-lg transition-all duration-150 text-xs ${
                isActive
                  ? 'bg-white/[0.06] text-white font-medium'
                  : 'text-gray-500 hover:text-white hover:bg-white/[0.03]'
              }`}
            >
              {isActive && (
                <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 rounded-r-full bg-indigo-400" />
              )}
              <svg
                className={`w-4 h-4 flex-shrink-0 transition-colors ${isActive ? n.color || 'text-indigo-400' : 'text-gray-500 group-hover:text-white'}`}
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d={n.icon} />
              </svg>
              {!collapsed && <span className="truncate">{n.label}</span>}
            </button>
          );
        })}

        {/* Starred section - only show when there are active starred items */}
        {!collapsed && starredItems.length > 0 && (
          <>
            <div className="pt-6 pb-2 px-2.5 text-[9px] font-semibold text-gray-600 uppercase tracking-widest">
              Starred
            </div>
            {starredItems.map((item) => (
              <a
                key={item.name}
                href="#"
                className="flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg transition-all duration-150 text-xs text-gray-500 hover:text-white hover:bg-white/[0.03]"
              >
                <span className={`w-1.5 h-1.5 rounded-full ${item.color.replace('text-', 'bg-')}`} />
                <span className="truncate">{item.name}</span>
              </a>
            ))}
          </>
        )}

        {/* Recent Sessions */}
        {!collapsed && sessions.length > 0 && (
          <>
            <div className="pt-6 pb-2 px-2.5 text-[9px] font-semibold text-gray-600 uppercase tracking-widest">
              Recent
            </div>
            {sessions.slice(0, 3).map((s) => (
              <a
                key={s.id}
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  handleSelectSession(s.id);
                }}
                className={`group flex items-center gap-2 px-2.5 py-1.5 rounded-lg transition-all duration-150 text-xs ${
                  currentSessionId === s.id
                    ? 'bg-white/[0.06] text-white'
                    : 'text-gray-500 hover:text-white hover:bg-white/[0.03]'
                }`}
              >
                <svg
                  className="w-3 h-3 flex-shrink-0 opacity-40"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M2.25 12.76c0 1.6 1.123 2.994 2.707 3.227 1.087.16 2.185.283 3.293.369V21l4.076-4.076a1.526 1.526 0 011.037-.443 48.282 48.282 0 005.68-.494c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z"
                  />
                </svg>
                <span className="truncate flex-1">{s.title || 'New Chat'}</span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteSession(s.id);
                  }}
                  className="opacity-0 group-hover:opacity-100 ml-auto text-gray-500 hover:text-red-400 text-[10px] transition-all w-4 h-4 flex items-center justify-center rounded hover:bg-red-400/10"
                  title="Delete"
                >
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </a>
            ))}
          </>
        )}
      </nav>

      {/* Bottom: Model + User */}
      {!collapsed && (
        <div className="p-3 border-t border-white/[0.06] space-y-2">
          {/* Model pill */}
          <button
            onClick={onOpenSettings}
            className="w-full flex items-center gap-2.5 px-2 py-2 rounded-lg hover:bg-white/[0.03] transition-all duration-150 text-left group"
          >
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-indigo-500/20 to-teal-500/20 border border-indigo-500/20 flex items-center justify-center flex-shrink-0">
              <svg
                className="w-3.5 h-3.5 text-indigo-400"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M8.25 3v1.5M4.5 8.25H3m18 0h-1.5M4.5 12H3m18 0h-1.5m-15 3.75H3m18 0h-1.5M8.25 19.5V21M12 3v1.5m0 15V21m3.75-18v1.5m0 15V21m-9-1.5h10.5a2.25 2.25 0 002.25-2.25V6.75a2.25 2.25 0 00-2.25-2.25H6.75A2.25 2.25 0 004.5 6.75v10.5a2.25 2.25 0 002.25 2.25zm.75-12h9v9h-9v-9z"
                />
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[9px] text-gray-600 uppercase tracking-wide">Model</div>
              <div className="text-xs font-medium text-white truncate">{currentModel}</div>
            </div>
            <svg
              className="w-3 h-3 text-gray-600 group-hover:text-white transition-colors"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
            </svg>
          </button>

          {/* Active agents indicator */}
          {activeAgents > 0 && (
            <div className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-indigo-500/10 border border-indigo-500/20">
              <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-pulse flex-shrink-0" />
              <span className="text-[10px] text-indigo-300 font-medium">
                {activeAgents} agent{activeAgents !== 1 ? 's' : ''} running
              </span>
            </div>
          )}

          {/* User */}
          <div className="flex items-center gap-2.5 pt-1 border-t border-white/[0.06] cursor-pointer hover:bg-white/[0.03] rounded-lg px-1.5 py-2 transition-all duration-150 group">
            <div className="w-7 h-7 rounded-full bg-gradient-to-br from-indigo-500 via-teal-500 to-pink-500 flex items-center justify-center text-white shadow-md flex-shrink-0">
              <span className="text-xs font-semibold">{user?.name?.charAt(0)?.toUpperCase() ?? 'U'}</span>
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-xs font-medium text-white truncate">{user?.name ?? 'User'}</div>
              <div className="text-[9px] text-gray-600">{user?.email ?? ''}</div>
            </div>
            <button
              onClick={(e) => {
                e.stopPropagation();
                logout();
              }}
              className="opacity-0 group-hover:opacity-100 text-gray-500 hover:text-red-400 transition-all"
              title="Sign out"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15m3 0l3-3m0 0l-3-3m3 3H9"
                />
              </svg>
            </button>
          </div>
        </div>
      )}
    </aside>
  );
}
