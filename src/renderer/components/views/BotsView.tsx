import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAgentsStore } from '../../stores/agents';
import { useChatStore } from '../../stores/chat';
import { useAutomationStore } from '../../stores/automation';
import { useNotificationStore } from '../../stores/notifications';
import { BotAvatar } from '../agents/BotAvatar';

// Bots — Hermes bot-mode architecture in Infinite glass:
// every bot is a persistent identity (role, model pin, SOUL persona, skills)
// with a canonical forever-chat, routines, and hide/unhide. Additive only.

interface Bot {
  id: string;
  name: string;
  description: string;
  icon: string;
  color: string;
  systemPrompt: string;
  allowedTools: string[];
  maxTurns: number;
  model?: string;
  provider?: string;
  soul?: string;
  avatarSeed?: string;
  createdAt: number;
  updatedAt: number;
}

const BOT_CHATS_KEY = 'infinite:bot-chats';
const HIDDEN_BOTS_KEY = 'infinite:hidden-bots';

function readMap(key: string): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(key) ?? '{}');
  } catch {
    return {};
  }
}

function readHidden(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(HIDDEN_BOTS_KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

const DEFAULT_TOOLS = ['Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep'];

export function BotsView({ onViewChange }: { onViewChange: (view: string) => void }) {
  const addToast = useNotificationStore((s) => s.addToast);
  const runs = useAgentsStore((s) => s.runs);
  const spawnAgent = useAgentsStore((s) => s.spawn);
  const refreshRuns = useAgentsStore((s) => s.refreshRuns);
  const selectSession = useChatStore((s) => s.selectSession);
  const createSession = useChatStore((s) => s.createSession);
  const renameSession = useChatStore((s) => s.renameSession);
  const pinSession = useChatStore((s) => s.pinSession);
  const loadWorkflows = useAutomationStore((s) => s.loadWorkflows);
  const workflows = useAutomationStore((s) => s.workflows);

  const [bots, setBots] = useState<Bot[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [hidden, setHidden] = useState<string[]>(() => readHidden());
  const [showHidden, setShowHidden] = useState(false);
  const [dialog, setDialog] = useState<null | { mode: 'new' | 'edit'; bot?: Bot }>(null);
  const [taskFor, setTaskFor] = useState<Bot | null>(null);
  // Master-detail layout: the left column lists bots compactly, the right
  // column shows the selected bot's full profile — so one bot never floats
  // alone in a page-sized void.
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const list = (await window.api.listCustomAgents()) as Bot[];
      setBots(Array.isArray(list) ? list : []);
    } catch {
      setBots([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    void refreshRuns();
    void loadWorkflows();
  }, [refresh, refreshRuns, loadWorkflows]);

  const busyIds = useMemo(
    () => new Set(runs.filter((r) => r.status === 'running').map((r) => r.agentId)),
    [runs],
  );
  const activeBots = useMemo(() => bots.filter((b) => busyIds.has(b.id)), [bots, busyIds]);
  const routineCount = useCallback(
    (name: string) => workflows.filter((w) => w.name.startsWith(`[bot:${name}]`)).length,
    [workflows],
  );

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return bots.filter((b) => {
      if (!showHidden && hidden.includes(b.id)) return false;
      if (!q) return true;
      return b.name.toLowerCase().includes(q) || (b.description ?? '').toLowerCase().includes(q);
    });
  }, [bots, search, hidden, showHidden]);

  // Selection falls back to the first visible bot so the detail pane is
  // never empty while a bot exists.
  const selected = useMemo(
    () => visible.find((b) => b.id === selectedId) ?? visible[0] ?? null,
    [visible, selectedId],
  );

  const setHide = (id: string, hide: boolean) => {
    setHidden((prev) => {
      const next = hide ? [...new Set([...prev, id])] : prev.filter((x) => x !== id);
      localStorage.setItem(HIDDEN_BOTS_KEY, JSON.stringify(next));
      return next;
    });
  };

  // Canonical forever-chat: created + pinned at first open, reused forever.
  const openChat = useCallback(
    async (bot: Bot) => {
      try {
        const map = readMap(BOT_CHATS_KEY);
        const known = map[bot.id];
        if (known) {
          try {
            await selectSession(known);
            onViewChange('chats');
            return;
          } catch {
            /* session gone — fall through and re-create */
          }
        }
        const settings = JSON.parse(localStorage.getItem('infinite:current') ?? '{}');
        const session = await createSession(
          settings.cwd ?? '.',
          bot.model || settings.model || 'qwen3:4b',
          bot.provider || settings.provider || 'ollama',
        );
        await renameSession(session.id, `Bot: ${bot.name}`);
        await pinSession(session.id, true);
        try {
          await window.api.appendSessionMessage({
            sessionId: session.id,
            message: {
              id: crypto.randomUUID(),
              role: 'assistant',
              content: [
                {
                  type: 'text',
                  text: `Hi, I'm ${bot.name}${bot.description ? ` — ${bot.description}` : ''}. This is our forever-chat: everything we do lives here. What are we working on?`,
                },
              ],
              timestamp: Date.now(),
            },
          });
        } catch {
          /* greeting is a nicety, not a requirement */
        }
        await selectSession(session.id);
        localStorage.setItem(BOT_CHATS_KEY, JSON.stringify({ ...readMap(BOT_CHATS_KEY), [bot.id]: session.id }));
        onViewChange('chats');
      } catch (e) {
        addToast({ title: 'Could not open bot chat', message: e instanceof Error ? e.message : 'Unknown error', type: 'error' });
      }
    },
    [addToast, createSession, onViewChange, pinSession, renameSession, selectSession],
  );

  const runBot = useCallback(
    async (bot: Bot, task: string) => {
      try {
        await spawnAgent(
          bot.id,
          task.trim(),
          bot.provider || bot.model ? { provider: bot.provider, model: bot.model } : undefined,
        );
        addToast({ title: `${bot.name} started`, message: task.trim().slice(0, 80), type: 'success' });
      } catch (e) {
        addToast({ title: 'Run failed', message: e instanceof Error ? e.message : 'Unknown error', type: 'error' });
      }
    },
    [addToast, spawnAgent],
  );

  const removeBot = useCallback(
    async (bot: Bot) => {
      if (!window.confirm(`Delete ${bot.name}? Its profile is removed permanently. Past chats stay in Sessions.`)) return;
      try {
        await window.api.deleteCustomAgent({ id: bot.id });
        const map = readMap(BOT_CHATS_KEY);
        delete map[bot.id];
        localStorage.setItem(BOT_CHATS_KEY, JSON.stringify(map));
        await refresh();
        addToast({ title: 'Bot deleted', message: bot.name, type: 'success' });
      } catch (e) {
        addToast({ title: 'Delete failed', message: e instanceof Error ? e.message : 'Unknown error', type: 'error' });
      }
    },
    [addToast, refresh],
  );

  const duplicateBot = useCallback(
    async (bot: Bot) => {
      try {
        await window.api.createCustomAgent({
          agent: {
            name: `${bot.name} copy`,
            description: bot.description,
            icon: bot.icon,
            color: bot.color,
            systemPrompt: bot.systemPrompt,
            allowedTools: bot.allowedTools,
            maxTurns: bot.maxTurns,
            model: bot.model,
            provider: bot.provider,
            soul: bot.soul,
            avatarSeed: bot.avatarSeed,
          },
        });
        await refresh();
        addToast({ title: 'Bot duplicated', message: bot.name, type: 'success' });
      } catch (e) {
        addToast({ title: 'Duplicate failed', message: e instanceof Error ? e.message : 'Unknown error', type: 'error' });
      }
    },
    [addToast, refresh],
  );

  return (
    <div className="flex-1 overflow-hidden p-6 animate-fade-in flex flex-col min-h-0">
      <div className="flex items-center gap-3 mb-1">
        <div>
          <h1 className="text-2xl font-bold text-white leading-tight">Bots</h1>
          <p className="text-zinc-500 text-sm">Specialists with their own chat, model, persona, and routines.</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {hidden.length > 0 && (
            <button
              onClick={() => setShowHidden((v) => !v)}
              title={showHidden ? 'Hide hidden bots' : 'Show hidden bots'}
              className={`rounded-lg px-2.5 py-1.5 text-xs border transition-colors ${
                showHidden
                  ? 'bg-violet-500/20 border-violet-500/40 text-violet-100'
                  : 'bg-white/[0.04] border-white/[0.08] text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              {showHidden ? '' : hidden.length}
            </button>
          )}
          <button
            onClick={() => setDialog({ mode: 'new' })}
            className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold bg-gradient-to-r from-violet-600 to-cyan-500 text-white shadow-[0_6px_16px_rgba(124,58,237,.3)] hover:from-violet-500 hover:to-cyan-400 active:scale-[0.98] transition-all"
          >
            + New Bot
          </button>
        </div>
      </div>

      {/* Master-detail: compact list on the left, the selected bot's full
          profile on the right — the same shape as the Workers view, so one
          bot never floats alone in a page-sized void. */}
      <div className="grid lg:grid-cols-[minmax(280px,1fr)_minmax(340px,1.35fr)] gap-4 flex-1 min-h-0 mt-3">
        {/* List column */}
        <div className="flex flex-col gap-3 min-h-0">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search bots…"
            aria-label="Search bots"
            className="w-full rounded-xl bg-[#0c1018] border border-white/[0.07] px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 outline-none focus:border-violet-500/30 transition-colors flex-shrink-0"
          />

          {/* Active-now presence strip */}
          {activeBots.length > 0 && (
            <div className="flex items-center gap-2 overflow-x-auto pb-1 flex-shrink-0">
              <span className="text-[10px] font-semibold uppercase tracking-[0.13em] text-emerald-300/80 flex-shrink-0">
                Active now
              </span>
              {activeBots.map((b) => (
                <button
                  key={b.id}
                  onClick={() => void openChat(b)}
                  className="inline-flex flex-shrink-0 items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/[0.07] px-2.5 py-1 text-xs text-emerald-100 hover:bg-emerald-500/[0.12] transition-colors"
                >
                  <BotAvatar name={b.name} seed={b.avatarSeed} size={20} busy />
                  {b.name}
                </button>
              ))}
            </div>
          )}

          <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar flex flex-col gap-2 pr-1">
            {loading ? (
              <div className="py-16 text-center text-sm text-zinc-500">Loading bots…</div>
            ) : visible.length === 0 ? (
              <div className="min-h-[240px] flex flex-col items-center justify-center gap-2 text-center rounded-xl bg-[#0c1018] border border-white/[0.06]">
                <div className="text-sm text-zinc-400 font-medium">{bots.length ? 'No bots match' : 'No bots yet'}</div>
                <div className="text-xs text-zinc-600 max-w-sm">
                  {bots.length
                    ? 'Try a different search — or reveal hidden bots with the eye toggle.'
                    : 'Create your first specialist: a name and a role is enough to start.'}
                </div>
                {!bots.length && (
                  <button
                    onClick={() => setDialog({ mode: 'new' })}
                    className="mt-2 rounded-lg px-4 py-2 text-xs font-semibold bg-white/[0.05] border border-white/10 text-zinc-200 hover:bg-white/[0.08] transition-colors"
                  >
                    + New Bot
                  </button>
                )}
              </div>
            ) : (
              visible.map((b) => {
                const busy = busyIds.has(b.id);
                const dimmed = hidden.includes(b.id);
                const last = runs.find((r) => r.agentId === b.id);
                const dot = last
                  ? last.status === 'running' || last.status === 'queued'
                    ? 'bg-amber-400 animate-pulse'
                    : last.status === 'failed'
                      ? 'bg-red-400'
                      : last.status === 'completed'
                        ? 'bg-emerald-400'
                        : 'bg-zinc-500'
                  : 'bg-zinc-800';
                return (
                  <button
                    key={b.id}
                    onClick={() => setSelectedId(b.id)}
                    className={`w-full flex items-center gap-3 rounded-xl border p-3 text-left transition-colors ${
                      selected?.id === b.id
                        ? 'border-violet-500/40 bg-violet-500/[0.08]'
                        : 'border-white/[0.06] bg-white/[0.02] hover:border-white/[0.12] hover:bg-white/[0.04]'
                    } ${dimmed ? 'opacity-50' : ''}`}
                  >
                    <BotAvatar name={b.name} seed={b.avatarSeed} size={36} busy={busy} />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-zinc-100 truncate">{b.name}</span>
                        {busy && <span className="af-badge">working</span>}
                      </span>
                      <span className="block text-xs text-zinc-500 truncate">{b.description || 'No role set'}</span>
                    </span>
                    <span className={`h-2 w-2 rounded-full flex-shrink-0 ${dot}`} />
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* Detail column */}
        <div className="min-h-0 overflow-y-auto custom-scrollbar">
          {!selected ? (
            <div className="h-full min-h-[240px] flex flex-col items-center justify-center gap-2 text-center rounded-2xl border border-white/[0.06] bg-white/[0.015] p-8">
              <div className="text-sm text-zinc-400 font-medium">No bot selected</div>
              <div className="text-xs text-zinc-600 max-w-xs">
                Select a bot to see its role, model, routines, and controls.
              </div>
            </div>
          ) : (() => {
            const busy = busyIds.has(selected.id);
            const dimmed = hidden.includes(selected.id);
            const routines = routineCount(selected.name);
            const last = runs.find((r) => r.agentId === selected.id);
            const dot = last
              ? last.status === 'running' || last.status === 'queued'
                ? 'bg-amber-400 animate-pulse'
                : last.status === 'failed'
                  ? 'bg-red-400'
                  : last.status === 'completed'
                    ? 'bg-emerald-400'
                    : 'bg-zinc-500'
              : 'bg-zinc-700';
            const lastDetail =
              last?.preview?.trim() ||
              (last?.status === 'failed' && last.error ? last.error.slice(0, 120) : '') ||
              last?.status ||
              '';
            return (
              <div className="rounded-2xl border border-white/[0.07] bg-[#0c1018] p-5">
                <div className="flex items-start gap-4">
                  <BotAvatar name={selected.name} seed={selected.avatarSeed} size={64} busy={busy} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <h2 className="text-lg font-bold text-white truncate">{selected.name}</h2>
                      {busy && <span className="af-badge">working</span>}
                      {dimmed && <span className="af-badge opacity-70">hidden</span>}
                    </div>
                    <p className="text-sm text-zinc-500 mt-0.5">{selected.description || 'No role set'}</p>
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
                      {(selected.provider || selected.model) && (
                        <span className="rounded-md border border-cyan-500/20 bg-cyan-500/[0.06] px-2 py-0.5 font-mono text-cyan-300/80">
                          {selected.provider ?? 'any provider'}{selected.model ? ` · ${selected.model}` : ''}
                        </span>
                      )}
                      <span className="rounded-md border border-white/[0.08] bg-white/[0.03] px-2 py-0.5 text-zinc-400">
                        {routines} routine{routines === 1 ? '' : 's'}
                      </span>
                      <span className="rounded-md border border-white/[0.08] bg-white/[0.03] px-2 py-0.5 text-zinc-400">
                        {selected.allowedTools.length} tool{selected.allowedTools.length === 1 ? '' : 's'}
                      </span>
                    </div>
                  </div>
                </div>

                {last && (
                  <div className="mt-4 rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
                    <div className="flex items-center gap-2 text-[11px] text-zinc-500 min-w-0">
                      <span className={`h-1.5 w-1.5 rounded-full flex-shrink-0 ${dot}`} />
                      <span className="uppercase tracking-[0.12em] text-[9.5px] text-zinc-600 flex-shrink-0">Last run</span>
                      <span className="truncate" title={lastDetail}>{lastDetail}</span>
                    </div>
                  </div>
                )}

                <div className="mt-4 grid grid-cols-2 gap-2">
                  <button onClick={() => void openChat(selected)} className="af-action">
                    Chat
                  </button>
                  <button onClick={() => setTaskFor(selected)} className="af-action">
                    Run task
                  </button>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-1 text-[11px]">
                  <button onClick={() => setDialog({ mode: 'edit', bot: selected })} className="rounded px-1.5 py-1 text-zinc-500 hover:text-zinc-200 hover:bg-white/[0.05] transition-colors">Edit</button>
                  <button onClick={() => void duplicateBot(selected)} className="rounded px-1.5 py-1 text-zinc-500 hover:text-zinc-200 hover:bg-white/[0.05] transition-colors">Duplicate</button>
                  <button
                    onClick={() => onViewChange('automations')}
                    title="Routines live in Automations, namespaced per bot"
                    className="rounded px-1.5 py-1 text-zinc-500 hover:text-zinc-200 hover:bg-white/[0.05] transition-colors"
                  >
                    Routines
                  </button>
                  <button onClick={() => setHide(selected.id, !dimmed)} className="rounded px-1.5 py-1 text-zinc-500 hover:text-zinc-200 hover:bg-white/[0.05] transition-colors">
                    {dimmed ? 'Unhide' : 'Hide'}
                  </button>
                  <button onClick={() => void removeBot(selected)} className="ml-auto rounded px-1.5 py-1 text-zinc-600 hover:text-red-300 hover:bg-red-500/10 transition-colors">
                    Delete
                  </button>
                </div>

                {selected.soul && (
                  <div className="mt-4 rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
                    <div className="text-[9.5px] uppercase tracking-[0.12em] text-zinc-600 mb-1">SOUL persona</div>
                    <p className="text-[11.5px] leading-relaxed text-zinc-400 line-clamp-4 whitespace-pre-wrap">{selected.soul}</p>
                  </div>
                )}
                {selected.systemPrompt && (
                  <div className="mt-3 rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
                    <div className="text-[9.5px] uppercase tracking-[0.12em] text-zinc-600 mb-1">Instructions</div>
                    <p className="text-[11.5px] leading-relaxed text-zinc-500 line-clamp-4 whitespace-pre-wrap">{selected.systemPrompt}</p>
                  </div>
                )}
              </div>
            );
          })()}
        </div>
      </div>

      {taskFor && (
        <TaskDialog
          key={taskFor.id}
          botName={taskFor.name}
          onClose={() => setTaskFor(null)}
          onRun={(task) => {
            setTaskFor(null);
            void runBot(taskFor, task);
          }}
        />
      )}

      {dialog && (
        <BotDialog
          key={dialog.mode + (dialog.bot?.id ?? 'new')}
          mode={dialog.mode}
          bot={dialog.bot}
          allBots={bots}
          onClose={() => setDialog(null)}
          onSaved={() => {
            setDialog(null);
            void refresh();
          }}
        />
      )}
    </div>
  );
}

function TaskDialog({
  botName,
  onClose,
  onRun,
}: {
  botName: string;
  onClose: () => void;
  onRun: (task: string) => void;
}) {
  const [task, setTask] = useState('');
  const submit = () => {
    if (task.trim()) onRun(task.trim());
  };
  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div
        className="relative w-full max-w-md rounded-2xl border border-white/[0.08] bg-[#111113] shadow-2xl p-5"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={`Run task with ${botName}`}
      >
        <div className="flex items-center gap-3 mb-3">
          <BotAvatar name={botName} size={32} />
          <h2 className="text-sm font-semibold text-zinc-100">Task for {botName}</h2>
          <button onClick={onClose} className="ml-auto text-zinc-500 hover:text-zinc-200 transition-colors" aria-label="Close">✕</button>
        </div>
        <textarea
          value={task}
          onChange={(e) => setTask(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder="Describe the task… (Enter to run, Shift+Enter for a new line)"
          rows={3}
          autoFocus
          className="w-full rounded-xl bg-black/20 border border-white/[0.07] px-3 py-2.5 text-sm text-zinc-100 placeholder:text-zinc-600 outline-none focus:border-violet-500/30 transition-colors resize-y"
        />
        <div className="mt-3 flex items-center gap-2">
          <button
            onClick={submit}
            disabled={!task.trim()}
            className="rounded-lg px-4 py-2 text-xs font-semibold bg-gradient-to-r from-violet-600 to-cyan-500 text-white shadow-[0_6px_16px_rgba(124,58,237,.3)] hover:from-violet-500 hover:to-cyan-400 active:scale-[0.98] disabled:opacity-50 transition-all"
          >
            Run task
          </button>
          <button
            onClick={onClose}
            className="rounded-lg px-3 py-2 text-xs font-medium bg-white/[0.04] border border-white/[0.08] text-zinc-300 hover:bg-white/[0.07] transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

function BotDialog({
  mode,
  bot,
  allBots,
  onClose,
  onSaved,
}: {
  mode: 'new' | 'edit';
  bot?: Bot;
  allBots: Bot[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const addToast = useNotificationStore((s) => s.addToast);
  const [name, setName] = useState(bot?.name ?? '');
  const [description, setDescription] = useState(bot?.description ?? '');
  const [systemPrompt, setSystemPrompt] = useState(bot?.systemPrompt ?? '');
  const [advanced, setAdvanced] = useState(false);
  const [cloneFrom, setCloneFrom] = useState('');
  const [provider, setProvider] = useState(bot?.provider ?? '');
  const [model, setModel] = useState(bot?.model ?? '');
  const [soul, setSoul] = useState(bot?.soul ?? '');
  const [avatarSeed, setAvatarSeed] = useState(bot?.avatarSeed ?? '');
  const [maxTurns, setMaxTurns] = useState(bot?.maxTurns ?? 20);
  const [tools, setTools] = useState<string[]>(bot?.allowedTools ?? DEFAULT_TOOLS);
  const [providers, setProviders] = useState<Array<{ id: string; label: string }>>([]);
  const [models, setModels] = useState<Array<{ id: string; label?: string }>>([]);
  const [toolCatalog, setToolCatalog] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const p = (await window.api.listProviders()) as Array<{ id: string; label: string }>;
        setProviders(p);
      } catch {
        /* optional */
      }
      try {
        const t = (await window.api.listTools()) as Array<{ name: string }> | string[];
        setToolCatalog(
          (Array.isArray(t) ? t : []).map((x) => (typeof x === 'string' ? x : x.name)).filter(Boolean),
        );
      } catch {
        /* optional */
      }
    })();
  }, []);

  useEffect(() => {
    if (!provider) {
      setModels([]);
      return;
    }
    void (async () => {
      try {
        const m = (await window.api.listProviderModels({ provider })) as Array<{ id: string; label?: string; provider?: string }>;
        // Strict per-provider scoping: a bot bound to this provider only ever
        // offers this provider's own models.
        setModels(Array.isArray(m) ? m.filter((model) => !model.provider || model.provider === provider) : []);
      } catch {
        setModels([]);
      }
    })();
  }, [provider]);

  const applyClone = (id: string) => {
    setCloneFrom(id);
    if (!id) return;
    const src = allBots.find((b) => b.id === id);
    if (!src) return;
    if (!systemPrompt) setSystemPrompt(src.systemPrompt);
    if (!description) setDescription(src.description);
    setTools(src.allowedTools?.length ? src.allowedTools : DEFAULT_TOOLS);
    if (!provider && src.provider) setProvider(src.provider);
    if (!model && src.model) setModel(src.model);
    if (!soul && src.soul) setSoul(src.soul);
    setMaxTurns(src.maxTurns ?? 20);
  };

  const toggleTool = (t: string) =>
    setTools((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]));

  const save = async () => {
    if (!name.trim()) {
      addToast({ title: 'Name required', message: 'Give the bot a name first.', type: 'error' });
      return;
    }
    setSaving(true);
    try {
      const payload = {
        name: name.trim(),
        description: description.trim(),
        icon: bot?.icon ?? '✦',
        color: bot?.color ?? '#8b5cf6',
        systemPrompt: systemPrompt.trim() || `You are ${name.trim()}, a specialist assistant in Infinite OS.`,
        allowedTools: tools.length ? tools : DEFAULT_TOOLS,
        maxTurns,
        model: model.trim() || undefined,
        provider: provider.trim() || undefined,
        soul: soul.trim() || undefined,
        avatarSeed: avatarSeed.trim() || undefined,
      };
      if (mode === 'edit' && bot) {
        await window.api.updateCustomAgent({ id: bot.id, updates: payload });
        addToast({ title: 'Bot updated', message: payload.name, type: 'success' });
      } else {
        await window.api.createCustomAgent({ agent: payload });
        addToast({ title: 'Bot created', message: payload.name, type: 'success' });
      }
      onSaved();
    } catch (e) {
      addToast({ title: 'Save failed', message: e instanceof Error ? e.message : 'Unknown error', type: 'error' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div
        className="relative w-full max-w-lg max-h-[85vh] overflow-y-auto custom-scrollbar rounded-2xl border border-white/[0.08] bg-[#111113] shadow-2xl p-5"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={mode === 'edit' ? 'Edit bot' : 'New bot'}
      >
        <div className="flex items-center gap-3 mb-4">
          <BotAvatar name={name || '?'} seed={avatarSeed || undefined} size={40} />
          <h2 className="text-sm font-semibold text-zinc-100">{mode === 'edit' ? 'Edit bot' : 'New bot'}</h2>
          <button onClick={onClose} className="ml-auto text-zinc-500 hover:text-zinc-200 transition-colors" aria-label="Close">✕</button>
        </div>

        <label className="block text-[11px] font-medium text-zinc-400 mb-1">Name</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Researcher"
          autoFocus
          className="w-full rounded-xl bg-black/20 border border-white/[0.07] px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 outline-none focus:border-violet-500/30 transition-colors mb-3"
        />
        <label className="block text-[11px] font-medium text-zinc-400 mb-1">Title / role</label>
        <input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="e.g. Reads docs deeply, writes findings"
          className="w-full rounded-xl bg-black/20 border border-white/[0.07] px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 outline-none focus:border-violet-500/30 transition-colors mb-3"
        />
        <label className="block text-[11px] font-medium text-zinc-400 mb-1">Instructions</label>
        <textarea
          value={systemPrompt}
          onChange={(e) => setSystemPrompt(e.target.value)}
          placeholder="How this bot behaves…"
          rows={3}
          className="w-full rounded-xl bg-black/20 border border-white/[0.07] px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 outline-none focus:border-violet-500/30 transition-colors resize-y mb-3"
        />

        <button onClick={() => setAdvanced((v) => !v)} className="text-xs font-medium text-violet-300 hover:text-violet-200 transition-colors mb-3">
          {advanced ? '▾ Advanced' : '▸ Advanced (clone, model pin, SOUL, tools)'}
        </button>

        {advanced && (
          <div className="space-y-3 rounded-xl border border-white/[0.06] bg-white/[0.02] p-3 mb-3">
            {mode === 'new' && allBots.length > 0 && (
              <div>
                <label className="block text-[11px] font-medium text-zinc-400 mb-1">Clone from</label>
                <select
                  value={cloneFrom}
                  onChange={(e) => applyClone(e.target.value)}
                  className="w-full rounded-xl bg-black/20 border border-white/[0.07] px-3 py-2 text-sm text-zinc-100 outline-none focus:border-violet-500/30 transition-colors"
                >
                  <option value="">Fresh bot</option>
                  {allBots.map((b) => (
                    <option key={b.id} value={b.id}>{b.name}</option>
                  ))}
                </select>
              </div>
            )}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[11px] font-medium text-zinc-400 mb-1">Provider pin (optional)</label>
                <select
                  value={provider}
                  onChange={(e) => {
                    setProvider(e.target.value);
                    setModel('');
                  }}
                  className="w-full rounded-xl bg-black/20 border border-white/[0.07] px-3 py-2 text-sm text-zinc-100 outline-none focus:border-violet-500/30 transition-colors"
                >
                  <option value="">Inherit default</option>
                  {providers.map((p) => (
                    <option key={p.id} value={p.id}>{p.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-medium text-zinc-400 mb-1">Model pin (optional)</label>
                {models.length ? (
                  <select
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                    className="w-full rounded-xl bg-black/20 border border-white/[0.07] px-3 py-2 text-sm text-zinc-100 outline-none focus:border-violet-500/30 transition-colors"
                  >
                    <option value="">Inherit default</option>
                    {models.map((m) => (
                      <option key={m.id} value={m.id}>{m.label ?? m.id}</option>
                    ))}
                  </select>
                ) : (
                  <input
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                    placeholder="Inherit default"
                    className="w-full rounded-xl bg-black/20 border border-white/[0.07] px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 outline-none focus:border-violet-500/30 transition-colors"
                  />
                )}
              </div>
            </div>
            <div>
              <label className="block text-[11px] font-medium text-zinc-400 mb-1">SOUL — persona & standing instructions</label>
              <textarea
                value={soul}
                onChange={(e) => setSoul(e.target.value)}
                placeholder="Who this bot is, how it speaks, what it never does…"
                rows={2}
                className="w-full rounded-xl bg-black/20 border border-white/[0.07] px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 outline-none focus:border-violet-500/30 transition-colors resize-y"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[11px] font-medium text-zinc-400 mb-1">Avatar seed</label>
                <div className="flex gap-2">
                  <input
                    value={avatarSeed}
                    onChange={(e) => setAvatarSeed(e.target.value)}
                    placeholder="blank = from name"
                    className="min-w-0 flex-1 rounded-xl bg-black/20 border border-white/[0.07] px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 outline-none focus:border-violet-500/30 transition-colors"
                  />
                  <button
                    onClick={() => setAvatarSeed(Math.random().toString(36).slice(2, 8))}
                    className="flex-shrink-0 rounded-xl px-3 py-2 text-xs bg-white/[0.05] border border-white/10 text-zinc-300 hover:bg-white/[0.08] transition-colors"
                  >
                    Re-roll
                  </button>
                </div>
              </div>
              <div>
                <label className="block text-[11px] font-medium text-zinc-400 mb-1">Max turns</label>
                <input
                  type="number"
                  min={1}
                  max={200}
                  value={maxTurns}
                  onChange={(e) => setMaxTurns(Math.max(1, Math.min(200, Number(e.target.value) || 20)))}
                  className="w-full rounded-xl bg-black/20 border border-white/[0.07] px-3 py-2 text-sm text-zinc-100 outline-none focus:border-violet-500/30 transition-colors"
                />
              </div>
            </div>
            {toolCatalog.length > 0 && (
              <div>
                <label className="block text-[11px] font-medium text-zinc-400 mb-1">Allowed tools</label>
                <div className="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto custom-scrollbar">
                  {toolCatalog.map((t) => {
                    const on = tools.includes(t);
                    return (
                      <button
                        key={t}
                        onClick={() => toggleTool(t)}
                        className={`rounded-full border px-2.5 py-1 text-[11px] transition-colors ${
                          on
                            ? 'bg-violet-500/20 border-violet-500/40 text-violet-100'
                            : 'bg-white/[0.03] border-white/[0.08] text-zinc-500 hover:text-zinc-300'
                        }`}
                      >
                        {t}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        <div className="flex items-center gap-2">
          <button
            onClick={() => void save()}
            disabled={saving || !name.trim()}
            className="rounded-lg px-4 py-2 text-xs font-semibold bg-gradient-to-r from-violet-600 to-cyan-500 text-white shadow-[0_6px_16px_rgba(124,58,237,.3)] hover:from-violet-500 hover:to-cyan-400 active:scale-[0.98] disabled:opacity-50 transition-all"
          >
            {saving ? 'Saving…' : mode === 'edit' ? 'Save changes' : 'Create bot'}
          </button>
          <button
            onClick={onClose}
            className="rounded-lg px-3 py-2 text-xs font-medium bg-white/[0.04] border border-white/[0.08] text-zinc-300 hover:bg-white/[0.07] transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
