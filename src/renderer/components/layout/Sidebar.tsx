import { useEffect, useRef, useState } from 'react';
import { useChatStore } from '../../stores/chat';
import { useAgentsStore } from '../../stores/agents';
import { useAuthStore } from '../../stores/auth';
import { useAiTabsStore, type AiTabKind } from '../../stores/aiTabs';
import { InfiniteLogo } from '../brand/InfiniteLogo';
import { AppIcon, BRAND_GRADIENT, type AppIconName } from '../brand/AppIcon';
import { useNotificationStore } from '../../stores/notifications';
import { PhoneConnectModal } from '../phone/PhoneConnectModal';
import type { Session } from '../../../shared/types';

// Flat, monochrome nav — icons inherit their color from the row state so the
// whole rail reads as one system instead of a set of colored widgets.
const NAV_PRIMARY: { id: string; label: string; icon: AppIconName }[] = [
  { id: 'home', label: 'Home', icon: 'nav.workspace' },
  { id: 'chats', label: 'Chats', icon: 'nav.chats' },
  { id: 'projects', label: 'Projects', icon: 'nav.projects' },
  { id: 'documents', label: 'File Explorer', icon: 'nav.files' },
  { id: 'terminal', label: 'Terminal', icon: 'nav.terminal' },
];

const NAV_SECONDARY: { id: string; label: string; icon: AppIconName }[] = [
  { id: 'bots', label: 'Bots', icon: 'nav.agents' },
  { id: 'memory', label: 'Memory', icon: 'nav.memory' },
  { id: 'automations', label: 'Scheduled Jobs', icon: 'nav.automations' },
  { id: 'messaging', label: 'Messaging', icon: 'home.chat' },
  { id: 'artifacts', label: 'Artifacts', icon: 'tab.document' },
  { id: 'workspace', label: 'Workspace', icon: 'nav.workspace' },
  { id: 'active-memory', label: 'Active Memory', icon: 'home.memory' },
  { id: 'standing-orders', label: 'Standing Orders', icon: 'home.standing-orders' },
  { id: 'plugins', label: 'Plugin Store', icon: 'home.plugins' },
  { id: 'capabilities', label: 'Tools & Skills', icon: 'nav.capabilities' },
];

const NAV_BUSINESS: { id: string; label: string; icon: AppIconName }[] = [
  { id: 'business', label: 'Business OS', icon: 'home.business' },
  { id: 'app-builder', label: 'App Builder', icon: 'tab.feature' },
  { id: 'website-builder', label: 'Website Builder', icon: 'tab.summary' },
  { id: 'callcenter', label: 'Call Center', icon: 'home.chat' },
  { id: 'enterprise', label: 'Enterprise', icon: 'nav.projects' },
  { id: 'deploy', label: 'Deploy', icon: 'nav.automations' },
  { id: 'knowledge', label: 'Knowledge', icon: 'nav.memory' },
];

