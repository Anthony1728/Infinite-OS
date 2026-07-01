import { useEffect, useState } from 'react';

interface SystemMetrics {
  cpu: number;
  cpuCores: number;
  ram: number;
  ramUsed: string;
  ramTotal: string;
  load1: string;
  load5: string;
  load15: string;
  platform: string;
  hostname: string;
}

interface MetricCard {
  label: string;
  value: string;
  subtext: string;
  color: string;
  icon: string;
}

const STATUS_INDICATORS = [
  { name: 'AI Core', ok: true, detail: 'All providers connected' },
  { name: 'Agent Runtime', ok: true, detail: '6 agents registered' },
  { name: 'Tool Registry', ok: true, detail: '11 tools available' },
  { name: 'Memory Store', ok: true, detail: 'Active' },
  { name: 'MCP Manager', ok: true, detail: 'Ready' },
  { name: 'Orchestrator', ok: true, detail: 'Idle' },
];

export function MonitoringDashboard() {
  const [metrics, setMetrics] = useState<SystemMetrics | null>(null);
  const [history, setHistory] = useState<number[]>([]);

  useEffect(() => {
    const fetchMetrics = async () => {
      try {
        const m = await window.api.getMetrics();
        setMetrics(m);
        setHistory(prev => {
          const next = [...prev, m.cpu];
          return next.length > 30 ? next.slice(-30) : next;
        });
      } catch {
        // silent
      }
    };
    fetchMetrics();
    const interval = setInterval(fetchMetrics, 3000);
    return () => clearInterval(interval);
  }, []);

  const cards: MetricCard[] = metrics ? [
    { label: 'CPU Usage', value: `${metrics.cpu}%`, subtext: `${metrics.cpuCores} cores`, color: 'from-indigo-500 to-violet-500', icon: 'M8.25 3v1.5M4.5 8.25H3m18 0h-1.5M4.5 12H3m18 0h-1.5m-15 3.75H3m18 0h-1.5M8.25 19.5V21M12 3v1.5m0 15V21m3.75-18v1.5m0 15V21m-9-1.5h10.5a2.25 2.25 0 002.25-2.25V6.75a2.25 2.25 0 00-2.25-2.25H6.75A2.25 2.25 0 004.5 6.75v10.5a2.25 2.25 0 002.25 2.25zm.75-12h9v9h-9v-9z' },
    { label: 'Memory', value: `${metrics.ram}%`, subtext: `${metrics.ramUsed} / ${metrics.ramTotal} GB`, color: 'from-cyan-500 to-teal-500', icon: 'M6 6.878V6a2.25 2.25 0 012.25-2.25h7.5A2.25 2.25 0 0118 6v.878m-12 0c.235-.083.487-.128.75-.128h10.5c.263 0 .515.045.75.128m-12 0A2.25 2.25 0 004.5 9v.878m13.5-3A2.25 2.25 0 0119.5 9v.878m0 0a2.246 2.246 0 00-.75-.128H5.25c-.263 0-.515.045-.75.128m15 0A2.25 2.25 0 0121 12v6a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 18v-6c0-1.243 1.007-2.25 2.25-2.25h13.5' },
    { label: 'Load Avg', value: metrics.load1, subtext: `5m: ${metrics.load5} · 15m: ${metrics.load15}`, color: 'from-amber-500 to-orange-500', icon: 'M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z' },
    { label: 'Platform', value: metrics.platform, subtext: metrics.hostname, color: 'from-rose-500 to-pink-500', icon: 'M9 17.25v1.007a3 3 0 01-.879 2.122L7.5 21h9l-.621-.621A3 3 0 0115 18.257V17.25m6-12V15a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 15V5.25m18 0A2.25 2.25 0 0018.75 3H5.25A2.25 2.25 0 003 5.25m18 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.07 7.409A2.25 2.25 0 012 5.493V5.25' },
  ] : [];

  return (
    <div className="h-full overflow-y-auto custom-scrollbar animate-fade-in">
      <div className="p-5 space-y-5">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-white">System Monitor</h1>
            <p className="text-xs text-gray-500 mt-1">Real-time system health and performance metrics</p>
          </div>
          <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/15 text-emerald-400 text-[10px] font-medium border border-emerald-500/20">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            Live
          </span>
        </div>

        {/* Metric Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {cards.map((card) => (
            <div key={card.label} className="bg-[#12121a] border border-white/[0.06] rounded-xl p-4 hover:border-white/[0.1] transition-all">
              <div className="flex items-center justify-between mb-3">
                <div className={`w-9 h-9 rounded-lg bg-gradient-to-br ${card.color} flex items-center justify-center shadow-md`}>
                  <svg className="w-4.5 h-4.5 text-white" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d={card.icon} />
                  </svg>
                </div>
              </div>
              <div className="text-2xl font-bold text-white">{card.value}</div>
              <div className="text-[10px] text-gray-500 mt-0.5">{card.label}</div>
              <div className="text-[10px] text-gray-600 mt-0.5">{card.subtext}</div>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-12 gap-4">
          {/* CPU History Chart */}
          <div className="col-span-12 lg:col-span-8 bg-[#12121a] border border-white/[0.06] rounded-xl p-5">
            <h2 className="text-sm font-semibold text-white mb-4">CPU Usage History</h2>
            <div className="relative h-40">
              <div className="absolute inset-0 flex items-end gap-[3px]">
                {history.map((val, i) => (
                  <div
                    key={i}
                    className="flex-1 rounded-t-sm transition-all duration-300"
                    style={{
                      height: `${Math.max(2, val)}%`,
                      background: val > 80 ? 'linear-gradient(to top, #ef4444, #f87171)' :
                        val > 50 ? 'linear-gradient(to top, #f59e0b, #fbbf24)' :
                          'linear-gradient(to top, #6366f1, #818cf8)',
                      opacity: 0.3 + (i / history.length) * 0.7,
                    }}
                  />
                ))}
              </div>
              <div className="absolute inset-0 pointer-events-none">
                {[25, 50, 75].map(pct => (
                  <div key={pct} className="absolute w-full border-t border-white/[0.04]" style={{ bottom: `${pct}%` }}>
                    <span className="absolute -left-1 -top-2 text-[8px] text-gray-600">{pct}%</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="flex items-center justify-between mt-2 text-[9px] text-gray-600">
              <span>30 seconds ago</span>
              <span>Now</span>
            </div>
          </div>

          {/* System Status */}
          <div className="col-span-12 lg:col-span-4 bg-[#12121a] border border-white/[0.06] rounded-xl p-5">
            <h2 className="text-sm font-semibold text-white mb-4">System Status</h2>
            <div className="space-y-3">
              {STATUS_INDICATORS.map((item) => (
                <div key={item.name} className="flex items-center gap-3">
                  <div className={`w-2 h-2 rounded-full flex-shrink-0 ${item.ok ? 'bg-emerald-400' : 'bg-red-400'}`} />
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium text-white">{item.name}</div>
                    <div className="text-[10px] text-gray-500 truncate">{item.detail}</div>
                  </div>
                  <span className={`text-[9px] font-medium ${item.ok ? 'text-emerald-400' : 'text-red-400'}`}>
                    {item.ok ? 'OK' : 'Error'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Resource Usage Bars */}
        <div className="bg-[#12121a] border border-white/[0.06] rounded-xl p-5">
          <h2 className="text-sm font-semibold text-white mb-4">Resource Usage</h2>
          <div className="space-y-4">
            {[
              { label: 'CPU', value: metrics?.cpu ?? 0, color: 'from-indigo-500 to-violet-500' },
              { label: 'RAM', value: metrics?.ram ?? 0, color: 'from-cyan-500 to-teal-500' },
            ].map((res) => (
              <div key={res.label}>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-xs font-medium text-white">{res.label}</span>
                  <span className="text-xs text-gray-400">{res.value}%</span>
                </div>
                <div className="h-2.5 bg-white/5 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full bg-gradient-to-r ${res.color} transition-all duration-500`}
                    style={{ width: `${res.value}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

