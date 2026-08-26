import { useEffect, useState } from 'react';
import { AppIcon, type AppIconName } from '../brand/AppIcon';
import { useAgentsStore } from '../../stores/agents';
import { useChatStore } from '../../stores/chat';

const MODULES: { id: string; title: string; metric: string; icon: AppIconName }[] = [
  { id: 'chats', title: 'AI Chat', metric: 'Multi-model workspace', icon: 'home.chat' },
  { id: 'learning', title: 'Learn', metric: 'Knowledge and study hub', icon: 'home.learn' },
  { id: 'canvas', title: 'Infinite Canvas', metric: 'Visual workflows', icon: 'home.canvas' },
  { id: 'workspace', title: 'Code Workspace', metric: 'Files, editor, and terminal', icon: 'home.code' },
  { id: 'automations', title: 'Automation Studio', metric: 'Workflow engine', icon: 'home.automation' },
  { id: 'agents', title: 'Agent Fleet', metric: 'Specialized AI workers', icon: 'home.agents' },
  { id: 'multi-agent', title: 'Orchestrator', metric: 'Parallel agent missions', icon: 'home.orchestrator' },
  { id: 'business', title: 'Business Command Center', metric: 'CRM and analytics', icon: 'home.business' },
  { id: 'scheduled-tasks', title: 'Routines', metric: 'Scheduled automations', icon: 'home.routines' },
  { id: 'standing-orders', title: 'Standing Orders', metric: 'Persistent instructions', icon: 'home.standing-orders' },
  { id: 'active-memory', title: 'Active Memory', metric: 'Auto context retrieval', icon: 'home.memory' },
  { id: 'plugins', title: 'Plugin Store', metric: 'Extensions', icon: 'home.plugins' },
];

const QUICK_ACTIONS: { label: string; view: string; icon: AppIconName }[] = [
  { label: 'AI Chat', view: 'chats', icon: 'home.chat' },
  { label: 'Learn', view: 'learning', icon: 'home.learn' },
  { label: 'Automate', view: 'automations', icon: 'home.automation' },
  { label: 'Cloud Sync', view: 'cloud', icon: 'home.cloud' },
];

interface SystemMetrics {
  cpu: number;
  cpuCores: number;
  ram: number;
  ramUsed: string;
  ramTotal: string;
}

interface OSHomeViewProps {
  onOpenView: (view: string) => void;
}