function groupSessionsByDate(sessions: Session[]): { label: string; sessions: Session[] }[] {
  const now = Date.now();
  const day = 86_400_000;
  const groups: Record<string, Session[]> = {
    'Today': [],
    'Yesterday': [],
    'Previous 7 days': [],
    'Previous 30 days': [],
    'Older': [],
  };
  for (const s of sessions) {
    const age = now - s.updated_at;
    if (age < day) groups['Today'].push(s);
    else if (age < 2 * day) groups['Yesterday'].push(s);
    else if (age < 7 * day) groups['Previous 7 days'].push(s);
    else if (age < 30 * day) groups['Previous 30 days'].push(s);
    else groups['Older'].push(s);
  }
  return Object.entries(groups)
    .filter(([, items]) => items.length > 0)
    .map(([label, items]) => ({ label, sessions: items }));
}

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
  const importSession = useChatStore((state) => state.importSession);
  const branchSession = useChatStore((state) => state.branchSession);
  const exportSession = useChatStore((state) => state.exportSession);
  const shareSession = useChatStore((state) => state.shareSession);
  const addToast = useNotificationStore((state) => state.addToast);
  const runs = useAgentsStore((state) => state.runs);
  const { user } = useAuthStore();
  const aiTabs = useAiTabsStore((state) => state.tabs);
  const closeAiTab = useAiTabsStore((state) => state.closeTab);
  const [currentModel, setCurrentModel] = useState('No model selected');
  const [currentProvider, setCurrentProvider] = useState('Provider');
  const [pairedLabel, setPairedLabel] = useState('');
  const [providerConnected, setProviderConnected] = useState(false);
  const [workspaceConnected, setWorkspaceConnected] = useState(false);
  const [chatSearch, setChatSearch] = useState('');
  const [sessionMenu, setSessionMenu] = useState<string | null>(null);
  const [clearHistoryConfirm, setClearHistoryConfirm] = useState(false);
  const [clearingHistory, setClearingHistory] = useState(false);
  const [clearHistoryError, setClearHistoryError] = useState('');
  const [phoneOpen, setPhoneOpen] = useState(false);
  const [tabsExpanded, setTabsExpanded] = useState(true);

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
        setPairedLabel(cur.secondModelEnabled && cur.model2Label ? cur.model2Label : cur.secondModelEnabled && cur.model2 ? cur.model2 : '');
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

  useEffect(() => {
    if (aiTabs.length > 0) setTabsExpanded(true);
  }, [aiTabs.length]);

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

  // ZCode-style top action: reveal the conversation filter and focus it.
  const handleSearch = () => {
    if (collapsed) onToggleCollapse();
    requestAnimationFrame(() => {
      document.getElementById('sidebar-chat-search')?.focus();
    });
  };

  // Hermes parity: import an exported session (.json / .md) back into chats.
  const importInputRef = useRef<HTMLInputElement>(null);
  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const content = await file.text();
      const format = file.name.toLowerCase().endsWith('.json') ? 'json' as const : 'markdown' as const;
      await importSession(content, format);
      onNavChange('chats');
      addToast({ title: 'Session imported', message: file.name, type: 'success' });
    } catch (err) {
      addToast({ title: 'Import failed', message: err instanceof Error ? err.message : 'Could not import file', type: 'error' });
    }
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

  const tabIconName = (kind: AiTabKind): AppIconName => {
    const icons: Partial<Record<AiTabKind, AppIconName>> = {
      quiz: 'tab.quiz', summary: 'tab.summary', business: 'tab.business', feature: 'tab.feature',
      code: 'tab.code', research: 'tab.research', lesson: 'tab.lesson', workspace: 'tab.workspace',
      chart: 'tab.chart', document: 'tab.document', video: 'tab.video', invoice: 'tab.invoice',
      data: 'tab.data', dashboard: 'tab.dashboard', financial: 'tab.financial', custom: 'tab.custom',
      website: 'tab.workspace', image: 'tab.document', embed: 'tab.workspace', media: 'tab.video',
      schedule: 'tab.document', tracker: 'tab.data', portfolio: 'tab.workspace', comparison: 'tab.chart',
      calculator: 'tab.data', presentation: 'tab.document', mindmap: 'tab.chart', checklist: 'tab.feature',
      timeline: 'tab.document', kanban: 'tab.workspace',
    };
    return icons[kind] ?? 'tab.custom';
  };

  const renderNavItem = (n: { id: string; label: string; icon: AppIconName }) => {
    const isActive = activeView === n.id;
    return (
      <button
        key={n.id}
        onClick={() => onNavChange(n.id)}
        title={collapsed ? n.label : undefined}
        data-nav={n.id}
        className={`os-nav-item group relative w-full flex items-center ${collapsed ? 'justify-center' : 'gap-2.5'} px-2.5 py-2 rounded-lg transition-colors duration-150 text-xs ${
          isActive
            ? 'is-active bg-white/[0.07] text-zinc-100 font-medium'
            : 'text-gray-500 hover:text-zinc-200 hover:bg-white/[0.04]'
        }`}
      >
        <AppIcon
          name={n.icon}
          className={`w-4 h-4 flex-shrink-0 ${isActive ? '' : 'opacity-70'}`}
          strokeWidth={1.7}
          gradient={BRAND_GRADIENT}
        />
        {!collapsed && <span className="truncate">{n.label}</span>}
      </button>
    );
  };

  const renderActionRow = (
    key: string,
    label: string,
    keycap: string | null,
    onClick: () => void,
    icon: React.ReactNode,
    opts?: { badge?: number },
  ) => (
    <button
      key={key}
      onClick={onClick}
      title={collapsed ? label : undefined}
      className={`group relative w-full flex items-center ${collapsed ? 'justify-center' : 'gap-2.5'} px-2.5 py-2 rounded-lg transition-colors duration-150 text-xs ${
        activeView === key
          ? 'is-active bg-white/[0.07] text-zinc-100 font-medium'
          : 'text-gray-500 hover:text-zinc-200 hover:bg-white/[0.04]'
      }`}
    >
      {icon}
      {!collapsed && (
        <>
          <span className="truncate flex-1 text-left">{label}</span>
          {typeof opts?.badge === 'number' && opts.badge > 0 && (
            <span className="text-[9px] font-medium text-zinc-500 bg-white/[0.06] border border-white/[0.08] rounded-full px-1.5 py-px">
              {opts.badge}
            </span>
          )}
          {keycap && (
            <span className="os-accent-keycap text-[9px] border px-1.5 py-0.5 rounded font-mono opacity-70">{keycap}</span>
          )}
        </>
      )}
    </button>
  );

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
            onClick={() => onNavChange('chats')}
            className="flex items-center gap-3 min-w-0 text-left rounded-lg"
            aria-label="Open AI Chat"
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

      {/* Primary actions: New task / Search */}
      <div className={`pt-3 space-y-0.5 ${collapsed ? 'px-2' : 'px-3'}`}>
        {renderActionRow(
          'chats:new',
          'New task',
          'Ctrl+N',
          () => void handleNewChat(),
          <svg className="w-4 h-4 flex-shrink-0 text-gray-500 group-hover:text-zinc-200 transition-colors" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>,
        )}
        {renderActionRow(
          'search',
          'Search',
          'Ctrl+K',
          handleSearch,
          <svg className="w-4 h-4 flex-shrink-0 text-gray-500 group-hover:text-zinc-200 transition-colors" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
            <path strokeLinecap="round" d="m20 20-4-4m2-5a7 7 0 1 1-14 0 7 7 0 0 1 14 0Z" />
          </svg>,
        )}
        {renderActionRow(
          'import',
          'Import session',
          null,
          () => importInputRef.current?.click(),
          <svg className="w-4 h-4 flex-shrink-0 text-gray-500 group-hover:text-zinc-200 transition-colors" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 16.5V3m0 13.5 4.5-4.5M12 16.5 7.5 12M4.5 19.5h15" />
          </svg>,
        )}
        <input
          ref={importInputRef}
          type="file"
          accept=".json,.md,.markdown"
          className="hidden"
          aria-label="Import session file"
          onChange={(e) => void handleImportFile(e)}
        />
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-2 pt-1 pb-2 custom-scrollbar">
        <div className="space-y-0.5">
          {NAV_PRIMARY.map(renderNavItem)}
        </div>

        {/* Automate & extend */}
        {!collapsed && (
          <div className="pt-6 pb-1.5 px-2.5 text-[9px] font-semibold text-zinc-600 uppercase tracking-[0.13em]">
            Automate
          </div>
        )}
        <div className="space-y-0.5">
          {renderActionRow(
            'automations',
            'Automations',
            null,
            () => onNavChange('automations'),
            <AppIcon name="nav.automations" className="w-4 h-4 flex-shrink-0 opacity-70" strokeWidth={1.7} gradient={BRAND_GRADIENT} />,
          )}
          {renderActionRow(
            'plugins',
            'Plugin Marketplace',
            null,
            () => onNavChange('plugins'),
            <AppIcon name="nav.capabilities" className="w-4 h-4 flex-shrink-0 opacity-70" strokeWidth={1.7} gradient={BRAND_GRADIENT} />,
          )}
        </div>

        {!collapsed && (
          <div className="pt-6 pb-1.5 px-2.5 text-[9px] font-semibold text-zinc-600 uppercase tracking-[0.13em]">
            System
          </div>
        )}
        <div className="space-y-0.5">
          {NAV_SECONDARY.map(renderNavItem)}
        </div>

        {!collapsed && (
          <div className="pt-6 pb-1.5 px-2.5 text-[9px] font-semibold text-zinc-600 uppercase tracking-[0.13em]">
            Business
          </div>
        )}
        <div className="space-y-0.5">
          {NAV_BUSINESS.map(renderNavItem)}
        </div>

        {/* Tabs — unified dropdown for all AI-created tabs */}
        {collapsed ? (
          <div className="mt-4 space-y-0.5">
            <button
              onClick={() => { onToggleCollapse(); setTabsExpanded(true); }}
              title={`Tabs${aiTabs.length ? ` — ${aiTabs.length} open` : ''}`}
              className={`relative w-full flex items-center justify-center p-2 rounded-lg transition-colors duration-150 ${aiTabs.length ? 'text-violet-300 bg-violet-500/10 border border-violet-500/20' : 'text-gray-500 hover:text-zinc-200 hover:bg-white/[0.04]'}`}
            >
              <AppIcon name="nav.tabs" className="w-4 h-4 flex-shrink-0" strokeWidth={1.7} gradient={aiTabs.length ? BRAND_GRADIENT : undefined} />
              {aiTabs.length > 0 && (
                <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-violet-600 text-white text-[9px] font-bold flex items-center justify-center border border-[#0c0c10]">
                  {aiTabs.length}
                </span>
              )}
            </button>
          </div>
        ) : (
          <div className="mt-4">
            <button
              onClick={() => setTabsExpanded(!tabsExpanded)}
              className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-xs font-medium transition-colors duration-150 text-zinc-300 hover:text-white hover:bg-white/[0.04] border border-transparent hover:border-white/[0.06]"
            >
              <AppIcon name="nav.tabs" className="w-4 h-4 flex-shrink-0" strokeWidth={1.7} gradient={aiTabs.length ? BRAND_GRADIENT : undefined} />
              <span className="flex-1 text-left tracking-wide">Tabs</span>
              <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full border transition-colors ${aiTabs.length ? 'bg-violet-500/15 text-violet-300 border-violet-500/20' : 'bg-white/[0.06] text-zinc-500 border-white/[0.08]'}`}>
                {aiTabs.length}
              </span>
              <svg className={`w-3 h-3 text-zinc-500 transition-transform duration-200 ${tabsExpanded ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
              </svg>
            </button>
            <div className={`grid transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] ${tabsExpanded ? 'grid-rows-[1fr] opacity-100 mt-1.5' : 'grid-rows-[0fr] opacity-0'}`}>
              <div className="overflow-hidden">
                <div className="space-y-1 px-1">
                  {aiTabs.length === 0 ? (
                    <div className="mx-1 rounded-lg border border-dashed border-white/[0.06] bg-white/[0.02] px-3 py-4 text-center">
                      <div className="w-8 h-8 mx-auto mb-2 rounded-lg bg-violet-500/10 border border-violet-500/20 flex items-center justify-center">
                        <AppIcon name="nav.tabs" className="w-4 h-4 text-violet-400" strokeWidth={1.7} />
                      </div>
                      <p className="text-[11px] font-medium text-zinc-300">No tabs yet</p>
                      <p className="text-[10px] text-zinc-500 mt-1 leading-relaxed">Ask the AI to create anything — website, image, video, quiz, document, dashboard — it will appear here.</p>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center justify-between px-1 pb-1">
                        <span className="text-[10px] text-zinc-500">{aiTabs.length} open</span>
                        <button
                          onClick={() => { aiTabs.forEach(t => closeAiTab(t.id)); if (aiTabs.some(t => t.id === activeView)) onNavChange('chats'); }}
                          className="text-[10px] text-zinc-500 hover:text-red-400 transition-colors"
                        >
                          Clear all
                        </button>
                      </div>
                      {aiTabs.map((tab) => {
                        const isActive = activeView === tab.id;
                        const hasEmoji = tab.icon && /[\u{1F300}-\u{1F9FF}]/u.test(tab.icon);
                        return (
                          <div key={tab.id} className="relative group/tab">
                            <button
                              onClick={() => onNavChange(tab.id)}
                              className={`group relative w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg transition-colors duration-150 text-xs text-left ${
                                isActive
                                  ? 'bg-white/[0.07] text-zinc-100 font-medium border border-white/[0.08]'
                                  : 'text-gray-500 hover:text-zinc-200 hover:bg-white/[0.04] border border-transparent'
                              }`}
                            >
                              {hasEmoji ? (
                                <span className="w-4 h-4 flex-shrink-0 text-center text-sm leading-4">{tab.icon}</span>
                              ) : (
                                <AppIcon
                                  name={tabIconName(tab.kind)}
                                  className="w-4 h-4 flex-shrink-0"
                                  strokeWidth={1.7}
                                />
                              )}
                              <span className="truncate flex-1">{tab.title}</span>
                              <span className="text-[9px] px-1 py-0.5 rounded bg-white/[0.06] border border-white/[0.08] text-zinc-500 capitalize hidden group-hover/tab:inline-flex">
                                {tab.kind}
                              </span>
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
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Starred section - only show when there are active starred items */}
        {!collapsed && starredItems.length > 0 && (
          <>
            <div className="pt-6 pb-1.5 px-2.5 text-[9px] font-semibold text-zinc-600 uppercase tracking-[0.13em]">
              Starred
            </div>
            {starredItems.map((item) => (
              <div
                key={item.name}
                className="flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-xs text-gray-500"
              >
                <span className="w-1.5 h-1.5 rounded-full bg-zinc-600" />
                <span className="truncate">{item.name}</span>
              </div>
            ))}
          </>
        )}

        {/* Recent Sessions */}
        {!collapsed && (
          <>
            <div className="pt-6 pb-1.5 px-2.5 flex items-center justify-between text-[9px] font-semibold text-zinc-600 uppercase tracking-[0.13em]">
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
              <label className="h-7 rounded-lg border border-white/[0.06] bg-white/[0.02] flex items-center gap-2 px-2 focus-within:border-white/[0.18] transition-colors">
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
                  id="sidebar-chat-search"
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
              groupSessionsByDate(sessions).map((group) => (
                <div key={group.label} className="mb-2">
                  <div className="px-2.5 py-1 text-[9px] font-medium text-zinc-600 uppercase tracking-wider">{group.label}</div>
                  {group.sessions.map((s) => (
                    <div key={s.id} className="relative">
                      <button
                        onClick={() => handleSelectSession(s.id)}
                        className={`group w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg transition-colors duration-150 text-xs ${
                          currentSessionId === s.id
                            ? 'bg-white/[0.06] text-white'
                            : 'text-gray-500 hover:text-zinc-200 hover:bg-white/[0.03]'
                        }`}
                      >
                        <svg
                          className={`w-3 h-3 flex-shrink-0 ${s.pinned ? 'text-zinc-400' : 'opacity-40'}`}
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
                        {useChatStore.getState().isSessionStreaming(s.id) && (
                          <span className="relative flex h-2 w-2 flex-shrink-0">
                            <span className="absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75 animate-ping" />
                            <span className="relative inline-flex rounded-full h-2 w-2 bg-indigo-400" />
                          </span>
                        )}
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
                        <div className="absolute z-50 right-1 top-7 w-36 rounded-lg border border-white/[0.08] bg-[#111113] p-1 shadow-2xl animate-scale-in">
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
                            {
                              label: 'Copy share',
                              action: async () => {
                                const r = await shareSession(s.id) as { ok: boolean; length?: number };
                                addToast({ title: r.ok ? 'Conversation copied to clipboard' : 'Share failed', type: r.ok ? 'success' : 'error' });
                              },
                            },
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
                  ))}
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
            className="w-full flex items-center gap-2.5 rounded-xl border border-white/[0.055] bg-white/[0.018] px-2.5 py-2.5 hover:border-white/[0.1] hover:bg-white/[0.035] transition-colors duration-150 text-left group"
            title={`${currentProvider} · ${currentModel}`}
          >
            <div className="w-7 h-7 rounded-lg bg-white/[0.035] border border-white/[0.08] flex items-center justify-center flex-shrink-0">
              <AppIcon name="topbar.engine" className="w-3.5 h-3.5 text-zinc-400" strokeWidth={1.7} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[9px] text-zinc-600 truncate">Selected · {currentProvider}</div>
              <div className="text-[11px] font-medium text-zinc-200 truncate">{currentModel}</div>
              {pairedLabel && (
                <div className="mt-0.5 inline-flex items-center gap-1 rounded-full border border-cyan-400/20 bg-cyan-400/[0.06] px-1.5 py-px text-[8px] font-medium text-cyan-300/80 truncate max-w-full">
                  + {pairedLabel}
                </div>
              )}
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
            <div className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-white/[0.04] border border-white/[0.07]">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse flex-shrink-0" />
              <span className="text-[10px] text-zinc-400 font-medium">
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
                  className={`w-1.5 h-1.5 rounded-full border ${providerConnected ? 'border-emerald-400 bg-emerald-400/20' : 'border-zinc-600'}`}
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

          {/* User row with phone connect + settings */}
          <div className="flex items-center gap-2.5 pt-2 border-t border-white/[0.06] px-1.5 py-1.5">
            <div
              onClick={() => window.dispatchEvent(new Event('infinite:open-personalization'))}
              className="os-profile-ring w-7 h-7 rounded-full flex items-center justify-center cursor-pointer flex-shrink-0 overflow-hidden"
              role="button"
              tabIndex={0}
              title="Personalize profile"
              onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') window.dispatchEvent(new Event('infinite:open-personalization')); }}
            >
              {user?.avatar ? <img src={user.avatar} alt="" className="h-full w-full object-cover" /> : <span className="text-xs font-semibold text-zinc-200">{user?.name?.charAt(0)?.toUpperCase() ?? 'U'}</span>}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-xs font-medium text-white truncate">{user?.name ?? 'User'}</div>
              <div className="text-[9px] text-gray-600 truncate">{user?.email ?? ''}</div>
            </div>
            <button
              onClick={() => setPhoneOpen(true)}
              className="icon-button w-7 h-7 flex-shrink-0"
              title="Connect phone (QR)"
              aria-label="Connect your phone"
            >
              <AppIcon name="action.phone" className="w-3.5 h-3.5" strokeWidth={1.7} />
            </button>
            <button
              onClick={onOpenSettings}
              className="icon-button w-7 h-7 flex-shrink-0"
              title="Settings"
              aria-label="Open settings"
            >
              <AppIcon name="nav.settings" className="w-3.5 h-3.5 opacity-80" strokeWidth={1.7} gradient={BRAND_GRADIENT} />
            </button>
          </div>
        </div>
      )}

      <PhoneConnectModal open={phoneOpen} onClose={() => setPhoneOpen(false)} />
    </aside>
  );
}
