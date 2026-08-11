import type { Tool, ToolContext, ToolResult } from './base.js';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';

interface ScheduledTask {
  id: string;
  title: string;
  description: string;
  type: 'once' | 'recurring' | 'reminder' | 'deadline';
  schedule: {
    datetime?: number;
    cron?: string;
    interval?: number;
    timezone?: string;
  };
  payload: {
    action: 'notify' | 'run_tool' | 'run_agent' | 'send_email' | 'webhook';
    config: Record<string, unknown>;
  };
  priority: 'critical' | 'high' | 'medium' | 'low';
  status: 'pending' | 'running' | 'completed' | 'cancelled' | 'overdue';
  tags: string[];
  createdAt: number;
  lastRun?: number;
  nextRun?: number;
  runCount: number;
  dependencies?: string[];
}

interface SmartSuggestion {
  id: string;
  type: 'schedule' | 'optimize' | 'batch' | 'delegate' | 'reschedule';
  title: string;
  description: string;
  confidence: number;
  relatedTaskIds: string[];
}

const DATA_DIR = join(homedir(), '.infinite-ai', 'scheduler');

function ensureDir(): void {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
}

function loadTasks(): ScheduledTask[] {
  ensureDir();
  const path = join(DATA_DIR, 'tasks.json');
  if (!existsSync(path)) return [];
  try { return JSON.parse(readFileSync(path, 'utf-8')); } catch { return []; }
}

function saveTasks(tasks: ScheduledTask[]): void {
  ensureDir();
  writeFileSync(join(DATA_DIR, 'tasks.json'), JSON.stringify(tasks, null, 2));
}

function parseNaturalLanguage(input: string): { datetime?: number; recurring?: string; interval?: number } {
  const lower = input.toLowerCase();
  const now = Date.now();

  if (lower.includes('every minute')) return { interval: 60000 };
  if (lower.includes('every 5 minutes')) return { interval: 300000 };
  if (lower.includes('every 15 minutes')) return { interval: 900000 };
  if (lower.includes('every 30 minutes')) return { interval: 1800000 };
  if (lower.includes('every hour') || lower.includes('hourly')) return { interval: 3600000 };
  if (lower.includes('every 2 hours')) return { interval: 7200000 };
  if (lower.includes('every 4 hours')) return { interval: 14400000 };
  if (lower.includes('every 6 hours')) return { interval: 21600000 };
  if (lower.includes('every 8 hours')) return { interval: 28800000 };
  if (lower.includes('every 12 hours')) return { interval: 43200000 };
  if (lower.includes('twice a day')) return { interval: 43200000 };
  if (lower.includes('every day') || lower.includes('daily')) return { recurring: 'daily' };
  if (lower.includes('every week') || lower.includes('weekly')) return { recurring: 'weekly' };
  if (lower.includes('every month') || lower.includes('monthly')) return { recurring: 'monthly' };
  if (lower.includes('every monday')) return { recurring: 'monday' };
  if (lower.includes('every friday')) return { recurring: 'friday' };
  if (lower.includes('weekdays')) return { recurring: 'weekdays' };

  if (lower.includes('in 5 minutes')) return { datetime: now + 300000 };
  if (lower.includes('in 10 minutes')) return { datetime: now + 600000 };
  if (lower.includes('in 15 minutes')) return { datetime: now + 900000 };
  if (lower.includes('in 30 minutes')) return { datetime: now + 1800000 };
  if (lower.includes('in 1 hour') || lower.includes('in an hour')) return { datetime: now + 3600000 };
  if (lower.includes('in 2 hours')) return { datetime: now + 7200000 };
  if (lower.includes('in 3 hours')) return { datetime: now + 10800000 };
  if (lower.includes('in 4 hours')) return { datetime: now + 14400000 };
  if (lower.includes('tomorrow')) {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(9, 0, 0, 0);
    return { datetime: tomorrow.getTime() };
  }
  if (lower.includes('next week')) {
    const nextWeek = new Date();
    nextWeek.setDate(nextWeek.getDate() + 7);
    nextWeek.setHours(9, 0, 0, 0);
    return { datetime: nextWeek.getTime() };
  }

  const timeMatch = lower.match(/at (\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);
  if (timeMatch) {
    let hours = parseInt(timeMatch[1]!);
    const minutes = timeMatch[2] ? parseInt(timeMatch[2]) : 0;
    if (timeMatch[3] === 'pm' && hours < 12) hours += 12;
    if (timeMatch[3] === 'am' && hours === 12) hours = 0;
    const target = new Date();
    target.setHours(hours, minutes, 0, 0);
    if (target.getTime() <= now) target.setDate(target.getDate() + 1);
    return { datetime: target.getTime() };
  }

  return {};
}

function getNextRunTime(task: ScheduledTask): number | undefined {
  if (task.schedule.datetime) return task.schedule.datetime;
  if (task.schedule.interval && task.lastRun) return task.lastRun + task.schedule.interval;
  if (task.schedule.interval && !task.lastRun) return Date.now() + task.schedule.interval;
  if (task.schedule.cron) {
    const now = new Date();
    const next = new Date(now);
    if (task.schedule.cron === 'daily') {
      next.setHours(9, 0, 0, 0);
      if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1);
    } else if (task.schedule.cron === 'weekly') {
      next.setDate(next.getDate() + ((1 + 7 - next.getDay()) % 7 || 7));
      next.setHours(9, 0, 0, 0);
    } else if (task.schedule.cron === 'monday') {
      next.setDate(next.getDate() + ((1 + 7 - next.getDay()) % 7 || 7));
      next.setHours(9, 0, 0, 0);
    } else if (task.schedule.cron === 'friday') {
      next.setDate(next.getDate() + ((5 + 7 - next.getDay()) % 7 || 7));
      next.setHours(9, 0, 0, 0);
    }
    return next.getTime();
  }
  return undefined;
}

