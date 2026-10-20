/**
 * Planner agent tool — the user's personal tasks, calendar, and reminders.
 *
 * The agent uses this when the user says "remind me", "add that to my list",
 * "what's on my calendar", or finishes a piece of work and should leave a task
 * behind. Dates accept ISO strings or epoch milliseconds so the model can use
 * whichever shape it is most reliable with.
 */

import type { Tool, ToolContext, ToolResult } from './base.js';
import {
  dayKey,
  startOfDay,
  type PlannerPriority,
} from '../../shared/planner.js';
import { getPlannerStore } from '../planner/store.js';

interface PlannerArgs {
  action:
    | 'overview'
    | 'task_create'
    | 'task_update'
    | 'task_complete'
    | 'task_delete'
    | 'event_create'
    | 'event_update'
    | 'event_delete'
    | 'reminder_create'
    | 'reminder_delete';
  id?: string;
  title?: string;
  notes?: string;
  due?: string | number;
  priority?: PlannerPriority;
  tags?: string[];
  list?: string;
  done?: boolean;
  start?: string | number;
  end?: string | number;
  allDay?: boolean;
  location?: string;
  at?: string | number;
  color?: string;
}

function toMs(value: string | number | undefined): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value === 'number') return Number.isFinite(value) ? Math.floor(value) : undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function result(value: unknown): ToolResult {
  return { content: JSON.stringify(value, null, 2) };
}

function bad(message: string): ToolResult {
  return { content: message, is_error: true };
}

export const plannerTool: Tool = {
  name: 'Planner',
  description:
    'Operate the user\'s personal Planner: tasks, calendar events, and reminders. ' +
    'overview returns everything plus stats. Dates accept ISO strings ("2026-10-21T15:00:00") or epoch ms. ' +
    'task_create can also set a reminder by calling reminder_create with the task id. task_complete marks done. ' +
    'Use this for "remind me", "put that on my list", "what is due today", "schedule that", or to leave a follow-up after finishing work. ' +
    'This is the personal planner — for business CRM records use Business, for scheduled automations use Automation.',
  inputSchema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: [
          'overview', 'task_create', 'task_update', 'task_complete', 'task_delete',
          'event_create', 'event_update', 'event_delete', 'reminder_create', 'reminder_delete',
        ],
      },
      id: { type: 'string' },
      title: { type: 'string' },
      notes: { type: 'string' },
      due: { description: 'ISO date/time or epoch ms.' },
      priority: { type: 'string', enum: ['low', 'medium', 'high'] },
      tags: { type: 'array', items: { type: 'string' } },
      list: { type: 'string', description: 'Optional list/project name.' },
      done: { type: 'boolean' },
      start: { description: 'Event start, ISO or epoch ms.' },
      end: { description: 'Event end, ISO or epoch ms.' },
      allDay: { type: 'boolean' },
      location: { type: 'string' },
      at: { description: 'Reminder time, ISO or epoch ms.' },
      color: { type: 'string' },
    },
    required: ['action'],
  },
  permission: 'ask',
  async execute(args, _ctx: ToolContext): Promise<ToolResult> {
    const input = args as PlannerArgs;
    const store = getPlannerStore();
    try {
      if (input.action === 'overview') {
        const data = store.get();
        const now = Date.now();
        const today = dayKey(now);
        return result({
          stats: store.stats(now),
          tasks: data.tasks
            .slice()
            .sort((a, b) => Number(a.done) - Number(b.done) || (a.due ?? Infinity) - (b.due ?? Infinity))
            .slice(0, 200)
            .map((task) => ({ ...task, dueLabel: task.due ? dayKey(task.due) : null, isToday: task.due ? dayKey(task.due) === today : false })),
          events: data.events
            .filter((event) => event.end >= startOfDay(now))
            .sort((a, b) => a.start - b.start)
            .slice(0, 100),
          reminders: data.reminders
            .filter((reminder) => !reminder.firedAt)
            .sort((a, b) => a.at - b.at)
            .slice(0, 100),
        });
      }

      if (input.action === 'task_create') {
        if (!input.title?.trim()) return bad('task_create requires title.');
        const task = store.createTask({
          title: input.title,
          notes: input.notes,
          due: toMs(input.due),
          priority: input.priority,
          tags: input.tags,
          list: input.list,
        });
        return result({ task });
      }

      if (input.action === 'task_update') {
        if (!input.id) return bad('task_update requires id.');
        const task = store.updateTask(input.id, {
          title: input.title,
          notes: input.notes,
          due: input.due === undefined ? undefined : toMs(input.due) ?? null,
          priority: input.priority,
          tags: input.tags,
          list: input.list,
          done: input.done,
        });
        return task ? result({ task }) : bad(`No task with id ${input.id}.`);
      }

      if (input.action === 'task_complete') {
        if (!input.id) return bad('task_complete requires id.');
        const task = store.updateTask(input.id, { done: input.done !== false });
        return task ? result({ task }) : bad(`No task with id ${input.id}.`);
      }

      if (input.action === 'task_delete') {
        if (!input.id) return bad('task_delete requires id.');
        return result({ deleted: store.deleteTask(input.id) });
      }

      if (input.action === 'event_create') {
        if (!input.title?.trim()) return bad('event_create requires title.');
        const start = toMs(input.start) ?? toMs(input.due);
        if (!start) return bad('event_create requires start (ISO date/time or epoch ms).');
        const event = store.createEvent({
          title: input.title,
          start,
          end: toMs(input.end),
          allDay: input.allDay,
          location: input.location,
          notes: input.notes,
          color: input.color,
        });
        return result({ event });
      }

      if (input.action === 'event_update') {
        if (!input.id) return bad('event_update requires id.');
        const event = store.updateEvent(input.id, {
          title: input.title,
          start: toMs(input.start),
          end: toMs(input.end),
          allDay: input.allDay,
          location: input.location,
          notes: input.notes,
          color: input.color,
        });
        return event ? result({ event }) : bad(`No event with id ${input.id}.`);
      }

      if (input.action === 'event_delete') {
        if (!input.id) return bad('event_delete requires id.');
        return result({ deleted: store.deleteEvent(input.id) });
      }

      if (input.action === 'reminder_create') {
        if (!input.title?.trim()) return bad('reminder_create requires title.');
        const at = toMs(input.at) ?? toMs(input.due);
        if (!at) return bad('reminder_create requires at (ISO date/time or epoch ms).');
        const reminder = store.createReminder({ title: input.title, at, taskId: input.id });
        return result({ reminder });
      }

      if (input.action === 'reminder_delete') {
        if (!input.id) return bad('reminder_delete requires id.');
        return result({ deleted: store.deleteReminder(input.id) });
      }

      return bad(`Unknown Planner action: ${input.action}`);
    } catch (error) {
      return bad((error as Error).message);
    }
  },
};
