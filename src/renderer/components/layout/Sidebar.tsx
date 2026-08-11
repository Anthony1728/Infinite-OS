import { useEffect, useState } from 'react';
import { useChatStore } from '../../stores/chat';
import { useAgentsStore } from '../../stores/agents';
import { useAuthStore } from '../../stores/auth';
import { useAiTabsStore, type AiTabKind } from '../../stores/aiTabs';
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
    label: 'File Explorer',
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
    id: 'capabilities',
    label: 'Capabilities',
    icon: 'M12 18v-5.25m0 0a6.01 6.01 0 001.5-.189m-1.5.189a6.01 6.01 0 01-1.5-.189m3.75 7.478a12.06 12.06 0 01-4.5 0m3.75 2.383a14.406 14.406 0 01-3 0M14.25 18v-.192c0-.983.658-1.823 1.508-2.316a7.5 7.5 0 10-7.517 0c.85.493 1.509 1.333 1.509 2.316V18',
    color: 'text-fuchsia-400',
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
  const sessions = useChatStore((state) => state.sessions);
  const currentSessionId = useChatStore((state) => state.currentSessionId);
  const loadSessions = useChatStore((state) => state.loadSessions);
  const createSession = useChatStore((state) => state.createSession);
  const selectSession = useChatStore((state) => state.selectSession);
  const deleteSession = useChatStore((state) => state.deleteSession);
  const clearAllSessions = useChatStore((state) => state.clearAllSessions);
  const renameSession = useChatStore((state) => state.renameSession);
  const pinSession = useChatStore((state) => state.pinSession);
  const searchSessions = useChatStore((state) => state.searchSessions);
  const branchSession = useChatStore((state) => state.branchSession);
  const exportSession = useChatStore((state) => state.exportSession);
  const runs = useAgentsStore((state) => state.runs);
  const { user, logout } = useAuthStore();
  const aiTabs = useAiTabsStore((state) => state.tabs);
  const closeAiTab = useAiTabsStore((state) => state.closeTab);
  const [currentModel, setCurrentModel] = useState('No model selected');
  const [currentProvider, setCurrentProvider] = useState('Provider');
  const [providerConnected, setProviderConnected] = useState(false);
  const [workspaceConnected, setWorkspaceConnected] = useState(false);
  const [chatSearch, setChatSearch] = useState('');
  const [sessionMenu, setSessionMenu] = useState<string | null>(null);
  const [clearHistoryConfirm, setClearHistoryConfirm] = useState(false);
  const [clearingHistory, setClearingHistory] = useState(false);
  const [clearHistoryError, setClearHistoryError] = useState('');

  const activeAgents = runs.filter((r) => r.status === 'running').length;

  useEffect(() => {
    loadSessions();
    const updateModel = async () => {
      try {
        const cur = JSON.parse(localStorage.getItem('infinite:current') ?? '{}');
        const provider = cur.provider === 'local' ? 'ollama' : (cur.provider ?? 'openrouter');
        setCurrentProvider(provider === 'opencode' ? 'OpenCode Zen' : provider);
        if (cur.model) {
          const models = await window.api.listProviderModels({ provider }) as Array<{ id: string; label?: string }>;
          const selected = models.find((item) => item.id === cur.model);
          const fallbackName = cur.model.split('/').pop()?.replace(/:free$/, '') ?? cur.model;
          setCurrentModel(selected?.label ?? fallbackName);
        }
        setWorkspaceConnected(Boolean(cur.cwd && cur.cwd !== '.'));
        const result = await window.api.testProvider({ provider: cur.provider ?? 'openrouter', apiKey: '' });
        setProviderConnected(Boolean(result.ok));
      } catch {
        setProviderConnected(false);
      }
    };
    void updateModel();
    window.addEventListener('storage', updateModel);
    return () => window.removeEventListener('storage', updateModel);
  }, [loadSessions]);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (chatSearch.trim()) void searchSessions(chatSearch);
      else void loadSessions();
    }, 220);
    return () => clearTimeout(timer);
  }, [chatSearch, searchSessions, loadSessions]);

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

  const handleClearHistory = async () => {
    setClearingHistory(true);
    setClearHistoryError('');
    try {
      await clearAllSessions();
      setChatSearch('');
      setSessionMenu(null);
      setClearHistoryConfirm(false);
      onNavChange('chats');
    } catch (error) {
      setClearHistoryError(error instanceof Error ? error.message : 'Could not clear chat history');
    } finally {
      setClearingHistory(false);
    }
  };

  const tabIcon = (kind: AiTabKind): string => {
    const emojis: Partial<Record<AiTabKind, string>> = {
      quiz: '📝', summary: '📋', business: '💼', feature: '✨',
      code: '💻', research: '🔍', lesson: '🎓', workspace: '📁',
      chart: '📊', document: '📄', video: '🎬', invoice: '💰',
      data: '📈', dashboard: '📊', financial: '💹', custom: '⚙️',
    };
    return emojis[kind] || emojis.custom!;
  };

  // Tab icon rendering removed — now uses emojis

  return (
    <aside
      className={`os-sidebar ${collapsed ? 'w-14' : 'w-60'} bg-[#0c0c10] border-r border-white/[0.055] flex flex-col flex-shrink-0 h-full transition-[width] duration-200`}
    >
      {/* Logo + collapse toggle */}
      <div
        className={`${collapsed ? 'px-2' : 'px-4'} flex h-14 items-center border-b border-white/[0.055] ${collapsed ? 'justify-center' : 'justify-between'}`}
      >
        {!collapsed && (
          <button
            onClick={() => onNavChange('home')}
            className="flex items-center gap-3 min-w-0 text-left rounded-lg"
            aria-label="Open Infinite OS home"
          >
            <span className="w-9 h-8 flex items-center justify-center">
              <InfiniteLogo className="w-9 h-5" animated />
            </span>
            <span className="text-[12px] font-semibold text-zinc-100 tracking-[0.16em] truncate">INFINITE OS</span>
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
        <div className="px-3 py-3">
          <button
            onClick={handleNewChat}
            className="os-new-chat group w-full h-10 px-3 rounded-lg border text-zinc-100 flex items-center justify-between transition-all duration-150 text-xs"
          >
            <span className="flex items-center gap-2">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
              New Chat
            </span>
            <span className="os-accent-keycap text-[9px] border px-1.5 py-0.5 rounded font-mono">Ctrl+N</span>
          </button>
        </div>
      )}

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-2 space-y-1 custom-scrollbar">
        {NAV.map((n) => {
          const isActive = activeView === n.id;
          return (
            <button
              key={n.id}
              onClick={() => onNavChange(n.id)}
              title={collapsed ? n.label : undefined}
              data-nav={n.id}
              className={`os-nav-item group relative w-full flex items-center ${collapsed ? 'justify-center' : 'gap-2.5'} px-2.5 py-2.5 rounded-lg transition-all duration-150 text-xs ${
                isActive
                  ? 'is-active bg-white/[0.06] text-white font-medium'
                  : 'text-gray-500 hover:text-white hover:bg-white/[0.03]'
              }`}
            >
              {isActive && (
                <span className="os-accent-indicator absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 rounded-r-full" />
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

        {!collapsed && aiTabs.length > 0 && (
          <>
            <div className="pt-6 pb-2 px-2.5 flex items-center justify-between text-[9px] font-semibold text-cyan-400/70 uppercase tracking-widest">
              <span>AI Workspaces</span>
              <span>{aiTabs.length}</span>
            </div>
            {aiTabs.map((tab) => {
              const isActive = activeView === tab.id;
              const hasEmoji = tab.icon && /[\u{1F300}-\u{1F9FF}]/u.test(tab.icon);
              return (
                <div key={tab.id} className="relative group/tab">
                  <button
                    onClick={() => onNavChange(tab.id)}
                    className={`group relative w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg transition-all duration-150 text-xs ${
                      isActive
                        ? 'bg-cyan-400/[0.08] text-white font-medium'
                        : 'text-gray-500 hover:text-white hover:bg-white/[0.03]'
                    }`}
                  >
                    {isActive && (
                      <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 rounded-r-full bg-cyan-400" />
                    )}
                    {hasEmoji ? (
                      <span className="w-4 h-4 flex-shrink-0 text-center text-sm leading-4">{tab.icon}</span>
                    ) : (
                      <span
                        className={`w-4 h-4 flex-shrink-0 text-sm leading-none flex items-center justify-center ${isActive ? 'text-cyan-300' : 'text-gray-500 group-hover:text-cyan-300'}`}
                        role="img"
                        aria-label={tab.title}
                      >
                        {tabIcon(tab.kind)}
                      </span>
                    )}
                    <span className="truncate flex-1 text-left">{tab.title}</span>
                  </button>
                  <button
                    onClick={(event) => {
                      event.stopPropagation();
                      closeAiTab(tab.id);
                      if (activeView === tab.id) onNavChange('chats');
                    }}
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 w-5 h-5 rounded-md opacity-0 group-hover/tab:opacity-100 text-zinc-600 hover:text-zinc-200 hover:bg-white/[0.06] transition-opacity"
                    aria-label={`Close ${tab.title}`}
                    title="Close tab"
                  >
                    <svg className="w-3 h-3 mx-auto" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                      <path strokeLinecap="round" d="M6 6l12 12M18 6 6 18" />
                    </svg>
                  </button>
                </div>
              );
            })}
          </>
        )}

        {/* Starred section - only show when there are active starred items */}
        {!collapsed && starredItems.length > 0 && (
          <>
            <div className="pt-7 pb-2.5 px-2.5 text-[9px] font-semibold text-gray-600 uppercase tracking-widest">
              Starred
            </div>
            {starredItems.map((item) => (
              <div
                key={item.name}
                className="flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-xs text-gray-500"
              >
                <span className={`w-1.5 h-1.5 rounded-full ${item.color.replace('text-', 'bg-')}`} />
                <span className="truncate">{item.name}</span>
              </div>
            ))}
          </>
        )}

        {/* Recent Sessions */}
        {!collapsed && (
          <>
            <div className="pt-7 pb-2 px-2.5 flex items-center justify-between text-[9px] font-semibold text-gray-600 uppercase tracking-widest">
              <span>Conversations</span>
              <span className="flex items-center gap-2">
                <span>{sessions.length}</span>
                {sessions.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      setClearHistoryError('');
                      setClearHistoryConfirm(true);
                    }}
                    className="normal-case tracking-normal text-[9px] font-medium text-zinc-600 hover:text-red-400 transition-colors"
                    aria-label="Clear all chat history"
                    title="Clear all chat history"
                  >
                    Clear all
                  </button>
                )}
              </span>
            </div>
            {clearHistoryConfirm && (
              <div
                className="mx-1.5 mb-2 rounded-lg border border-red-400/20 bg-red-400/[0.045] p-2"
                role="alertdialog"
                aria-label="Clear all chat history"
                aria-describedby="clear-history-description"
              >
                <p id="clear-history-description" className="text-[10px] leading-4 text-zinc-300">
                  Delete every conversation? This cannot be undone.
                </p>
                {clearHistoryError && <p className="mt-1 text-[9px] text-red-300">{clearHistoryError}</p>}
                <div className="mt-2 flex justify-end gap-1.5">
                  <button
                    type="button"
                    disabled={clearingHistory}
                    onClick={() => setClearHistoryConfirm(false)}
                    className="rounded-md px-2 py-1 text-[9px] text-zinc-500 hover:bg-white/[0.05] hover:text-zinc-200 disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={clearingHistory}
                    onClick={() => void handleClearHistory()}
                    className="rounded-md bg-red-500/15 px-2 py-1 text-[9px] font-medium text-red-300 hover:bg-red-500/25 disabled:cursor-wait disabled:opacity-50"
                  >
                    {clearingHistory ? 'Clearing…' : 'Delete all'}
                  </button>
                </div>
              </div>
            )}
            <div className="px-1.5 pb-2">
              <label className="h-7 rounded-lg border border-white/[0.055] bg-white/[0.018] flex items-center gap-2 px-2 focus-within:border-indigo-500/30">
                <svg
                  className="w-3 h-3 text-zinc-600"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" d="m20 20-4-4m2-5a7 7 0 1 1-14 0 7 7 0 0 1 14 0Z" />
                </svg>
                <input
                  value={chatSearch}
                  onChange={(event) => setChatSearch(event.target.value)}
                  placeholder="Search chats"
                  className="min-w-0 flex-1 bg-transparent text-[10px] text-zinc-300 placeholder:text-zinc-700 outline-none"
                />
              </label>
            </div>
            {sessions.length === 0 ? (
              <div className="px-2.5 py-3 text-[10px] text-zinc-700">
                {chatSearch ? 'No matching conversations' : 'No conversations yet'}
              </div>
            ) : (
              sessions.map((s) => (
                <div key={s.id} className="relative">
                  <button
                    onClick={() => handleSelectSession(s.id)}
                    className={`group w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg transition-all duration-150 text-xs ${
                      currentSessionId === s.id
                        ? 'bg-white/[0.06] text-white'
                        : 'text-gray-500 hover:text-white hover:bg-white/[0.03]'
                    }`}
                  >
                    <svg
                      className={`w-3 h-3 flex-shrink-0 ${s.pinned ? 'text-indigo-400' : 'opacity-40'}`}
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d={
                          s.pinned
                            ? 'm14 4 6 6-3 1-4 4-1 5-3-3-5 3 3-5-3-3 5-1 4-4 1-3Z'
                            : 'M3 12.76c0 1.6 1.1 3 2.7 3.2 1.1.2 2.3.3 3.4.4L12 21l2.8-4.1c.2-.3.5-.5.9-.5 1.1-.1 2.3-.2 3.4-.4 1.6-.2 2.7-1.6 2.7-3.2V6.7c0-1.6-1.1-3-2.7-3.2A48 48 0 0 0 12 3c-2.4 0-4.7.2-7 .5C3.4 3.7 2.3 5.1 2.3 6.7v6Z'
                        }
                      />
                    </svg>
                    <span className="truncate flex-1 text-left">{s.title || 'New Chat'}</span>
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setSessionMenu((value) => (value === s.id ? null : s.id));
                    }}
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 w-6 h-6 rounded-md text-zinc-600 hover:text-zinc-200 hover:bg-white/[0.06]"
                    aria-label={`Conversation actions for ${s.title}`}
                  >
                    ···
                  </button>
                  {sessionMenu === s.id && (
                    <div className="absolute z-50 right-1 top-7 w-36 rounded-lg border border-white/[0.08] bg-[#11131b] p-1 shadow-2xl animate-scale-in">
                      {[
                        { label: s.pinned ? 'Unpin' : 'Pin', action: () => pinSession(s.id, !s.pinned) },
                        {
                          label: 'Rename',
                          action: () => {
                            const title = window.prompt('Rename conversation', s.title);
                            if (title) void renameSession(s.id, title);
                          },
                        },
                        { label: 'Branch', action: () => branchSession(s.id) },
                        { label: 'Export', action: () => exportSession(s.id) },
                        { label: 'Delete', action: () => deleteSession(s.id), danger: true },
                      ].map((item) => (
                        <button
                          key={item.label}
                          onClick={() => {
                            void item.action();
                            setSessionMenu(null);
                          }}
                          className={`w-full rounded-md px-2 py-1.5 text-left text-[10px] hover:bg-white/[0.05] ${item.danger ? 'text-red-400' : 'text-zinc-400 hover:text-zinc-100'}`}
                        >
                          {item.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ))
            )}
          </>
        )}
      </nav>

      {/* Bottom: Model + User */}
      {!collapsed && (
        <div className="p-3.5 border-t border-white/[0.06] space-y-2.5">
          {/* Model pill */}
          <button
            onClick={onOpenSettings}
            className="w-full flex items-center gap-2.5 rounded-xl border border-white/[0.055] bg-white/[0.018] px-2.5 py-2.5 hover:border-white/[0.1] hover:bg-white/[0.035] transition-all duration-150 text-left group"
            title={`${currentProvider} · ${currentModel}`}
          >
            <div className="w-7 h-7 rounded-lg bg-white/[0.035] border border-white/[0.08] flex items-center justify-center flex-shrink-0">
              <svg
                className="w-3.5 h-3.5 text-zinc-400"
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
              <div className="text-[9px] text-zinc-600 truncate">Selected · {currentProvider}</div>
              <div className="text-[11px] font-medium text-zinc-200 truncate">{currentModel}</div>
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

          <div className="px-1.5 pt-1 border-t border-white/[0.05]">
            <div className="text-[8px] uppercase tracking-[0.14em] text-zinc-700 mb-1.5">Connected</div>
            <div className="space-y-1 text-[9px]">
              <div className="flex items-center gap-2 text-zinc-500">
                <span className="w-1.5 h-1.5 rounded-full border border-emerald-400 bg-emerald-400/20" />
                Local PC
              </div>
              <div className="flex items-center gap-2 text-zinc-500">
                <span
                  className={`w-1.5 h-1.5 rounded-full border ${providerConnected ? 'border-emerald-400 bg-emerald-400/20' : 'border-amber-400 bg-amber-400/10'}`}
                />
                AI provider
              </div>
              <div className="flex items-center gap-2 text-zinc-500">
                <span
                  className={`w-1.5 h-1.5 rounded-full border ${workspaceConnected ? 'border-emerald-400 bg-emerald-400/20' : 'border-zinc-600'}`}
                />
                Workspace
              </div>
            </div>
          </div>

          {/* User */}
          <div onClick={() => window.dispatchEvent(new Event('infinite:open-personalization'))} className="flex items-center gap-2.5 pt-1 border-t border-white/[0.06] cursor-pointer hover:bg-white/[0.03] rounded-lg px-1.5 py-2 transition-all duration-150 group" role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') window.dispatchEvent(new Event('infinite:open-personalization')); }}>
            <div className="w-7 h-7 rounded-full bg-gradient-to-br from-indigo-500 via-teal-500 to-pink-500 flex items-center justify-center text-white shadow-md flex-shrink-0">
              {user?.avatar ? <img src={user.avatar} alt="" className="h-full w-full rounded-full object-cover" /> : <span className="text-xs font-semibold">{user?.name?.charAt(0)?.toUpperCase() ?? 'U'}</span>}
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
