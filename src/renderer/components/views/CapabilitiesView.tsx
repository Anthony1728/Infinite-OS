import { useEffect, useMemo, useState } from 'react';
import { useChatStore } from '../../stores/chat';

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
  { id: 'all', label: 'All', color: '#818cf8' },
  { id: 'core', label: 'Core', color: '#22d3ee' },
  { id: 'computer', label: 'PC Control', color: '#f59e0b' },
  { id: 'web', label: 'Web', color: '#38bdf8' },
  { id: 'create', label: 'Create', color: '#ec4899' },
  { id: 'data', label: 'Data & APIs', color: '#34d399' },
  { id: 'selfhelp', label: 'Self-Help', color: '#a78bfa' },
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

const QUICK_ACTIONS: Array<{ label: string; icon: string; prompt: string; accent: string }> = [
  {
    label: 'Recover my Wi-Fi password',
    icon: '📶',
    prompt: 'I forgot my Wi-Fi password. List the saved Wi-Fi profiles on this PC, then recover the stored password for my current network using the Network tool.',
    accent: '#a78bfa',
  },
  {
    label: 'Diagnose my internet',
    icon: '🩺',
    prompt: 'Run network diagnostics on this PC: show my connection status and gateway, ping the gateway, and test DNS resolution. Summarize what you find and what to fix.',
    accent: '#38bdf8',
  },
  {
    label: 'Show my PC health',
    icon: '⚙️',
    prompt: 'Show me a health snapshot of this PC: CPU, RAM, disk, battery, and top processes. Flag anything that looks wrong.',
    accent: '#f59e0b',
  },
  {
    label: 'Build a quick app',
    icon: '⚡',
    prompt: 'Scaffold a small React app with the App Builder and tell me how to run it.',
    accent: '#ec4899',
  },
  {
    label: 'Summarize a document',
    icon: '📄',
    prompt: 'Pick a document from my workspace, read it, and give me a concise summary with key takeaways.',
    accent: '#22d3ee',
  },
  {
    label: 'Make a chart',
    icon: '📊',
    prompt: 'Generate a chart visualizing something useful from my recent data and open it in a side tab.',
    accent: '#34d399',
  },
  {
    label: 'Create an automation',
    icon: '⏰',
    prompt: 'Show me automation templates and set up one useful recurring workflow for me.',
    accent: '#fbbf24',
  },
  {
    label: 'Check my security',
    icon: '🛡️',
    prompt: 'Run a defensive security check on this machine: scan for exposed secrets in my workspace and check dependency vulnerabilities. Report findings only.',
    accent: '#ef4444',
  },
];

function toolCategory(name: string): string {
  return TOOL_META[name]?.category ?? 'core';
}

function toolIcon(name: string): string {
  return TOOL_META[name]?.icon ?? '🛠️';
}

function badgeClass(category: string): string {
  switch (category) {
    case 'core': return 'bg-cyan-400/10 text-cyan-300 border-cyan-400/20';
    case 'computer': return 'bg-amber-400/10 text-amber-300 border-amber-400/20';
    case 'web': return 'bg-sky-400/10 text-sky-300 border-sky-400/20';
    case 'create': return 'bg-pink-400/10 text-pink-300 border-pink-400/20';
    case 'data': return 'bg-emerald-400/10 text-emerald-300 border-emerald-400/20';
    case 'selfhelp': return 'bg-violet-400/10 text-violet-300 border-violet-400/20';
    default: return 'bg-white/[0.05] text-zinc-400 border-white/[0.08]';
  }
}

const CATEGORY_LABEL: Record<string, string> = {
  core: 'Core',
  computer: 'PC Control',
  web: 'Web',
  create: 'Create',
  data: 'Data & APIs',
  selfhelp: 'Self-Help',
};

