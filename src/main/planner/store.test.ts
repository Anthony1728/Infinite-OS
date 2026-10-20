import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PlannerStore } from './store.js';
import { dayKey, startOfDay } from '../../shared/planner.js';

const dirs: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'infinite-planner-'));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

const NOON = new Date(2026, 9, 20, 12, 0, 0, 0).getTime();

describe('PlannerStore', () => {
  it('creates, updates, toggles, and deletes tasks', () => {
    let next = 0;
    const store = new PlannerStore({ dataDir: tempDir(), now: () => NOON, id: () => `task-${++next}` });
    const task = store.createTask({ title: 'Call Sam', priority: 'high', due: NOON + 3_600_000, tags: ['work', '  call '] });
    expect(task).toMatchObject({ title: 'Call Sam', priority: 'high', done: false, tags: ['work', 'call'] });

    const updated = store.updateTask(task.id, { title: 'Call Sam back', notes: 'about the quote' });
    expect(updated?.title).toBe('Call Sam back');
    expect(updated?.notes).toBe('about the quote');

    const done = store.toggleTask(task.id);
    expect(done?.done).toBe(true);
    expect(done?.completedAt).toBe(NOON);
    expect(store.toggleTask(task.id)?.completedAt).toBeUndefined();

    expect(store.deleteTask(task.id)).toBe(true);
    expect(store.deleteTask(task.id)).toBe(false);
    expect(store.get().tasks).toEqual([]);
  });

  it('clears the task link when a task is deleted', () => {
    const store = new PlannerStore({ dataDir: tempDir(), now: () => NOON, id: (() => { let n = 0; return () => `id-${++n}`; })() });
    const task = store.createTask({ title: 'Ship' });
    const reminder = store.createReminder({ title: 'Ship reminder', at: NOON + 1_000, taskId: task.id });
    expect(reminder.taskId).toBe(task.id);
    store.deleteTask(task.id);
    expect(store.get().reminders[0].taskId).toBeUndefined();
  });

  it('stores events with sane end times and supports updates', () => {
    const store = new PlannerStore({ dataDir: tempDir(), now: () => NOON, id: () => 'event-1' });
    const event = store.createEvent({ title: 'Design review', start: NOON + 60_000 });
    expect(event.end).toBe(event.start + 3_600_000);

    const updated = store.updateEvent(event.id, { start: NOON + 7_200_000, title: 'Design review 2' });
    expect(updated?.start).toBe(NOON + 7_200_000);
    expect(updated?.end).toBe(NOON + 7_200_000 + 3_600_000);

    expect(store.deleteEvent(event.id)).toBe(true);
    expect(store.deleteEvent(event.id)).toBe(false);
  });

  it('reports due reminders once and never replays them', () => {
    let now = NOON;
    const store = new PlannerStore({ dataDir: tempDir(), now: () => now, id: (() => { let n = 0; return () => `rem-${++n}`; })() });
    const early = store.createReminder({ title: 'Early', at: NOON - 1_000 });
    const later = store.createReminder({ title: 'Later', at: NOON + 60_000 });
    expect(store.dueReminders(now).map((item) => item.id)).toEqual([early.id]);

    store.markReminderFired(early.id, now);
    expect(store.dueReminders(now)).toEqual([]);

    now += 120_000;
    expect(store.dueReminders(now).map((item) => item.id)).toEqual([later.id]);
  });

  it('computes today, overdue, and upcoming stats in local time', () => {
    const store = new PlannerStore({ dataDir: tempDir(), now: () => NOON, id: (() => { let n = 0; return () => `s-${++n}`; })() });
    store.createTask({ title: 'Overdue', due: startOfDay(NOON) - 1 });
    store.createTask({ title: 'Today', due: NOON });
    store.createTask({ title: 'Later', due: NOON + 3 * 86_400_000 });
    const done = store.createTask({ title: 'Done', due: startOfDay(NOON) - 1 });
    store.toggleTask(done.id);
    store.createEvent({ title: 'Now', start: NOON, end: NOON + 3_600_000 });
    store.createReminder({ title: 'Soon', at: NOON + 60_000 });

    expect(store.stats(NOON)).toEqual({
      open: 3,
      done: 1,
      overdue: 1,
      dueToday: 1,
      upcomingEvents: 1,
      pendingReminders: 1,
    });
    expect(dayKey(NOON)).toBe('2026-10-20');
  });

  it('persists across instances', () => {
    const dir = tempDir();
    const store = new PlannerStore({ dataDir: dir, now: () => NOON });
    const task = store.createTask({ title: 'Persist me' });
    const reloaded = new PlannerStore({ dataDir: dir });
    expect(reloaded.get().tasks[0]).toMatchObject({ id: task.id, title: 'Persist me' });
  });

  it('preserves a corrupt file and starts clean', () => {
    const dir = tempDir();
    const store = new PlannerStore({ dataDir: dir });
    store.createTask({ title: 'x' });
    writeFileSync(join(dir, 'planner.json'), 'nope', 'utf8');
    const recovered = new PlannerStore({ dataDir: dir });
    expect(recovered.get().tasks).toEqual([]);
    expect(readdirSync(dir).some((name) => name.includes('.corrupt-'))).toBe(true);
  });

  it('clamps malformed values instead of crashing', () => {
    const store = new PlannerStore({ dataDir: tempDir(), now: () => NOON });
    const task = store.createTask({ title: '   ', priority: 'urgent' as never, due: -5, tags: ['x', 3 as never], notes: 'n' });
    expect(task.title).toBe('Untitled task');
    expect(task.priority).toBe('medium');
    expect(task.due).toBeUndefined();
    expect(task.tags).toEqual(['x']);
  });
});
