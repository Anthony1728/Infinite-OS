import { useEffect, useState } from 'react';
import { useAgentsStore } from '../../stores/agents';
import { useChatStore } from '../../stores/chat';

const MODULES = [
  {
    id: 'chats',
    title: 'AI Workspace',
    status: 'Live',
    metric: 'Multi-model chat',
    accent: 'from-indigo-500 to-cyan-500',
    icon: 'M2.25 12.76c0 1.6 1.123 2.994 2.707 3.227 1.087.16 2.185.283 3.293.369V21l4.076-4.076a1.526 1.526 0 0 1 1.037-.443 48.282 48.282 0 0 0 5.68-.494c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0 0 12 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z',
  },
  {
    id: 'agents',
    title: 'Agent Fleet',
    status: 'Live',
    metric: '84 agent templates',
    accent: 'from-violet-500 to-indigo-600',
    icon: 'M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09z',
  },
  {
    id: 'multi-agent',
    title: 'Orchestrator',
    status: 'Live',
    metric: 'Parallel agent missions',
    accent: 'from-rose-500 to-pink-600',
    icon: 'M15 19.128a9.38 9.38 0 0 0 2.625.372 9.337 9.337 0 0 0 4.121-.952 4.125 4.125 0 0 0-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 0 1 8.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0 1 11.964-3.07M12 6.375a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0zm8.25 2.25a2.625 2.625 0 1 1-5.25 0 2.625 2.625 0 0 1 5.25 0z',
  },
  {
    id: 'automations',
    title: 'Automation Studio',
    status: 'Live',
    metric: 'Workflow engine',
    accent: 'from-amber-500 to-orange-500',
    icon: 'M3.75 13.5 14.25 2.25 12 10.5h8.25L9.75 21.75 12 13.5H3.75z',
  },
  {
    id: 'browser',
    title: 'Browser Control',
    status: 'Live',
    metric: 'Web automation',
    accent: 'from-sky-500 to-blue-600',
    icon: 'M12 21a9.004 9.004 0 0 0 8.716-6.747M12 21a9.004 9.004 0 0 1-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3',
  },
  {
    id: 'cloud',
    title: 'Cloud Workspace',
    status: 'Beta',
    metric: 'Sync layer',
    accent: 'from-cyan-500 to-teal-500',
    icon: 'M12 16.5V9.75m0 0 3 3m-3-3-3 3M6.75 19.5a4.5 4.5 0 0 1-1.41-8.775 5.25 5.25 0 0 1 10.233-2.33 3 3 0 0 1 3.758 3.848A3.752 3.752 0 0 1 18 19.5H6.75z',
  },
  {
    id: 'business',
    title: 'Business Suite',
    status: 'Live',
    metric: 'CRM and analytics',
    accent: 'from-orange-500 to-rose-500',
    icon: 'M20.25 14.15v4.25c0 1.094-.787 2.036-1.872 2.18-2.087.277-4.216.42-6.378.42s-4.291-.143-6.378-.42c-1.085-.144-1.872-1.086-1.872-2.18v-4.25m16.5 0a2.18 2.18 0 0 0 .75-1.661V8.706c0-1.081-.768-2.015-1.837-2.175a48.114 48.114 0 0 0-3.413-.387m-16.5 2.956V8.706c0-1.081.768-2.015 1.837-2.175a48.114 48.114 0 0 1 3.413-.387m7.5 0V5.25A2.25 2.25 0 0 0 13.5 3h-3a2.25 2.25 0 0 0-2.25 2.25v.894',
  },
  {
    id: 'plugins',
    title: 'Plugin Marketplace',
    status: 'Alpha',
    metric: 'Extensions',
    accent: 'from-lime-500 to-emerald-500',
    icon: 'M14.25 6.087c0-.355.186-.676.476-.88l1.282-.897a1.125 1.125 0 0 1 1.572.275l1.5 2.25c.343.514.208 1.209-.304 1.554l-1.155.779a1.08 1.08 0 0 0-.467.894v3.876c0 .36.18.697.48.897l1.142.761c.512.342.65 1.034.309 1.547l-1.5 2.25a1.125 1.125 0 0 1-1.57.286l-1.29-.882a1.08 1.08 0 0 0-.609-.189H9.884c-.218 0-.43.066-.609.189l-1.29.882a1.125 1.125 0 0 1-1.57-.286l-1.5-2.25a1.125 1.125 0 0 1 .309-1.547l1.142-.761c.3-.2.48-.537.48-.897v-3.876c0-.358-.177-.693-.474-.894l-1.148-.779a1.125 1.125 0 0 1-.304-1.554l1.5-2.25a1.125 1.125 0 0 1 1.572-.275l1.282.897c.29.204.476.525.476.88v.163a1.5 1.5 0 0 0 1.5 1.5h1.5a1.5 1.5 0 0 0 1.5-1.5v-.163z',
  },
];

