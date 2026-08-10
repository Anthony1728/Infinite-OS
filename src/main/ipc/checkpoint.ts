/**
 * Checkpoint IPC Handler
 */

import { ipcMain } from 'electron';
import { IPC } from '../../shared/ipc.js';
import { getCheckpointManager, type TaskState } from '../checkpoint/manager.js';

export function registerCheckpointIpc(): void {
  const manager = getCheckpointManager();

  // Create checkpoint
  ipcMain.handle(IPC.CHECKPOINT_CREATE, async (_event, args: {
    taskId: string;
    name: string;
    description?: string;
    metadata?: Record<string, unknown>;
    state: TaskState;
  }) => {
    try {
      const checkpoint = manager.create({
        taskId: args.taskId,
        name: args.name,
        description: args.description,
        state: args.state,
        metadata: args.metadata,
      });
      return { ok: true, checkpoint };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, error: message };
    }
  });

  // List checkpoints
  ipcMain.handle(IPC.CHECKPOINT_LIST, async (_event, args?: { taskId?: string; limit?: number }) => {
    try {
      const checkpoints = args?.taskId
        ? manager.list(args.taskId, args.limit)
        : manager.listAll(args?.limit);
      return { ok: true, checkpoints };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, error: message };
    }
  });

  // Get checkpoint
  ipcMain.handle(IPC.CHECKPOINT_GET, async (_event, args: { id: string }) => {
    try {
      const checkpoint = manager.get(args.id);
      if (!checkpoint) {
        return { ok: false, error: 'Checkpoint not found' };
      }
      return { ok: true, checkpoint };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, error: message };
    }
  });

  // Restore checkpoint
  ipcMain.handle(IPC.CHECKPOINT_RESTORE, async (_event, args: { id: string }) => {
    try {
      const result = manager.rollback(args.id);
      if (!result.success) {
        return { ok: false, error: result.error };
      }
      return { ok: true, state: result.state, rollbackActions: result.rollbackActions };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, error: message };
    }
  });

  // Delete checkpoint
  ipcMain.handle(IPC.CHECKPOINT_DELETE, async (_event, args: { id: string }) => {
    try {
      const deleted = manager.delete(args.id);
      return { ok: deleted, error: deleted ? undefined : 'Checkpoint not found' };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, error: message };
    }
  });

  // Diff checkpoints
  ipcMain.handle(IPC.CHECKPOINT_DIFF, async (_event, args: { id1: string; id2: string }) => {
    try {
      const diff = manager.diff(args.id1, args.id2);
      if (!diff) {
        return { ok: false, error: 'One or both checkpoints not found' };
      }
      return { ok: true, ...diff };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, error: message };
    }
  });
}
