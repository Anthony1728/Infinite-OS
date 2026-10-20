// Session Board — kanban surface for the main-process SessionBoard. Create,
// start, monitor and cancel parallel agent sessions (standalone agents, crews,
// orchestrator runs), each with optional git-worktree isolation.

import { useEffect, useMemo, useState } from 'react';
import { useSessionBoardStore, type Session, type SessionStatus, type SessionType } from '../../stores/session-board';

const COLUMN_ORDER: SessionStatus[] = ['queued', 'running', 'completed', 'failed', 'cancelled'];

const COLUMN_META: Record<SessionStatus, { label: string; accent: string }> = {
  queued: { label: 'Queued', accent: 'bg-indigo-400' },
  running: { label: 'Running', accent: 'bg-cyan-400' },
  completed: { label: 'Completed', accent: 'bg-emerald-400' },
  failed: { label: 'Failed', accent: 'bg-rose-400' },
  cancelled: { label: 'Cancelled', accent: 'bg-zinc-400' },
};

const TYPE_BADGE: Record<SessionType, string> = {
  standalone: 'bg-violet-500/15 text-violet-300 border-violet-500/20',
  crew: 'bg-cyan-500/15 text-cyan-300 border-cyan-500/20',
  orchestrator: 'bg-amber-500/15 text-amber-300 border-amber-500/20',
};

function typeLabel(type: SessionType): string {
  return type === 'standalone' ? 'Standalone' : type === 'crew' ? 'Crew' : 'Orchestrator';
}

function SessionCard({
  session,
  onStart,
  onStop,
  onInterject,
  onCopy,
}: {
  session: Session;
  onStart: () => void;
  onStop: () => void;
  onInterject: () => void;
  onCopy: () => void;
}) {
  const isActive = session.status === 'queued' || session.status === 'running';
  return (
    <div className="bg-bgCard border border-borderSubtle rounded-xl p-3 space-y-2 animate-slide-up">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-sm font-medium text-textMain truncate">{session.title}</div>
          <div className="flex items-center gap-1.5 mt-1 flex-wrap">
            <span className={`text-[9px] px-1.5 py-0.5 rounded border ${TYPE_BADGE[session.type]}`}>
              {typeLabel(session.type)}
            </span>
            {session.isolation && (
              <span className="text-[9px] text-amber-300/80 px-1.5 py-0.5 rounded border border-amber-500/20" title={session.isolation}>
                shared workspace
              </span>
            )}
            {session.model && (
              <span className="text-[9px] text-textMuted px-1.5 py-0.5 rounded bg-white/5 truncate max-w-[140px]">
                {session.model}
              </span>
            )}
          </div>
        </div>
        {isActive && (
          <div className="w-2 h-2 rounded-full bg-cyan-400 animate-live-pulse flex-none mt-1" />
        )}
      </div>

      {session.status === 'running' && (
        <div>
          <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
            <div
              className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-violet-500 transition-all duration-500"
              style={{ width: `${session.progress}%` }}
            />
          </div>
          <div className="text-[10px] text-textMuted mt-1 truncate">{session.currentStep ?? 'Working…'}</div>
        </div>
      )}

      {session.status === 'failed' && session.error && (
        <div className="text-[10px] text-rose-300/90 break-words">{session.error}</div>
      )}
      {session.status === 'completed' && session.results?.result && (
        <div className="text-[10px] text-emerald-300/80 break-words truncate">{session.results.result}</div>
      )}

      <div className="flex items-center justify-between gap-2 pt-1">
        <div className="text-[9px] text-textMuted">
          {session.startedAt
            ? new Date(session.startedAt).toLocaleTimeString()
            : 'queued'}
          {session.completedAt && session.startedAt
            ? ` · ${((session.completedAt - session.startedAt) / 1000).toFixed(0)}s`
            : ''}
        </div>
        {session.status === 'queued' && (
          <button onClick={onStart} className="btn-premium text-[10px] px-3 py-1">Start →</button>
        )}
        {session.status === 'running' && (
          <div className="flex gap-1.5">
            {session.type === 'orchestrator' && (
              <button
                onClick={onInterject}
                className="px-2 py-1 rounded-lg bg-amber-500/10 text-amber-300 text-[10px] font-medium border border-amber-500/20 hover:bg-amber-500/20 transition-all"
                title="Send a message to the running orchestrator"
              >
                Interject
              </button>
            )}
            <button
              onClick={onStop}
              className="px-2 py-1 rounded-lg bg-red-500/10 text-red-400 text-[10px] font-medium border border-red-500/20 hover:bg-red-500/20 transition-all"
            >
              Stop
            </button>
          </div>
        )}
        {session.status === 'completed' && session.results?.result && (
          <button onClick={onCopy} className="px-2 py-1 rounded-lg bg-green-500/10 text-green-400 text-[10px] font-medium border border-green-500/20 hover:bg-green-500/20 transition-all">
            Copy
          </button>
        )}
      </div>
    </div>
  );
}

