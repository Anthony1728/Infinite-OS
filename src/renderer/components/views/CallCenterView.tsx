import { useState, useEffect } from 'react';
import { Phone, PhoneCall, PhoneOff, Pause, Play, Users, Plus, Headphones } from 'lucide-react';

interface CallRecord {
  id: string;
  callerId: string;
  callerName?: string;
  direction: string;
  status: string;
  startTime: number;
  endTime?: number;
  duration?: number;
  agentId?: string;
  disposition?: string;
  tags: string[];
}

interface CallAgent {
  id: string;
  name: string;
  status: string;
  skills: string[];
  totalCalls: number;
  avgHandleTime: number;
  satisfaction: number;
}

interface CallQueue {
  id: string;
  name: string;
  waitlist: string[];
  enabled: boolean;
}

export function CallCenterView() {
  const [tab, setTab] = useState<'calls' | 'agents' | 'queues' | 'analytics'>('calls');
  const [calls, setCalls] = useState<CallRecord[]>([]);
  const [agents, setAgents] = useState<CallAgent[]>([]);
  const [queues, setQueues] = useState<CallQueue[]>([]);
  const [analytics, setAnalytics] = useState<{ totalCalls?: number; answeredCalls?: number; missedCalls?: number; avgHandleTime?: number; callsByHour?: Array<{ hour: number; count: number }>; topDispositions?: Array<{ disposition: string; count: number }> } | null>(null);
  const [showNewAgent, setShowNewAgent] = useState(false);
  const [newAgentName, setNewAgentName] = useState('');
  const [showNewQueue, setShowNewQueue] = useState(false);
  const [newQueueName, setNewQueueName] = useState('');
  const [showNewCall, setShowNewCall] = useState(false);
  const [newCallerId, setNewCallerId] = useState('');
  const [newDirection, setNewDirection] = useState('inbound');

  useEffect(() => { loadAll(); }, []);

  const loadAll = async () => {
    try { setCalls(await window.api.callList()); } catch { /* silent */ }
    try { setAgents(await window.api.callAgentList()); } catch { /* silent */ }
    try { setQueues(await window.api.callQueueList()); } catch { /* silent */ }
    try { setAnalytics(await window.api.callAnalytics()); } catch { /* silent */ }
  };

  const createCall = async () => {
    if (!newCallerId) return;
    await window.api.callCreate({ callerId: newCallerId, direction: newDirection });
    setShowNewCall(false);
    setNewCallerId('');
    loadAll();
  };

  const answerCall = async (callId: string) => {
    const avail = agents.find((a) => a.status === 'available');
    await window.api.callAnswer({ callId, agentId: avail?.id });
    loadAll();
  };

  const holdCall = async (callId: string) => {
    await window.api.callHold({ callId });
    loadAll();
  };

  const resumeCall = async (callId: string) => {
    await window.api.callResume({ callId });
    loadAll();
  };

  const endCall = async (callId: string) => {
    await window.api.callEnd({ callId, disposition: 'completed' });
    loadAll();
  };

  const createAgent = async () => {
    if (!newAgentName) return;
    await window.api.callAgentCreate({ name: newAgentName, skills: [], maxConcurrent: 1 });
    setShowNewAgent(false);
    setNewAgentName('');
    loadAll();
  };

  const createQueue = async () => {
    if (!newQueueName) return;
    await window.api.callQueueCreate({ name: newQueueName });
    setShowNewQueue(false);
    setNewQueueName('');
    loadAll();
  };

  const updateAgentStatus = async (agentId: string, status: string) => {
    await window.api.callAgentStatus({ agentId, status });
    loadAll();
  };

  const statusColor = (status: string) => {
    switch (status) {
      case 'active': return 'text-green-400 bg-green-500/15';
      case 'hold': return 'text-yellow-400 bg-yellow-500/15';
      case 'ringing': return 'text-blue-400 bg-blue-500/15';
      case 'missed': return 'text-red-400 bg-red-500/15';
      case 'ended': return 'text-[var(--text-secondary)] bg-[var(--bg-tertiary)]';
      case 'available': return 'text-green-400 bg-green-500/15';
      case 'busy': return 'text-red-400 bg-red-500/15';
      case 'away': return 'text-yellow-400 bg-yellow-500/15';
      default: return 'text-[var(--text-secondary)] bg-[var(--bg-tertiary)]';
    }
  };

  const formatDuration = (ms?: number) => {
    if (!ms) return '--';
    const s = Math.floor(ms / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  };

  return (
    <div className="h-full flex flex-col bg-[var(--bg-primary)]">
      <div className="p-3 border-b border-[var(--border)]">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold">Call Center</h2>
          <div className="flex gap-2">
            {analytics && (
              <div className="flex gap-3 text-xs">
                <span className="text-green-400">{analytics.answeredCalls} answered</span>
                <span className="text-red-400">{analytics.missedCalls} missed</span>
                <span className="text-[var(--text-secondary)]">Avg: {formatDuration(analytics.avgHandleTime)}</span>
              </div>
            )}
          </div>
        </div>
        <div className="flex gap-1">
          {(['calls', 'agents', 'queues', 'analytics'] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-3 py-1.5 rounded text-sm capitalize ${
                tab === t ? 'bg-[var(--accent)] text-white' : 'hover:bg-[var(--bg-tertiary)]'}`}>
              {t}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-auto p-4">
        {tab === 'calls' && (
          <div>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-medium">Active Calls</h3>
              <button onClick={() => setShowNewCall(true)}
                className="flex items-center gap-1 px-3 py-1.5 rounded bg-[var(--accent)] text-white text-sm">
                <Phone size={14} /> New Call
              </button>
            </div>
            {showNewCall && (
              <div className="p-3 bg-[var(--bg-secondary)] rounded mb-4 space-y-2">
                <div className="flex gap-2">
                  <input type="text" placeholder="Caller ID" value={newCallerId} onChange={(e) => setNewCallerId(e.target.value)}
                    className="flex-1 p-2 rounded bg-[var(--bg-primary)] border border-[var(--border)] text-sm" />
                  <select value={newDirection} onChange={(e) => setNewDirection(e.target.value)}
                    className="p-2 rounded bg-[var(--bg-primary)] border border-[var(--border)] text-sm">
                    <option value="inbound">Inbound</option>
                    <option value="outbound">Outbound</option>
                  </select>
                </div>
                <div className="flex gap-2">
                  <button onClick={createCall} className="px-3 py-1.5 rounded bg-[var(--accent)] text-white text-sm">Create</button>
                  <button onClick={() => setShowNewCall(false)} className="px-3 py-1.5 rounded bg-[var(--bg-tertiary)] text-sm">Cancel</button>
                </div>
              </div>
            )}
            <div className="space-y-2">
              {calls.map((c) => (
                <div key={c.id} className="flex items-center gap-3 p-3 bg-[var(--bg-secondary)] rounded">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center ${statusColor(c.status)}`}>
                    {c.direction === 'inbound' ? <Phone size={14} /> : <PhoneCall size={14} />}
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{c.callerName || c.callerId}</span>
                      <span className="text-xs text-[var(--text-secondary)]">{c.direction}</span>
                    </div>
                    <div className="text-xs text-[var(--text-secondary)]">
                      {formatDuration(c.duration || (Date.now() - c.startTime))}
                      {c.agentId && ` · Agent assigned`}
                    </div>
                  </div>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${statusColor(c.status)}`}>{c.status}</span>
                  <div className="flex gap-1">
                    {c.status === 'ringing' && (
                      <button onClick={() => answerCall(c.id)} className="p-1.5 rounded hover:bg-green-500/20 text-green-400">
                        <Phone size={14} />
                      </button>
                    )}
                    {c.status === 'active' && (
                      <>
                        <button onClick={() => holdCall(c.id)} className="p-1.5 rounded hover:bg-yellow-500/20 text-yellow-400">
                          <Pause size={14} />
                        </button>
                        <button onClick={() => endCall(c.id)} className="p-1.5 rounded hover:bg-red-500/20 text-red-400">
                          <PhoneOff size={14} />
                        </button>
                      </>
                    )}
                    {c.status === 'hold' && (
                      <button onClick={() => resumeCall(c.id)} className="p-1.5 rounded hover:bg-green-500/20 text-green-400">
                        <Play size={14} />
                      </button>
                    )}
                  </div>
                </div>
              ))}
              {calls.length === 0 && (
                <div className="text-center py-12 text-[var(--text-secondary)]">
                  <Phone size={48} className="mx-auto mb-4 opacity-50" />
                  <p>No calls yet</p>
                </div>
              )}
            </div>
          </div>
        )}

        {tab === 'agents' && (
          <div>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-medium">Agents ({agents.length})</h3>
              <button onClick={() => setShowNewAgent(true)}
                className="flex items-center gap-1 px-3 py-1.5 rounded bg-[var(--accent)] text-white text-sm">
                <Plus size={14} /> Add Agent
              </button>
            </div>
            {showNewAgent && (
              <div className="p-3 bg-[var(--bg-secondary)] rounded mb-4 space-y-2">
                <input type="text" placeholder="Agent name" value={newAgentName} onChange={(e) => setNewAgentName(e.target.value)}
                  className="w-full p-2 rounded bg-[var(--bg-primary)] border border-[var(--border)] text-sm" />
                <div className="flex gap-2">
                  <button onClick={createAgent} className="px-3 py-1.5 rounded bg-[var(--accent)] text-white text-sm">Create</button>
                  <button onClick={() => setShowNewAgent(false)} className="px-3 py-1.5 rounded bg-[var(--bg-tertiary)] text-sm">Cancel</button>
                </div>
              </div>
            )}
            <div className="space-y-2">
              {agents.map((a) => (
                <div key={a.id} className="flex items-center gap-3 p-3 bg-[var(--bg-secondary)] rounded">
                  <Headphones size={14} className="text-[var(--accent)]" />
                  <div className="flex-1">
                    <span className="text-sm font-medium">{a.name}</span>
                    <div className="text-xs text-[var(--text-secondary)]">
                      {a.totalCalls} calls · {formatDuration(a.avgHandleTime)} avg · {a.satisfaction.toFixed(1)}★
                    </div>
                  </div>
                  <select value={a.status} onChange={(e) => updateAgentStatus(a.id, e.target.value)}
                    className={`text-xs px-2 py-1 rounded ${statusColor(a.status)}`}>
                    <option value="available">Available</option>
                    <option value="busy">Busy</option>
                    <option value="away">Away</option>
                    <option value="offline">Offline</option>
                  </select>
                </div>
              ))}
            </div>
          </div>
        )}

        {tab === 'queues' && (
          <div>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-medium">Queues ({queues.length})</h3>
              <button onClick={() => setShowNewQueue(true)}
                className="flex items-center gap-1 px-3 py-1.5 rounded bg-[var(--accent)] text-white text-sm">
                <Plus size={14} /> New Queue
              </button>
            </div>
            {showNewQueue && (
              <div className="p-3 bg-[var(--bg-secondary)] rounded mb-4 space-y-2">
                <input type="text" placeholder="Queue name" value={newQueueName} onChange={(e) => setNewQueueName(e.target.value)}
                  className="w-full p-2 rounded bg-[var(--bg-primary)] border border-[var(--border)] text-sm" />
                <div className="flex gap-2">
                  <button onClick={createQueue} className="px-3 py-1.5 rounded bg-[var(--accent)] text-white text-sm">Create</button>
                  <button onClick={() => setShowNewQueue(false)} className="px-3 py-1.5 rounded bg-[var(--bg-tertiary)] text-sm">Cancel</button>
                </div>
              </div>
            )}
            <div className="space-y-2">
              {queues.map((q) => (
                <div key={q.id} className="flex items-center gap-3 p-3 bg-[var(--bg-secondary)] rounded">
                  <Users size={14} className="text-[var(--accent)]" />
                  <div className="flex-1">
                    <span className="text-sm font-medium">{q.name}</span>
                    <div className="text-xs text-[var(--text-secondary)]">{q.waitlist.length} waiting</div>
                  </div>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${q.enabled ? 'text-green-400 bg-green-500/15' : 'text-red-400 bg-red-500/15'}`}>
                    {q.enabled ? 'Active' : 'Disabled'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {tab === 'analytics' && analytics && (
          <div className="space-y-4">
            <div className="grid grid-cols-4 gap-3">
              <div className="p-4 bg-[var(--bg-secondary)] rounded-lg text-center">
                <div className="text-2xl font-bold">{analytics.totalCalls}</div>
                <div className="text-xs text-[var(--text-secondary)]">Total Calls</div>
              </div>
              <div className="p-4 bg-green-500/10 rounded-lg text-center">
                <div className="text-2xl font-bold text-green-400">{analytics.answeredCalls}</div>
                <div className="text-xs text-[var(--text-secondary)]">Answered</div>
              </div>
              <div className="p-4 bg-red-500/10 rounded-lg text-center">
                <div className="text-2xl font-bold text-red-400">{analytics.missedCalls}</div>
                <div className="text-xs text-[var(--text-secondary)]">Missed</div>
              </div>
              <div className="p-4 bg-[var(--bg-secondary)] rounded-lg text-center">
                <div className="text-2xl font-bold">{formatDuration(analytics.avgHandleTime)}</div>
                <div className="text-xs text-[var(--text-secondary)]">Avg Handle Time</div>
              </div>
            </div>

            <div className="p-4 bg-[var(--bg-secondary)] rounded-lg">
              <h3 className="text-sm font-medium mb-3">Calls by Hour</h3>
              <div className="flex items-end gap-1 h-32">
                {analytics.callsByHour?.map((entry: { hour: number; count: number }) => (
                  <div key={entry.hour} className="flex-1 flex flex-col items-center">
                    <div
                      className="w-full bg-[var(--accent)] rounded-t"
                      style={{ height: `${Math.max(2, (entry.count / Math.max(...(analytics.callsByHour?.map((e: { count: number }) => e.count) ?? [1]), 1)) * 100)}%` }}
                    />
                    {entry.hour % 3 === 0 && <span className="text-[8px] text-[var(--text-secondary)] mt-1">{entry.hour}h</span>}
                  </div>
                ))}
              </div>
            </div>

            {analytics.topDispositions && analytics.topDispositions.length > 0 && (
              <div className="p-4 bg-[var(--bg-secondary)] rounded-lg">
                <h3 className="text-sm font-medium mb-3">Top Dispositions</h3>
                <div className="space-y-2">
                  {analytics.topDispositions.map((d: { disposition: string; count: number }) => (
                    <div key={d.disposition} className="flex items-center gap-3">
                      <span className="text-sm flex-1">{d.disposition}</span>
                      <span className="text-xs text-[var(--text-secondary)]">{d.count}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