function generateSuggestions(tasks: ScheduledTask[]): SmartSuggestion[] {
  const suggestions: SmartSuggestion[] = [];
  const now = Date.now();
  const pending = tasks.filter((t) => t.status === 'pending');

  const overdue = pending.filter((t) => t.schedule.datetime && t.schedule.datetime < now);
  if (overdue.length > 0) {
    suggestions.push({
      id: randomUUID(),
      type: 'reschedule',
      title: `${overdue.length} overdue task(s) need rescheduling`,
      description: `You have ${overdue.length} overdue tasks: ${overdue.map((t) => t.title).join(', ')}. Consider rescheduling or completing them.`,
      confidence: 0.95,
      relatedTaskIds: overdue.map((t) => t.id),
    });
  }

  const criticalPending = pending.filter((t) => t.priority === 'critical');
  if (criticalPending.length > 2) {
    suggestions.push({
      id: randomUUID(),
      type: 'batch',
      title: 'Batch critical tasks together',
      description: `You have ${criticalPending.length} critical tasks. Consider batching similar ones to improve efficiency.`,
      confidence: 0.8,
      relatedTaskIds: criticalPending.map((t) => t.id),
    });
  }

  const recurringTasks = pending.filter((t) => t.type === 'recurring');
  if (recurringTasks.length > 0) {
    suggestions.push({
      id: randomUUID(),
      type: 'optimize',
      title: 'Optimize recurring task schedule',
      description: `You have ${recurringTasks.length} recurring tasks. Consider grouping them to reduce context switching.`,
      confidence: 0.7,
      relatedTaskIds: recurringTasks.map((t) => t.id),
    });
  }

  return suggestions;
}

