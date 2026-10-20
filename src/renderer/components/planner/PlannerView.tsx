import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { PlannerEvent, PlannerPriority, PlannerTask } from '../../../shared/planner';
import { dayKey, endOfDay, startOfDay } from '../../../shared/planner';
import { usePlannerStore, plannerSnapshot } from '../../stores/planner';
import { StudioIcon } from '../studio/Icons';
import './planner.css';

type Tab = 'today' | 'upcoming' | 'calendar';

const PRIORITY_COLOR: Record<PlannerPriority, string> = {
  high: 'bg-rose-400',
  medium: 'bg-amber-400',
  low: 'bg-sky-400',
};

const EVENT_COLORS = ['#8b5cf6', '#22d3ee', '#34d399', '#fbbf24', '#f472b6', '#f87171'];

export function PlannerView() {
  const data = usePlannerStore((state) => state.data);
  const loading = usePlannerStore((state) => state.loading);
  const load = usePlannerStore((state) => state.load);
  const createTask = usePlannerStore((state) => state.createTask);
  const updateTask = usePlannerStore((state) => state.updateTask);
  const toggleTask = usePlannerStore((state) => state.toggleTask);
  const deleteTask = usePlannerStore((state) => state.deleteTask);
  const createEvent = usePlannerStore((state) => state.createEvent);
  const updateEvent = usePlannerStore((state) => state.updateEvent);
  const deleteEvent = usePlannerStore((state) => state.deleteEvent);
  const createReminder = usePlannerStore((state) => state.createReminder);
  const deleteReminder = usePlannerStore((state) => state.deleteReminder);
  const checkDue = usePlannerStore((state) => state.checkDue);

  const [tab, setTab] = useState<Tab>('today');
  const [composer, setComposer] = useState('');
  const [composerDue, setComposerDue] = useState('');
  const [composerPriority, setComposerPriority] = useState<PlannerPriority>('medium');
  const [editingTask, setEditingTask] = useState<PlannerTask | null>(null);
  const [eventEditor, setEventEditor] = useState<{ event?: PlannerEvent; start: number } | null>(null);
  const [monthCursor, setMonthCursor] = useState(() => {
    const date = new Date();
    return new Date(date.getFullYear(), date.getMonth(), 1).getTime();
  });
  const [selectedDay, setSelectedDay] = useState(() => startOfDay(Date.now()));
  const [showCompleted, setShowCompleted] = useState(false);
  const [reminderTitle, setReminderTitle] = useState('');
  const [reminderAt, setReminderAt] = useState(() => dateTimeInput(Date.now() + 3_600_000));
  const [showFired, setShowFired] = useState(false);
  const composerRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    void load().then(() => checkDue());
  }, [load, checkDue]);

  const now = Date.now();
  const snapshot = plannerSnapshot(data, now);
  const dayStart = startOfDay(now);
  const dayEnd = endOfDay(now);

  const open = useMemo(() => data.tasks.filter((task) => !task.done), [data.tasks]);
  const done = useMemo(
    () => data.tasks.filter((task) => task.done).sort((a, b) => (b.completedAt ?? b.updatedAt) - (a.completedAt ?? a.updatedAt)),
    [data.tasks],
  );
  const overdue = open.filter((task) => task.due !== undefined && task.due < dayStart).sort(byDue);
  const today = open.filter((task) => task.due !== undefined && task.due >= dayStart && task.due <= dayEnd).sort(byDue);
  const upcoming = open.filter((task) => task.due !== undefined && task.due > dayEnd).sort(byDue);
  const someday = open.filter((task) => task.due === undefined);
  const todayEvents = data.events
    .filter((event) => event.end >= dayStart && event.start <= dayEnd)
    .sort((a, b) => a.start - b.start);
  const pendingReminders = data.reminders.filter((reminder) => !reminder.firedAt).sort((a, b) => a.at - b.at);
  const firedReminders = data.reminders.filter((reminder) => reminder.firedAt).sort((a, b) => (b.firedAt ?? 0) - (a.firedAt ?? 0));

  const quick = useMemo(() => parseQuickAdd(composer), [composer]);
  const dueValue = composerDue || (quick.due ? dateTimeInput(quick.due) : '');

  const addTask = async () => {
    const title = quick.title.trim();
    if (!title) return;
    const due = dueValue ? new Date(dueValue).getTime() : undefined;
    await createTask({
      title,
      due: due && Number.isFinite(due) ? due : undefined,
      priority: composerPriority,
    });
    setComposer('');
    setComposerDue('');
    setComposerPriority('medium');
  };

  const addQuickReminder = async (task: PlannerTask) => {
    const at = task.due && task.due > Date.now() ? task.due : Date.now() + 60_000;
    await createReminder({ title: task.title, at, taskId: task.id });
  };

  const selectedEvents = data.events
    .filter((event) => dayKey(event.start) === dayKey(selectedDay) || (event.start < selectedDay && event.end > selectedDay))
    .sort((a, b) => a.start - b.start);
  const selectedTasks = open
    .filter((task) => task.due !== undefined && dayKey(task.due) === dayKey(selectedDay))
    .sort(byDue);

  const eventDays = useMemo(() => {
    const map = new Map<string, PlannerEvent[]>();
    for (const event of data.events) {
      const key = dayKey(event.start);
      const list = map.get(key) ?? [];
      list.push(event);
      map.set(key, list);
    }
    return map;
  }, [data.events]);

  const taskDays = useMemo(() => {
    const map = new Map<string, PlannerTask[]>();
    for (const task of open) {
      if (task.due === undefined) continue;
      const key = dayKey(task.due);
      const list = map.get(key) ?? [];
      list.push(task);
      map.set(key, list);
    }
    return map;
  }, [open]);

  const monthDate = new Date(monthCursor);
  const monthLabel = monthDate.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  const calendarDays = buildMonth(monthCursor);

  const newEventAt = (ms: number) => {
    const date = new Date(ms);
    date.setHours(9, 0, 0, 0);
    setEventEditor({ start: date.getTime() });
  };

  return (
    <div className="flex h-full min-h-0 bg-transparent text-[12px]">
      <main className="flex min-w-0 flex-1 flex-col">
        <header className="border-b border-white/[0.06] bg-[#0c0c11]/70 px-6 pb-4 pt-5 backdrop-blur-xl">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="mb-1 flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.16em] text-zinc-600">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400/80 shadow-[0_0_8px_rgba(52,211,153,0.6)]" />
                {greeting()}
              </div>
              <h1 className="text-[22px] font-semibold tracking-[-0.025em] text-zinc-100">
                {new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
              </h1>
              <p className="mt-0.5 text-[11.5px] text-zinc-500">
                {snapshot.open === 0
                  ? 'Nothing open. A clear desk is a good place to start.'
                  : `${snapshot.open} open ${snapshot.open === 1 ? 'task' : 'tasks'}${snapshot.overdue ? ` · ${snapshot.overdue} overdue` : ''}${snapshot.dueToday ? ` · ${snapshot.dueToday} due today` : ''}.`}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Stat label="Overdue" value={snapshot.overdue} tone={snapshot.overdue ? 'rose' : 'muted'} />
              <Stat label="Today" value={snapshot.dueToday} tone={snapshot.dueToday ? 'amber' : 'muted'} />
              <Stat label="Events" value={snapshot.upcomingEvents} tone="violet" />
              <Stat label="Done" value={snapshot.done} tone="emerald" />
            </div>
          </div>

          <div className="mt-4 flex items-center gap-1">
            {(['today', 'upcoming', 'calendar'] as Tab[]).map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setTab(value)}
                className={`rounded-lg px-3 py-1.5 text-[11.5px] font-medium capitalize transition-colors ${
                  tab === value ? 'bg-white/[0.09] text-zinc-100' : 'text-zinc-500 hover:bg-white/[0.04] hover:text-zinc-300'
                }`}
              >
                {value}
              </button>
            ))}
            <button
              type="button"
              onClick={() => newEventAt(tab === 'calendar' ? selectedDay : Date.now())}
              className="ml-auto flex items-center gap-1.5 rounded-lg border border-white/[0.08] bg-white/[0.035] px-2.5 py-1.5 text-[10.5px] font-medium text-zinc-300 transition-colors hover:bg-white/[0.07]"
            >
              <StudioIcon name="calendar" size={12} /> New event
            </button>
          </div>
        </header>

        {(tab === 'today' || tab === 'upcoming') && (
          <div className="border-b border-white/[0.06] bg-[#0e0e13] px-6 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-white/[0.04] text-zinc-500">
                <StudioIcon name="plus" size={15} />
              </span>
              <input
                ref={composerRef}
                value={composer}
                onChange={(event) => setComposer(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    void addTask();
                  }
                }}
                placeholder="Add a task… try “Call Sam tomorrow at 3pm”"
                className="h-8 min-w-[200px] flex-1 rounded-lg border border-white/[0.07] bg-white/[0.025] px-3 text-[12px] text-zinc-200 outline-none placeholder:text-zinc-600 focus:border-violet-400/30"
              />
              <input
                type="datetime-local"
                value={dueValue}
                onChange={(event) => setComposerDue(event.target.value)}
                className="h-8 rounded-lg border border-white/[0.07] bg-white/[0.025] px-2 text-[10.5px] text-zinc-400 outline-none focus:border-violet-400/30"
                aria-label="Due date"
              />
              <select
                value={composerPriority}
                onChange={(event) => setComposerPriority(event.target.value as PlannerPriority)}
                className="h-8 rounded-lg border border-white/[0.07] bg-[#111117] px-2 text-[10.5px] text-zinc-400 outline-none focus:border-violet-400/30"
                aria-label="Priority"
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
              <button
                type="button"
                onClick={() => void addTask()}
                disabled={!composer.trim()}
                className="h-8 rounded-lg bg-gradient-to-r from-violet-500 to-indigo-500 px-3.5 text-[11px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
              >
                Add task
              </button>
            </div>
            {quick.due && (
              <div className="mt-1.5 pl-10 text-[10px] text-violet-300/80">
                Due {new Date(quick.due).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
              </div>
            )}
          </div>
        )}

        <div className="planner-scroll min-h-0 flex-1 overflow-y-auto px-6 py-5">
          {loading && <div className="py-10 text-center text-[11px] text-zinc-600">Opening your day…</div>}

          {!loading && tab === 'today' && (
            <div className="mx-auto max-w-[760px] space-y-7">
              {overdue.length > 0 && (
                <Section title="Overdue" count={overdue.length} tone="rose">
                  {overdue.map((task) => (
                    <TaskRow
                      key={task.id}
                      task={task}
                      onToggle={() => void toggleTask(task.id)}
                      onEdit={() => setEditingTask(task)}
                      onDelete={() => void deleteTask(task.id)}
                      onRemind={() => void addQuickReminder(task)}
                    />
                  ))}
                </Section>
              )}

              <Section title="Today" count={today.length + todayEvents.length}>
                {todayEvents.map((event) => (
                  <EventRow key={event.id} event={event} onClick={() => setEventEditor({ event, start: event.start })} />
                ))}
                {today.map((task) => (
                  <TaskRow
                    key={task.id}
                    task={task}
                    onToggle={() => void toggleTask(task.id)}
                    onEdit={() => setEditingTask(task)}
                    onDelete={() => void deleteTask(task.id)}
                    onRemind={() => void addQuickReminder(task)}
                  />
                ))}
                {today.length === 0 && todayEvents.length === 0 && (
                  <EmptyRow text="Today is clear. Add something above, or leave it open on purpose." />
                )}
              </Section>

              {upcoming.length > 0 && (
                <Section title="Next up" count={upcoming.length}>
                  {upcoming.slice(0, 4).map((task) => (
                    <TaskRow
                      key={task.id}
                      task={task}
                      onToggle={() => void toggleTask(task.id)}
                      onEdit={() => setEditingTask(task)}
                      onDelete={() => void deleteTask(task.id)}
                      onRemind={() => void addQuickReminder(task)}
                    />
                  ))}
                  {upcoming.length > 4 && (
                    <button type="button" onClick={() => setTab('upcoming')} className="mt-2 text-[10.5px] text-violet-300/80 hover:text-violet-200">
                      View all {upcoming.length} upcoming →
                    </button>
                  )}
                </Section>
              )}

              {someday.length > 0 && (
                <Section title="Someday" count={someday.length}>
                  {someday.slice(0, 5).map((task) => (
                    <TaskRow
                      key={task.id}
                      task={task}
                      onToggle={() => void toggleTask(task.id)}
                      onEdit={() => setEditingTask(task)}
                      onDelete={() => void deleteTask(task.id)}
                      onRemind={() => void addQuickReminder(task)}
                    />
                  ))}
                </Section>
              )}

              <CompletedSection tasks={done} show={showCompleted} onToggle={() => setShowCompleted((value) => !value)} onRestore={(task) => void toggleTask(task.id)} onDelete={(task) => void deleteTask(task.id)} />
            </div>
          )}

          {!loading && tab === 'upcoming' && (
            <div className="mx-auto max-w-[760px] space-y-7">
              <Section title="Upcoming" count={upcoming.length}>
                {upcoming.map((task) => (
                  <TaskRow
                    key={task.id}
                    task={task}
                    onToggle={() => void toggleTask(task.id)}
                    onEdit={() => setEditingTask(task)}
                    onDelete={() => void deleteTask(task.id)}
                    onRemind={() => void addQuickReminder(task)}
                  />
                ))}
                {upcoming.length === 0 && <EmptyRow text="No dated tasks ahead. Add a deadline to something that matters." />}
              </Section>
              {someday.length > 0 && (
                <Section title="Someday" count={someday.length}>
                  {someday.map((task) => (
                    <TaskRow
                      key={task.id}
                      task={task}
                      onToggle={() => void toggleTask(task.id)}
                      onEdit={() => setEditingTask(task)}
                      onDelete={() => void deleteTask(task.id)}
                      onRemind={() => void addQuickReminder(task)}
                    />
                  ))}
                </Section>
              )}
              {overdue.length > 0 && (
                <Section title="Overdue" count={overdue.length} tone="rose">
                  {overdue.map((task) => (
                    <TaskRow
                      key={task.id}
                      task={task}
                      onToggle={() => void toggleTask(task.id)}
                      onEdit={() => setEditingTask(task)}
                      onDelete={() => void deleteTask(task.id)}
                      onRemind={() => void addQuickReminder(task)}
                    />
                  ))}
                </Section>
              )}
              <CompletedSection tasks={done} show={showCompleted} onToggle={() => setShowCompleted((value) => !value)} onRestore={(task) => void toggleTask(task.id)} onDelete={(task) => void deleteTask(task.id)} />
            </div>
          )}

          {!loading && tab === 'calendar' && (
            <div className="mx-auto max-w-[920px]">
              <div className="rounded-2xl border border-white/[0.07] bg-white/[0.018]">
                <div className="flex items-center gap-2 border-b border-white/[0.06] px-4 py-3">
                  <h2 className="text-[14px] font-semibold tracking-[-0.01em] text-zinc-100">{monthLabel}</h2>
                  <div className="ml-2 flex items-center gap-0.5">
                    <button
                      type="button"
                      onClick={() => setMonthCursor(new Date(monthDate.getFullYear(), monthDate.getMonth() - 1, 1).getTime())}
                      className="grid h-6 w-6 place-items-center rounded-md text-zinc-500 hover:bg-white/[0.06] hover:text-zinc-200"
                      aria-label="Previous month"
                    >
                      <StudioIcon name="chevron-left" size={14} />
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const date = new Date();
                        setMonthCursor(new Date(date.getFullYear(), date.getMonth(), 1).getTime());
                        setSelectedDay(startOfDay(Date.now()));
                      }}
                      className="rounded-md px-2 py-1 text-[10.5px] text-zinc-500 hover:bg-white/[0.06] hover:text-zinc-200"
                    >
                      Today
                    </button>
                    <button
                      type="button"
                      onClick={() => setMonthCursor(new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 1).getTime())}
                      className="grid h-6 w-6 place-items-center rounded-md text-zinc-500 hover:bg-white/[0.06] hover:text-zinc-200"
                      aria-label="Next month"
                    >
                      <StudioIcon name="chevron-right" size={14} />
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => newEventAt(selectedDay)}
                    className="ml-auto flex items-center gap-1.5 rounded-lg bg-white/[0.05] px-2.5 py-1.5 text-[10.5px] text-zinc-300 hover:bg-white/[0.09]"
                  >
                    <StudioIcon name="plus" size={12} /> Event on {new Date(selectedDay).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                  </button>
                </div>
                <div className="grid grid-cols-7 border-b border-white/[0.06]">
                  {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((label) => (
                    <div key={label} className="px-2 py-1.5 text-center text-[9.5px] font-semibold uppercase tracking-[0.12em] text-zinc-600">
                      {label}
                    </div>
                  ))}
                </div>
                <div className="grid grid-cols-7">
                  {calendarDays.map((cell) => {
                    const events = eventDays.get(dayKey(cell.ms)) ?? [];
                    const tasks = taskDays.get(dayKey(cell.ms)) ?? [];
                    const isSelected = dayKey(cell.ms) === dayKey(selectedDay);
                    const isToday = dayKey(cell.ms) === dayKey(Date.now());
                    return (
                      <button
                        key={cell.ms}
                        type="button"
                        onClick={() => setSelectedDay(cell.ms)}
                        onDoubleClick={() => newEventAt(cell.ms)}
                        className={`min-h-[92px] border-b border-r border-white/[0.045] p-1.5 text-left align-top transition-colors ${
                          cell.inMonth ? 'hover:bg-white/[0.025]' : 'opacity-40'
                        } ${isSelected ? 'bg-violet-500/[0.07]' : ''}`}
                      >
                        <span
                          className={`mb-1 grid h-5 w-5 place-items-center rounded-full text-[10px] tabular-nums ${
                            isToday ? 'bg-violet-500 font-semibold text-white' : 'text-zinc-400'
                          }`}
                        >
                          {new Date(cell.ms).getDate()}
                        </span>
                        <div className="space-y-0.5">
                          {events.slice(0, 2).map((event) => (
                            <div key={event.id} className="flex items-center gap-1 truncate rounded px-1 py-0.5 text-[9px] text-zinc-300" style={{ background: `${event.color ?? '#8b5cf6'}1f` }}>
                              <span className="h-1 w-1 shrink-0 rounded-full" style={{ background: event.color ?? '#8b5cf6' }} />
                              <span className="truncate">{event.title}</span>
                            </div>
                          ))}
                          {tasks.slice(0, events.length > 1 ? 1 : 2).map((task) => (
                            <div key={task.id} className="flex items-center gap-1 truncate px-1 text-[9px] text-zinc-500">
                              <span className={`h-1 w-1 shrink-0 rounded-full ${PRIORITY_COLOR[task.priority]}`} />
                              <span className="truncate">{task.title}</span>
                            </div>
                          ))}
                          {events.length + tasks.length > 3 && (
                            <div className="px-1 text-[8.5px] text-zinc-600">+{events.length + tasks.length - 3} more</div>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="mt-4 rounded-2xl border border-white/[0.07] bg-white/[0.018]">
                <div className="flex items-center gap-2 border-b border-white/[0.06] px-4 py-2.5">
                  <span className="text-[11.5px] font-medium text-zinc-200">
                    {new Date(selectedDay).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
                  </span>
                  <div className="ml-auto flex gap-1.5">
                    <button type="button" onClick={() => newEventAt(selectedDay)} className="rounded-md px-2 py-1 text-[10px] text-zinc-400 hover:bg-white/[0.06] hover:text-zinc-100">
                      + Event
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setComposer('');
                        setComposerDue(`${dayKey(selectedDay)}T09:00`);
                        setTab('today');
                        setTimeout(() => composerRef.current?.focus(), 0);
                      }}
                      className="rounded-md px-2 py-1 text-[10px] text-zinc-400 hover:bg-white/[0.06] hover:text-zinc-100"
                    >
                      + Task
                    </button>
                  </div>
                </div>
                <div className="p-2">
                  {selectedEvents.map((event) => (
                    <EventRow key={event.id} event={event} onClick={() => setEventEditor({ event, start: event.start })} />
                  ))}
                  {selectedTasks.map((task) => (
                    <TaskRow
                      key={task.id}
                      task={task}
                      onToggle={() => void toggleTask(task.id)}
                      onEdit={() => setEditingTask(task)}
                      onDelete={() => void deleteTask(task.id)}
                      onRemind={() => void addQuickReminder(task)}
                    />
                  ))}
                  {selectedEvents.length === 0 && selectedTasks.length === 0 && <EmptyRow text="Nothing on this day yet." />}
                </div>
              </div>
            </div>
          )}
        </div>
      </main>

      <aside className="hidden w-[296px] shrink-0 flex-col border-l border-white/[0.06] bg-[#0b0b10]/80 backdrop-blur-xl lg:flex">
        <div className="border-b border-white/[0.06] px-4 py-3">
          <div className="flex items-center gap-2">
            <StudioIcon name="bell" size={13} className="text-violet-300" />
            <span className="text-[11.5px] font-semibold text-zinc-200">Reminders</span>
            <span className="ml-auto rounded-full bg-white/[0.05] px-1.5 py-0.5 text-[9px] text-zinc-500">{pendingReminders.length}</span>
          </div>
        </div>

        <div className="border-b border-white/[0.06] p-3">
          <input
            value={reminderTitle}
            onChange={(event) => setReminderTitle(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                if (reminderTitle.trim()) {
                  void createReminder({ title: reminderTitle.trim(), at: new Date(reminderAt).getTime() });
                  setReminderTitle('');
                }
              }
            }}
            placeholder="Remind me to…"
            className="mb-2 h-8 w-full rounded-lg border border-white/[0.07] bg-white/[0.025] px-2.5 text-[11.5px] text-zinc-200 outline-none placeholder:text-zinc-600 focus:border-violet-400/30"
          />
          <div className="flex items-center gap-1.5">
            <input
              type="datetime-local"
              value={reminderAt}
              onChange={(event) => setReminderAt(event.target.value)}
              className="h-7 min-w-0 flex-1 rounded-md border border-white/[0.07] bg-white/[0.025] px-1.5 text-[10px] text-zinc-400 outline-none"
              aria-label="Reminder time"
            />
            <button
              type="button"
              onClick={() => {
                if (!reminderTitle.trim()) return;
                void createReminder({ title: reminderTitle.trim(), at: new Date(reminderAt).getTime() });
                setReminderTitle('');
              }}
              disabled={!reminderTitle.trim()}
              className="h-7 rounded-md bg-violet-500/20 px-2.5 text-[10px] font-medium text-violet-200 transition-colors hover:bg-violet-500/30 disabled:opacity-40"
            >
              Set
            </button>
          </div>
        </div>

        <div className="planner-scroll min-h-0 flex-1 overflow-y-auto p-2">
          {pendingReminders.length === 0 && (
            <div className="px-3 py-8 text-center text-[10.5px] leading-relaxed text-zinc-600">
              No reminders waiting. They fire as a desktop notification and a toast, even while you work elsewhere.
            </div>
          )}
          {pendingReminders.map((reminder) => (
            <div key={reminder.id} className="group flex items-start gap-2 rounded-lg px-2 py-2 transition-colors hover:bg-white/[0.03]">
              <span className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${reminder.at < now ? 'bg-rose-400' : 'bg-violet-400/80'}`} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[11px] text-zinc-300">{reminder.title}</div>
                <div className={`text-[9.5px] ${reminder.at < now ? 'text-rose-400/80' : 'text-zinc-600'}`}>{formatReminderTime(reminder.at)}</div>
              </div>
              <button
                type="button"
                onClick={() => void deleteReminder(reminder.id)}
                className="mt-0.5 text-zinc-700 opacity-0 transition-opacity hover:text-rose-300 group-hover:opacity-100"
                aria-label="Delete reminder"
              >
                <StudioIcon name="x" size={12} />
              </button>
            </div>
          ))}

          {firedReminders.length > 0 && (
            <div className="mt-2 border-t border-white/[0.05] pt-2">
              <button
                type="button"
                onClick={() => setShowFired((value) => !value)}
                className="w-full px-2 py-1 text-left text-[9.5px] uppercase tracking-[0.12em] text-zinc-600 hover:text-zinc-400"
              >
                {showFired ? 'Hide' : 'Show'} fired ({firedReminders.length})
              </button>
              {showFired && firedReminders.slice(0, 12).map((reminder) => (
                <div key={reminder.id} className="flex items-center gap-2 px-2 py-1.5 opacity-50">
                  <StudioIcon name="check" size={10} className="text-zinc-600" />
                  <span className="min-w-0 flex-1 truncate text-[10px] text-zinc-500 line-through">{reminder.title}</span>
                  <button type="button" onClick={() => void deleteReminder(reminder.id)} className="text-zinc-700 hover:text-rose-300" aria-label="Delete reminder">
                    <StudioIcon name="x" size={10} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="border-t border-white/[0.06] px-4 py-3">
          <div className="mb-2 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.13em] text-zinc-600">
            <StudioIcon name="clock" size={11} /> Next up
          </div>
          <NextUp
            tasks={upcoming}
            events={data.events.filter((event) => event.start >= now).sort((a, b) => a.start - b.start)}
            onEventClick={(event) => setEventEditor({ event, start: event.start })}
          />
        </div>
      </aside>

      {editingTask && (
        <TaskModal
          task={editingTask}
          onClose={() => setEditingTask(null)}
          onSave={(patch) => {
            void updateTask(editingTask.id, patch);
            setEditingTask(null);
          }}
          onDelete={() => {
            void deleteTask(editingTask.id);
            setEditingTask(null);
          }}
        />
      )}

      {eventEditor && (
        <EventModal
          event={eventEditor.event}
          start={eventEditor.start}
          onClose={() => setEventEditor(null)}
          onSave={async (input) => {
            if (eventEditor.event) await updateEvent(eventEditor.event.id, input);
            else await createEvent(input);
            setEventEditor(null);
          }}
          onDelete={
            eventEditor.event
              ? async () => {
                  await deleteEvent(eventEditor.event!.id);
                  setEventEditor(null);
                }
              : undefined
          }
        />
      )}
    </div>
  );
}

function Section({
  title,
  count,
  tone,
  children,
}: {
  title: string;
  count: number;
  tone?: 'rose';
  children: ReactNode;
}) {
  return (
    <section>
      <div className="mb-2 flex items-baseline gap-2">
        <h2 className={`text-[11px] font-semibold uppercase tracking-[0.14em] ${tone === 'rose' ? 'text-rose-300/90' : 'text-zinc-500'}`}>
          {title}
        </h2>
        <span className="text-[9.5px] tabular-nums text-zinc-700">{count}</span>
      </div>
      <div className="overflow-hidden rounded-xl border border-white/[0.06] bg-white/[0.015]">{children}</div>
    </section>
  );
}

function TaskRow({
  task,
  onToggle,
  onEdit,
  onDelete,
  onRemind,
}: {
  task: PlannerTask;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onRemind: () => void;
}) {
  const due = task.due;
  const overdue = due !== undefined && due < startOfDay(Date.now()) && !task.done;
  const isToday = due !== undefined && dayKey(due) === dayKey(Date.now());
  return (
    <div className="group flex items-center gap-2.5 border-b border-white/[0.045] px-3 py-2.5 last:border-0 hover:bg-white/[0.02]">
      <button
        type="button"
        onClick={onToggle}
        aria-label={task.done ? 'Mark not done' : 'Mark done'}
        className={`grid h-[17px] w-[17px] shrink-0 place-items-center rounded-full border transition-all ${
          task.done
            ? 'border-emerald-400/60 bg-emerald-400/15 text-emerald-300'
            : 'border-white/[0.18] text-transparent hover:border-violet-400/60 hover:bg-violet-500/10'
        }`}
      >
        <StudioIcon name="check" size={10} strokeWidth={2.4} />
      </button>
      <button type="button" onClick={onEdit} className="min-w-0 flex-1 text-left">
        <div className={`truncate text-[12px] ${task.done ? 'text-zinc-600 line-through' : 'text-zinc-200'}`}>{task.title}</div>
        <div className="mt-0.5 flex items-center gap-2 text-[9.5px]">
          <span className={`h-1 w-1 rounded-full ${PRIORITY_COLOR[task.priority]}`} />
          {due !== undefined ? (
            <span className={overdue ? 'text-rose-400/90' : isToday ? 'text-amber-300/80' : 'text-zinc-600'}>
              {formatDue(due)}
            </span>
          ) : (
            <span className="text-zinc-700">Someday</span>
          )}
          {task.list && <span className="truncate rounded bg-white/[0.04] px-1 text-[8.5px] text-zinc-500">{task.list}</span>}
          {task.tags.slice(0, 2).map((tag) => (
            <span key={tag} className="truncate text-zinc-700">#{tag}</span>
          ))}
          {task.notes && <span className="truncate text-zinc-700">· {task.notes}</span>}
        </div>
      </button>
      <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
        <button type="button" onClick={onRemind} title="Set reminder for this task" className="grid h-6 w-6 place-items-center rounded-md text-zinc-600 hover:bg-white/[0.06] hover:text-amber-300">
          <StudioIcon name="bell" size={12} />
        </button>
        <button type="button" onClick={onDelete} title="Delete task" className="grid h-6 w-6 place-items-center rounded-md text-zinc-600 hover:bg-rose-500/10 hover:text-rose-300">
          <StudioIcon name="trash" size={12} />
        </button>
      </div>
    </div>
  );
}

function EventRow({ event, onClick }: { event: PlannerEvent; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-2.5 border-b border-white/[0.045] px-3 py-2.5 text-left last:border-0 hover:bg-white/[0.02]"
    >
      <span className="h-7 w-1 shrink-0 rounded-full" style={{ background: event.color ?? '#8b5cf6' }} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[12px] text-zinc-200">{event.title}</span>
        <span className="mt-0.5 block text-[9.5px] text-zinc-600">
          {event.allDay ? 'All day' : `${formatTime(event.start)}–${formatTime(event.end)}`}
          {event.location ? ` · ${event.location}` : ''}
        </span>
      </span>
      <StudioIcon name="chevron-right" size={13} className="text-zinc-700" />
    </button>
  );
}

function CompletedSection({
  tasks,
  show,
  onToggle,
  onRestore,
  onDelete,
}: {
  tasks: PlannerTask[];
  show: boolean;
  onToggle: () => void;
  onRestore: (task: PlannerTask) => void;
  onDelete: (task: PlannerTask) => void;
}) {
  if (!tasks.length) return null;
  return (
    <section>
      <button type="button" onClick={onToggle} className="mb-2 flex w-full items-baseline gap-2 text-left">
        <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-600">Completed</span>
        <span className="text-[9.5px] tabular-nums text-zinc-700">{tasks.length}</span>
        <StudioIcon name={show ? 'chevron-up' : 'chevron-down'} size={11} className="ml-auto text-zinc-600" />
      </button>
      {show && (
        <div className="overflow-hidden rounded-xl border border-white/[0.06] bg-white/[0.01]">
          {tasks.map((task) => (
            <div key={task.id} className="group flex items-center gap-2.5 border-b border-white/[0.04] px-3 py-2 last:border-0">
              <button type="button" onClick={() => onRestore(task)} className="grid h-[17px] w-[17px] place-items-center rounded-full border border-emerald-400/50 bg-emerald-400/10 text-emerald-300" aria-label="Restore task">
                <StudioIcon name="check" size={10} strokeWidth={2.4} />
              </button>
              <span className="min-w-0 flex-1 truncate text-[11.5px] text-zinc-600 line-through">{task.title}</span>
              <button type="button" onClick={() => onDelete(task)} className="text-zinc-700 opacity-0 hover:text-rose-300 group-hover:opacity-100" aria-label="Delete task">
                <StudioIcon name="trash" size={11} />
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function EmptyRow({ text }: { text: string }) {
  return <div className="px-3 py-5 text-center text-[10.5px] leading-relaxed text-zinc-600">{text}</div>;
}

function Stat({ label, value, tone }: { label: string; value: number; tone: 'rose' | 'amber' | 'violet' | 'emerald' | 'muted' }) {
  const toneClass = {
    rose: 'text-rose-300',
    amber: 'text-amber-300',
    violet: 'text-violet-300',
    emerald: 'text-emerald-300',
    muted: 'text-zinc-300',
  }[tone];
  return (
    <div className="min-w-[64px] rounded-xl border border-white/[0.06] bg-white/[0.022] px-2.5 py-1.5">
      <div className={`text-[15px] font-semibold tabular-nums leading-none ${toneClass}`}>{value}</div>
      <div className="mt-1 text-[8.5px] uppercase tracking-[0.12em] text-zinc-600">{label}</div>
    </div>
  );
}

function NextUp({
  tasks,
  events,
  onEventClick,
}: {
  tasks: PlannerTask[];
  events: PlannerEvent[];
  onEventClick: (event: PlannerEvent) => void;
}) {
  const nextTask = tasks[0];
  const nextEvent = events[0];
  if (!nextTask && !nextEvent) {
    return <div className="text-[10.5px] leading-relaxed text-zinc-600">Nothing scheduled. Rest is part of the plan.</div>;
  }
  return (
    <div className="space-y-2">
      {nextEvent && (
        <button
          type="button"
          onClick={() => onEventClick(nextEvent)}
          className="flex w-full items-center gap-2 rounded-lg border border-white/[0.05] bg-white/[0.02] px-2.5 py-2 text-left"
        >
          <span className="h-6 w-0.5 rounded-full" style={{ background: nextEvent.color ?? '#8b5cf6' }} />
          <span className="min-w-0">
            <span className="block truncate text-[10.5px] text-zinc-300">{nextEvent.title}</span>
            <span className="block text-[9px] text-zinc-600">{formatDue(nextEvent.start)} · {formatTime(nextEvent.start)}</span>
          </span>
        </button>
      )}
      {nextTask && (
        <div className="flex items-center gap-2 rounded-lg border border-white/[0.05] bg-white/[0.02] px-2.5 py-2">
          <span className={`h-1.5 w-1.5 rounded-full ${PRIORITY_COLOR[nextTask.priority]}`} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[10.5px] text-zinc-300">{nextTask.title}</span>
            <span className="block text-[9px] text-zinc-600">{nextTask.due ? formatDue(nextTask.due) : 'Someday'}</span>
          </span>
        </div>
      )}
    </div>
  );
}

function TaskModal({
  task,
  onClose,
  onSave,
  onDelete,
}: {
  task: PlannerTask;
  onClose: () => void;
  onSave: (patch: { title: string; notes: string; due: number | null; priority: PlannerPriority; list?: string; tags: string[] }) => void;
  onDelete: () => void;
}) {
  const [title, setTitle] = useState(task.title);
  const [notes, setNotes] = useState(task.notes);
  const [due, setDue] = useState(task.due ? dateTimeInput(task.due) : '');
  const [priority, setPriority] = useState(task.priority);
  const [list, setList] = useState(task.list ?? '');
  const [tags, setTags] = useState(task.tags.join(', '));

  return (
    <Modal onClose={onClose} width={480}>
      <div className="mb-4 flex items-center gap-2">
        <span className="grid h-7 w-7 place-items-center rounded-lg bg-violet-500/15 text-violet-300">
          <StudioIcon name="file" size={14} />
        </span>
        <h2 className="text-[14px] font-semibold text-zinc-100">Edit task</h2>
        <button type="button" onClick={onClose} className="ml-auto grid h-6 w-6 place-items-center rounded-md text-zinc-500 hover:bg-white/[0.06] hover:text-zinc-200" aria-label="Close">
          <StudioIcon name="x" size={14} />
        </button>
      </div>
      <div className="space-y-3">
        <Field label="Title">
          <input
            autoFocus
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && title.trim()) {
                onSave({ title: title.trim(), notes, due: due ? new Date(due).getTime() : null, priority, list: list.trim() || undefined, tags: splitTags(tags) });
              }
            }}
            className="modal-input"
          />
        </Field>
        <Field label="Notes">
          <textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={3} className="modal-input resize-y" placeholder="Context, links, the reason this matters…" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Due">
            <input type="datetime-local" value={due} onChange={(event) => setDue(event.target.value)} className="modal-input" />
          </Field>
          <Field label="Priority">
            <select value={priority} onChange={(event) => setPriority(event.target.value as PlannerPriority)} className="modal-input bg-[#111117]">
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="List / project">
            <input value={list} onChange={(event) => setList(event.target.value)} className="modal-input" placeholder="Personal, Work…" />
          </Field>
          <Field label="Tags">
            <input value={tags} onChange={(event) => setTags(event.target.value)} className="modal-input" placeholder="comma, separated" />
          </Field>
        </div>
      </div>
      <div className="mt-5 flex items-center">
        <button type="button" onClick={onDelete} className="rounded-lg px-2.5 py-1.5 text-[11px] text-rose-300/80 transition-colors hover:bg-rose-500/10 hover:text-rose-200">
          Delete task
        </button>
        <div className="ml-auto flex gap-2">
          <button type="button" onClick={onClose} className="rounded-lg px-3 py-1.5 text-[11.5px] text-zinc-400 hover:bg-white/[0.06] hover:text-zinc-200">
            Cancel
          </button>
          <button
            type="button"
            disabled={!title.trim()}
            onClick={() => onSave({ title: title.trim(), notes, due: due ? new Date(due).getTime() : null, priority, list: list.trim() || undefined, tags: splitTags(tags) })}
            className="rounded-lg bg-gradient-to-r from-violet-500 to-indigo-500 px-3.5 py-1.5 text-[11.5px] font-semibold text-white disabled:opacity-40"
          >
            Save task
          </button>
        </div>
      </div>
    </Modal>
  );
}

function EventModal({
  event,
  start,
  onClose,
  onSave,
  onDelete,
}: {
  event?: PlannerEvent;
  start: number;
  onClose: () => void;
  onSave: (input: { title: string; start: number; end: number; allDay: boolean; location?: string; notes?: string; color?: string }) => Promise<void>;
  onDelete?: () => Promise<void>;
}) {
  const startDate = new Date(event?.start ?? start);
  const endDate = new Date(event?.end ?? start + 3_600_000);
  const [title, setTitle] = useState(event?.title ?? '');
  const [startValue, setStartValue] = useState(dateTimeInput(startDate.getTime()));
  const [endValue, setEndValue] = useState(dateTimeInput(endDate.getTime()));
  const [allDay, setAllDay] = useState(event?.allDay ?? false);
  const [location, setLocation] = useState(event?.location ?? '');
  const [notes, setNotes] = useState(event?.notes ?? '');
  const [color, setColor] = useState(event?.color ?? EVENT_COLORS[0]);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!title.trim() || saving) return;
    setSaving(true);
    const startMs = new Date(startValue).getTime();
    let endMs = new Date(endValue).getTime();
    if (!Number.isFinite(startMs)) return setSaving(false);
    if (!Number.isFinite(endMs) || endMs <= startMs) endMs = startMs + 3_600_000;
    await onSave({
      title: title.trim(),
      start: allDay ? startOfDay(startMs) : startMs,
      end: allDay ? endOfDay(startMs) : endMs,
      allDay,
      location: location.trim() || undefined,
      notes: notes.trim() || undefined,
      color,
    });
    setSaving(false);
  };

  return (
    <Modal onClose={onClose} width={500}>
      <div className="mb-4 flex items-center gap-2">
        <span className="grid h-7 w-7 place-items-center rounded-lg bg-cyan-500/15 text-cyan-300">
          <StudioIcon name="calendar" size={14} />
        </span>
        <h2 className="text-[14px] font-semibold text-zinc-100">{event ? 'Edit event' : 'New event'}</h2>
        <button type="button" onClick={onClose} className="ml-auto grid h-6 w-6 place-items-center rounded-md text-zinc-500 hover:bg-white/[0.06] hover:text-zinc-200" aria-label="Close">
          <StudioIcon name="x" size={14} />
        </button>
      </div>
      <div className="space-y-3">
        <Field label="Title">
          <input autoFocus value={title} onChange={(event) => setTitle(event.target.value)} onKeyDown={(input) => { if (input.key === 'Enter') void save(); }} className="modal-input" placeholder="Design review" />
        </Field>
        <label className="flex items-center gap-2 text-[11px] text-zinc-400">
          <input type="checkbox" checked={allDay} onChange={(input) => setAllDay(input.target.checked)} className="accent-violet-500" />
          All day
        </label>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Starts">
            <input type={allDay ? 'date' : 'datetime-local'} value={allDay ? startValue.slice(0, 10) : startValue} onChange={(input) => setStartValue(allDay ? `${input.target.value}T09:00` : input.target.value)} className="modal-input" />
          </Field>
          <Field label="Ends">
            <input type={allDay ? 'date' : 'datetime-local'} value={allDay ? endValue.slice(0, 10) : endValue} onChange={(input) => setEndValue(allDay ? `${input.target.value}T10:00` : input.target.value)} className="modal-input" />
          </Field>
        </div>
        <Field label="Location">
          <input value={location} onChange={(input) => setLocation(input.target.value)} className="modal-input" placeholder="Office, Zoom, address…" />
        </Field>
        <Field label="Notes">
          <textarea value={notes} onChange={(input) => setNotes(input.target.value)} rows={2} className="modal-input resize-y" />
        </Field>
        <Field label="Color">
          <div className="flex gap-2 pt-1">
            {EVENT_COLORS.map((swatch) => (
              <button
                key={swatch}
                type="button"
                onClick={() => setColor(swatch)}
                className={`h-5 w-5 rounded-full transition-transform ${color === swatch ? 'scale-110 ring-2 ring-white/60 ring-offset-2 ring-offset-[#14141b]' : 'hover:scale-110'}`}
                style={{ background: swatch }}
                aria-label={`Use color ${swatch}`}
              />
            ))}
          </div>
        </Field>
      </div>
      <div className="mt-5 flex items-center">
        {onDelete && (
          <button type="button" onClick={() => void onDelete()} className="rounded-lg px-2.5 py-1.5 text-[11px] text-rose-300/80 hover:bg-rose-500/10 hover:text-rose-200">
            Delete event
          </button>
        )}
        <div className="ml-auto flex gap-2">
          <button type="button" onClick={onClose} className="rounded-lg px-3 py-1.5 text-[11.5px] text-zinc-400 hover:bg-white/[0.06] hover:text-zinc-200">
            Cancel
          </button>
          <button type="button" disabled={!title.trim() || saving} onClick={() => void save()} className="rounded-lg bg-gradient-to-r from-violet-500 to-indigo-500 px-3.5 py-1.5 text-[11.5px] font-semibold text-white disabled:opacity-40">
            {saving ? 'Saving…' : event ? 'Save event' : 'Add event'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function Modal({ children, onClose, width }: { children: ReactNode; onClose: () => void; width: number }) {
  return (
    <div className="fixed inset-0 z-[70] grid place-items-center bg-black/60 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="max-h-[90vh] overflow-y-auto rounded-2xl border border-white/[0.08] bg-[#14141b] p-5 shadow-2xl" style={{ width }} onClick={(event) => event.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[9.5px] font-semibold uppercase tracking-[0.12em] text-zinc-600">{label}</span>
      {children}
    </label>
  );
}

function splitTags(value: string): string[] {
  return value.split(',').map((tag) => tag.trim()).filter(Boolean).slice(0, 20);
}

function byDue(a: PlannerTask, b: PlannerTask): number {
  return (a.due ?? Number.MAX_SAFE_INTEGER) - (b.due ?? Number.MAX_SAFE_INTEGER);
}

function dateTimeInput(ms: number): string {
  const date = new Date(ms);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatTime(ms: number): string {
  return new Date(ms).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

function formatDue(ms: number): string {
  const date = new Date(ms);
  const today = startOfDay(Date.now());
  const dueDay = startOfDay(ms);
  const time = date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  if (dueDay === today) return `Today, ${time}`;
  if (dueDay === today + 86_400_000) return `Tomorrow, ${time}`;
  if (dueDay === today - 86_400_000) return `Yesterday, ${time}`;
  if (ms < today) return `Overdue · ${date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
  return date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }) + `, ${time}`;
}

function formatReminderTime(ms: number): string {
  const date = new Date(ms);
  return date.toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 5) return 'Late night';
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

function buildMonth(cursor: number): Array<{ ms: number; inMonth: boolean }> {
  const date = new Date(cursor);
  const year = date.getFullYear();
  const month = date.getMonth();
  const first = new Date(year, month, 1);
  const offset = (first.getDay() + 6) % 7; // Monday-first week
  const start = new Date(year, month, 1 - offset);
  return Array.from({ length: 42 }, (_value, index) => {
    const cell = new Date(start.getFullYear(), start.getMonth(), start.getDate() + index, 12);
    return { ms: cell.getTime(), inMonth: cell.getMonth() === month };
  });
}

/**
 * Tiny natural-language date parser for the quick-add box. It intentionally
 * handles only unambiguous phrases ("today", "tomorrow", a weekday, a time);
 * everything else stays in the title so nothing is scheduled by accident.
 */
export function parseQuickAdd(text: string): { title: string; due?: number } {
  let working = text;
  let day: Date | null = null;
  const now = new Date();

  if (/\btomorrow\b/i.test(working)) {
    day = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    working = working.replace(/\btomorrow\b/i, ' ');
  } else if (/\btoday\b/i.test(working)) {
    day = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    working = working.replace(/\btoday\b/i, ' ');
  } else {
    const weekday = /\b(next\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i.exec(working);
    if (weekday) {
      const target = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'].indexOf(weekday[2].toLowerCase());
      let delta = (target - now.getDay() + 7) % 7;
      if (delta === 0 || /^next/i.test(weekday[1] ?? '')) delta += 7;
      day = new Date(now.getFullYear(), now.getMonth(), now.getDate() + delta);
      working = working.replace(weekday[0], ' ');
    }
  }

  let hour: number | null = null;
  let minute = 0;
  const time = /\b(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i.exec(working);
  if (time) {
    hour = Number(time[1]);
    minute = time[2] ? Number(time[2]) : 0;
    if (hour === 12) hour = 0;
    if (time[3].toLowerCase() === 'pm') hour += 12;
    if (hour > 23 || minute > 59) {
      hour = null;
      minute = 0;
    } else {
      working = working.replace(time[0], ' ');
    }
  }

  if (!day && hour === null) return { title: text };
  if (!day) {
    day = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if (hour !== null && new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour, minute).getTime() <= Date.now()) {
      day = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1);
    }
  }
  const dueDate = new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour ?? 9, minute);
  return { title: working.replace(/\s{2,}/g, ' ').trim() || text, due: dueDate.getTime() };
}