const QUICK_ACTIONS = [
  { label: 'New Chat', view: 'chats', icon: 'M2.25 12.76c0 1.6 1.123 2.994 2.707 3.227 1.087.16 2.185.283 3.293.369V21l4.076-4.076a1.526 1.526 0 0 1 1.037-.443 48.282 48.282 0 0 0 5.68-.494c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0 0 12 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z', color: 'text-indigo-400 bg-indigo-400/10' },
  { label: 'Deploy Agent', view: 'agents', icon: 'M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09z', color: 'text-violet-400 bg-violet-400/10' },
  { label: 'Orchestrate', view: 'multi-agent', icon: 'M15 19.128a9.38 9.38 0 0 0 2.625.372 9.337 9.337 0 0 0 4.121-.952 4.125 4.125 0 0 0-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M12 6.375a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0zm8.25 2.25a2.625 2.625 0 1 1-5.25 0 2.625 2.625 0 0 1 5.25 0z', color: 'text-rose-400 bg-rose-400/10' },
  { label: 'Automate', view: 'automations', icon: 'M3.75 13.5 14.25 2.25 12 10.5h8.25L9.75 21.75 12 13.5H3.75z', color: 'text-amber-400 bg-amber-400/10' },
  { label: 'Cloud Sync', view: 'cloud', icon: 'M12 16.5V9.75m0 0 3 3m-3-3-3 3M6.75 19.5a4.5 4.5 0 0 1-1.41-8.775 5.25 5.25 0 0 1 10.233-2.33 3 3 0 0 1 3.758 3.848A3.752 3.752 0 0 1 18 19.5H6.75z', color: 'text-cyan-400 bg-cyan-400/10' },
  { label: 'Business', view: 'business', icon: 'M20.25 14.15v4.25c0 1.094-.787 2.036-1.872 2.18-2.087.277-4.216.42-6.378.42s-4.291-.143-6.378-.42c-1.085-.144-1.872-1.086-1.872-2.18v-4.25m16.5 0a2.18 2.18 0 0 0 .75-1.661V8.706c0-1.081-.768-2.015-1.837-2.175a48.114 48.114 0 0 0-3.413-.387', color: 'text-orange-400 bg-orange-400/10' },
];

const WORKFLOWS = [
  { name: 'Capture customer request', stage: 'Business Suite', progress: 72 },
  { name: 'Review repository changes', stage: 'AI Coding', progress: 54 },
  { name: 'Publish campaign assets', stage: 'Creative Studio', progress: 38 },
];

interface OSHomeViewProps {
  onOpenView: (view: string) => void;
}

