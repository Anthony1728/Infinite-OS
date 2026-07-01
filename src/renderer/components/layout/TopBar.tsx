import { useEffect, useState } from 'react';
import { useAgentsStore } from '../../stores/agents';
import { useAuthStore } from '../../stores/auth';

interface TopBarProps {
  onOpenCommand: () => void;
  onToggleSidebar: () => void;
  onToggleRightPanel: () => void;
  onOpenDeploy?: () => void;
}

interface SystemMetrics {
  cpu: number;
  cpuCores: number;
  ram: number;
  ramUsed: string;
  ramTotal: string;
}

export function TopBar({ onOpenCommand, onToggleSidebar, onToggleRightPanel, onOpenDeploy }: TopBarProps) {
  const [metrics, setMetrics] = useState<SystemMetrics | null>(null);
  const { runs, chatTasks, subTasks } = useAgentsStore();
  const user = useAuthStore((state) => state.user);
  const activeAgents = runs.filter((run) => run.status === 'running').length;
  const activeTasks =
    chatTasks.filter((task) => task.status === 'working').length +
    subTasks.filter((task) => task.status === 'running' || task.status === 'pending').length;

  useEffect(() => {
    const update = async () => {
      try {
        setMetrics(await window.api.getMetrics());
      } catch {
        setMetrics({ cpu: 0, cpuCores: 0, ram: 0, ramUsed: '0.0', ramTotal: '0.0' });
      }
    };
    void update();
    const interval = window.setInterval(update, 3000);
    return () => window.clearInterval(interval);
  }, []);

  return (
    <header className="h-14 flex-shrink-0 border-b border-white/[0.055] bg-[#090c13]/95 backdrop-blur-xl px-4 grid grid-cols-[1fr_auto_1fr] items-center">
      <div className="flex items-center">
        <button onClick={onToggleSidebar} className="icon-button w-8 h-8 xl:hidden" aria-label="Toggle sidebar">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.6" viewBox="0 0 24 24">
            <path strokeLinecap="round" d="M4 7h16M4 12h16M4 17h16" />
          </svg>
        </button>
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={onOpenCommand}
          className="hidden md:flex h-8 w-64 items-center gap-2 rounded-lg border border-white/[0.07] bg-white/[0.018] px-3 text-[10px] text-zinc-600 hover:border-indigo-500/30 hover:text-zinc-300 transition-colors"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="m21 21-4.35-4.35m1.35-5.4a6.75 6.75 0 1 1-13.5 0 6.75 6.75 0 0 1 13.5 0Z"
            />
          </svg>
          <span className="flex-1 text-left">Search anything…</span>
          <span className="font-mono text-[8px]">⌘ K</span>
        </button>
        <div className="hidden lg:flex items-center gap-1.5">
          <MetricCard
            label="CPU"
            value={`${Math.round(metrics?.cpu ?? 0)}%`}
            values={[4, 7, 5, 9, 6, 8, 11, 5]}
            color="#60a5fa"
          />
          <MetricCard
            label="RAM"
            value={`${metrics?.ramUsed ?? '0.0'} GB`}
            values={[6, 8, 7, 9, 10, 8, 9, 6]}
            color="#22d3ee"
          />
          <MetricCard label="Agents" value={String(activeAgents)} values={[4, 5, 7, 4, 9, 6, 10, 5]} color="#4ade80" />
          <MetricCard label="Tasks" value={String(activeTasks)} values={[3, 8, 4, 10, 5, 9, 6, 11]} color="#c084fc" />
        </div>
      </div>

      <div className="flex items-center justify-end gap-1.5">
        <button
          onClick={onOpenDeploy}
          className="icon-button w-8 h-8 hidden md:inline-flex"
          title="Deploy"
          aria-label="Open deploy"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.6" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M15.6 14.4a6 6 0 0 1-5.85 7.35v-4.8m5.85-2.55A15 15 0 0 0 21.75 2.25 15 15 0 0 0 9.6 8.4m6 6a15 15 0 0 1-5.85 2.55M9.6 8.4a6 6 0 0 0-7.35 5.85h4.8m2.55-5.85a15 15 0 0 0-2.55 5.85"
            />
          </svg>
        </button>
        <button
          onClick={onToggleRightPanel}
          className="icon-button w-8 h-8"
          title="Toggle activity panel"
          aria-label="Toggle activity panel"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.6" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M9 4.5v15m10.5 0h-15A1.5 1.5 0 0 1 3 18V6a1.5 1.5 0 0 1 1.5-1.5h15A1.5 1.5 0 0 1 21 6v12a1.5 1.5 0 0 1-1.5 1.5Z"
            />
          </svg>
        </button>
        <div
          className="relative w-7 h-7 rounded-full bg-gradient-to-br from-indigo-500 via-violet-500 to-cyan-500 p-[2px]"
          title={user?.name || 'User'}
        >
          <div className="w-full h-full rounded-full bg-[#121722] flex items-center justify-center text-[9px] font-semibold text-white">
            {user?.name?.charAt(0)?.toUpperCase() || 'U'}
          </div>
          <span className="absolute right-0 bottom-0 w-2 h-2 rounded-full bg-emerald-400 border-2 border-[#090c13]" />
        </div>
      </div>
    </header>
  );
}

function MetricCard({
  label,
  value,
  values,
  color,
}: {
  label: string;
  value: string;
  values: number[];
  color: string;
}) {
  const points = values.map((height, index) => `${index * 5},${12 - height}`).join(' ');
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
