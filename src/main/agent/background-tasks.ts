// Background tasks — "run in background" for chat runs. The run keeps
// streaming into its transcript while the user works elsewhere; completion or
// failure raises an OS notification (Codex/Claude Code background-parity) and
// the renderer can badge running tasks in the sidebar.

import { Notification } from 'electron';
import { IPC } from '../../shared/ipc.js';

type Emit = (channel: string, payload: unknown) => void;
let emit: Emit | null = null;

export function setBackgroundTaskEmitter(fn: Emit): void {
  emit = fn;
}

export interface BackgroundTask {
  sessionId: string;
  title: string;
  startedAt: number;
  endedAt?: number;
  status: 'running' | 'completed' | 'failed';
  summary?: string;
}

const tasks = new Map<string, BackgroundTask>();

export function startBackgroundTask(sessionId: string, title: string): BackgroundTask {
  const task: BackgroundTask = { sessionId, title, startedAt: Date.now(), status: 'running' };
  tasks.set(sessionId, task);
  broadcast();
  return task;
}

export function finishBackgroundTask(sessionId: string, status: 'completed' | 'failed', summary?: string): void {
  const task = tasks.get(sessionId);
  if (!task) return;
  task.status = status;
  task.endedAt = Date.now();
  task.summary = summary?.slice(0, 300);
  broadcast();
  // OS notification — the user has switched away; bring the result to them.
  try {
    if (Notification.isSupported()) {
      new Notification({
        title: status === 'completed' ? 'Infinite OS — task finished' : 'Infinite OS — task failed',
        body: `${task.title}${task.summary ? `\n${task.summary}` : ''}`.slice(0, 280),
        silent: false,
      }).show();
    }
  } catch { /* notifications are best-effort */ }
  // Auto-cleanup after 30 minutes so the list never grows unbounded.
  setTimeout(() => tasks.delete(sessionId), 30 * 60_000).unref?.();
}

export function listBackgroundTasks(): BackgroundTask[] {
  return [...tasks.values()].sort((a, b) => b.startedAt - a.startedAt);
}

export function isBackgroundRunning(sessionId: string): boolean {
  return tasks.get(sessionId)?.status === 'running';
}

function broadcast(): void {
  emit?.(IPC.CHAT_STREAM_EVENT, {
    sessionId: '',
    type: 'background_tasks',
    tasks: listBackgroundTasks(),
  });
}