export function OSHomeView({ onOpenView }: OSHomeViewProps) {
  const { runs } = useAgentsStore();
  const { sessions } = useChatStore();
  const [timeStr, setTimeStr] = useState('');

  const activeAgents = runs.filter((r) => r.status === 'running').length;
  const completedToday = runs.filter((r) => r.status === 'completed').length;

  useEffect(() => {
    const tick = () => {
      const now = new Date();
      setTimeStr(now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
    };
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, []);

  const OPERATIONS = [
    { label: 'Chat sessions', value: String(sessions.length || 0), detail: sessions.length > 0 ? `${sessions.length} loaded` : 'None yet' },
    { label: 'Active agents', value: String(activeAgents), detail: activeAgents > 0 ? 'Running now' : 'All idle', live: activeAgents > 0 },
    { label: 'Tasks done', value: String(completedToday), detail: 'This session' },
    { label: 'System', value: 'Online', detail: 'All systems go' },
  ];

  return (
    <div className="h-full overflow-y-auto custom-scrollbar animate-fade-in">
      <div className="p-5 space-y-5">
        {/* Hero Banner */}
        <section className="grid grid-cols-12 gap-4">
          <div className="col-span-12 xl:col-span-8 bg-bgPanel border border-borderSubtle rounded-2xl p-5 relative overflow-hidden">
            {/* Decorative glow */}
            <div className="absolute -top-20 -right-20 w-64 h-64 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none" />
            <div className="absolute -bottom-16 -left-10 w-48 h-48 bg-teal-500/10 rounded-full blur-3xl pointer-events-none" />

            <div className="relative flex items-start justify-between gap-4">
              <div>
                <div className="text-[10px] uppercase tracking-widest text-textMuted mb-2 flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-live-pulse" />
                  InfiniteAI OS · {timeStr}
                </div>
                <h1 className="text-2xl font-bold text-textMain mb-2">Unified AI workspace</h1>
                <p className="text-sm text-textMuted max-w-xl leading-relaxed">
                  Assistants, agents, automation, cloud workspaces, business operations, and knowledge management in one operating layer.
                </p>
              </div>
              <button
                onClick={() => onOpenView('chats')}
                className="btn-premium flex items-center gap-2 flex-shrink-0"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                </svg>
                New Chat
              </button>
            </div>

            {/* Live stats bar */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mt-6 relative">
              {OPERATIONS.map((item) => (
                <div key={item.label} className="bg-bgCard border border-borderSubtle rounded-xl p-3 hover:border-indigo-500/20 transition-all">
                  <div className="text-[10px] text-textMuted mb-1 flex items-center gap-1">
                    {item.live && <span className="w-1 h-1 rounded-full bg-indigo-400 animate-live-pulse flex-shrink-0" />}
                    {item.label}
                  </div>
                  <div className="text-xl font-bold text-textMain">{item.value}</div>
                  <div className="text-[10px] text-textMuted mt-1">{item.detail}</div>
                </div>
              ))}
            </div>
          </div>

          {/* System Layer */}
          <div className="col-span-12 xl:col-span-4 bg-bgPanel border border-borderSubtle rounded-2xl p-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <div className="text-[10px] uppercase tracking-widest text-textMuted">System Layer</div>
                <h2 className="text-sm font-semibold text-textMain mt-1">Core routing</h2>
              </div>
              <span className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-emerald-500/15 text-emerald-400 text-[10px] font-medium border border-emerald-500/20">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-live-pulse" />
                Online
              </span>
            </div>
            <div className="space-y-3">
              {[
                { layer: 'AI Core', pct: 88, color: 'from-indigo-500 to-violet-500' },
                { layer: 'Agent Core', pct: 74, color: 'from-rose-500 to-pink-500' },
                { layer: 'Cloud Core', pct: 60, color: 'from-cyan-500 to-blue-500' },
              ].map((item, index) => (
                <div key={item.layer} className="flex items-center gap-3 animate-slide-up" style={{ animationDelay: `${index * 60}ms` }}>
                  <div className="w-8 h-8 rounded-lg bg-bgCard border border-borderSubtle flex items-center justify-center text-xs font-semibold text-textMain flex-shrink-0">
                    {index + 1}
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-medium text-textMain">{item.layer}</span>
                      <span className="text-[10px] text-textMuted">{item.pct}%</span>
                    </div>
                    <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full bg-gradient-to-r ${item.color} transition-all duration-700`}
                        style={{ width: `${item.pct}%` }}
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Active agents live panel */}
            {activeAgents > 0 && (
              <div className="mt-4 p-3 rounded-xl bg-indigo-500/10 border border-indigo-500/20 animate-slide-up">
                <div className="flex items-center gap-2 mb-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-live-pulse" />
                  <span className="text-[10px] font-semibold text-indigo-300 uppercase tracking-wider">Live Agents</span>
                </div>
                <div className="text-xl font-bold text-indigo-200">{activeAgents}</div>
                <div className="text-[10px] text-indigo-300/70">Currently executing tasks</div>
                <button
                  onClick={() => onOpenView('agents')}
                  className="mt-2 text-[10px] text-indigo-300 hover:text-indigo-100 transition-all flex items-center gap-1"
                >
                  View fleet →
                </button>
              </div>
            )}
          </div>
        </section>

        {/* Module Grid */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <div>
              <h2 className="text-sm font-semibold text-textMain">Workspace Modules</h2>
              <p className="text-xs text-textMuted mt-0.5">Launch any operating surface from one place.</p>
            </div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-4 gap-3">
            {MODULES.map((module, i) => (
              <button
                key={module.id}
                onClick={() => onOpenView(module.id)}
                className="group text-left bg-bgCard border border-borderSubtle hover:border-indigo-500/30 rounded-xl p-4 transition-all hover:bg-bgCard/80 animate-slide-up"
                style={{ animationDelay: `${i * 30}ms` }}
              >
                <div className="flex items-start justify-between gap-2 mb-3">
                  <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${module.accent} flex items-center justify-center shadow-lg flex-shrink-0`}>
                    <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d={module.icon} />
                    </svg>
                  </div>
                  <span className={`px-1.5 py-0.5 rounded-full text-[9px] font-semibold uppercase tracking-wide ${
                    module.status === 'Live' ? 'bg-emerald-500/15 text-emerald-400' :
                    module.status === 'Beta' ? 'bg-amber-500/15 text-amber-400' :
                    'bg-purple-500/15 text-purple-400'
                  }`}>
                    {module.status}
                  </span>
                </div>
                <div className="font-semibold text-textMain text-sm">{module.title}</div>
                <div className="text-[10px] text-textMuted mt-0.5">{module.metric}</div>
              </button>
            ))}
          </div>
        </section>

        {/* Bottom: Workflows + Quick Actions */}
        <section className="grid grid-cols-12 gap-4">
          {/* Workflows */}
          <div className="col-span-12 lg:col-span-7 bg-bgPanel border border-borderSubtle rounded-2xl p-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-sm font-semibold text-textMain">Active Workflows</h2>
                <p className="text-xs text-textMuted mt-0.5">Cross-module work moving through the OS.</p>
              </div>
              <button
                onClick={() => onOpenView('automations')}
                className="px-3 py-1.5 rounded-lg bg-indigo-500/10 text-indigo-400 text-xs font-medium hover:bg-indigo-500/20 transition-all border border-indigo-500/20"
              >
                Open Studio
              </button>
            </div>
            <div className="space-y-3">
              {WORKFLOWS.map((workflow, i) => (
                <div
                  key={workflow.name}
                  className="bg-bgCard border border-borderSubtle rounded-xl p-3 animate-slide-up"
                  style={{ animationDelay: `${i * 50}ms` }}
                >
                  <div className="flex items-center justify-between mb-2">
                    <div>
                      <div className="text-sm font-medium text-textMain">{workflow.name}</div>
                      <div className="text-xs text-textMuted">{workflow.stage}</div>
                    </div>
                    <div className="text-xs font-semibold text-textMain">{workflow.progress}%</div>
                  </div>
                  <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-cyan-500 transition-all duration-700"
                      style={{ width: `${workflow.progress}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Quick Actions */}
          <div className="col-span-12 lg:col-span-5 bg-bgPanel border border-borderSubtle rounded-2xl p-5">
            <div className="mb-4">
              <h2 className="text-sm font-semibold text-textMain">Quick Actions</h2>
              <p className="text-xs text-textMuted mt-0.5">Common entry points for daily work.</p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {QUICK_ACTIONS.map((action, i) => (
                <button
                  key={action.label}
                  onClick={() => onOpenView(action.view)}
                  className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-bgCard border border-borderSubtle text-xs font-medium text-textMain hover:border-indigo-500/30 hover:bg-white/[0.03] transition-all animate-slide-up text-left"
                  style={{ animationDelay: `${i * 30}ms` }}
                >
                  <div className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 ${action.color}`}>
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d={action.icon} />
                    </svg>
                  </div>
                  {action.label}
                </button>
              ))}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