function NewSessionForm({ onClose }: { onClose: () => void }) {
  const create = useSessionBoardStore((s) => s.create);
  const start = useSessionBoardStore((s) => s.start);

  const [type, setType] = useState<SessionType>('standalone');
  const [title, setTitle] = useState('');
  const [task, setTask] = useState('');
  const [agentId, setAgentId] = useState('');
  const [model, setModel] = useState('');
  const [provider, setProvider] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    if (!title.trim() || !task.trim() || busy) return;
    setBusy(true);
    setError('');
    try {
      const session = await create(type, title.trim(), {
        agentId: agentId.trim() || undefined,
        model: model.trim() || undefined,
        provider: provider.trim() || undefined,
        description: task.trim(),
      });
      await start(session.id, task.trim(), agentId.trim() || undefined, model.trim() || undefined, provider.trim() || undefined);
      onClose();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-3 animate-slide-down">
      <div className="grid grid-cols-3 gap-2">
        {(['standalone', 'crew', 'orchestrator'] as SessionType[]).map((t) => (
          <button
            key={t}
            onClick={() => setType(t)}
            className={`px-2 py-1.5 rounded-lg text-[11px] font-medium border transition-all capitalize ${
              type === t
                ? 'bg-indigo-500/15 text-indigo-300 border-indigo-500/30'
                : 'text-textMuted border-borderSubtle hover:border-white/20'
            }`}
          >
            {typeLabel(t)}
          </button>
        ))}
      </div>
      <input
        className="af-task-input"
        placeholder="Session title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
      />
      <textarea
        className="af-task-input resize-none"
        placeholder={`Task for this ${typeLabel(type)} session…`}
        rows={3}
        value={task}
        onChange={(e) => setTask(e.target.value)}
      />
      {type === 'standalone' && (
        <input
          className="af-task-input"
          placeholder="Agent id (default: auto)"
          value={agentId}
          onChange={(e) => setAgentId(e.target.value)}
        />
      )}
      <div className="grid grid-cols-2 gap-2">
        <input
          className="af-task-input"
          placeholder="Model"
          value={model}
          onChange={(e) => setModel(e.target.value)}
        />
        <input
          className="af-task-input"
          placeholder="Provider (default: openrouter)"
          value={provider}
          onChange={(e) => setProvider(e.target.value)}
        />
      </div>
      {error && <div className="text-[11px] text-rose-300">{error}</div>}
      <div className="flex justify-end gap-2">
        <button onClick={onClose} className="px-3 py-1.5 text-xs text-textMuted hover:text-textMain rounded-lg hover:bg-white/5 transition-all">
          Cancel
        </button>
        <button onClick={submit} disabled={!title.trim() || !task.trim() || busy} className="btn-premium text-xs disabled:opacity-50">
          {busy ? 'Starting…' : 'Create & Start'}
        </button>
      </div>
    </div>
  );
}

