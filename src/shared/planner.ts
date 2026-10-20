/**
 * Planner — the personal operating layer: tasks, calendar events, reminders.
 *
 * Timestamps are epoch milliseconds so day grouping, sorting, and reminder
 * firing are all timezone-correct without parsing date strings twice. The
 * renderer chooses the local day boundary; the store never guesses one.
 */

export type PlannerPriority = 'low' | 'medium' | 'high';

export interface PlannerTask {
  id: string;
  title: string;
  notes: string;
  /** Epoch ms. Undefined means "someday". */
  due?: number;
  priority: PlannerPriority;
  done: boolean;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
  tags: string[];
  /** Free-form project/list name used for grouping. */
  list?: string;
}

export interface PlannerEvent {
  id: string;
  title: string;
  start: number;
  end: number;
  allDay: boolean;
  location?: string;
  notes?: string;
  /** A CSS color token; the UI falls back to the OS accent. */
  color?: string;
}

export interface PlannerReminder {
  id: string;
  title: string;
  at: number;
  createdAt: number;
  /** Set once the renderer has fired it, so a reload cannot replay it. */
  firedAt?: number;
  taskId?: string;
}

export interface PlannerData {
  version: 1;
  tasks: PlannerTask[];
  events: PlannerEvent[];
  reminders: PlannerReminder[];
}

export interface PlannerTaskInput {
  title: string;
  notes?: string;
  due?: number;
  priority?: PlannerPriority;
  tags?: string[];
  list?: string;
}

export interface PlannerTaskUpdate {
  title?: string;
  notes?: string;
  due?: number | null;
  priority?: PlannerPriority;
  done?: boolean;
  tags?: string[];
  list?: string;
}

export interface PlannerEventInput {
  title: string;
  start: number;
  end?: number;
  allDay?: boolean;
  location?: string;
  notes?: string;
  color?: string;
}

export interface PlannerReminderInput {
  title: string;
  at: number;
  taskId?: string;
}

export interface PlannerStats {
  open: number;
  done: number;
  overdue: number;
  dueToday: number;
  upcomingEvents: number;
  pendingReminders: number;
}

export const PLANNER_LIMITS = {
  title: 300,
  notes: 20_000,
  tags: 20,
  tasks: 5_000,
  events: 5_000,
  reminders: 2_000,
} as const;

export function defaultPlannerData(): PlannerData {
  return { version: 1, tasks: [], events: [], reminders: [] };
}

/** Local calendar day key (YYYY-MM-DD), never UTC-shifted. */
export function dayKey(ms: number): string {
  const date = new Date(ms);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

export function startOfDay(ms: number): number {
  const date = new Date(ms);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

export function endOfDay(ms: number): number {
  const date = new Date(ms);
  date.setHours(23, 59, 59, 999);
  return date.getTime();
}

/** Calendar-safe day arithmetic, including across daylight-saving changes. */
export function addDays(ms: number, days: number): number {
  const date = new Date(ms);
  date.setDate(date.getDate() + days);
  return date.getTime();
}
