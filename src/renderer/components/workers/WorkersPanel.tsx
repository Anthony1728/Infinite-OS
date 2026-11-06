import { useEffect, useMemo, useState } from 'react';
import { useWorkersStore, type WorkerView } from '../../stores/workers';
import { useNotificationStore } from '../../stores/notifications';
import { AppIcon, BRAND_GRADIENT } from '../brand/AppIcon';

const STATUS_META: Record<WorkerView['status'], { label: string; dot: string; badge: string }> = {
  running: { label: 'Running', dot: 'bg-emerald-400', badge: 'bg-emerald-400/10 text-emerald-300 border-emerald-400/30' },
  scheduled: { label: 'Scheduled', dot: 'bg-sky-400', badge: 'bg-sky-400/10 text-sky-300 border-sky-400/30' },
  draft: { label: 'Manual', dot: 'bg-violet-400', badge: 'bg-violet-400/10 text-violet-300 border-violet-400/30' },
  paused: { label: 'Paused', dot: 'bg-amber-400', badge: 'bg-amber-400/10 text-amber-300 border-amber-400/30' },
  needs_input: { label: 'Needs attention', dot: 'bg-rose-400', badge: 'bg-rose-400/10 text-rose-300 border-rose-400/30' },
};

const STEP_META: Record<string, { icon: string; label: string; className: string }> = {
  pending: { icon: '○', label: 'Pending', className: 'text-white/30' },
  running: { icon: '◐', label: 'Running', className: 'text-sky-300' },
  completed: { icon: '●', label: 'Done', className: 'text-emerald-300' },
  failed: { icon: '✕', label: 'Failed', className: 'text-rose-300' },
  skipped: { icon: '–', label: 'Skipped', className: 'text-white/30' },
};

function formatWhen(ts?: number): string {
  if (!ts) return 'Never';
  const diff = Date.now() - ts;
  if (diff < 60_000) return 'Just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return new Date(ts).toLocaleDateString([], { month: 'short', day: 'numeric' });
}

interface CreateForm {
  name: string;
  task: string;
  steps: string;
  schedule: 'manual' | 'interval' | 'daily' | 'weekdays' | 'once';
  intervalMinutes: number;
  time: string;
  onceAt: string;
  notify: boolean;
}

const EMPTY_FORM: CreateForm = {
  name: '',
  task: '',
  steps: '',
  schedule: 'manual',
  intervalMinutes: 30,
  time: '09:00',
  onceAt: '',
  notify: true,
};

function buildTrigger(form: CreateForm): { type: string; config: Record<string, unknown> } {
  switch (form.schedule) {
    case 'interval':
      return { type: 'interval', config: { intervalMs: Math.max(1, form.intervalMinutes) * 60_000 } };
    case 'daily': {
      const [hour, minute] = form.time.split(':').map(Number);
      return { type: 'cron', config: { cron: `${minute || 0} ${hour || 0} * * *` } };
    }
    case 'weekdays': {
      const [hour, minute] = form.time.split(':').map(Number);
      return { type: 'cron', config: { cron: `${minute || 0} ${hour || 0} * * 1-5` } };
    }
    case 'once':
      return { type: 'once', config: { onceAt: form.onceAt ? new Date(form.onceAt).toISOString() : '' } };
    default:
      return { type: 'manual', config: {} };
  }
}

/** Reverse of buildTrigger, so editing a worker starts from what it already is. */
function formFromWorker(worker: WorkerView): CreateForm {
  const { type, config } = worker.trigger;
  const cron = String(config.cron ?? '0 9 * * *').split(/\s+/);
  const schedule: CreateForm['schedule'] =
    type === 'interval' ? 'interval'
      : type === 'cron' ? (String(config.cron ?? '').includes('1-5') ? 'weekdays' : 'daily')
        : type === 'once' ? 'once'
          : 'manual';
  const intervalMs = Number(config.intervalMs ?? 0);
  const onceAtDate = config.onceAt ? new Date(String(config.onceAt)) : null;
  return {
    name: worker.name,
    task: worker.task,
    steps: worker.steps.map((step) => step.title).join('\n'),
    schedule,
    intervalMinutes: intervalMs > 0 ? Math.max(1, Math.round(intervalMs / 60_000)) : 30,
    time: `${(cron[1] ?? '9').padStart(2, '0')}:${(cron[0] ?? '0').padStart(2, '0')}`,
    onceAt: onceAtDate && !Number.isNaN(onceAtDate.getTime()) ? toLocalInputValue(onceAtDate) : '',
    notify: worker.notifyOnFinish,
  };
}

