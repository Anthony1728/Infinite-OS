import { useEffect, useState } from 'react';
import { useAgentsStore } from '../../stores/agents';
import { useAuthStore } from '../../stores/auth';
import { useBrainStore } from '../../stores/brain';
import { AppIcon } from '../brand/AppIcon';

interface TopBarProps {
  onOpenCommand: () => void;
  onToggleSidebar: () => void;
  onToggleRightPanel: () => void;
  rightPanelOpen: boolean;
  onOpenDeploy?: () => void;
}

interface SystemMetrics {
  cpu: number;
  cpuCores: number;
  ram: number;
  ramUsed: string;
  ramTotal: string;
}

export function TopBar({ onOpenCommand, onToggleSidebar, onToggleRightPanel, rightPanelOpen, onOpenDeploy }: TopBarProps) {
  const [metrics, setMetrics] = useState<SystemMetrics | null>(null);
  const [metricHistory, setMetricHistory] = useState<{ cpu: number[]; ram: number[] }>({ cpu: [], ram: [] });
  const [agentHistory, setAgentHistory] = useState<number[]>([]);
  const [taskHistory, setTaskHistory] = useState<number[]>([]);
  const [profileOpen, setProfileOpen] = useState(false);
  const runs = useAgentsStore((state) => state.runs);
  const chatTasks = useAgentsStore((state) => state.chatTasks);
  const subTasks = useAgentsStore((state) => state.subTasks);
  const user = useAuthStore((state) => state.user);
  const logout = useAuthStore((state) => state.logout);
  const enginePhase = useBrainStore((state) => state.enginePhase);
  const engineProgress = useBrainStore((state) => state.engineProgress);
  const activeAgents = runs.filter((run) => run.status === 'running').length;
  const standaloneActiveRuns = runs.filter(
    (run) => run.status === 'running' &&
      !subTasks.some((task) => task.description === run.task && Math.abs(task.startedAt - run.startedAt) < 5_000),
  ).length;
  const activeTasks =
    chatTasks.filter((task) => task.status === 'working').length +
    subTasks.filter((task) => task.status === 'running' || task.status === 'pending').length +
    standaloneActiveRuns;

  useEffect(() => {
    const update = async () => {
      try {
        const next = await window.api.getMetrics() as SystemMetrics;
        setMetrics(next);
        setMetricHistory((history) => ({
          cpu: [...history.cpu.slice(-7), next.cpu],
          ram: [...history.ram.slice(-7), next.ram],
        }));
      } catch {
        // Preserve the last measured sample. Showing zero would falsely claim
        // that an unavailable metrics service means an idle computer.
      }
    };
    void update();
    const interval = window.setInterval(update, 3000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => setAgentHistory((history) => [...history.slice(-7), activeAgents]), [activeAgents]);
  useEffect(() => setTaskHistory((history) => [...history.slice(-7), activeTasks]), [activeTasks]);

  return (
    <header className="os-topbar relative z-[300] flex h-14 flex-shrink-0 items-center gap-3 overflow-visible border-b border-white/[0.025] bg-[#090c13]/95 px-4 backdrop-blur-xl">
      <div className="flex flex-shrink-0 items-center">
        <button onClick={onToggleSidebar} className="icon-button w-8 h-8 xl:hidden" aria-label="Toggle sidebar">
          <AppIcon name="topbar.menu" className="w-4 h-4" strokeWidth={1.6} />
        </button>
      </div>

      <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
        <button
          onClick={onOpenCommand}
          className="os-search-command hidden h-8 min-w-[140px] max-w-64 flex-1 items-center gap-2 rounded-lg border px-3 text-[10px] md:flex"
          aria-label="Search anything"
        >
          <span className="os-search-icon" aria-hidden="true">
            <AppIcon name="topbar.search" className="w-3.5 h-3.5" strokeWidth={1.8} />
          </span>
          <span className="os-search-placeholder min-w-0 flex-1 text-left"><span>Search anything…</span><i aria-hidden="true" /></span>
          <span className="os-search-shortcut font-mono text-[8px]">⌘ K</span>
        </button>
        <div className="hidden flex-shrink-0 items-center gap-1.5 lg:flex">
          <MetricCard
            label="CPU"
            value={metrics ? `${Math.round(metrics.cpu)}%` : '—'}
            values={metricHistory.cpu}
            maximum={100}
            color="#60a5fa"
          />
          <MetricCard
            label="RAM"
            value={metrics ? `${metrics.ramUsed} GB` : '—'}
            values={metricHistory.ram}
            maximum={100}
            color="#22d3ee"
          />
          <MetricCard label="Agents" value={String(activeAgents)} values={agentHistory} color="#4ade80" />
          <MetricCard label="Tasks" value={String(activeTasks)} values={taskHistory} color="#c084fc" />
        </div>
      </div>

      <div className="ml-auto flex flex-shrink-0 items-center justify-end gap-1.5 border-l border-white/[0.045] pl-3">
        <button
          type="button"
          onClick={() => void useBrainStore.getState().refreshEngineStatus()}
          className="flex h-8 min-w-[96px] items-center justify-center gap-2 rounded-lg border border-white/[0.065] bg-[#0d121c] px-2.5 transition-colors hover:border-emerald-400/20 hover:bg-white/[0.025]"
          title={`Engine: ${enginePhase}${enginePhase === 'bootstrapping' ? ` (${engineProgress}%)` : ''}`}
        >
          <span className={`h-1.5 w-1.5 rounded-full ${enginePhase === 'active' ? 'bg-emerald-400 shadow-[0_0_7px_rgba(52,211,153,.8)]' : enginePhase === 'bootstrapping' ? 'bg-amber-400' : 'bg-zinc-600'}`} />
          <span className="text-[7px] uppercase tracking-[0.08em] text-zinc-500">ENGINE</span>
          <span className="ml-auto text-[9px] font-medium text-zinc-300">{enginePhase === 'active' ? '100%' : enginePhase === 'bootstrapping' ? `${engineProgress}%` : 'Off'}</span>
        </button>

        <button
          type="button"
          onClick={onToggleRightPanel}
          className="icon-button relative h-8 w-8"
          title={`${rightPanelOpen ? 'Close' : 'Open'} notifications and activity`}
          aria-label={`${rightPanelOpen ? 'Close' : 'Open'} notifications and activity`}
          aria-expanded={rightPanelOpen}
        >
          <AppIcon name="topbar.notifications" className="h-4 w-4" strokeWidth={1.6} />
          {activeTasks > 0 && <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-pink-400 ring-2 ring-[#090c13]" />}
        </button>

        <div className="relative">
          <button
            type="button"
            onClick={() => setProfileOpen((open) => !open)}
            className="os-profile-ring relative h-8 w-8 rounded-full p-[1px]"
            title={user?.name || 'User'}
            aria-label="Open profile menu"
            aria-expanded={profileOpen}
          >
            <span className="flex h-full w-full items-center justify-center overflow-hidden rounded-full bg-[#101520] text-[10px] font-semibold text-white">{user?.avatar ? <img src={user.avatar} alt="" className="h-full w-full object-cover" /> : user?.name?.charAt(0)?.toUpperCase() || 'U'}</span>
            <span className="absolute bottom-0 right-0 h-2 w-2 rounded-full border-2 border-[#090c13] bg-emerald-400" />
          </button>
          {profileOpen && (
            <div
              className="absolute right-0 top-10 z-[400] w-44 rounded-xl border border-white/[0.09] bg-[#10141e] p-1.5 shadow-2xl"
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="border-b border-white/[0.06] px-2 py-2">
                <div className="truncate text-[11px] font-medium text-zinc-200">{user?.name || 'User'}</div>
                <div className="truncate text-[9px] text-zinc-600">{user?.email || 'Infinite OS account'}</div>
              </div>
              <button onClick={() => { setProfileOpen(false); onOpenDeploy?.(); }} className="mt-1 w-full rounded-lg px-2 py-2 text-left text-[10px] text-zinc-400 hover:bg-white/[0.05] hover:text-white">Deploy</button>
              <button onClick={() => { setProfileOpen(false); window.dispatchEvent(new Event('infinite:open-personalization')); }} className="w-full rounded-lg px-2 py-2 text-left text-[10px] text-zinc-400 hover:bg-white/[0.05] hover:text-white">Profile & appearance</button>
              <button onClick={() => { setProfileOpen(false); window.dispatchEvent(new Event('infinite:open-settings')); }} className="w-full rounded-lg px-2 py-2 text-left text-[10px] text-zinc-400 hover:bg-white/[0.05] hover:text-white">AI & system settings</button>
              <button onClick={() => void logout()} className="w-full rounded-lg px-2 py-2 text-left text-[10px] text-red-400/80 hover:bg-red-500/[0.08] hover:text-red-300">Sign out</button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

function MetricCard({
  label,
  value,
  values,
  maximum,
  color,
}: {
  label: string;
  value: string;
  values: number[];
  maximum?: number;
  color: string;
}) {
  const samples = values.length > 0 ? values : [0];
  const scale = Math.max(1, maximum ?? Math.max(...samples));
  const padded = samples.length >= 8 ? samples.slice(-8) : [...Array(8 - samples.length).fill(samples[0]), ...samples];
  const points = padded
    .map((sample, index) => `${index * 5},${11 - Math.max(0, Math.min(10, (sample / scale) * 10))}`)
    .join(' ');
  return (
    <div className="h-8 min-w-[64px] rounded-lg border border-white/[0.065] bg-white/[0.018] px-2 flex items-center gap-2">
      <span>
        <span className="block text-[7px] uppercase tracking-wide text-zinc-600">{label}</span>
        <span className="block text-[9px] font-medium text-zinc-300">{value}</span>
      </span>
      <svg className="w-9 h-3" viewBox="0 0 35 12" fill="none" aria-hidden="true">
        <polyline
          points={points}
          stroke={color}
          strokeWidth="1"
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}
