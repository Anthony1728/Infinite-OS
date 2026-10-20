/**
 * PlannerStore — tasks, calendar events, and reminders.
 *
 * Same durability rules as Studio: one profile-scoped JSON file, atomic
 * replacement, corrupt-file preservation. Time is stored as epoch ms so the
 * renderer owns the user's timezone and daylight-saving boundaries.
 */

import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { infiniteHome } from '../profiles/home.js';
import {
  PLANNER_LIMITS,
  addDays,
  dayKey,
  defaultPlannerData,
  startOfDay,
  type PlannerData,
  type PlannerEvent,
  type PlannerEventInput,
  type PlannerPriority,
  type PlannerReminder,
  type PlannerReminderInput,
  type PlannerStats,
  type PlannerTask,
  type PlannerTaskInput,
  type PlannerTaskUpdate,
} from '../../shared/planner.js';

export interface PlannerStoreOptions {
  dataDir?: string;
  now?: () => number;
  id?: () => string;
}

function text(value: unknown, max: number): string {
  return typeof value === 'string' ? value.slice(0, max) : '';
}

function timestamp(value: unknown): number | undefined {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : undefined;
}

function priority(value: unknown): PlannerPriority {
  return value === 'low' || value === 'high' ? value : 'medium';
}

function tags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((tag): tag is string => typeof tag === 'string')
    .map((tag) => tag.trim().slice(0, 40))
    .filter(Boolean)
    .slice(0, PLANNER_LIMITS.tags);
}

export class PlannerStore {
  readonly file: string;
  private readonly now: () => number;
  private readonly idFactory: () => string;
  private data: PlannerData = defaultPlannerData();

  constructor(options: PlannerStoreOptions = {}) {
    const dir = options.dataDir ?? join(infiniteHome(), 'planner');
    this.file = join(dir, 'planner.json');
    this.now = options.now ?? Date.now;
    this.idFactory = options.id ?? randomUUID;
    this.load();
  }

  private load(): void {
    if (!existsSync(this.file)) return;
    try {
      const parsed = JSON.parse(readFileSync(this.file, 'utf8')) as Partial<PlannerData>;
      this.data = {
        version: 1,
        tasks: (Array.isArray(parsed.tasks) ? parsed.tasks : []).slice(0, PLANNER_LIMITS.tasks).map((task) => this.normalizeTask(task)),
        events: (Array.isArray(parsed.events) ? parsed.events : []).slice(0, PLANNER_LIMITS.events).map((event) => this.normalizeEvent(event)),
        reminders: (Array.isArray(parsed.reminders) ? parsed.reminders : []).slice(0, PLANNER_LIMITS.reminders).map((reminder) => this.normalizeReminder(reminder)),
      };
    } catch (error) {
      try {
        renameSync(this.file, `${this.file}.corrupt-${Date.now()}`);
      } catch {
        /* best effort */
      }
      console.error('[planner] Could not read planner.json; preserved a corrupt copy:', error);
      this.data = defaultPlannerData();
    }
  }

  private normalizeTask(input: Partial<PlannerTask>): PlannerTask {
    const createdAt = timestamp(input.createdAt) ?? this.now();
    const done = input.done === true;
    return {
      id: text(input.id, 80) || this.idFactory(),
      title: text(input.title, PLANNER_LIMITS.title).trim() || 'Untitled task',
      notes: text(input.notes, PLANNER_LIMITS.notes),
      due: timestamp(input.due),
      priority: priority(input.priority),
      done,
      createdAt,
      updatedAt: timestamp(input.updatedAt) ?? createdAt,
      completedAt: done ? timestamp(input.completedAt) ?? createdAt : undefined,
      tags: tags(input.tags),
      list: text(input.list, 80).trim() || undefined,
    };
  }

