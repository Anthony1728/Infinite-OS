import { create } from 'zustand';
import {
  startOfDay,
  endOfDay,
  type PlannerData,
  type PlannerEvent,
  type PlannerEventInput,
  type PlannerReminder,
  type PlannerReminderInput,
  type PlannerTask,
  type PlannerTaskInput,
  type PlannerTaskUpdate,
} from '../../shared/planner';
import { useNotificationStore } from './notifications';

interface PlannerState {
  data: PlannerData;
  loading: boolean;
  error: string | null;
  load: () => Promise<void>;
  createTask: (input: PlannerTaskInput) => Promise<PlannerTask | null>;
  updateTask: (id: string, patch: PlannerTaskUpdate) => Promise<PlannerTask | null>;
  toggleTask: (id: string) => Promise<PlannerTask | null>;
  deleteTask: (id: string) => Promise<void>;
  createEvent: (input: PlannerEventInput) => Promise<PlannerEvent | null>;
  updateEvent: (id: string, patch: Partial<PlannerEventInput>) => Promise<PlannerEvent | null>;
  deleteEvent: (id: string) => Promise<void>;
  createReminder: (input: PlannerReminderInput) => Promise<PlannerReminder | null>;
  updateReminder: (id: string, patch: Partial<PlannerReminderInput>) => Promise<PlannerReminder | null>;
  deleteReminder: (id: string) => Promise<void>;
  checkDue: () => Promise<void>;
}

const toast = (type: 'success' | 'error' | 'info', title: string, message?: string, duration?: number) =>
  useNotificationStore.getState().addToast({ type, title, message, duration });

const EMPTY: PlannerData = { version: 1, tasks: [], events: [], reminders: [] };

let checkingReminders = false;

function notifyDesktop(title: string, body: string) {
  try {
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    const notification = new Notification(title, { body, silent: false });
    notification.onclick = () => {
      window.focus();
      notification.close();
    };
  } catch {
    // Desktop notifications are a bonus; the in-app toast always fires.
  }
}