export const smartSchedulerTool: Tool = {
  name: 'SmartScheduler',
  description:
    'AI-powered task scheduling with natural language parsing. Create tasks with "in 30 minutes", "every day at 9am", "tomorrow", "next week". Smart suggestions for batch optimization, rescheduling overdue tasks, and prioritizing work. Supports deadlines, reminders, recurring tasks, and dependencies.',
  permission: 'ask',
  inputSchema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['create', 'list', 'get', 'update', 'delete', 'complete', 'suggestions', 'overdue', 'today', 'upcoming'],
        description: 'Scheduler action',
      },
      title: { type: 'string', description: 'Task title' },
      description: { type: 'string', description: 'Task description' },
      schedule: { type: 'string', description: 'Natural language schedule (e.g., "in 30 minutes", "every day at 9am", "tomorrow")' },
      priority: { type: 'string', enum: ['critical', 'high', 'medium', 'low'], description: 'Task priority' },
      type: { type: 'string', enum: ['once', 'recurring', 'reminder', 'deadline'], description: 'Task type' },
      tags: { type: 'array', items: { type: 'string' }, description: 'Task tags' },
      taskId: { type: 'string', description: 'Task ID for get/update/delete/complete' },
      payloadAction: { type: 'string', description: 'Action to perform when task runs (notify, run_tool, run_agent)' },
      payloadConfig: { type: 'object', description: 'Configuration for the payload action' },
    },
    required: ['action'],
  },

  async execute(args): Promise<ToolResult> {
    const input = args as {
      action: string;
      title?: string;
      description?: string;
      schedule?: string;
      priority?: string;
      type?: string;
      tags?: string[];
      taskId?: string;
      payloadAction?: string;
      payloadConfig?: Record<string, unknown>;
    };

    try {
      const tasks = loadTasks();

      switch (input.action) {
        case 'create': {
          if (!input.title) return { content: 'title is required', is_error: true };

          const scheduleData = input.schedule ? parseNaturalLanguage(input.schedule) : {};
          const taskType = input.type || (scheduleData.recurring ? 'recurring' : scheduleData.interval ? 'recurring' : 'once');

          const task: ScheduledTask = {
            id: randomUUID(),
            title: input.title,
            description: input.description || '',
            type: taskType as ScheduledTask['type'],
            schedule: {
              datetime: scheduleData.datetime,
              cron: scheduleData.recurring,
              interval: scheduleData.interval,
            },
            payload: {
              action: (input.payloadAction as ScheduledTask['payload']['action']) || 'notify',
              config: input.payloadConfig || { message: `Task "${input.title}" is due!` },
            },
            priority: (input.priority as ScheduledTask['priority']) || 'medium',
            status: 'pending',
            tags: input.tags || [],
            createdAt: Date.now(),
            runCount: 0,
          };

          task.nextRun = getNextRunTime(task);
          tasks.push(task);
          saveTasks(tasks);

          return {
            content: [
              `Task created: ${task.title}`,
              `ID: ${task.id}`,
              `Type: ${task.type}`,
              `Priority: ${task.priority}`,
              task.nextRun ? `Next run: ${new Date(task.nextRun).toLocaleString()}` : '',
              `Schedule: ${input.schedule || 'manual'}`,
            ].filter(Boolean).join('\n'),
          };
        }

        case 'list': {
          if (tasks.length === 0) return { content: 'No scheduled tasks yet. Use "create" to add one.' };

          const lines = [`=== Scheduled Tasks (${tasks.length}) ===`, ''];
          const byStatus: Record<string, ScheduledTask[]> = {};
          for (const t of tasks) {
            const status = t.status;
            if (!byStatus[status]) byStatus[status] = [];
            byStatus[status].push(t);
          }

          for (const [status, statusTasks] of Object.entries(byStatus)) {
            lines.push(`--- ${status.toUpperCase()} (${statusTasks.length}) ---`);
            for (const t of statusTasks) {
              const nextRun = t.nextRun ? new Date(t.nextRun).toLocaleString() : 'N/A';
              lines.push(`  [${t.priority.toUpperCase()}] ${t.title}`);
              lines.push(`    ID: ${t.id} | Type: ${t.type} | Next: ${nextRun}`);
            }
            lines.push('');
          }
          return { content: lines.join('\n') };
        }

        case 'get': {
          if (!input.taskId) return { content: 'taskId is required', is_error: true };
          const task = tasks.find((t) => t.id === input.taskId);
          if (!task) return { content: `Task not found: ${input.taskId}`, is_error: true };

          return {
            content: [
              `=== ${task.title} ===`,
              `ID: ${task.id}`,
              `Type: ${task.type}`,
              `Priority: ${task.priority}`,
              `Status: ${task.status}`,
              `Description: ${task.description || 'none'}`,
              `Tags: ${task.tags.join(', ') || 'none'}`,
              task.nextRun ? `Next run: ${new Date(task.nextRun).toLocaleString()}` : '',
              task.lastRun ? `Last run: ${new Date(task.lastRun).toLocaleString()}` : '',
              `Run count: ${task.runCount}`,
              `Created: ${new Date(task.createdAt).toLocaleString()}`,
            ].filter(Boolean).join('\n'),
          };
        }

        case 'update': {
          if (!input.taskId) return { content: 'taskId is required', is_error: true };
          const task = tasks.find((t) => t.id === input.taskId);
          if (!task) return { content: `Task not found: ${input.taskId}`, is_error: true };

          if (input.title) task.title = input.title;
          if (input.description) task.description = input.description;
          if (input.priority) task.priority = input.priority as ScheduledTask['priority'];
          if (input.tags) task.tags = input.tags;
          if (input.schedule) {
            const scheduleData = parseNaturalLanguage(input.schedule);
            if (scheduleData.datetime) task.schedule.datetime = scheduleData.datetime;
            if (scheduleData.recurring) task.schedule.cron = scheduleData.recurring;
            if (scheduleData.interval) task.schedule.interval = scheduleData.interval;
            task.nextRun = getNextRunTime(task);
          }

          saveTasks(tasks);
          return { content: `Task updated: ${task.title}` };
        }

        case 'delete': {
          if (!input.taskId) return { content: 'taskId is required', is_error: true };
          const idx = tasks.findIndex((t) => t.id === input.taskId);
          if (idx === -1) return { content: `Task not found: ${input.taskId}`, is_error: true };
          const removed = tasks.splice(idx, 1)[0]!;
          saveTasks(tasks);
          return { content: `Deleted task: ${removed.title}` };
        }

        case 'complete': {
          if (!input.taskId) return { content: 'taskId is required', is_error: true };
          const task = tasks.find((t) => t.id === input.taskId);
          if (!task) return { content: `Task not found: ${input.taskId}`, is_error: true };

          task.status = 'completed';
          task.lastRun = Date.now();
          task.runCount++;
          saveTasks(tasks);
          return { content: `Completed: ${task.title}` };
        }

        case 'suggestions': {
          const suggestions = generateSuggestions(tasks);
          if (suggestions.length === 0) return { content: 'No suggestions at this time. Your schedule looks optimized!' };

          const lines = ['=== Smart Suggestions ===', ''];
          for (const s of suggestions) {
            lines.push(`[${s.type.toUpperCase()}] ${s.title}`);
            lines.push(`  ${s.description}`);
            lines.push(`  Confidence: ${Math.round(s.confidence * 100)}%`);
            lines.push('');
          }
          return { content: lines.join('\n') };
        }

        case 'overdue': {
          const now = Date.now();
          const overdue = tasks.filter((t) => t.status === 'pending' && t.schedule.datetime && t.schedule.datetime < now);
          if (overdue.length === 0) return { content: 'No overdue tasks!' };

          const lines = [`=== Overdue Tasks (${overdue.length}) ===`, ''];
          for (const t of overdue) {
            const overdueBy = now - (t.schedule.datetime || 0);
            const hours = Math.floor(overdueBy / 3600000);
            const mins = Math.floor((overdueBy % 3600000) / 60000);
            lines.push(`  [${t.priority.toUpperCase()}] ${t.title}`);
            lines.push(`    Overdue by: ${hours > 0 ? `${hours}h ` : ''}${mins}m`);
          }
          return { content: lines.join('\n') };
        }

        case 'today': {
          const now = new Date();
          const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
          const todayEnd = todayStart + 86400000;
          const todayTasks = tasks.filter(
            (t) => t.status === 'pending' && t.nextRun && t.nextRun >= todayStart && t.nextRun < todayEnd
          );

          if (todayTasks.length === 0) return { content: 'No tasks scheduled for today.' };

          const lines = [`=== Today's Tasks (${todayTasks.length}) ===`, ''];
          for (const t of todayTasks.sort((a, b) => (a.nextRun || 0) - (b.nextRun || 0))) {
            const time = t.nextRun ? new Date(t.nextRun).toLocaleTimeString() : 'N/A';
            lines.push(`  ${time} - [${t.priority.toUpperCase()}] ${t.title}`);
          }
          return { content: lines.join('\n') };
        }

        case 'upcoming': {
          const now = Date.now();
          const nextWeek = now + 7 * 24 * 60 * 60 * 1000;
          const upcoming = tasks.filter(
            (t) => t.status === 'pending' && t.nextRun && t.nextRun >= now && t.nextRun <= nextWeek
          ).sort((a, b) => (a.nextRun || 0) - (b.nextRun || 0));

          if (upcoming.length === 0) return { content: 'No upcoming tasks in the next 7 days.' };

          const lines = [`=== Upcoming Tasks (Next 7 Days) ===`, ''];
          for (const t of upcoming) {
            const date = t.nextRun ? new Date(t.nextRun).toLocaleString() : 'N/A';
            lines.push(`  ${date} - [${t.priority.toUpperCase()}] ${t.title}`);
          }
          return { content: lines.join('\n') };
        }

        default:
          return { content: `Unknown action: ${input.action}`, is_error: true };
      }
    } catch (error) {
      return { content: `SmartScheduler error: ${(error as Error).message}`, is_error: true };
    }
  },
};
