import { useEffect, useState } from 'react';
import { useChatStore } from '../../stores/chat';

const NAV = [
  {
    id: 'home',
    label: 'OS Home',
    icon: 'M3.75 6A2.25 2.25 0 016 3.75h12A2.25 2.25 0 0120.25 6v12A2.25 2.25 0 0118 20.25H6A2.25 2.25 0 013.75 18V6zM8.25 8.25h7.5v7.5h-7.5v-7.5z',
  },
  {
    id: 'chats',
    label: 'AI Chat',
    icon: 'M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 01.865-.501c1.153-.086 2.294-.213 3.423-.379 1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z',
  },
  {
    id: 'agents',
    label: 'Agent Builder',
    icon: 'M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z',
  },
  {
    id: 'multi-agent',
    label: 'Multi-Agent',
    icon: 'M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.969-1.584A6.005 6.005 0 0112 15a15 15 0 014.682 2.72M12 12a3 3 0 100-6 3 3 0 000 6z',
  },
  {
    id: 'automations',
    label: 'Automations',
    icon: 'M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z',
  },
  {
    id: 'browser',
    label: 'Browser',
    icon: 'M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3',
  },
  {
    id: 'projects',
    label: 'Projects',
    icon: 'M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z',
  },
  {
    id: 'documents',
    label: 'Files',
    icon: 'M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z',
  },
  {
    id: 'workspace',
    label: 'Team Space',
    icon: 'M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h12a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25H6A2.25 2.25 0 013.75 18v-2.25z',
  },
  {
    id: 'cloud',
    label: 'Cloud',
    icon: 'M2.25 15a4.5 4.5 0 014.5-4.5h.51A6.75 6.75 0 1120.25 13.5H18a3.75 3.75 0 00-7.244-1.344A4.5 4.5 0 002.25 15z',
  },
  {
    id: 'business',
    label: 'Business',
    icon: 'M20.25 14.15v4.25c0 1.094-.787 2.036-1.872 2.18-2.087.277-4.216.42-6.378.42s-4.291-.143-6.378-.42c-1.085-.144-1.872-1.086-1.872-2.18v-4.25m16.5 0a2.18 2.18 0 00.75-1.661V8.706c0-1.081-.768-2.015-1.837-2.175a48.114 48.114 0 00-3.413-.387M8.25 6.144V5.25A2.25 2.25 0 0110.5 3h3A2.25 2.25 0 0115.75 5.25v.894',
  },
  {
    id: 'plugins',
    label: 'Plugins',
    icon: 'M14.25 6.087c0-.355.186-.676.476-.88l1.282-.897a1.125 1.125 0 011.572.275l1.5 2.25c.343.514.208 1.209-.304 1.554l-1.155.779a1.08 1.08 0 00-.467.894v3.876c0 .36.18.697.48.897l1.142.761c.512.342.65 1.034.309 1.547l-1.5 2.25a1.125 1.125 0 01-1.57.286l-1.29-.882a1.08 1.08 0 00-.609-.189H9.884c-.218 0-.43.066-.609.189l-1.29.882a1.125 1.125 0 01-1.57-.286l-1.5-2.25a1.125 1.125 0 01.309-1.547l1.142-.761c.3-.2.48-.537.48-.897v-3.876c0-.358-.177-.693-.474-.894l-1.148-.779a1.125 1.125 0 01-.304-1.554l1.5-2.25a1.125 1.125 0 011.572-.275l1.282.897c.29.204.476.525.476.88v.163a1.5 1.5 0 001.5 1.5h1.5a1.5 1.5 0 001.5-1.5v-.163z',
  },
  {
    id: 'memory',
    label: 'Memory',
    icon: 'M12 18v-5.25m0 0a6.01 6.01 0 001.5-.189m-1.5.189a6.01 6.01 0 01-1.5-.189m3.75 7.478a12.06 12.06 0 01-4.5 0m3.75 2.383a14.406 14.406 0 01-3 0M14.25 18v-.192c0-.983.658-1.823 1.508-2.316a7.5 7.5 0 10-7.517 0c.85.493 1.509 1.333 1.509 2.316V18',
  },
  {
    id: 'voice',
    label: 'Voice',
    icon: 'M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z',
  },
  {
    id: 'video',
    label: 'Video',
    icon: 'M3.375 19.5h17.25m-17.25 0a1.125 1.125 0 01-1.125-1.125M3.375 19.5h1.5C5.496 19.5 6 18.996 6 18.375m-3.75 0V5.625m0 12.75v-1.5c0-.621.504-1.125 1.125-1.125m18.375 2.625V5.625m0 12.75c0 .621-.504 1.125-1.125 1.125m1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125m0 3.75h-1.5A1.125 1.125 0 0118 18.375M20.625 4.5H3.375m17.25 0c.621 0 1.125.504 1.125 1.125M20.625 4.5h-1.5C18.504 4.5 18 5.004 18 5.625m3.75 0v1.5c0 .621-.504 1.125-1.125 1.125M3.375 4.5c-.621 0-1.125.504-1.125 1.125M3.375 4.5h1.5C5.496 4.5 6 5.004 6 5.625m-3.75 0v1.5c0 .621.504 1.125 1.125 1.125m0 0h1.5m-1.5 0c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125m1.5-3.75C5.496 8.25 6 7.746 6 7.125v-1.5M4.875 8.25C5.496 8.25 6 8.754 6 9.375v1.5m0-5.25v5.25m0-5.25C6 5.004 6.504 4.5 7.125 4.5h9.75c.621 0 1.125.504 1.125 1.125m1.125 2.625h1.5m-1.5 0A1.125 1.125 0 0118 7.125v-1.5m1.125 2.625c-.621 0-1.125.504-1.125 1.125v1.5m2.625-2.625c.621 0 1.125.504 1.125 1.125v1.5c0 .621-.504 1.125-1.125 1.125M18 5.625v5.25M7.125 12h9.75m-9.75 0A1.125 1.125 0 016 10.875M7.125 12C6.504 12 6 12.504 6 13.125m0-2.25C6 11.496 5.496 12 4.875 12M18 10.875c0 .621-.504 1.125-1.125 1.125M18 10.875c0 .621.504 1.125 1.125 1.125m-2.25 0c.621 0 1.125.504 1.125 1.125m-12 5.25v-5.25m0 5.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125m-12 0v-1.5c0-.621-.504-1.125-1.125-1.125M18 18.375v-5.25m0 5.25v-1.5c0-.621.504-1.125 1.125-1.125M18 13.125v1.5c0 .621.504 1.125 1.125 1.125M18 13.125c0-.621.504-1.125 1.125-1.125M6 13.125v1.5c0 .621-.504 1.125-1.125 1.125M6 13.125C6 12.504 5.496 12 4.875 12m-1.5 0h1.5m-1.5 0c-.621 0-1.125-.504-1.125-1.125v-1.5c0-.621.504-1.125 1.125-1.125M19.125 12h1.5m0 0c.621 0 1.125.504 1.125 1.125v1.5c0 .621-.504 1.125-1.125 1.125m-17.25 0h1.5m14.25 0h1.5',
  },
  {
    id: 'deploy',
    label: 'Deploy',
    icon: 'M15.59 14.37a6 6 0 01-5.84 7.38v-4.8m5.84-2.58a14.98 14.98 0 006.16-12.12A14.98 14.98 0 009.631 8.41m5.96 5.96a14.926 14.926 0 01-5.841 2.58m-.119-8.54a6 6 0 00-7.381 5.84h4.8m2.581-5.84a14.927 14.927 0 00-2.58 5.84m2.699 2.7c-.103.021-.207.041-.311.06a15.09 15.09 0 01-2.448-2.448 14.9 14.9 0 01.06-.312m-2.24 2.39a4.493 4.493 0 00-1.757 4.306 4.493 4.493 0 004.306-1.758M16.5 9a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0z',
  },
  {
    id: 'testing',
    label: 'Testing',
    icon: 'M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19.8 15.3M14.25 3.104c.251.023.501.05.75.082M19.8 15.3l-1.57.393A9.065 9.065 0 0112 15a9.065 9.065 0 00-6.23.693L5 14.5m14.8.8l1.402 1.402c1.232 1.232.65 3.318-1.067 3.611A48.309 48.309 0 0112 21c-2.773 0-5.491-.235-8.135-.687-1.718-.293-2.3-2.379-1.067-3.61L5 14.5',
  },
  {
    id: 'enterprise',
    label: 'Enterprise',
    icon: 'M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z',
  },
  {
    id: 'callcenter',
    label: 'Call Center',
    icon: 'M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 002.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 01-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 00-1.091-.852H4.5A2.25 2.25 0 002.25 4.5v2.25z',
  },
  {
    id: 'settings',
    label: 'Settings',
    icon: 'M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z',
  },
];

