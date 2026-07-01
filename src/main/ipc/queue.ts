/**
 * Queue IPC Handler
 */

import { ipcMain } from 'electron';
import { IPC } from '../../shared/ipc.js';
import { getTaskQueueManager } from '../queue/manager.js';

export function registerQueueIpc(): void {
  const manager = getTaskQueueManager();

  // Create queue
  ipcMain.handle(IPC.QUEUE_CREATE, async (_event, args: { name: string; priority?: number }) => {
    try {
      const queue = manager.createQueue(args.name, args.priority);
      return { ok: true, queue };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, error: message };
    }
  });

  // List queues
  ipcMain.handle(IPC.QUEUE_LIST, async () => {
    try {
      const queues = manager.listQueues();
      return { ok: true, queues };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, error: message };
    }
  });

  // Get queue
  ipcMain.handle(IPC.QUEUE_GET, async (_event, args: { id: string }) => {
    try {
      const queue = manager.getQueue(args.id);
      if (!queue) {
        return { ok: false, error: 'Queue not found' };
      }
      return { ok: true, queue };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, error: message };
    }
  });

  // Delete queue
  ipcMain.handle(IPC.QUEUE_DELETE, async (_event, args: { id: string }) => {
    try {
      const deleted = manager.deleteQueue(args.id);
      return { ok: deleted, error: deleted ? undefined : 'Queue not found' };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, error: message };
    }
  });

  // Enqueue task
  ipcMain.handle(IPC.QUEUE_ENQUEUE, async (_event, args: {
    queueId: string;
    task: Record<string, unknown>;
    priority?: number;
  }) => {
    try {
      const queued = manager.enqueue(args.queueId, 'custom', args.task, args.priority);
      if (!queued) {
        return { ok: false, error: 'Queue not found' };
      }
      return { ok: true, task: queued };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, error: message };
    }
  });

  // Dequeue task
  ipcMain.handle(IPC.QUEUE_DEQUEUE, async (_event, args?: { queueId?: string }) => {
    try {
      const task = manager.dequeue(args?.queueId);
      if (!task) {
        return { ok: false, error: 'No tasks available' };
      }
      return { ok: true, task };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, error: message };
    }
  });

  // Peek at next task
  ipcMain.handle(IPC.QUEUE_PEEK, async (_event, args: { queueId: string }) => {
    try {
      const task = manager.peek(args.queueId);
      if (!task) {
        return { ok: false, error: 'No tasks available' };
      }
      return { ok: true, task };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, error: message };
    }
  });

  // Get queue status
  ipcMain.handle(IPC.QUEUE_STATUS, async (_event, args: { queueId: string }) => {
    try {
      const status = manager.getQueueStatus(args.queueId);
      if (!status) {
        return { ok: false, error: 'Queue not found' };
      }
      return { ok: true, ...status };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, error: message };
    }
  });

  // Get stats
  ipcMain.handle(IPC.QUEUE_STATS, async () => {
    try {
      const stats = manager.getStats();
      return { ok: true, stats };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, error: message };
    }
  });
}