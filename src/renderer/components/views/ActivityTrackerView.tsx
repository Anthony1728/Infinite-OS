import { useState, useEffect, useCallback } from 'react';
import { ActivityInbox } from '../activity/ActivityInbox';

interface TrackerStatus {
  isTracking: boolean;
  totalActions: number;
  currentSession: string | null;
}

interface TrackedAction {
  id: string;
  type: 'mouse_move' | 'mouse_click' | 'key_press' | 'scroll' | 'app_switch' | 'text_input' | 'window_focus' | 'app_launch' | 'browser_action';
  timestamp: string;
  data: Record<string, unknown>;
}

interface DayAnalysis {
  date: string;
  totalActions: number;
  breakdown: Record<string, number>;
  topApps: { name: string; time: number }[];
  topWebsites: { url: string; visits: number }[];
  sessions: { start: string; end: string; duration: number; actions: number }[];
  patterns: string[];
  peakHours: number[];
}

interface ActivityPattern {
  type: string;
  description: string;
  confidence: number;
  data: Record<string, unknown>;
}

export function ActivityTrackerView() {
  const [status, setStatus] = useState<TrackerStatus | null>(null);
  const [recentActions, setRecentActions] = useState<TrackedAction[]>([]);
  const [analysis, setAnalysis] = useState<DayAnalysis | null>(null);
  const [patterns, setPatterns] = useState<ActivityPattern[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDate, setSelectedDate] = useState<string>(new Date().toISOString().slice(0, 10));
  const [tab, setTab] = useState<'inbox' | 'desktop'>('inbox');

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [s, r, p] = await Promise.all([
        window.api.trackerStatus(),
        window.api.trackerRecent({ count: 100 }),
        window.api.trackerPatterns(),
      ]);
      setStatus(s as TrackerStatus);
      setRecentActions(r as TrackedAction[]);
      setPatterns(p as ActivityPattern[]);
    } catch (err) {
      console.error('Failed to load tracker data:', err);
    }
    setLoading(false);
  }, []);

  const loadAnalysis = useCallback(async () => {
    try {
      const a = await window.api.trackerAnalyzeDay({ date: selectedDate });
      setAnalysis(a as DayAnalysis);
    } catch (err) {
      console.error('Failed to load analysis:', err);
    }
  }, [selectedDate]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    void loadAnalysis();
  }, [loadAnalysis]);

  const handleToggleTracking = async () => {
    if (status?.isTracking) {
      await window.api.trackerStop();
    } else {
      await window.api.trackerStart();
    }
    await loadData();
  };

  const formatDuration = (ms: number) => {
    const hours = Math.floor(ms / 3600000);
    const minutes = Math.floor((ms % 3600000) / 60000);
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
  };

  const getActionIcon = (type: string) => {
    switch (type) {
      case 'mouse_move': return '🖱️';
      case 'mouse_click': return '👆';
      case 'key_press': return '⌨️';
      case 'scroll': return '📜';
      case 'app_switch': return '🔄';
      case 'text_input': return '📝';
      case 'window_focus': return '🪟';
      case 'app_launch': return '🚀';
      case 'browser_action': return '🌐';
      default: return '•';
    }
  };

  const getActionColor = (type: string) => {
    switch (type) {
      case 'mouse_move': return 'text-blue-400';
      case 'mouse_click': return 'text-green-400';
      case 'key_press': return 'text-yellow-400';
      case 'scroll': return 'text-purple-400';
      case 'app_switch': return 'text-orange-400';
      case 'text_input': return 'text-teal-400';
      case 'window_focus': return 'text-indigo-400';
      case 'app_launch': return 'text-pink-400';
      case 'browser_action': return 'text-cyan-400';
      default: return 'text-gray-400';
    }
  };

  return (
    <div className="flex-1 overflow-y-auto p-6 animate-fade-in">
      <div className="flex items-start justify-between mb-5 gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-white">Activity</h1>
          <p className="text-gray-500 text-sm">What finished, what failed, and what needs you — plus your desktop patterns.</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border border-white/[0.07] bg-white/[0.02] p-0.5">
            <button
              onClick={() => setTab('inbox')}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${tab === 'inbox' ? 'bg-white/[0.09] text-white' : 'text-zinc-500 hover:text-zinc-300'}`}
            >
              Inbox
            </button>
            <button
              onClick={() => setTab('desktop')}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${tab === 'desktop' ? 'bg-white/[0.09] text-white' : 'text-zinc-500 hover:text-zinc-300'}`}
            >
              Desktop
            </button>
          </div>
          {tab === 'desktop' && (
            <button
              onClick={handleToggleTracking}
              className={`px-4 py-2 rounded-lg text-xs font-medium transition-all flex items-center gap-2 ${
                status?.isTracking
                  ? 'bg-red-500/20 text-red-300 border border-red-500/30 hover:bg-red-500/30'
                  : 'bg-green-500/20 text-green-300 border border-green-500/30 hover:bg-green-500/30'
              }`}
            >
              <span className={`w-2 h-2 rounded-full ${status?.isTracking ? 'bg-red-400 animate-pulse' : 'bg-green-400'}`} />
              {status?.isTracking ? 'Stop Tracking' : 'Start Tracking'}
            </button>
          )}
        </div>
      </div>

      {tab === 'inbox' ? (
        <ActivityInbox />
      ) : (
        <>
      {loading && (
        <div className="flex items-center justify-center py-8 text-gray-500 text-sm gap-2">
          <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          Loading tracker data...
        </div>
      )}

      {/* Status Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-[#1a1a1f] border border-white/[0.06] rounded-xl p-4">
          <div className="text-[10px] text-gray-500 uppercase tracking-wide mb-1">Total Actions</div>
          <div className="text-2xl font-bold text-white">{status?.totalActions ?? 0}</div>
        </div>
        <div className="bg-[#1a1a1f] border border-white/[0.06] rounded-xl p-4">
          <div className="text-[10px] text-gray-500 uppercase tracking-wide mb-1">Status</div>
          <div className={`text-sm font-medium ${status?.isTracking ? 'text-green-400' : 'text-gray-500'}`}>
            {status?.isTracking ? 'Tracking Active' : 'Paused'}
          </div>
        </div>
        <div className="bg-[#1a1a1f] border border-white/[0.06] rounded-xl p-4">
          <div className="text-[10px] text-gray-500 uppercase tracking-wide mb-1">Today&apos;s Actions</div>
          <div className="text-2xl font-bold text-white">{analysis?.totalActions ?? 0}</div>
        </div>
        <div className="bg-[#1a1a1f] border border-white/[0.06] rounded-xl p-4">
          <div className="text-[10px] text-gray-500 uppercase tracking-wide mb-1">Patterns Found</div>
          <div className="text-2xl font-bold text-white">{patterns.length}</div>
        </div>
      </div>

      {/* Day Selector */}
      <div className="flex items-center gap-3 mb-6">
        <label className="text-xs text-gray-400">Select Date:</label>
        <input
          type="date"
          value={selectedDate}
          onChange={(e) => setSelectedDate(e.target.value)}
          className="bg-white/5 border border-white/[0.08] rounded-lg px-3 py-1.5 text-xs text-white"
        />
        <button
          onClick={loadAnalysis}
          className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/[0.08] text-xs text-gray-400 hover:text-white transition-all"
        >
          Refresh Analysis
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Activity Breakdown */}
        {analysis && (
          <div className="bg-[#1a1a1f] border border-white/[0.06] rounded-xl p-5">
            <h3 className="text-sm font-medium text-white mb-4">Activity Breakdown</h3>
            {Object.keys(analysis.breakdown).length > 0 ? (
              <div className="space-y-3">
                {Object.entries(analysis.breakdown)
                  .sort((a, b) => b[1] - a[1])
                  .map(([type, count]) => {
                    const max = Math.max(...Object.values(analysis.breakdown));
                    const pct = max > 0 ? (count / max) * 100 : 0;
                    return (
                      <div key={type}>
                        <div className="flex items-center justify-between mb-1">
                          <span className={`text-xs ${getActionColor(type)}`}>{getActionIcon(type)} {type.replace(/_/g, ' ')}</span>
                          <span className="text-[10px] text-gray-500">{count.toLocaleString()}</span>
                        </div>
                        <div className="w-full bg-white/5 rounded-full h-1.5">
                          <div
                            className={`h-1.5 rounded-full bg-gradient-to-r ${
                              type.includes('mouse') ? 'from-blue-500 to-cyan-500' :
                              type.includes('key') ? 'from-yellow-500 to-amber-500' :
                              type.includes('app') ? 'from-orange-500 to-red-500' :
                              type.includes('browser') ? 'from-cyan-500 to-teal-500' :
                              'from-purple-500 to-pink-500'
                            }`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
              </div>
            ) : (
              <div className="text-center py-8 text-gray-500 text-xs">No data for this date</div>
            )}
          </div>
        )}

        {/* Peak Hours */}
        {analysis && (
          <div className="bg-[#1a1a1f] border border-white/[0.06] rounded-xl p-5">
            <h3 className="text-sm font-medium text-white mb-4">Peak Activity Hours</h3>
            <div className="grid grid-cols-12 gap-1">
              {Array.from({ length: 24 }, (_, i) => {
                const isPeak = analysis.peakHours.includes(i);
                return (
                  <div
                    key={i}
                    className={`h-8 rounded-sm flex items-center justify-center text-[8px] transition-all ${
                      isPeak ? 'bg-indigo-500/30 text-indigo-300 border border-indigo-500/40' : 'bg-white/[0.02] text-gray-600'
                    }`}
                    title={`${i}:00 - ${isPeak ? 'Peak' : 'Low'}`}
                  >
                    {i % 3 === 0 ? `${i}` : ''}
                  </div>
                );
              })}
            </div>
            <div className="flex gap-4 mt-3">
              <div className="flex items-center gap-1.5">
                <div className="w-3 h-3 rounded-sm bg-indigo-500/30 border border-indigo-500/40" />
                <span className="text-[9px] text-gray-500">Peak hour</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-3 h-3 rounded-sm bg-white/[0.02]" />
                <span className="text-[9px] text-gray-500">Low activity</span>
              </div>
            </div>
          </div>
        )}

        {/* Top Apps */}
        {analysis && analysis.topApps.length > 0 && (
          <div className="bg-[#1a1a1f] border border-white/[0.06] rounded-xl p-5">
            <h3 className="text-sm font-medium text-white mb-4">Most Used Apps</h3>
            <div className="space-y-2">
              {analysis.topApps.map((app, i) => {
                const maxTime = analysis.topApps[0]?.time || 1;
                return (
                  <div key={i} className="flex items-center gap-3">
                    <span className="text-[10px] text-gray-500 w-4">{i + 1}.</span>
                    <div className="flex-1">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs text-white truncate">{app.name}</span>
                        <span className="text-[10px] text-gray-500">{formatDuration(app.time)}</span>
                      </div>
                      <div className="w-full bg-white/5 rounded-full h-1">
                        <div
                          className="h-1 rounded-full bg-gradient-to-r from-indigo-500 to-purple-500"
                          style={{ width: `${(app.time / maxTime) * 100}%` }}
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Top Websites */}
        {analysis && analysis.topWebsites.length > 0 && (
          <div className="bg-[#1a1a1f] border border-white/[0.06] rounded-xl p-5">
            <h3 className="text-sm font-medium text-white mb-4">Most Visited Sites</h3>
            <div className="space-y-2">
              {analysis.topWebsites.map((site, i) => {
                const maxVisits = analysis.topWebsites[0]?.visits || 1;
                return (
                  <div key={i} className="flex items-center gap-3">
                    <span className="text-[10px] text-gray-500 w-4">{i + 1}.</span>
                    <div className="flex-1">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs text-white truncate">{site.url}</span>
                        <span className="text-[10px] text-gray-500">{site.visits} visits</span>
                      </div>
                      <div className="w-full bg-white/5 rounded-full h-1">
                        <div
                          className="h-1 rounded-full bg-gradient-to-r from-cyan-500 to-teal-500"
                          style={{ width: `${(site.visits / maxVisits) * 100}%` }}
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Detected Patterns */}
        {patterns.length > 0 && (
          <div className="bg-[#1a1a1f] border border-white/[0.06] rounded-xl p-5">
            <h3 className="text-sm font-medium text-white mb-4">Detected Patterns</h3>
            <div className="space-y-3">
              {patterns.map((p, i) => (
                <div key={i} className="bg-white/[0.02] rounded-lg p-3 border border-white/[0.04]">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs text-white font-medium capitalize">{p.type.replace(/_/g, ' ')}</span>
                    <span className="text-[10px] text-indigo-400">{Math.round(p.confidence * 100)}% confidence</span>
                  </div>
                  <p className="text-[11px] text-gray-400">{p.description}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Sessions */}
        {analysis && analysis.sessions.length > 0 && (
          <div className="bg-[#1a1a1f] border border-white/[0.06] rounded-xl p-5 lg:col-span-2">
            <h3 className="text-sm font-medium text-white mb-4">Activity Sessions</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-gray-500 border-b border-white/[0.06]">
                    <th className="text-left py-2 font-medium">Start</th>
                    <th className="text-left py-2 font-medium">End</th>
                    <th className="text-left py-2 font-medium">Duration</th>
                    <th className="text-left py-2 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {analysis.sessions.map((s, i) => (
                    <tr key={i} className="border-b border-white/[0.04]">
                      <td className="py-2 text-white">{new Date(s.start).toLocaleTimeString()}</td>
                      <td className="py-2 text-white">{new Date(s.end).toLocaleTimeString()}</td>
                      <td className="py-2 text-gray-400">{formatDuration(s.duration)}</td>
                      <td className="py-2 text-gray-400">{s.actions}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Recent Actions Stream */}
      <div className="mt-6 bg-[#1a1a1f] border border-white/[0.06] rounded-xl p-5">
        <h3 className="text-sm font-medium text-white mb-4">Recent Actions Stream</h3>
        <div className="space-y-1 max-h-80 overflow-y-auto custom-scrollbar">
          {recentActions.map((action) => (
            <div key={action.id} className="flex items-center gap-3 py-1.5 hover:bg-white/[0.02] rounded px-2 transition-all">
              <span className="text-xs">{getActionIcon(action.type)}</span>
              <span className={`text-xs ${getActionColor(action.type)}`}>{action.type.replace(/_/g, ' ')}</span>
              <span className="text-[10px] text-gray-600 flex-1 truncate">
                {String(action.data.app || action.data.url || action.data.key || '')}
              </span>
              <span className="text-[9px] text-gray-600">
                {new Date(action.timestamp).toLocaleTimeString()}
              </span>
            </div>
          ))}
          {recentActions.length === 0 && (
            <div className="text-center py-8 text-gray-500 text-xs">
              No recent actions. Start tracking to see your activity.
            </div>
          )}
        </div>
      </div>
        </>
      )}
    </div>
  );
}