export const usePlannerStore = create<PlannerState>((set, get) => ({
  data: EMPTY,
  loading: true,
  error: null,

  load: async () => {
    set({ loading: true, error: null });
    try {
      const data = (await window.api.plannerGet()) as PlannerData;
      set({
        data: data ?? EMPTY,
        loading: false,
      });
    } catch (error) {
      set({ loading: false, error: (error as Error).message });
      toast('error', 'Planner could not open', (error as Error).message);
    }
  },

  createTask: async (input) => {
    try {
      const task = (await window.api.plannerTaskCreate(input)) as PlannerTask;
      set((state) => ({ data: { ...state.data, tasks: [task, ...state.data.tasks] } }));
      return task;
    } catch (error) {
      toast('error', 'Could not add that task', (error as Error).message);
      return null;
    }
  },

  updateTask: async (id, patch) => {
    try {
      const task = (await window.api.plannerTaskUpdate({ id, patch })) as PlannerTask | null;
      if (task) {
        set((state) => ({
          data: { ...state.data, tasks: state.data.tasks.map((item) => (item.id === id ? task : item)) },
        }));
      }
      return task;
    } catch (error) {
      toast('error', 'Could not update that task', (error as Error).message);
      return null;
    }
  },

  toggleTask: async (id) => {
    try {
      const task = (await window.api.plannerTaskToggle({ id })) as PlannerTask | null;
      if (task) {
        set((state) => ({
          data: { ...state.data, tasks: state.data.tasks.map((item) => (item.id === id ? task : item)) },
        }));
      }
      return task;
    } catch (error) {
      toast('error', 'Could not update that task', (error as Error).message);
      return null;
    }
  },

  deleteTask: async (id) => {
    try {
      const deleted = (await window.api.plannerTaskDelete({ id })) as boolean;
      if (!deleted) return;
      set((state) => ({
        data: {
          ...state.data,
          tasks: state.data.tasks.filter((item) => item.id !== id),
          reminders: state.data.reminders.map((reminder) =>
            reminder.taskId === id ? { ...reminder, taskId: undefined } : reminder,
          ),
        },
      }));
    } catch (error) {
      toast('error', 'Could not delete that task', (error as Error).message);
    }
  },

  createEvent: async (input) => {
    try {
      const event = (await window.api.plannerEventCreate(input)) as PlannerEvent;
      set((state) => ({ data: { ...state.data, events: [event, ...state.data.events] } }));
      return event;
    } catch (error) {
      toast('error', 'Could not add that event', (error as Error).message);
      return null;
    }
  },

  updateEvent: async (id, patch) => {
    try {
      const event = (await window.api.plannerEventUpdate({ id, patch })) as PlannerEvent | null;
      if (event) {
        set((state) => ({
          data: { ...state.data, events: state.data.events.map((item) => (item.id === id ? event : item)) },
        }));
      }
      return event;
    } catch (error) {
      toast('error', 'Could not update that event', (error as Error).message);
      return null;
    }
  },

  deleteEvent: async (id) => {
    try {
      const deleted = (await window.api.plannerEventDelete({ id })) as boolean;
      if (!deleted) return;
      set((state) => ({ data: { ...state.data, events: state.data.events.filter((item) => item.id !== id) } }));
    } catch (error) {
      toast('error', 'Could not delete that event', (error as Error).message);
    }
  },

  createReminder: async (input) => {
    try {
      const reminder = (await window.api.plannerReminderCreate(input)) as PlannerReminder;
      set((state) => ({ data: { ...state.data, reminders: [reminder, ...state.data.reminders] } }));
      return reminder;
    } catch (error) {
      toast('error', 'Could not set that reminder', (error as Error).message);
      return null;
    }
  },

  updateReminder: async (id, patch) => {
    try {
      const reminder = (await window.api.plannerReminderUpdate({ id, patch })) as PlannerReminder | null;
      if (reminder) {
        set((state) => ({
          data: {
            ...state.data,
            reminders: state.data.reminders.map((item) => (item.id === id ? reminder : item)),
          },
        }));
      }
      return reminder;
    } catch (error) {
      toast('error', 'Could not update that reminder', (error as Error).message);
      return null;
    }
  },

  deleteReminder: async (id) => {
    try {
      const deleted = (await window.api.plannerReminderDelete({ id })) as boolean;
      if (!deleted) return;
      set((state) => ({
        data: { ...state.data, reminders: state.data.reminders.filter((item) => item.id !== id) },
      }));
    } catch (error) {
      toast('error', 'Could not delete that reminder', (error as Error).message);
    }
  },

  /**
   * Called by the app shell on login and every 15 seconds. The guard prevents
   * overlapping checks when a slow IPC call and a timer collide, and it keeps
   * reminders firing even while the Planner view is closed.
   */
  checkDue: async () => {
    if (checkingReminders) return;
    checkingReminders = true;
    try {
      const now = Date.now();
      const due = (await window.api.plannerDue()) as PlannerReminder[];
      for (const reminder of due) {
        toast('info', reminder.title, 'Reminder', 10_000);
        notifyDesktop('Infinite OS reminder', reminder.title);
        await window.api.plannerFired({ id: reminder.id });
        set((state) => ({
          data: {
            ...state.data,
            reminders: state.data.reminders.map((item) =>
              item.id === reminder.id ? { ...item, firedAt: now } : item,
            ),
          },
        }));
      }
      // Keep the rendered list accurate if another window fired one.
      if (!due.length) {
        const localDue = get().data.reminders.some((item) => !item.firedAt && item.at <= now);
        if (localDue) {
          const data = (await window.api.plannerGet()) as PlannerData;
          set({ data });
        }
      }
    } catch {
      // A missed reminder check is retried by the next tick.
    } finally {
      checkingReminders = false;
    }
  },
}));

/** Local, renderer-side stats used for the greeting strip. */
export function plannerSnapshot(data: PlannerData, now = Date.now()) {
  const dayStart = startOfDay(now);
  const dayEnd = endOfDay(now);
  const openTasks = data.tasks.filter((task) => !task.done);
  return {
    open: openTasks.length,
    done: data.tasks.length - openTasks.length,
    overdue: openTasks.filter((task) => task.due !== undefined && task.due < dayStart).length,
    dueToday: openTasks.filter(
      (task) => task.due !== undefined && task.due >= dayStart && task.due <= dayEnd,
    ).length,
    upcomingEvents: data.events.filter((event) => event.end >= now).length,
    pendingReminders: data.reminders.filter((reminder) => !reminder.firedAt).length,
  };
}