  private normalizeEvent(input: Partial<PlannerEvent>): PlannerEvent {
    const start = timestamp(input.start) ?? this.now();
    const end = Math.max(start, timestamp(input.end) ?? start + 60 * 60_000);
    return {
      id: text(input.id, 80) || this.idFactory(),
      title: text(input.title, PLANNER_LIMITS.title).trim() || 'Untitled event',
      start,
      end,
      allDay: input.allDay === true,
      location: text(input.location, 300).trim() || undefined,
      notes: text(input.notes, PLANNER_LIMITS.notes),
      color: text(input.color, 40).trim() || undefined,
    };
  }

  private normalizeReminder(input: Partial<PlannerReminder>): PlannerReminder {
    const createdAt = timestamp(input.createdAt) ?? this.now();
    return {
      id: text(input.id, 80) || this.idFactory(),
      title: text(input.title, PLANNER_LIMITS.title).trim() || 'Reminder',
      at: timestamp(input.at) ?? createdAt,
      createdAt,
      firedAt: timestamp(input.firedAt),
      taskId: text(input.taskId, 80).trim() || undefined,
    };
  }

  private save(): void {
    mkdirSync(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.data), 'utf8');
    renameSync(tmp, this.file);
  }

  private task(id: string): PlannerTask | undefined {
    return this.data.tasks.find((item) => item.id === id);
  }

  get(): PlannerData {
    return JSON.parse(JSON.stringify(this.data)) as PlannerData;
  }

  createTask(input: PlannerTaskInput): PlannerTask {
    if (this.data.tasks.length >= PLANNER_LIMITS.tasks) throw new Error('Task list is full.');
    const now = this.now();
    const task: PlannerTask = this.normalizeTask({
      id: this.idFactory(),
      title: input?.title,
      notes: input?.notes,
      due: input?.due,
      priority: input?.priority,
      createdAt: now,
      updatedAt: now,
      tags: input?.tags,
      list: input?.list,
      done: false,
    });
    this.data.tasks.push(task);
    this.save();
    return { ...task };
  }

  updateTask(id: string, patch: PlannerTaskUpdate): PlannerTask | null {
    const task = this.task(id);
    if (!task) return null;
    if (patch.title !== undefined) task.title = text(patch.title, PLANNER_LIMITS.title).trim() || task.title;
    if (patch.notes !== undefined) task.notes = text(patch.notes, PLANNER_LIMITS.notes);
    if (patch.due !== undefined) task.due = patch.due === null ? undefined : timestamp(patch.due);
    if (patch.priority !== undefined) task.priority = priority(patch.priority);
    if (patch.tags !== undefined) task.tags = tags(patch.tags);
    if (patch.list !== undefined) task.list = text(patch.list, 80).trim() || undefined;
    if (patch.done !== undefined) {
      task.done = patch.done === true;
      task.completedAt = task.done ? this.now() : undefined;
    }
    task.updatedAt = this.now();
    this.save();
    return { ...task };
  }

  toggleTask(id: string): PlannerTask | null {
    const task = this.task(id);
    if (!task) return null;
    return this.updateTask(id, { done: !task.done });
  }

  deleteTask(id: string): boolean {
    const index = this.data.tasks.findIndex((item) => item.id === id);
    if (index < 0) return false;
    this.data.tasks.splice(index, 1);
    for (const reminder of this.data.reminders) {
      if (reminder.taskId === id) reminder.taskId = undefined;
    }
    this.save();
    return true;
  }

  createEvent(input: PlannerEventInput): PlannerEvent {
    if (this.data.events.length >= PLANNER_LIMITS.events) throw new Error('Calendar is full.');
    const start = timestamp(input?.start) ?? this.now();
    const event = this.normalizeEvent({
      id: this.idFactory(),
      title: input?.title,
      start,
      end: input?.end ?? start + 60 * 60_000,
      allDay: input?.allDay,
      location: input?.location,
      notes: input?.notes,
      color: input?.color,
    });
    this.data.events.push(event);
    this.save();
    return { ...event };
  }

  updateEvent(id: string, patch: Partial<PlannerEventInput>): PlannerEvent | null {
    const event = this.data.events.find((item) => item.id === id);
    if (!event) return null;
    if (patch.title !== undefined) event.title = text(patch.title, PLANNER_LIMITS.title).trim() || event.title;
    if (patch.start !== undefined) {
      const start = timestamp(patch.start);
      if (start) {
        const duration = Math.max(0, event.end - event.start);
        event.start = start;
        event.end = start + duration;
      }
    }
    if (patch.end !== undefined) {
      const end = timestamp(patch.end);
      if (end) event.end = Math.max(event.start, end);
    }
    if (patch.allDay !== undefined) event.allDay = patch.allDay === true;
    if (patch.location !== undefined) event.location = text(patch.location, 300).trim() || undefined;
    if (patch.notes !== undefined) event.notes = text(patch.notes, PLANNER_LIMITS.notes);
    if (patch.color !== undefined) event.color = text(patch.color, 40).trim() || undefined;
    this.save();
    return { ...event };
  }

  deleteEvent(id: string): boolean {
    const index = this.data.events.findIndex((item) => item.id === id);
    if (index < 0) return false;
    this.data.events.splice(index, 1);
    this.save();
    return true;
  }

  createReminder(input: PlannerReminderInput): PlannerReminder {
    if (this.data.reminders.length >= PLANNER_LIMITS.reminders) throw new Error('Reminder list is full.');
    const reminder = this.normalizeReminder({
      id: this.idFactory(),
      title: input?.title,
      at: input?.at,
      createdAt: this.now(),
      taskId: input?.taskId,
    });
    this.data.reminders.push(reminder);
    this.save();
    return { ...reminder };
  }

  updateReminder(id: string, patch: Partial<PlannerReminderInput>): PlannerReminder | null {
    const reminder = this.data.reminders.find((item) => item.id === id);
    if (!reminder) return null;
    if (patch.title !== undefined) reminder.title = text(patch.title, PLANNER_LIMITS.title).trim() || reminder.title;
    if (patch.at !== undefined) {
      const at = timestamp(patch.at);
      if (at) {
        reminder.at = at;
        reminder.firedAt = undefined;
      }
    }
    this.save();
    return { ...reminder };
  }

  deleteReminder(id: string): boolean {
    const index = this.data.reminders.findIndex((item) => item.id === id);
    if (index < 0) return false;
    this.data.reminders.splice(index, 1);
    this.save();
    return true;
  }

  /** Reminders whose time has arrived and that have not been acknowledged. */
  dueReminders(now = this.now()): PlannerReminder[] {
    return this.data.reminders
      .filter((reminder) => !reminder.firedAt && reminder.at <= now)
      .sort((a, b) => a.at - b.at)
      .map((reminder) => ({ ...reminder }));
  }

  markReminderFired(id: string, at = this.now()): PlannerReminder | null {
    const reminder = this.data.reminders.find((item) => item.id === id);
    if (!reminder) return null;
    reminder.firedAt = at;
    this.save();
    return { ...reminder };
  }

  stats(now = this.now()): PlannerStats {
    const today = dayKey(now);
    const endOfWeek = addDays(startOfDay(now), 7);
    return {
      open: this.data.tasks.filter((task) => !task.done).length,
      done: this.data.tasks.filter((task) => task.done).length,
      overdue: this.data.tasks.filter((task) => !task.done && task.due !== undefined && task.due < startOfDay(now)).length,
      dueToday: this.data.tasks.filter((task) => !task.done && task.due !== undefined && dayKey(task.due) === today).length,
      upcomingEvents: this.data.events.filter((event) => event.end >= now && event.start < endOfWeek).length,
      pendingReminders: this.data.reminders.filter((reminder) => !reminder.firedAt).length,
    };
  }
}

let singleton: PlannerStore | null = null;

export function getPlannerStore(): PlannerStore {
  if (!singleton) singleton = new PlannerStore();
  return singleton;
}

export function resetPlannerStore(): void {
  singleton = null;
}