export function SessionBoard() {
  const { sessions, stats, init, refresh, start, cancel, interject } = useSessionBoardStore();
  const [showCreate, setShowCreate] = useState(false);
  const [interjectId, setInterjectId] = useState<string | null>(null);
  const [interjectText, setInterjectText] = useState('');

  useEffect(() => { void init(); }, [init]);

  const columns = useMemo(() => {
    const map = new Map<SessionStatus, Session[]>();
    for (const status of COLUMN_ORDER) map.set(status, []);
    for (const session of sessions) map.get(session.status)?.push(session);
    return map;
  }, [sessions]);

  const handleCopy = async (result: string) => {
    await navigator.clipboard.writeText(result);
  };

  const submitInterject = async (sessionId: string) => {
    if (!interjectText.trim()) return;
    await interject(sessionId, interjectText.trim());
    setInterjectId(null);
    setInterjectText('');
  };

  return (
    <div className="mb-8">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-sm font-semibold text-textMuted uppercase tracking-wider">Session Board</h2>
          <p className="text-xs text-textMuted mt-0.5">
            Parallel sessions with git-worktree isolation · {stats.active} active · {stats.total} total
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => refresh()}
            className="w-8 h-8 rounded-lg bg-bgCard border border-borderSubtle hover:border-indigo-500/30 flex items-center justify-center text-textMuted hover:text-textMain transition-all"
            title="Refresh board"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99" />
            </svg>
          </button>
          <button onClick={() => setShowCreate((v) => !v)} className="btn-premium flex items-center gap-1.5">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            New Session
          </button>
        </div>
      </div>

      {showCreate && (
        <div className="mb-4 bg-bgPanel border border-borderSubtle rounded-2xl p-4">
          <NewSessionForm onClose={() => setShowCreate(false)} />
        </div>
      )}

      {sessions.length === 0 ? (
        <div className="text-center py-10 bg-bgPanel border border-borderSubtle rounded-2xl">
          <div className="w-12 h-12 mx-auto rounded-2xl bg-gradient-to-br from-[#2a1b47] to-[#101226] border border-white/10 flex items-center justify-center mb-3">
            <svg className="w-6 h-6 text-violet-300" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 0 1 6 3.75h2.25A2.25 2.25 0 0 1 10.5 6v2.25a2.25 2.25 0 0 1-2.25 2.25H6a2.25 2.25 0 0 1-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 0 1 6 13.5h2.25a2.25 2.25 0 0 1 2.25 2.25V18a2.25 2.25 0 0 1-2.25 2.25H6A2.25 2.25 0 0 1 3.75 18v-2.25zM13.5 6a2.25 2.25 0 0 1 2.25-2.25H18A2.25 2.25 0 0 1 20.25 6v2.25A2.25 2.25 0 0 1 18 10.5h-2.25a2.25 2.25 0 0 1-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 0 1 2.25-2.25H18a2.25 2.25 0 0 1 2.25 2.25V18A2.25 2.25 0 0 1 18 20.25h-2.25A2.25 2.25 0 0 1 13.5 18v-2.25z" />
            </svg>
          </div>
          <p className="text-textMuted text-sm">No sessions yet. Create one to run a standalone agent, a crew, or an orchestrator in parallel.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-3">
          {COLUMN_ORDER.map((status) => {
            const meta = COLUMN_META[status];
            const items = columns.get(status) ?? [];
            return (
              <div key={status} className="bg-bgPanel/50 border border-borderSubtle rounded-xl p-2.5 min-h-[120px]">
                <div className="flex items-center gap-1.5 mb-2 px-1">
                  <span className={`w-1.5 h-1.5 rounded-full ${meta.accent}`} />
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-textMuted">{meta.label}</span>
                  <span className="text-[10px] text-textMuted opacity-60 ml-auto">{items.length}</span>
                </div>
                <div className="space-y-2">
                  {items.map((session) => (
                    <div key={session.id}>
                      <SessionCard
                        session={session}
                        onStart={() => start(session.id, session.description ?? 'Run queued session')}
                        onStop={() => cancel(session.id)}
                        onInterject={() => setInterjectId(session.id)}
                        onCopy={() => handleCopy(session.results?.result ?? '')}
                      />
                      {interjectId === session.id && (
                        <div className="mt-2 flex gap-2">
                          <input
                            className="af-task-input flex-1"
                            placeholder="Message the orchestrator…"
                            value={interjectText}
                            autoFocus
                            onChange={(e) => setInterjectText(e.target.value)}
                            onKeyDown={(e) => { if (e.key === 'Enter') submitInterject(session.id); if (e.key === 'Escape') setInterjectId(null); }}
                          />
                          <button onClick={() => submitInterject(session.id)} className="btn-premium text-[10px] px-3 py-1">Send</button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}