interface SidebarProps {
  activeView: string;
  onNavChange: (view: string) => void;
  onOpenSettings: () => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
}

export function Sidebar({ activeView, onNavChange, onOpenSettings, collapsed, onToggleCollapse }: SidebarProps) {
  const { sessions, currentSessionId, loadSessions, createSession, selectSession, deleteSession } = useChatStore();
  const [currentModel, setCurrentModel] = useState('Llama 3.3 70B');

  useEffect(() => {
    loadSessions();
    const updateModel = () => {
      try {
        const cur = JSON.parse(localStorage.getItem('infinite:current') ?? '{}');
        if (cur.model) {
          const name = cur.model.split('/').pop()?.replace(/:free$/, '') ?? cur.model;
          setCurrentModel(name);
        }
      } catch { /* ignore */ }
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
    <aside className={`${collapsed ? 'w-12' : 'w-56'} bg-bgPanel border-r border-borderSubtle flex flex-col flex-shrink-0 h-full transition-all duration-200`}>
      <div className={`${collapsed ? 'px-1.5 py-2' : 'px-3.5 py-3'} flex items-center ${collapsed ? 'justify-center' : 'justify-between'}`}>
        {!collapsed && (
          <button onClick={() => onNavChange('home')} className="flex items-center gap-2 min-w-0 text-left">
            <svg className="w-7 h-7 flex-shrink-0" viewBox="0 0 32 18" fill="none">
              <defs>
                <linearGradient id="infinityGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor="#818cf8" />
                  <stop offset="50%" stopColor="#14b8a6" />
                  <stop offset="100%" stopColor="#ec4899" />
                </linearGradient>
              </defs>
              <path
                d="M9 14.5C13.1421 14.5 16.5 11.1421 16.5 7C16.5 2.85786 19.8579 -0.5 24 -0.5C28.1421 -0.5 31.5 2.85786 31.5 7C31.5 11.1421 28.1421 14.5 24 14.5C19.8579 14.5 16.5 11.1421 16.5 7C16.5 2.85786 13.1421 -0.5 9 -0.5C4.85786 -0.5 1.5 2.85786 1.5 7C1.5 11.1421 4.85786 14.5 9 14.5Z"
                stroke="url(#infinityGrad)"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <span className="text-sm font-semibold text-textMain tracking-wide truncate">InfiniteAI OS</span>
          </button>
        )}
        <button onClick={onToggleCollapse}
          className="w-6 h-6 rounded hover:bg-white/5 flex items-center justify-center text-textMuted hover:text-textMain transition-all"
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            {collapsed
              ? <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
              : <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
            }
          </svg>
        </button>
      </div>

      {!collapsed && (
        <div className="px-3 mb-3">
          <button
            onClick={handleNewChat}
            className="w-full py-2 px-3 rounded-lg border border-borderSubtle hover:border-indigo-500/40 bg-white/[0.02] hover:bg-white/[0.04] text-textMain flex items-center justify-between transition-all duration-200 text-xs"
          >
            <span className="flex items-center gap-2">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
              New Chat
            </span>
            <span className="text-[9px] text-textMuted bg-white/5 px-1.5 py-0.5 rounded font-mono">Ctrl+N</span>
          </button>
        </div>
      )}

      <nav className="flex-1 overflow-y-auto px-2 space-y-0.5 custom-scrollbar">
        {NAV.map((n) => (
          <a
            key={n.id}
            href="#"
            onClick={(e) => {
              e.preventDefault();
              onNavChange(n.id);
            }}
            title={collapsed ? n.label : undefined}
            className={`group flex items-center ${collapsed ? 'justify-center' : 'gap-2.5'} px-2.5 py-2 rounded-lg transition-all duration-150 text-xs ${
              activeView === n.id ? 'bg-white/[0.06] text-textMain font-medium' : 'text-textMuted hover:text-textMain hover:bg-white/[0.03]'
            }`}
          >
            <svg
              className={`w-4 h-4 flex-shrink-0 ${activeView === n.id ? 'text-indigo-400' : 'text-textMuted group-hover:text-textMain'}`}
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d={n.icon} />
            </svg>
            {!collapsed && <span className="truncate">{n.label}</span>}
          </a>
        ))}

        {!collapsed && sessions.length > 0 && (
          <>
            <div className="pt-4 pb-1 px-2.5 text-[9px] font-semibold text-textMuted uppercase tracking-widest">
              Recent
            </div>
            {sessions.slice(0, 5).map((s) => (
              <a
                key={s.id}
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  handleSelectSession(s.id);
                }}
                className={`group flex items-center gap-2 px-2.5 py-1.5 rounded-lg transition-all duration-150 text-xs ${
                  currentSessionId === s.id ? 'bg-white/[0.06] text-textMain' : 'text-textMuted hover:text-textMain hover:bg-white/[0.03]'
                }`}
              >
                <svg className="w-3 h-3 flex-shrink-0 opacity-50" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 01.865-.501c1.153-.086 2.294-.213 3.423-.379 1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z" />
                </svg>
                <span className="truncate">{s.title || 'New Chat'}</span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteSession(s.id);
                  }}
                  className="opacity-0 group-hover:opacity-100 ml-auto text-textMuted hover:text-red-400 text-[10px] transition-all"
                  title="Delete"
                >
                  &#10005;
                </button>
              </a>
            ))}
          </>
        )}
      </nav>

      {!collapsed && (
        <div className="p-2.5 border-t border-borderSubtle/60 space-y-2.5">
          <button
            onClick={onOpenSettings}
            className="w-full flex items-center gap-2.5 px-2 py-2 rounded-lg hover:bg-white/[0.03] transition-all duration-150 text-left"
          >
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-indigo-500/20 to-teal-500/20 flex items-center justify-center flex-shrink-0">
              <svg className="w-3.5 h-3.5 text-indigo-400" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 7.5l-9-5.25L3 7.5m18 0l-9 5.25m9-5.25v9l-9 5.25M3 7.5l9 5.25M3 7.5v9l9 5.25m0-9v9" />
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[9px] text-textMuted uppercase">Model</div>
              <div className="text-xs font-medium text-textMain truncate">{currentModel}</div>
            </div>
            <svg className="w-3 h-3 text-textMuted" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
            </svg>
          </button>

          <div className="px-1">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[9px] text-textMuted">Context Load</span>
              <span className="text-[9px] font-medium text-textMain">64%</span>
            </div>
            <div className="h-1.5 w-full rounded-full bg-white/5 overflow-hidden">
              <div className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-teal-500" style={{ width: '64%' }} />
            </div>
          </div>

          <div className="flex items-center gap-2.5 pt-2 border-t border-borderSubtle/60 cursor-pointer hover:bg-white/[0.03] rounded-lg px-1.5 py-2 transition-all duration-150">
            <div className="w-7 h-7 rounded-full bg-gradient-to-br from-indigo-500 via-teal-500 to-pink-500 flex items-center justify-center text-white shadow-md">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-xs font-medium text-textMain truncate">Alex Johnson</div>
              <div className="text-[9px] text-textMuted">Local workspace</div>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}