function toLocalInputValue(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * Split the textarea into step objects without losing what the worker already
 * had: a step keeps its instruction (and demo frame) when its title still
 * matches, or when the count is unchanged and it simply moved position.
 */
function buildSteps(titles: string[], existing: WorkerView['steps']): Array<{ title: string; instruction: string; referenceFrame?: string }> {
  return titles.map((title, index) => {
    const byTitle = existing.find((step) => step.title === title);
    const byPosition = titles.length === existing.length ? existing[index] : undefined;
    const source = byTitle ?? byPosition;
    return {
      title,
      instruction: source?.instruction ?? `Complete this step: ${title}`,
      ...(source?.referenceFrame ? { referenceFrame: source.referenceFrame } : {}),
    };
  });
}

export function WorkersPanel({ onOpenTeaching }: { onOpenTeaching: () => void }) {
  const {
    workers, stats, background, selectedId, history, historyFor, loading,
    select, run, pause, resume, stop, remove, interject, setBackground, refresh,
  } = useWorkersStore();
  const addToast = useNotificationStore((s) => s.addToast);
  const [showCreate, setShowCreate] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<CreateForm>(EMPTY_FORM);
  const [instruction, setInstruction] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [, setTick] = useState(0);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => setTick((value) => value + 1), 60_000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const selected = useMemo(
    () => workers.find((worker) => worker.id === selectedId) ?? null,
    [workers, selectedId],
  );

  const guard = async (label: string, action: () => Promise<void>) => {
    setBusy(label);
    try {
      await action();
    } catch (error) {
      addToast({ type: 'error', title: 'Worker action failed', message: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(null);
    }
  };

  const handleCreate = async () => {
    if (!form.name.trim() || !form.task.trim()) {
      addToast({ type: 'error', title: 'Name and task are required' });
      return;
    }
    if (form.schedule === 'once' && (!form.onceAt || Number.isNaN(Date.parse(form.onceAt)))) {
      addToast({ type: 'error', title: 'Pick a valid one-shot time' });
      return;
    }
    const titles = form.steps.split('\n').map((line) => line.trim()).filter(Boolean);
    const editing = editingId ? workers.find((worker) => worker.id === editingId) : undefined;
    await guard(editing ? 'update' : 'create', async () => {
      if (editing) {
        await window.api.workerUpdate({
          workerId: editing.id,
          input: {
            name: form.name.trim(),
            task: form.task.trim(),
            steps: buildSteps(titles, editing.steps),
            trigger: buildTrigger(form),
            notifyOnFinish: form.notify,
          },
        });
      } else {
        await window.api.workerCreate({
          name: form.name.trim(),
          task: form.task.trim(),
          steps: titles,
          trigger: buildTrigger(form),
          notifyOnFinish: form.notify,
        });
      }
      const wasEditing = Boolean(editing);
      const label = form.name.trim();
      setForm(EMPTY_FORM);
      setEditingId(null);
      setShowCreate(false);
      await refresh();
      addToast({
        type: 'success',
        title: wasEditing ? 'Worker updated' : 'Worker created',
        message: `“${label}” is ${wasEditing ? 'saved' : 'ready'}.`,
      });
    });
  };

  const openEdit = (worker: WorkerView) => {
    setEditingId(worker.id);
    setForm(formFromWorker(worker));
    setShowCreate(true);
    // The form lives above the list — bring it into view.
    window.requestAnimationFrame(() => document.getElementById('worker-form')?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
  };

  const handleInterject = async () => {
    if (!selected || !instruction.trim()) return;
    await guard('interject', async () => {
      await interject(selected.id, instruction.trim());
      setInstruction('');
      addToast({ type: 'success', title: 'Instruction added', message: 'Pending steps will pick it up.' });
    });
  };

  const statCards = [
    { label: 'Workers', value: stats?.total ?? workers.length, tone: 'text-white' },
    { label: 'Scheduled', value: stats?.scheduled ?? 0, tone: 'text-sky-300' },
    { label: 'Running now', value: stats?.running ?? 0, tone: 'text-emerald-300' },
    { label: 'Need attention', value: stats?.needsInput ?? 0, tone: 'text-rose-300' },
    { label: 'Completed runs', value: stats?.successfulRuns ?? 0, tone: 'text-white' },
  ];

  return (
    <div className="flex flex-col gap-4 min-h-0 flex-1">
      {/* Header + stats */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-xl font-semibold text-white">Workers</h2>
          <p className="text-sm text-gray-500 mt-0.5">
            One worker per recurring task — with a step list you can watch, edit, pause, and reset.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-2 text-xs text-gray-400 bg-white/[0.04] border border-white/[0.08] rounded-lg px-3 py-2 cursor-pointer hover:bg-white/[0.07] transition-colors">
            <input
              type="checkbox"
              checked={background?.enabled ?? false}
              onChange={(event) => {
                void guard('background', async () => {
                  await setBackground(event.target.checked);
                  addToast({
                    type: 'success',
                    title: event.target.checked ? 'Workers keep running when the window closes' : 'Closing the window now quits Infinite OS',
                  });
                });
              }}
              className="accent-indigo-500"
            />
            Keep running in background
          </label>
          <button
            onClick={onOpenTeaching}
            className="text-sm px-3 py-2 rounded-lg border border-white/[0.10] text-gray-300 hover:bg-white/[0.06] transition-colors"
          >
            Teach a task
          </button>
          <button
            onClick={() => { setShowCreate(true); setEditingId(null); setForm(EMPTY_FORM); }}
            className="text-sm px-4 py-2 rounded-lg bg-indigo-500 hover:bg-indigo-400 text-white font-medium transition-colors"
          >
            New worker
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {statCards.map((card) => (
          <div key={card.label} className="rounded-xl border border-white/[0.07] bg-white/[0.03] px-4 py-3">
            <div className={`text-2xl font-semibold ${card.tone}`}>{card.value}</div>
            <div className="text-[11px] uppercase tracking-wide text-gray-500 mt-0.5">{card.label}</div>
          </div>
        ))}
      </div>

      {showCreate && (
        <div id="worker-form" className="rounded-xl border border-indigo-400/30 bg-indigo-500/[0.06] p-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div className="text-sm font-medium text-white">
              {editingId ? 'Edit worker' : 'New worker'}
            </div>
            {editingId && (
              <div className="text-[11px] text-gray-400">Changes apply from the next run.</div>
            )}
          </div>
          <div className="grid md:grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs text-gray-400">Name</span>
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Morning inbox triage"
                className="mt-1 w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-white/25"
              />
            </label>
            <label className="block">
              <span className="text-xs text-gray-400">Schedule</span>
              <select
                value={form.schedule}
                onChange={(e) => setForm({ ...form, schedule: e.target.value as CreateForm['schedule'] })}
                className="mt-1 w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-sm text-white"
              >
                <option value="manual">Manual only</option>
                <option value="interval">Every N minutes</option>
                <option value="daily">Every day</option>
                <option value="weekdays">Weekdays</option>
                <option value="once">Once at…</option>
              </select>
            </label>
          </div>

          {form.schedule === 'interval' && (
            <label className="block">
              <span className="text-xs text-gray-400">Interval (minutes, minimum 1)</span>
              <input
                type="number"
                min={1}
                value={form.intervalMinutes}
                onChange={(e) => setForm({ ...form, intervalMinutes: Number(e.target.value) })}
                className="mt-1 w-40 bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-sm text-white"
              />
            </label>
          )}
          {(form.schedule === 'daily' || form.schedule === 'weekdays') && (
            <label className="block">
              <span className="text-xs text-gray-400">Time</span>
              <input
                type="time"
                value={form.time}
                onChange={(e) => setForm({ ...form, time: e.target.value })}
                className="mt-1 w-40 bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-sm text-white"
              />
            </label>
          )}
          {form.schedule === 'once' && (
            <label className="block">
              <span className="text-xs text-gray-400">Run at</span>
              <input
                type="datetime-local"
                value={form.onceAt}
                onChange={(e) => setForm({ ...form, onceAt: e.target.value })}
                className="mt-1 w-64 bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-sm text-white"
              />
            </label>
          )}

          <label className="block">
            <span className="text-xs text-gray-400">What should this worker do? (the goal, in plain words)</span>
            <textarea
              value={form.task}
              onChange={(e) => setForm({ ...form, task: e.target.value })}
              rows={3}
              placeholder="Check my inbox, reply to anything routine, and leave me a short summary of what needs my decision."
              className="mt-1 w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-white/25"
            />
          </label>

          <label className="block">
            <span className="text-xs text-gray-400">Steps — one per line (optional; the worker splits the task itself if blank)</span>
            <textarea
              value={form.steps}
              onChange={(e) => setForm({ ...form, steps: e.target.value })}
              rows={4}
              placeholder={'Read the last 24h of messages\nDraft replies for routine ones\nLeave a summary in the workspace'}
              className="mt-1 w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-white/25"
            />
          </label>

          <div className="flex items-center justify-between">
            <label className="flex items-center gap-2 text-xs text-gray-400 cursor-pointer">
              <input
                type="checkbox"
                checked={form.notify}
                onChange={(e) => setForm({ ...form, notify: e.target.checked })}
                className="accent-indigo-500"
              />
              Notify me when a run finishes
            </label>
            <div className="flex gap-2">
              <button onClick={() => { setShowCreate(false); setEditingId(null); setForm(EMPTY_FORM); }} className="text-xs px-3 py-2 rounded-lg text-gray-400 hover:bg-white/[0.06]">
                Cancel
              </button>
              <button
                onClick={() => void handleCreate()}
                disabled={busy === 'create' || busy === 'update'}
                className="text-sm px-4 py-2 rounded-lg bg-indigo-500 hover:bg-indigo-400 text-white font-medium disabled:opacity-50"
              >
                {busy === 'create' ? 'Creating…' : busy === 'update' ? 'Saving…' : editingId ? 'Save changes' : 'Create worker'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* List + detail */}
      <div className="grid lg:grid-cols-[minmax(280px,1fr)_minmax(340px,1.35fr)] gap-4 min-h-0 flex-1">
        <div className="flex flex-col gap-3 min-h-0 overflow-y-auto pr-1">
          {loading && !workers.length && (
            <div className="text-sm text-gray-500 py-6 text-center">Loading workers…</div>
          )}
          {!loading && !workers.length && (
            <div className="rounded-xl border border-dashed border-white/15 bg-white/[0.02] p-8 text-center">
              <div className="mb-2 flex justify-center"><AppIcon name="inf.agent" className="h-10 w-10" gradient={BRAND_GRADIENT} /></div>
              <div className="text-white font-medium">No workers yet</div>
              <p className="text-sm text-gray-500 mt-1">
                Teach it a task you already do by hand, or describe one and let it write the steps.
              </p>
              <div className="flex gap-2 justify-center mt-4">
                <button onClick={onOpenTeaching} className="text-sm px-4 py-2 rounded-lg bg-white/10 hover:bg-white/15 text-white transition-colors">
                  Teach a task
                </button>
                <button onClick={() => setShowCreate(true)} className="text-sm px-4 py-2 rounded-lg bg-indigo-500 hover:bg-indigo-400 text-white transition-colors">
                  Create worker
                </button>
              </div>
            </div>
          )}

          {workers.map((worker) => {
            const meta = STATUS_META[worker.status] ?? STATUS_META.draft;
            const active = worker.id === selectedId;
            return (
              <button
                key={worker.id}
                onClick={() => void select(worker.id)}
                className={`text-left rounded-xl border p-4 transition-colors ${
                  active ? 'border-indigo-400/50 bg-indigo-500/[0.08]' : 'border-white/[0.07] bg-white/[0.03] hover:bg-white/[0.05]'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className={`w-2 h-2 rounded-full ${meta.dot} ${worker.status === 'running' ? 'animate-pulse' : ''}`} />
                    <span className="text-sm font-medium text-white truncate">{worker.name}</span>
                  </div>
                  <span className={`text-[10px] uppercase tracking-wide border rounded px-1.5 py-0.5 ${meta.badge}`}>{meta.label}</span>
                </div>
                {worker.description && <div className="text-xs text-gray-500 mt-1 line-clamp-2">{worker.description}</div>}
                <div className="flex items-center gap-3 mt-2 text-[11px] text-gray-500">
                  <span>{worker.scheduleLabel}</span>
                  <span>·</span>
                  <span>{worker.steps.length} steps</span>
                  <span>·</span>
                  <span>Run {formatWhen(worker.lastRunAt)}</span>
                </div>
                {worker.status === 'running' && (
                  <div className="mt-2">
                    <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
                      <div className="h-full bg-emerald-400 transition-all" style={{ width: `${Math.max(3, worker.progress)}%` }} />
                    </div>
                    <div className="text-[11px] text-emerald-300/80 mt-1">
                      Step {Math.min(worker.currentStepIndex + 1, worker.steps.length)}/{worker.steps.length} · {worker.progress}%
                    </div>
                  </div>
                )}
                {(worker.status === 'needs_input') && worker.lastError && (
                  <div className="text-[11px] text-rose-300/90 mt-1.5 line-clamp-2">{worker.lastError}</div>
                )}
              </button>
            );
          })}
        </div>

        {/* Detail */}
        <div className="min-h-0 overflow-y-auto">
          {!selected ? (
            <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-8 text-center text-sm text-gray-500 h-full flex flex-col items-center justify-center">
              <div className="mb-2"><AppIcon name="inf.tasks" className="h-8 w-8" gradient={BRAND_GRADIENT} /></div>
              Select a worker to see its steps, run history, and controls.
            </div>
          ) : (
            <WorkerDetail
              worker={selected}
              history={historyFor === selected.id ? history : []}
              busy={busy}
              instruction={instruction}
              setInstruction={setInstruction}
              onRun={() => void guard('run', () => run(selected.id))}
              onPause={() => void guard('pause', () => pause(selected.id))}
              onResume={() => void guard('resume', () => resume(selected.id))}
              onStop={() => void guard('stop', () => stop(selected.id))}
              onDelete={() => void guard('delete', async () => {
                await remove(selected.id);
                addToast({ type: 'success', title: 'Worker deleted' });
              })}
              onEdit={() => openEdit(selected)}
              onOpenFolder={() => void guard('folder', async () => {
                const result = await window.api.workerOpenFolder({ workerId: selected.id }) as { ok: boolean; error?: string };
                if (!result.ok) throw new Error(result.error ?? 'Could not open the workspace folder.');
              })}
              onInterject={() => void handleInterject()}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function WorkerDetail(props: {
  worker: WorkerView;
  history: ReturnType<typeof useWorkersStore.getState>['history'];
  busy: string | null;
  instruction: string;
  setInstruction: (value: string) => void;
  onRun: () => void;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
  onDelete: () => void;
  onEdit: () => void;
  onOpenFolder: () => void;
  onInterject: () => void;
}) {
  const { worker, history, busy, instruction, setInstruction } = props;
  const meta = STATUS_META[worker.status] ?? STATUS_META.draft;
  const [openStep, setOpenStep] = useState<string | null>(null);
  const isRunning = worker.status === 'running';

  return (
    <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-5 space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="text-lg font-semibold text-white truncate">{worker.name}</h3>
            <span className={`text-[10px] uppercase tracking-wide border rounded px-1.5 py-0.5 ${meta.badge}`}>{meta.label}</span>
          </div>
          <div className="text-xs text-gray-500 mt-1">
            {worker.scheduleLabel} · next run {worker.nextRunAt ? new Date(worker.nextRunAt).toLocaleString() : '—'} · workspace {worker.workspace}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {isRunning ? (
            <button onClick={props.onStop} disabled={busy !== null} className="text-xs px-3 py-1.5 rounded-lg bg-rose-500/15 text-rose-300 border border-rose-400/30 hover:bg-rose-500/25 disabled:opacity-50">
              ■ Stop
            </button>
          ) : (
            <button onClick={props.onRun} disabled={busy !== null} className="text-xs px-3 py-1.5 rounded-lg bg-emerald-500/15 text-emerald-300 border border-emerald-400/30 hover:bg-emerald-500/25 disabled:opacity-50">
              ▶ Run now
            </button>
          )}
          {worker.status === 'paused' ? (
            <button onClick={props.onResume} disabled={busy !== null} className="text-xs px-3 py-1.5 rounded-lg bg-sky-500/15 text-sky-300 border border-sky-400/30 hover:bg-sky-500/25 disabled:opacity-50">
              Resume schedule
            </button>
          ) : (
            <button onClick={props.onPause} disabled={busy !== null || isRunning} className="text-xs px-3 py-1.5 rounded-lg bg-white/[0.06] text-gray-300 border border-white/10 hover:bg-white/10 disabled:opacity-50">
              Pause
            </button>
          )}
          <button onClick={props.onEdit} disabled={busy !== null || isRunning} title={isRunning ? 'Stop the current run first' : 'Change name, task, steps or schedule'} className="text-xs px-3 py-1.5 rounded-lg bg-white/[0.06] text-gray-300 border border-white/10 hover:bg-white/10 disabled:opacity-50">
            Edit
          </button>
          <button onClick={props.onOpenFolder} className="text-xs px-3 py-1.5 rounded-lg bg-white/[0.06] text-gray-300 border border-white/10 hover:bg-white/10">
            Open workspace
          </button>
          <button onClick={props.onDelete} disabled={busy !== null} className="text-xs px-3 py-1.5 rounded-lg text-gray-500 hover:text-rose-300 hover:bg-rose-500/10 disabled:opacity-50">
            Delete
          </button>
        </div>
      </div>

      {worker.task && <p className="text-sm text-gray-300 whitespace-pre-wrap">{worker.task}</p>}

      {/* Progress */}
      <div>
        <div className="flex items-center justify-between text-[11px] text-gray-500 mb-1">
          <span>
            {isRunning
              ? `Step ${Math.min(worker.currentStepIndex + 1, worker.steps.length)} of ${worker.steps.length}`
              : `Last run: ${worker.lastRunAt ? formatWhen(worker.lastRunAt) : 'never'}`}
          </span>
          <span>{worker.progress}%</span>
        </div>
        <div className="h-2 rounded-full bg-white/10 overflow-hidden">
          <div
            className={`h-full transition-all ${worker.status === 'needs_input' ? 'bg-rose-400' : isRunning ? 'bg-emerald-400' : 'bg-indigo-400'}`}
            style={{ width: `${Math.max(worker.status === 'needs_input' ? 4 : 2, worker.progress)}%` }}
          />
        </div>
        <div className="flex items-center gap-4 mt-2 text-[11px] text-gray-500">
          <span>Confidence {worker.confidence}%</span>
          <span>{worker.consecutiveSuccesses} clean run{worker.consecutiveSuccesses === 1 ? '' : 's'} in a row</span>
          <span>{worker.successfulRuns} ok / {worker.failedRuns} failed</span>
        </div>
      </div>

      {(worker.lastError || worker.lastResult) && (
        <div className={`rounded-lg border px-3 py-2 text-xs whitespace-pre-wrap ${
          worker.status === 'needs_input'
            ? 'border-rose-400/30 bg-rose-500/[0.07] text-rose-200'
            : 'border-emerald-400/20 bg-emerald-500/[0.06] text-emerald-100/90'
        }`}>
          {worker.status === 'needs_input' ? worker.lastError : worker.lastResult}
        </div>
      )}

      {/* Steps */}
      <div>
        <div className="text-[11px] uppercase tracking-wide text-gray-500 mb-2">Step list</div>
        <ol className="space-y-1.5">
          {worker.steps.map((step, index) => {
            const stepMeta = STEP_META[step.status] ?? STEP_META.pending;
            const open = openStep === step.id;
            return (
              <li key={step.id} className="rounded-lg border border-white/[0.06] bg-black/20">
                <button
                  onClick={() => setOpenStep(open ? null : step.id)}
                  className="w-full text-left px-3 py-2 flex items-start gap-2"
                >
                  <span className={`text-sm leading-5 ${stepMeta.className}`}>{stepMeta.icon}</span>
                  <span className="min-w-0 flex-1">
                    <span className="text-sm text-gray-200">
                      <span className="text-gray-500 mr-1">{index + 1}.</span>
                      {step.title}
                    </span>
                    <span className={`block text-[10px] uppercase tracking-wide ${stepMeta.className}`}>{stepMeta.label}</span>
                  </span>
                  {step.referenceFrame && <span className="text-[10px] text-gray-500 shrink-0">📷 demo frame</span>}
                </button>
                {open && (
                  <div className="px-3 pb-3 space-y-2">
                    <pre className="text-xs text-gray-400 whitespace-pre-wrap font-sans">{step.instruction}</pre>
                    {step.result && (
                      <pre className="text-xs text-emerald-200/80 whitespace-pre-wrap font-sans bg-black/30 rounded p-2 border border-white/[0.06]">{step.result}</pre>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      </div>

      {/* Interject */}
      <div>
        <div className="text-[11px] uppercase tracking-wide text-gray-500 mb-1.5">Add instruction</div>
        <div className="flex gap-2">
          <input
            value={instruction}
            onChange={(event) => setInstruction(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter') props.onInterject(); }}
            placeholder={isRunning ? 'Steer the pending steps of this run…' : 'Note for future runs…'}
            className="flex-1 bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-white/25"
          />
          <button onClick={props.onInterject} disabled={!instruction.trim()} className="text-xs px-3 py-2 rounded-lg bg-white/[0.07] text-gray-200 hover:bg-white/10 disabled:opacity-40">
            Send
          </button>
        </div>
        {worker.notes.length > 0 && (
          <ul className="mt-2 space-y-1">
            {worker.notes.slice(-4).map((note, index) => (
              <li key={`${index}-${note.slice(0, 12)}`} className="text-[11px] text-gray-500">• {note}</li>
            ))}
          </ul>
        )}
      </div>

      {/* History */}
      <div>
        <div className="text-[11px] uppercase tracking-wide text-gray-500 mb-2">Run history ({worker.totalRuns})</div>
        {!history.length && <div className="text-xs text-gray-600">No runs recorded yet.</div>}
        <ul className="space-y-1.5">
          {history.slice(0, 8).map((run) => (
            <li key={run.id} className="rounded-lg border border-white/[0.06] bg-black/20 px-3 py-2">
              <div className="flex items-center justify-between text-[11px]">
                <span className={
                  run.status === 'completed' ? 'text-emerald-300' :
                  run.status === 'failed' ? 'text-rose-300' :
                  run.status === 'cancelled' ? 'text-amber-300' : 'text-sky-300'
                }>
                  {run.status}
                </span>
                <span className="text-gray-500">{new Date(run.startedAt).toLocaleString()}</span>
              </div>
              {(run.result || run.error) && (
                <div className="text-[11px] text-gray-400 mt-1 line-clamp-2 whitespace-pre-wrap">{run.error ?? run.result}</div>
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