export function CapabilitiesView() {
  const sendMessage = useChatStore((state) => state.sendMessage);
  const selectSession = useChatStore((state) => state.selectSession);
  const createSession = useChatStore((state) => state.createSession);

  const [tools, setTools] = useState<ToolInfo[]>([]);
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [category, setCategory] = useState('all');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [expanded, setExpanded] = useState<string | null>(null);

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

  return (
    <div className="h-full min-h-0 overflow-y-auto chat-scrollbar bg-[#080a10]">
      <div className="mx-auto max-w-6xl px-6 py-8 sm:px-8">
        {/* Header */}
        <div className="mb-8">
          <div className="text-[10px] uppercase tracking-[0.18em] text-cyan-400/70">Power Center</div>
          <h1 className="mt-2 text-2xl font-semibold text-zinc-100 tracking-[-0.02em]">Everything I can do</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-500">
            Full toolset, reusable skills, and one-tap actions. Ask for anything in chat — recovering your own
            Wi-Fi password, controlling this PC, browsing the web, generating documents, building apps, or
            automating workflows. Your PC, your data, your call.
          </p>
        </div>

        {status === 'error' && (
          <div className="mb-6 rounded-xl border border-red-400/20 bg-red-400/[0.05] px-4 py-3 text-sm text-red-300">
            Could not reach the tool registry. Restart Infinite OS and try again.
          </div>
        )}

        {/* Stat cards */}
        <div className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard label="Tools installed" value={tools.length} accent="#818cf8" icon="🛠️" />
          <StatCard label="Skills ready" value={skills.filter((s) => s.enabled).length} accent="#38bdf8" icon="📚" />
          <StatCard label="Categories" value={POWER_CATEGORIES.length - 1} accent="#22d3ee" icon="🗂️" />
          <StatCard label="Quick actions" value={QUICK_ACTIONS.length} accent="#34d399" icon="⚡" />
        </div>

        {/* Quick actions */}
        <section className="mb-10">
          <SectionTitle title="Try it now" subtitle="One click sends the request straight to chat" />
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
            {QUICK_ACTIONS.map((action) => (
              <button
                key={action.label}
                onClick={() => void runAction(action.prompt)}
                className="group relative overflow-hidden rounded-xl border border-white/[0.07] bg-white/[0.025] px-4 py-3.5 text-left transition-all duration-150 hover:bg-white/[0.045]"
                style={{ boxShadow: 'none' }}
              >
                <div
                  className="absolute inset-x-0 top-0 h-px opacity-0 transition-opacity duration-200 group-hover:opacity-100"
                  style={{ background: `linear-gradient(90deg, transparent, ${action.accent}, transparent)` }}
                />
                <div className="flex items-center gap-3">
                  <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg border border-white/[0.08] bg-white/[0.03] text-base">
                    {action.icon}
                  </span>
                  <div className="min-w-0">
                    <div className="truncate text-xs font-medium text-zinc-200 group-hover:text-white">{action.label}</div>
                    <div className="mt-0.5 text-[10px] text-zinc-600">Ask in chat →</div>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </section>

        {/* Skills */}
        <section className="mb-10">
          <SectionTitle title="Skills" subtitle="Reusable procedures that make me faster and safer" />
          {skills.length === 0 ? (
            <div className="rounded-xl border border-white/[0.06] bg-white/[0.015] px-4 py-6 text-center text-xs text-zinc-600">
              No skills installed yet. Ask me to create one — I can teach myself any repeatable workflow.
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
              {skills.map((skill) => (
                <div
                  key={skill.id}
                  className="flex flex-col rounded-xl border border-white/[0.07] bg-white/[0.02] px-4 py-3.5"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-sm">📚</span>
                    <span className="truncate text-xs font-medium text-zinc-200">{skill.name}</span>
                    <span className="ml-auto flex-shrink-0 rounded-md border border-white/[0.08] bg-white/[0.04] px-1.5 py-0.5 text-[9px] text-zinc-500">
                      {skill.category || 'general'}
                    </span>
                  </div>
                  <p className="mt-2 line-clamp-2 text-[11px] leading-5 text-zinc-500">{skill.description}</p>
                  {skill.triggers && skill.triggers.length > 0 && (
                    <div className="mt-2.5 flex flex-wrap gap-1.5">
                      {skill.triggers.slice(0, 3).map((trigger) => (
                        <span key={trigger} className="rounded-md bg-cyan-400/[0.06] px-1.5 py-0.5 text-[9px] text-cyan-300/70">
                          {trigger}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Tool browser */}
        <section className="mb-6">
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <SectionTitle title="Tool browser" subtitle={`${tools.length} registered tools · every one callable from chat`} compact />
            <label className="relative flex h-9 w-full max-w-xs items-center gap-2 rounded-lg border border-white/[0.07] bg-white/[0.02] px-3 focus-within:border-indigo-500/40">
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
                className={`rounded-lg border px-2.5 py-1.5 text-[11px] transition-all duration-150 ${
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
                const cat = toolCategory(tool.name);
                const props = Object.keys(tool.inputSchema?.properties ?? {});
                return (
                  <div
                    key={tool.name}
                    className={`rounded-xl border transition-colors duration-150 ${
                      isExpanded ? 'border-cyan-400/25 bg-cyan-400/[0.025]' : 'border-white/[0.07] bg-white/[0.02] hover:border-white/[0.12]'
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
                          <span className={`flex-shrink-0 rounded-md border px-1.5 py-0.5 text-[9px] ${badgeClass(cat)}`}>
                            {CATEGORY_LABEL[cat] ?? cat}
                          </span>
                        </div>
                        <p className={`mt-1 text-[11px] leading-5 text-zinc-500 ${isExpanded ? '' : 'line-clamp-2'}`}>
                          {tool.description}
                        </p>
                        {isExpanded && (
                          <div className="mt-3 border-t border-white/[0.06] pt-2.5">
                            {props.length > 0 ? (
                              <div className="flex flex-wrap gap-1.5">
                                {props.map((prop) => (
                                  <code key={prop} className="rounded bg-white/[0.05] px-1.5 py-0.5 font-mono text-[9px] text-cyan-300/80">
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
                        className={`mt-1 h-3.5 w-3.5 flex-shrink-0 text-zinc-700 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}
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
    </div>
  );
}

function StatCard({ label, value, icon, accent }: { label: string; value: number; icon: string; accent: string }) {
  return (
    <div className="relative overflow-hidden rounded-xl border border-white/[0.07] bg-white/[0.02] px-4 py-4">
      <div
        className="pointer-events-none absolute -right-4 -top-4 h-16 w-16 rounded-full opacity-[0.12] blur-2xl"
        style={{ background: accent }}
      />
      <div className="flex items-center justify-between">
        <span className="text-lg">{icon}</span>
        <span
          className="h-1.5 w-1.5 rounded-full"
          style={{ background: accent, boxShadow: `0 0 8px ${accent}` }}
        />
      </div>
      <div className="mt-3 text-2xl font-semibold tracking-[-0.02em] text-zinc-100">{value}</div>
      <div className="mt-0.5 text-[10px] uppercase tracking-[0.12em] text-zinc-600">{label}</div>
    </div>
  );
}

function SectionTitle({ title, subtitle, compact }: { title: string; subtitle: string; compact?: boolean }) {
  return (
    <div className={compact ? '' : 'mb-4'}>
      <h2 className="text-sm font-semibold text-zinc-100 tracking-[-0.01em]">{title}</h2>
      <p className={`text-[11px] text-zinc-600 ${compact ? 'mt-0.5' : 'mt-1'}`}>{subtitle}</p>
    </div>
  );
}
