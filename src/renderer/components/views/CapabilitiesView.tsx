import { useEffect, useMemo, useState } from 'react';
import { useChatStore } from '../../stores/chat';
import { AppIcon } from '../brand/AppIcon';
import { useNotificationStore } from '../../stores/notifications';

interface ToolInfo {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

interface SkillInfo {
  id: string;
  name: string;
  description: string;
  category: string;
  source: string;
  enabled: boolean;
  triggers?: string[];
}

const POWER_CATEGORIES = [
  { id: 'all', label: 'All' },
  { id: 'core', label: 'Core' },
  { id: 'computer', label: 'PC Control' },
  { id: 'web', label: 'Web' },
  { id: 'create', label: 'Create' },
  { id: 'data', label: 'Data & APIs' },
  { id: 'selfhelp', label: 'Self-Help' },
];

const TOOL_META: Record<string, { category: string; icon: string; keywords: string[] }> = {
  Bash: { category: 'core', icon: '⌘', keywords: ['run command', 'terminal', 'shell', 'powershell', 'cmd', 'script', 'execute'] },
  Read: { category: 'core', icon: '📄', keywords: ['read file', 'open file', 'view'] },
  Write: { category: 'core', icon: '✍️', keywords: ['create file', 'write file', 'save'] },
  Edit: { category: 'core', icon: '🔧', keywords: ['edit', 'modify', 'replace'] },
  Glob: { category: 'core', icon: '🗂️', keywords: ['list files', 'find files', 'glob'] },
  Grep: { category: 'core', icon: '🔎', keywords: ['search files', 'grep', 'regex'] },
  Delete: { category: 'core', icon: '🗑️', keywords: ['delete', 'remove'] },
  FileOps: { category: 'core', icon: '📁', keywords: ['copy', 'move', 'rename', 'zip', 'extract'] },
  WebSearch: { category: 'web', icon: '🔍', keywords: ['search web', 'google', 'find online'] },
  WebFetch: { category: 'web', icon: '🌐', keywords: ['fetch page', 'get url', 'scrape'] },
  browser_extension: { category: 'web', icon: '🧩', keywords: ['browser', 'chrome', 'edge', 'extension', 'tabs', 'click'] },
  Browser: { category: 'web', icon: '🌍', keywords: ['browse', 'fetch', 'http'] },
  Operator: { category: 'web', icon: '🖥️', keywords: ['chrome automation', 'cdp', 'headless'] },
  Computer: { category: 'computer', icon: '🖱️', keywords: ['mouse', 'keyboard', 'click', 'type', 'screen', 'desktop'] },
  TaskExecutor: { category: 'computer', icon: '🤖', keywords: ['multi-step', 'plan', 'execute task'] },
  System: { category: 'computer', icon: '⚙️', keywords: ['hardware', 'cpu', 'ram', 'battery', 'apps', 'winget'] },
  Notification: { category: 'computer', icon: '🔔', keywords: ['notify', 'alert', 'toast'] },
  GameAssistant: { category: 'computer', icon: '🎮', keywords: ['game', 'play'] },
  Voice: { category: 'computer', icon: '🎙️', keywords: ['speak', 'tts', 'text to speech', 'listen'] },
  Clipboard: { category: 'computer', icon: '📋', keywords: ['clipboard', 'copy', 'paste'] },
  ClipboardRead: { category: 'computer', icon: '📋', keywords: ['clipboard read'] },
  ClipboardWrite: { category: 'computer', icon: '📋', keywords: ['clipboard write'] },
  ClipboardImage: { category: 'computer', icon: '🖼️', keywords: ['clipboard image'] },
  Email: { category: 'web', icon: '✉️', keywords: ['email', 'mail', 'send', 'inbox'] },
  Knowledge: { category: 'core', icon: '🧠', keywords: ['memory', 'remember', 'recall', 'rag'] },
  Project: { category: 'core', icon: '📋', keywords: ['project', 'tasks', 'kanban', 'sprint'] },
  Automation: { category: 'core', icon: '⏰', keywords: ['schedule', 'workflow', 'cron', 'trigger'] },
  Agent: { category: 'core', icon: '🕸️', keywords: ['subagent', 'delegate', 'parallel', 'spawn'] },
  TaskGroup: { category: 'core', icon: '👥', keywords: ['multi-agent', 'parallel agents'] },
  create_custom_agent: { category: 'core', icon: '🛠️', keywords: ['custom agent', 'create agent'] },
  Skills: { category: 'core', icon: '📚', keywords: ['skills', 'procedures'] },
  SkillManage: { category: 'core', icon: '🧰', keywords: ['create skill', 'author skill'] },
  BuildFeature: { category: 'core', icon: '✨', keywords: ['feature', 'build', 'rollback'] },
  RollbackFeature: { category: 'core', icon: '↩️', keywords: ['undo feature', 'rollback'] },
  SelfImprove: { category: 'core', icon: '🌱', keywords: ['self improve', 'audit', 'fix'] },
  Security: { category: 'selfhelp', icon: '🛡️', keywords: ['security', 'scan', 'audit', 'vulnerability', 'defender'] },
  Network: { category: 'selfhelp', icon: '📶', keywords: ['wifi', 'wifi password', 'network', 'dns', 'ping', 'gateway'] },
  RouterAdmin: { category: 'selfhelp', icon: '📡', keywords: ['router', 'gateway', 'port forward', 'wifi password change'] },
  DocumentGenerator: { category: 'create', icon: '📄', keywords: ['pdf', 'excel', 'word', 'powerpoint', 'document'] },
  ChartGenerator: { category: 'create', icon: '📊', keywords: ['chart', 'graph', 'visualization'] },
  ImageEditor: { category: 'create', icon: '🎨', keywords: ['image', 'resize', 'crop', 'filter', 'watermark'] },
  Calendar: { category: 'create', icon: '📅', keywords: ['calendar', 'ics', 'event'] },
  CreateTab: { category: 'create', icon: '📑', keywords: ['tab', 'sidebar', 'dashboard', 'workspace'] },
  APITester: { category: 'data', icon: '🔌', keywords: ['api', 'http', 'rest', 'request'] },
  Json: { category: 'data', icon: '🧩', keywords: ['json', 'parse', 'csv'] },
  Text: { category: 'data', icon: '🔤', keywords: ['text', 'case', 'slug', 'regex'] },
  Crypto: { category: 'data', icon: '🔐', keywords: ['hash', 'encrypt', 'uuid', 'password'] },
  Time: { category: 'data', icon: '🕐', keywords: ['time', 'timezone', 'date'] },
  Math: { category: 'data', icon: '🧮', keywords: ['math', 'calculate', 'statistics'] },
  Timer: { category: 'data', icon: '⏱️', keywords: ['timer', 'countdown', 'remind'] },
  Database: { category: 'data', icon: '🗄️', keywords: ['sqlite', 'database', 'sql'] },
  Docker: { category: 'data', icon: '🐳', keywords: ['docker', 'container'] },
  CICD: { category: 'data', icon: '🔄', keywords: ['ci', 'cd', 'github actions', 'pipeline'] },
  Deploy: { category: 'data', icon: '🚀', keywords: ['deploy', 'vercel', 'netlify'] },
  Git: { category: 'data', icon: '🌿', keywords: ['git', 'commit', 'push', 'branch'] },
  GitStatus: { category: 'data', icon: '🌿', keywords: ['git status'] },
  GitLog: { category: 'data', icon: '🌿', keywords: ['git log'] },
  GitCommit: { category: 'data', icon: '🌿', keywords: ['git commit'] },
  GitBranch: { category: 'data', icon: '🌿', keywords: ['git branch'] },
  GitPush: { category: 'data', icon: '🌿', keywords: ['git push'] },
  GitPull: { category: 'data', icon: '🌿', keywords: ['git pull'] },
  GitDiff: { category: 'data', icon: '🌿', keywords: ['git diff'] },
  Business: { category: 'data', icon: '💼', keywords: ['business', 'contact', 'invoice', 'lead', 'deal'] },
  BusinessAdvisor: { category: 'data', icon: '📈', keywords: ['advisor', 'crm', 'forecast', 'analytics'] },
  AppBuilder: { category: 'create', icon: '🛠️', keywords: ['app', 'react', 'electron', 'nextjs'] },
  WebsiteBuilder: { category: 'create', icon: '🌐', keywords: ['website', 'portfolio', 'saas'] },
  Teach: { category: 'core', icon: '🎓', keywords: ['teach', 'quiz', 'lesson', 'study'] },
};

function toolCategory(name: string): string {
  return TOOL_META[name]?.category ?? 'core';
}

function toolIcon(name: string): string {
  return TOOL_META[name]?.icon ?? '🛠️';
}

export function CapabilitiesView() {
  const sendMessage = useChatStore((state) => state.sendMessage);
  const selectSession = useChatStore((state) => state.selectSession);
  const createSession = useChatStore((state) => state.createSession);
  const addToast = useNotificationStore((s) => s.addToast);

  const [tools, setTools] = useState<ToolInfo[]>([]);
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [category, setCategory] = useState('all');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [expanded, setExpanded] = useState<string | null>(null);

  // Create tool / skill dialogs
  const [showCreateTool, setShowCreateTool] = useState(false);
  const [showCreateSkill, setShowCreateSkill] = useState(false);
  const [newSkill, setNewSkill] = useState({ name: '', description: '', category: 'general', instructions: '' });

  useEffect(() => {
    let cancelled = false;
    Promise.allSettled([
      window.api.listTools(),
      window.api.skillsList().catch(() => [] as SkillInfo[]),
    ]).then(([toolsResult, skillsResult]) => {
      if (cancelled) return;
      if (toolsResult.status === 'fulfilled') setTools(toolsResult.value ?? []);
      if (skillsResult.status === 'fulfilled') setSkills(skillsResult.value ?? []);
      setStatus('ready');
    }).catch(() => {
      if (!cancelled) setStatus('error');
    });
    return () => { cancelled = true; };
  }, []);

  const grouped = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const t of tools) {
      const c = toolCategory(t.name);
      counts[c] = (counts[c] ?? 0) + 1;
    }
    return counts;
  }, [tools]);

  const visibleTools = useMemo(() => {
    const q = query.trim().toLowerCase();
    return tools.filter((t) => {
      if (category !== 'all' && toolCategory(t.name) !== category) return false;
      if (!q) return true;
      const meta = TOOL_META[t.name];
      const haystack = [t.name, t.description, ...(meta?.keywords ?? [])].join(' ').toLowerCase();
      return haystack.includes(q);
    });
  }, [tools, category, query]);

  const runAction = async (prompt: string) => {
    const settings = JSON.parse(localStorage.getItem('infinite:current') ?? '{}');
    const session = await createSession(
      settings.cwd ?? '.',
      settings.model ?? 'meta-llama/llama-3.3-70b-instruct:free',
      settings.provider ?? 'openrouter',
    );
    selectSession(session.id);
    window.dispatchEvent(new CustomEvent('infinite:navigate', { detail: 'chats' }));
    void sendMessage(prompt);
  };

  const handleCreateSkill = async () => {
    if (!newSkill.name.trim()) return;
    try {
      // Ask the AI to author the skill via chat
      const prompt = `Create a new skill called "${newSkill.name}" in category "${newSkill.category}". Description: ${newSkill.description}. Instructions: ${newSkill.instructions || 'No extra instructions.'}`;
      const settings = JSON.parse(localStorage.getItem('infinite:current') ?? '{}');
      const session = await createSession(
        settings.cwd ?? '.',
        settings.model ?? 'meta-llama/llama-3.3-70b-instruct:free',
        settings.provider ?? 'openrouter',
      );
      selectSession(session.id);
      window.dispatchEvent(new CustomEvent('infinite:navigate', { detail: 'chats' }));
      void sendMessage(prompt);
      setShowCreateSkill(false);
      setNewSkill({ name: '', description: '', category: 'general', instructions: '' });
    } catch (e) {
      addToast({ type: 'error', title: 'Could not create skill', message: e instanceof Error ? e.message : String(e) });
    }
  };

  const handleToggleSkill = async (skill: SkillInfo) => {
    try {
      await window.api.skillsToggle(skill.id);
      // Refresh
      const updated = await window.api.skillsList().catch(() => [] as SkillInfo[]);
      setSkills(updated);
    } catch (e) {
      addToast({ type: 'error', title: 'Could not update skill', message: e instanceof Error ? e.message : String(e) });
    }
  };

  return (
    <div className="flex-1 overflow-y-auto p-6 animate-fade-in">
      {/* Header — matches AutomationView */}
      <div className="flex items-start justify-between gap-4 mb-5">
        <div>
          <h1 className="text-xl font-semibold text-textMain">Tools &amp; Skills</h1>
          <p className="text-textMuted text-sm mt-1">Power center — every tool, every skill, every one-tap action. Ask for anything in chat.</p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            onClick={() => setShowCreateSkill(true)}
            className="px-3.5 py-2 bg-white/[0.04] border border-white/[0.08] text-zinc-300 rounded-lg text-xs font-medium hover:bg-white/[0.07] transition-colors"
          >
            New skill
          </button>
          <button
            onClick={() => setShowCreateTool(true)}
            className="btn-premium px-3.5 py-2 text-xs flex items-center gap-1.5"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2.2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>
            New tool
          </button>
        </div>
      </div>

      {/* Status strip — matches AutomationView */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 mb-6 text-[11px] text-textMuted">
        <span className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
          {tools.length} tools installed
        </span>
        <span>{skills.filter((s) => s.enabled).length} skills active</span>
        <span>{skills.length} total skills</span>
        <span>{POWER_CATEGORIES.length - 1} categories</span>
        {status === 'loading' && <span className="text-zinc-500">Loading…</span>}
      </div>

      {status === 'error' && (
        <div className="mb-6 rounded-xl border border-red-400/20 bg-red-400/[0.05] px-4 py-3 text-sm text-red-300">
          Could not reach the tool registry. Restart Infinite OS and try again.
        </div>
      )}

      {/* Create skill dialog */}
      {showCreateSkill && (
        <div className="bg-bgPanel border border-white/[0.09] rounded-xl p-5 mb-6 shadow-xl animate-scale-in">
          <h3 className="text-sm font-semibold text-textMain mb-4">New skill</h3>
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div>
              <label className="text-xs text-textMuted mb-1.5 block">Name *</label>
              <input
                value={newSkill.name}
                onChange={(e) => setNewSkill((p) => ({ ...p, name: e.target.value }))}
                placeholder="e.g. Weekly report"
                className="w-full bg-bgInput border border-borderSubtle rounded-lg px-3 py-2 text-sm text-textMain placeholder-textMuted focus:outline-none focus:border-white/[0.25]"
              />
            </div>
            <div>
              <label className="text-xs text-textMuted mb-1.5 block">Category</label>
              <input
                value={newSkill.category}
                onChange={(e) => setNewSkill((p) => ({ ...p, category: e.target.value }))}
                placeholder="general"
                className="w-full bg-bgInput border border-borderSubtle rounded-lg px-3 py-2 text-sm text-textMain placeholder-textMuted focus:outline-none focus:border-white/[0.25]"
              />
            </div>
          </div>
          <div className="mb-4">
            <label className="text-xs text-textMuted mb-1.5 block">Description</label>
            <input
              value={newSkill.description}
              onChange={(e) => setNewSkill((p) => ({ ...p, description: e.target.value }))}
              placeholder="What does this skill do?"
              className="w-full bg-bgInput border border-borderSubtle rounded-lg px-3 py-2 text-sm text-textMain placeholder-textMuted focus:outline-none focus:border-white/[0.25]"
            />
          </div>
          <div className="mb-5">
            <label className="text-xs text-textMuted mb-1.5 block">Instructions</label>
            <textarea
              value={newSkill.instructions}
              onChange={(e) => setNewSkill((p) => ({ ...p, instructions: e.target.value }))}
              placeholder="Step-by-step instructions for the skill…"
              className="w-full bg-bgInput border border-borderSubtle rounded-lg px-3 py-2 text-sm text-textMain placeholder-textMuted h-20 resize-none focus:outline-none focus:border-white/[0.25]"
            />
          </div>
          <div className="flex gap-2 justify-end">
            <button onClick={() => setShowCreateSkill(false)} className="px-4 py-2 text-textMuted hover:text-textMain text-sm rounded-lg transition-colors">Cancel</button>
            <button
              onClick={() => void handleCreateSkill()}
              disabled={!newSkill.name.trim()}
              className="btn-premium px-5 py-2 text-sm disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Create Skill
            </button>
          </div>
        </div>
      )}

      {/* Create tool dialog */}
      {showCreateTool && (
        <div className="bg-bgPanel border border-white/[0.09] rounded-xl p-5 mb-6 shadow-xl animate-scale-in">
          <h3 className="text-sm font-semibold text-textMain mb-4">New tool</h3>
          <p className="text-xs text-textMuted mb-4 leading-relaxed">
            Tools are code. Describe what you want the tool to do and Infinite AI will build it for you.
          </p>
          <div className="flex gap-2 justify-end">
            <button onClick={() => setShowCreateTool(false)} className="px-4 py-2 text-textMuted hover:text-textMain text-sm rounded-lg transition-colors">Cancel</button>
            <button
              onClick={() => {
                setShowCreateTool(false);
                const settings = JSON.parse(localStorage.getItem('infinite:current') ?? '{}');
                createSession(
                  settings.cwd ?? '.',
                  settings.model ?? 'meta-llama/llama-3.3-70b-instruct:free',
                  settings.provider ?? 'openrouter',
                ).then((session) => {
                  selectSession(session.id);
                  window.dispatchEvent(new CustomEvent('infinite:navigate', { detail: 'chats' }));
                  void sendMessage('Create a new tool for me. Ask me what it should do, what inputs it takes, and what it should return.');
                });
              }}
              className="btn-premium px-5 py-2 text-sm"
            >
              Ask Infinite AI
            </button>
          </div>
        </div>
      )}

      {/* Quick actions */}
      <section className="mb-6">
        <h2 className="text-sm font-semibold text-textMain mb-3">Try it now</h2>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {QUICK_ACTIONS.map((action) => (
            <button
              key={action.label}
              onClick={() => void runAction(action.prompt)}
              className="group relative flex items-center gap-3 rounded-xl border border-white/[0.07] bg-bgPanel px-4 py-3.5 text-left hover:border-white/[0.13] transition-colors"
            >
              <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg border border-white/[0.08] bg-white/[0.03] text-sm">
                {action.icon}
              </span>
              <div className="min-w-0">
                <div className="truncate text-xs font-medium text-zinc-200 group-hover:text-white">{action.label}</div>
                <div className="mt-0.5 text-[10px] text-textMuted">Ask in chat →</div>
              </div>
            </button>
          ))}
        </div>
      </section>

      {/* Skills */}
      <section className="mb-6">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-textMain">Skills</h2>
          {skills.length > 0 && (
            <span className="text-[11px] text-textMuted">{skills.length} skills · {skills.filter((s) => s.enabled).length} active</span>
          )}
        </div>
        {skills.length === 0 ? (
          <div className="text-center py-8 text-textMuted border border-dashed border-white/[0.08] rounded-xl">
            <AppIcon name="home.memory" className="w-6 h-6 text-zinc-600 mx-auto mb-2" strokeWidth={1.6} />
            <p className="text-xs">No skills yet. Create your first skill above or ask Infinite AI to teach itself a workflow.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {skills.map((skill) => (
              <div
                key={skill.id}
                className="group bg-bgPanel border border-white/[0.07] rounded-xl px-4 py-3 hover:border-white/[0.13] transition-colors"
              >
                <div className="flex items-center gap-2">
                  <span className="text-sm">📚</span>
                  <span className="truncate text-xs font-medium text-zinc-200">{skill.name}</span>
                  <span className="ml-auto flex-shrink-0 rounded-md border border-white/[0.08] bg-white/[0.04] px-1.5 py-0.5 text-[9px] text-zinc-500">
                    {skill.category || 'general'}
                  </span>
                  <span className={`h-1.5 w-1.5 rounded-full flex-shrink-0 ${skill.enabled ? 'bg-emerald-400' : 'bg-zinc-700'}`} title={skill.enabled ? 'Active' : 'Disabled'} />
                </div>
                <p className="mt-2 line-clamp-2 text-[11px] leading-5 text-textMuted">{skill.description}</p>
                <div className="mt-2.5 flex items-center gap-2">
                  {skill.triggers && skill.triggers.length > 0 && (
                    <div className="flex flex-wrap gap-1 flex-1">
                      {skill.triggers.slice(0, 3).map((trigger) => (
                        <span key={trigger} className="rounded-md bg-cyan-400/[0.06] px-1.5 py-0.5 text-[9px] text-cyan-300/70">
                          {trigger}
                        </span>
                      ))}
                    </div>
                  )}
                  <button
                    role="switch"
                    aria-checked={skill.enabled}
                    onClick={() => void handleToggleSkill(skill)}
                    className={`relative ml-auto w-8 h-4 rounded-full border transition-colors duration-150 flex-shrink-0 ${
                      skill.enabled ? 'bg-emerald-500/70 border-emerald-400/30' : 'bg-white/[0.06] border-white/[0.12]'
                    }`}
                  >
                    <span className={`absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full transition-all duration-150 ${skill.enabled ? 'left-[14px] bg-white' : 'left-[2px] bg-zinc-500'}`} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Tool browser */}
      <section className="mb-6">
        <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-sm font-semibold text-textMain">Tool browser <span className="font-normal text-textMuted">· {tools.length} registered · every one callable from chat</span></h2>
          <label className="relative flex h-8 w-full max-w-xs items-center gap-2 rounded-lg border border-white/[0.07] bg-white/[0.02] px-3 focus-within:border-white/[0.2]">
            <svg className="h-3.5 w-3.5 flex-shrink-0 text-zinc-600" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" d="m21 21-4.35-4.35M17 10.5a6.5 6.5 0 1 1-13 0 6.5 6.5 0 0 1 13 0Z" />
            </svg>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search tools…"
              className="min-w-0 flex-1 bg-transparent text-xs text-zinc-200 placeholder:text-zinc-700 outline-none"
            />
          </label>
        </div>

        <div className="mb-4 flex flex-wrap gap-1.5">
          {POWER_CATEGORIES.map((cat) => (
            <button
              key={cat.id}
              onClick={() => setCategory(cat.id)}
              className={`rounded-lg border px-2.5 py-1.5 text-[11px] transition-colors duration-150 ${
                category === cat.id
                  ? 'border-white/[0.14] bg-white/[0.07] text-white'
                  : 'border-white/[0.06] bg-white/[0.015] text-zinc-500 hover:text-zinc-200 hover:bg-white/[0.04]'
              }`}
            >
              {cat.label}
              {cat.id !== 'all' && (
                <span className="ml-1.5 text-[9px] text-zinc-600">{grouped[cat.id] ?? 0}</span>
              )}
            </button>
          ))}
        </div>

        {visibleTools.length === 0 ? (
          <div className="rounded-xl border border-white/[0.06] bg-white/[0.015] px-4 py-8 text-center text-xs text-zinc-600">
            No tools match your search. Try a different term or category.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
            {visibleTools.map((tool) => {
              const isExpanded = expanded === tool.name;
              const props = Object.keys((tool.inputSchema as Record<string, unknown>)?.properties as Record<string, unknown> ?? {});
              return (
                <div
                  key={tool.name}
                  className={`rounded-xl border transition-colors duration-150 ${
                    isExpanded ? 'border-white/[0.14] bg-white/[0.03]' : 'border-white/[0.07] bg-bgPanel hover:border-white/[0.13]'
                  }`}
                >
                  <button
                    onClick={() => setExpanded(isExpanded ? null : tool.name)}
                    className="flex w-full items-start gap-3 px-4 py-3.5 text-left"
                  >
                    <span className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg border border-white/[0.08] bg-white/[0.03] text-sm">
                      {toolIcon(tool.name)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate font-mono text-xs font-medium text-zinc-100">{tool.name}</span>
                        <span className="flex-shrink-0 rounded-md border border-white/[0.08] bg-white/[0.04] px-1.5 py-0.5 text-[9px] text-zinc-500">
                          {toolCategory(tool.name)}
                        </span>
                      </div>
                      <p className={`mt-1 text-[11px] leading-5 text-textMuted ${isExpanded ? '' : 'line-clamp-2'}`}>
                        {tool.description}
                      </p>
                      {isExpanded && (
                        <div className="mt-3 border-t border-white/[0.06] pt-2.5">
                          {props.length > 0 ? (
                            <div className="flex flex-wrap gap-1.5">
                              {props.map((prop) => (
                                <code key={prop} className="rounded bg-white/[0.05] px-1.5 py-0.5 font-mono text-[9px] text-zinc-400">
                                  {prop}
                                </code>
                              ))}
                            </div>
                          ) : (
                            <span className="text-[9px] text-zinc-700">No parameters</span>
                          )}
                        </div>
                      )}
                    </div>
                    <svg
                      className={`mt-1 h-3.5 w-3.5 flex-shrink-0 text-zinc-600 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}
                      fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
                    </svg>
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <footer className="pb-6 text-center text-[10px] text-zinc-700">
        Capabilities are surfaced automatically from the live tool registry — no restart needed.
      </footer>
    </div>
  );
}

const QUICK_ACTIONS: Array<{ label: string; icon: string; prompt: string }> = [
  { label: 'Recover my Wi-Fi password', icon: '📶', prompt: 'I forgot my Wi-Fi password. List the saved Wi-Fi profiles on this PC, then recover the stored password for my current network using the Network tool.' },
  { label: 'Diagnose my internet', icon: '🩺', prompt: 'Run network diagnostics on this PC: show my connection status and gateway, ping the gateway, and test DNS resolution. Summarize what you find and what to fix.' },
  { label: 'Show my PC health', icon: '⚙️', prompt: 'Show me a health snapshot of this PC: CPU, RAM, disk, battery, and top processes. Flag anything that looks wrong.' },
  { label: 'Build a quick app', icon: '⚡', prompt: 'Scaffold a small React app with the App Builder and tell me how to run it.' },
  { label: 'Summarize a document', icon: '📄', prompt: 'Pick a document from my workspace, read it, and give me a concise summary with key takeaways.' },
  { label: 'Make a chart', icon: '📊', prompt: 'Generate a chart visualizing something useful from my recent data and open it in a side tab.' },
  { label: 'Create an automation', icon: '⏰', prompt: 'Show me automation templates and set up one useful recurring workflow for me.' },
  { label: 'Check my security', icon: '🛡️', prompt: 'Run a defensive security check on this machine: scan for exposed secrets in my workspace and check dependency vulnerabilities. Report findings only.' },
];
