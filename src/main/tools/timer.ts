// Timer tool — in-process countdown timers that fire a system notification.
// Timers survive across tool calls within a session; a `check` action lets the
// agent (and tests) read fired timers deterministically. Electron notification
// is loaded lazily and guarded so the module stays testable outside Electron.

import type { Tool, ToolResult } from './base.js';

interface TimerInput {
  action: 'start' | 'list' | 'cancel' | 'check' | 'clear';
  label?: string;
  seconds?: number;
  minutes?: number;
  hours?: number;
  duration?: string; // "5m", "2h30m", "90s", "1h"
  id?: string;
}

interface ActiveTimer {
  id: string;
  label: string;
  durationMs: number;
  startedAt: number;
  endsAt: number;
}

interface FiredTimer {
  id: string;
  label: string;
  durationMs: number;
  startedAt: number;
  firedAt: number;
}

const activeTimers = new Map<string, ActiveTimer>();
const firedTimers: FiredTimer[] = [];
const MAX_FIRED_LOG = 200;

export const timerTool: Tool = {
  name: 'Timer',
  description: 'Start, list, cancel, and check in-process countdown timers. On completion the timer fires a system notification. Use for waiting periods, pomodoro breaks, or "ping me in N minutes".',
  inputSchema: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['start', 'list', 'cancel', 'check', 'clear'] },
      label: { type: 'string', description: 'Label shown on completion.' },
      seconds: { type: 'number', description: 'Duration in seconds.' },
      minutes: { type: 'number', description: 'Duration in minutes.' },
      hours: { type: 'number', description: 'Duration in hours.' },
      duration: { type: 'string', description: 'Compact duration like "90s", "5m", "2h30m".' },
      id: { type: 'string', description: 'Timer id for cancel.' },
    },
    required: ['action'],
  },
  permission: 'ask',

  async execute(args, _ctx): Promise<ToolResult> {
    const input = args as TimerInput;
    try {
      switch (input.action) {
        case 'start': {
          const durationMs = resolveDuration(input);
          if (durationMs <= 0) return bad('Timer duration must be positive.');
          if (durationMs > 365 * 24 * 3600 * 1000) return bad('Timer duration is capped at 1 year.');
          const id = `timer-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
          const startedAt = Date.now();
          const label = input.label?.trim() || 'Timer';
          const timer: ActiveTimer = { id, label, durationMs, startedAt, endsAt: startedAt + durationMs };
          activeTimers.set(id, timer);
          const handle = setTimeout(() => {
            activeTimers.delete(id);
            firedTimers.push({ id, label, durationMs, startedAt, firedAt: Date.now() });
            if (firedTimers.length > MAX_FIRED_LOG) firedTimers.splice(0, firedTimers.length - MAX_FIRED_LOG);
            void fireNotification(label);
          }, durationMs);
          handle.unref?.();
          return json({ ok: true, id, label, startedAt, endsAt: timer.endsAt, remainingMs: durationMs, hint: 'Use action=check to read fired timers, or action=list to see active ones.' });
        }
        case 'list': {
          const now = Date.now();
          const active = [...activeTimers.values()].map((t) => ({
            id: t.id,
            label: t.label,
            startedAt: t.startedAt,
            endsAt: t.endsAt,
            remainingMs: Math.max(0, t.endsAt - now),
            remainingLabel: formatDuration(Math.max(0, t.endsAt - now)),
          }));
          return json({ activeCount: active.length, active, recentlyFired: [...firedTimers].slice(-10).map((t) => ({ id: t.id, label: t.label, firedAt: t.firedAt })) });
        }
        case 'cancel': {
          if (!input.id) return bad('cancel requires an id.');
          const timer = activeTimers.get(input.id);
          if (!timer) return json({ ok: false, reason: 'not found', id: input.id });
          activeTimers.delete(input.id);
          return json({ ok: true, id: input.id, label: timer.label });
        }
        case 'check': {
          const fired = firedTimers.splice(0, firedTimers.length).map((t) => ({ id: t.id, label: t.label, firedAt: t.firedAt }));
          return json({ firedCount: fired.length, fired });
        }
        case 'clear': {
          const count = activeTimers.size;
          for (const id of [...activeTimers.keys()]) activeTimers.delete(id);
          const firedCount = firedTimers.splice(0, firedTimers.length).length;
          return json({ clearedActive: count, clearedFired: firedCount });
        }
        default:
          return bad(`Unknown Timer action: ${input.action}`);
      }
    } catch (error) {
      return bad((error as Error).message);
    }
  },
};

// ---------------------------------------------------------------------------

function resolveDuration(input: TimerInput): number {
  if (input.duration) {
    const total = parseCompactDuration(input.duration);
    if (total !== null) return total;
  }
  const seconds = input.seconds ?? 0;
  const minutes = input.minutes ?? 0;
  const hours = input.hours ?? 0;
  return (hours * 3600 + minutes * 60 + seconds) * 1000;
}

/** Parse compact durations like "90s", "5m", "2h30m", "1h15m30s". */
export function parseCompactDuration(text: string): number | null {
  const trimmed = text.trim().toLowerCase();
  if (!/^(\d+h)?(\d+m)?(\d+s)?$/.test(trimmed) || trimmed === '') return null;
  const hours = /(\d+)h/.exec(trimmed);
  const minutes = /(\d+)m/.exec(trimmed);
  const seconds = /(\d+)s/.exec(trimmed);
  const totalMs =
    (hours ? Number(hours[1]) * 3600 : 0) +
    (minutes ? Number(minutes[1]) * 60 : 0) +
    (seconds ? Number(seconds[1]) : 0);
  return totalMs > 0 ? totalMs * 1000 : null;
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.ceil(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

/** Best-effort system notification; never throws outside Electron. */
async function fireNotification(label: string): Promise<void> {
  try {
    const { Notification } = await import('electron');
    if (Notification.isSupported()) {
      new Notification({ title: 'Infinite OS — Timer', body: `${label} is complete.` }).show();
    }
  } catch {
    // Not running inside Electron (e.g. tests); the fired record already exists.
  }
}

function json(value: unknown): ToolResult { return { content: JSON.stringify(value, null, 2) }; }
function bad(content: string): ToolResult { return { content, is_error: true }; }