export function OSHomeView({ onOpenView }: OSHomeViewProps) {
  const { runs, chatTasks } = useAgentsStore();
  const { sessions } = useChatStore();
  const [timeStr, setTimeStr] = useState('');
  const [metrics, setMetrics] = useState<SystemMetrics | null>(null);

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

  useEffect(() => {
    let cancelled = false;
    const update = async () => {
      try {
        const next = await window.api.getMetrics() as SystemMetrics;
        if (!cancelled) setMetrics(next);
      } catch {
        // Keep the last real sample. A failed metrics call must not be rendered
        // as an invented zero or a healthy-system claim.
      }
    };
    void update();
    const timer = window.setInterval(update, 3000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  const recentTasks = [
    ...chatTasks.map((task) => ({
      id: task.id,
      name: task.title,
      stage: 'AI Chat',
      status: task.status,
      startedAt: task.startedAt,
    })),
    ...runs.map((run) => ({
      id: run.id,
      name: run.task,
      stage: 'Agent run',
      status: run.status,
      startedAt: run.startedAt,
    })),
  ].sort((a, b) => b.startedAt - a.startedAt).slice(0, 3);

  const OPERATIONS = [
    { label: 'Chat sessions', value: String(sessions.length || 0), detail: sessions.length > 0 ? `${sessions.length} loaded` : 'None yet' },
    { label: 'Active agents', value: String(activeAgents), detail: activeAgents > 0 ? 'Running now' : 'All idle', live: activeAgents > 0 },
    { label: 'Completed runs', value: String(completedToday), detail: 'Tracked by agents' },
    {
      label: 'Host metrics',
      value: metrics ? 'Measured' : 'Waiting',
      detail: metrics ? `${metrics.ramTotal} GB RAM detected` : 'Sampling this computer',
    },
  ];

  const systemLayers = [
    { layer: 'CPU usage', value: metrics ? `${Math.round(metrics.cpu)}%` : '—', pct: metrics?.cpu },
    { layer: 'Memory usage', value: metrics ? `${metrics.ramUsed} / ${metrics.ramTotal} GB` : '—', pct: metrics?.ram },
    { layer: 'Logical CPU cores', value: metrics ? String(metrics.cpuCores) : '—', pct: undefined },
  ];

  return (
    <div className="h-full overflow-y-auto overscroll-contain custom-scrollbar animate-fade-in">
      <div className="mx-auto w-full max-w-[1600px] space-y-4 p-4">
        {/* Hero */}
        <section className="grid grid-cols-12 gap-3">
          <div className="col-span-12 xl:col-span-8 bg-bgPanel border border-borderSubtle rounded-2xl p-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-[10px] uppercase tracking-widest text-textMuted mb-2 flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-live-pulse" />
                  Infinite OS · {timeStr}
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
                Open AI Chat
              </button>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-2 lg:grid-cols-4">
              {OPERATIONS.map((item) => (
                <div key={item.label} className="bg-bgCard border border-borderSubtle rounded-xl p-2.5 hover:border-white/[0.14] transition-colors">
                  <div className="text-[10px] text-textMuted mb-1 flex items-center gap-1">
                    {item.live && <span className="w-1 h-1 rounded-full bg-emerald-400 animate-live-pulse flex-shrink-0" />}
                    {item.label}
                  </div>
                  <div className="text-xl font-bold text-textMain">{item.value}</div>
                  <div className="text-[10px] text-textMuted mt-1">{item.detail}</div>
                </div>
              ))}
            </div>
          </div>

          {/* System Layer */}
          <div className="col-span-12 xl:col-span-4 bg-bgPanel border border-borderSubtle rounded-2xl p-4">
            <div className="flex items-center justify-between mb-4">
              <div>
                <div className="text-[10px] uppercase tracking-widest text-textMuted">System Layer</div>
                <h2 className="text-sm font-semibold text-textMain mt-1">Live host metrics</h2>
              </div>
              <span className={`flex items-center gap-1.5 px-2 py-1 rounded-full text-[10px] font-medium border ${metrics ? 'bg-white/[0.04] text-zinc-300 border-white/[0.09]' : 'bg-white/[0.03] text-textMuted border-borderSubtle'}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${metrics ? 'bg-emerald-400 animate-live-pulse' : 'bg-zinc-600'}`} />
                {metrics ? 'Measured' : 'Sampling'}
              </span>
            </div>
            <div className="space-y-3">
              {systemLayers.map((item, index) => (
                <div key={item.layer} className="flex items-center gap-3 animate-slide-up" style={{ animationDelay: `${index * 60}ms` }}>
                  <div className="w-8 h-8 rounded-lg bg-bgCard border border-borderSubtle flex items-center justify-center text-xs font-semibold text-zinc-400 flex-shrink-0">
                    {index + 1}
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-medium text-textMain">{item.layer}</span>
                      <span className="text-[10px] text-textMuted">{item.value}</span>
                    </div>
                    {item.pct === undefined ? (
                      <div className="h-1.5 bg-white/5 rounded-full" />
                    ) : (
                      <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full bg-zinc-400 transition-all duration-700"
                          style={{ width: `${Math.max(0, Math.min(100, item.pct))}%` }}
                        />
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* Active agents live panel */}
            {activeAgents > 0 && (
              <div className="mt-4 p-3 rounded-xl bg-white/[0.03] border border-white/[0.07] animate-slide-up">
                <div className="flex items-center gap-2 mb-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-live-pulse" />
                  <span className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider">Live Agents</span>
                </div>
                <div className="text-xl font-bold text-zinc-100">{activeAgents}</div>
                <div className="text-[10px] text-zinc-500">Currently executing tasks</div>
                <button
                  onClick={() => onOpenView('agents')}
                  className="mt-2 text-[10px] text-zinc-400 hover:text-zinc-200 transition-colors flex items-center gap-1"
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
          <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4 2xl:grid-cols-6">
            {MODULES.map((module, i) => (
              <button
                key={module.id}
                onClick={() => onOpenView(module.id)}
                className="os-module-tile group text-left bg-bgCard border border-borderSubtle rounded-xl p-3 transition-colors hover:bg-bgCard/80 animate-slide-up"
                style={{ animationDelay: `${i * 30}ms` }}
              >
                <div className="os-module-chip w-10 h-10 rounded-[13px] flex items-center justify-center flex-shrink-0 mb-2.5">
                  <AppIcon
                    name={module.icon}
                    className="os-module-glyph w-[19px] h-[19px]"
                    strokeWidth={1.75}
                  />
                </div>
                <div className="font-semibold text-textMain text-sm">{module.title}</div>
                <div className="text-[10px] text-textMuted mt-0.5">{module.metric}</div>
              </button>
            ))}
          </div>
        </section>

        {/* Bottom: Tasks + Quick Actions */}
        <section className="grid grid-cols-12 gap-3">
          {/* Tasks */}
          <div className="col-span-12 lg:col-span-7 bg-bgPanel border border-borderSubtle rounded-2xl p-4">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-sm font-semibold text-textMain">Recent Tasks</h2>
                <p className="text-xs text-textMuted mt-0.5">Live execution states reported by chat and agents.</p>
              </div>
              <button
                onClick={() => onOpenView('agents')}
                className="px-3 py-1.5 rounded-lg bg-white/[0.05] text-zinc-300 text-xs font-medium hover:bg-white/[0.09] transition-colors border border-white/[0.08]"
              >
                View Tasks
              </button>
            </div>
            <div className="space-y-3">
              {recentTasks.length === 0 ? (
                <div className="bg-bgCard border border-borderSubtle rounded-xl p-4 text-xs text-textMuted">
                  No tracked tasks yet. Start a task in AI Chat.
                </div>
              ) : recentTasks.map((task, i) => {
                const failed = task.status === 'failed' || task.status === 'cancelled';
                const working = task.status === 'working' || task.status === 'running' || task.status === 'queued';
                const statusLabel = failed ? 'Failed' : working ? 'Working' : 'Complete';
                return (
                <div
                  key={task.id}
                  className="bg-bgCard border border-borderSubtle rounded-xl p-3 animate-slide-up"
                  style={{ animationDelay: `${i * 50}ms` }}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-medium text-textMain line-clamp-1">{task.name}</div>
                      <div className="text-xs text-textMuted">{task.stage}</div>
                    </div>
                    <div className={`text-xs font-semibold ${failed ? 'text-red-400' : working ? 'text-zinc-300' : 'text-emerald-400'}`}>
                      {statusLabel}
                    </div>
                  </div>
                </div>
                );
              })}
            </div>
          </div>

          {/* Quick Actions */}
          <div className="col-span-12 lg:col-span-5 bg-bgPanel border border-borderSubtle rounded-2xl p-4">
            <div className="mb-4">
              <h2 className="text-sm font-semibold text-textMain">Quick Actions</h2>
              <p className="text-xs text-textMuted mt-0.5">Common entry points for daily work.</p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {QUICK_ACTIONS.map((action, i) => (
                <button
                  key={action.label}
                  onClick={() => onOpenView(action.view)}
                  className="os-module-tile flex items-center gap-2.5 px-3 py-2.5 rounded-xl bg-bgCard border border-borderSubtle text-xs font-medium text-textMain transition-colors animate-slide-up text-left"
                  style={{ animationDelay: `${i * 30}ms` }}
                >
                  <div className="os-module-chip w-7 h-7 rounded-[9px] flex items-center justify-center flex-shrink-0">
                    <AppIcon
                      name={action.icon}
                      className="os-module-glyph w-3.5 h-3.5"
                      strokeWidth={1.8}
                    />
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
