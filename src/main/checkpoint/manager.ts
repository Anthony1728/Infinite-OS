/**
 * Checkpoint System
 *
 * Provides task state persistence and rollback capabilities.
 * Allows saving task state at any point and restoring later.
 */

import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { infiniteHome } from '../profiles/home.js';

export interface Checkpoint {
  id: string;
  taskId: string;
  name: string;
  description?: string;
  timestamp: number;
  state: TaskState;
  metadata: Record<string, unknown>;
  parentId?: string; // For rollback chains
}

export interface TaskState {
  // Task execution state
  status: 'pending' | 'running' | 'paused' | 'completed' | 'failed';
  progress: number;
  currentStep: number;
  totalSteps: number;

  // Execution context
  cwd: string;
  history: Array<{
    role: string;
    content: string | Array<{ type: string; [key: string]: unknown }>;
    timestamp: number;
  }>;
  variables: Record<string, unknown>;

  // Agent state
  agentContext?: {
    model: string;
    provider: string;
    toolsUsed: string[];
    permissionMode: string;
  };

  // File system state (for rollback)
  modifiedFiles?: Array<{
    path: string;
    originalContent?: string;
    newContent: string;
    operation: 'create' | 'modify' | 'delete';
  }>;

  // Results
  result?: unknown;
  error?: string;
}

export interface CheckpointCreateOptions {
  taskId: string;
  name: string;
  description?: string;
  state: TaskState;
  metadata?: Record<string, unknown>;
  parentId?: string;
}

interface CheckpointStore {
  checkpoints: Record<string, Checkpoint[]>;
  metadata: {
    version: number;
    lastUpdated: number;
  };
}

/**
 * Checkpoint Manager
 *
 * Manages task checkpoints for persistence and rollback.
 */
export class CheckpointManager {
  private dataDir: string;
  private checkpoints = new Map<string, Checkpoint[]>();
  private store: CheckpointStore = { checkpoints: {}, metadata: { version: 1, lastUpdated: Date.now() } };
  // Monotonic clock: guarantees strictly increasing timestamps even when two
  // checkpoints are created within the same millisecond, so newest-first
  // ordering is deterministic (see list/listAll).
  private lastTimestamp = 0;

  constructor(dataDir?: string) {
    this.dataDir = dataDir ?? join(infiniteHome(), 'checkpoints');
    this.load();
  }

  /**
   * Create a new checkpoint
   */
  create(options: CheckpointCreateOptions): Checkpoint {
    const now = Date.now();
    this.lastTimestamp = now > this.lastTimestamp ? now : this.lastTimestamp + 1;
    const checkpoint: Checkpoint = {
      id: randomUUID(),
      taskId: options.taskId,
      name: options.name,
      description: options.description,
      timestamp: this.lastTimestamp,
      state: options.state,
      metadata: options.metadata ?? {},
      parentId: options.parentId,
    };

    // Add to in-memory store
    const taskCheckpoints = this.checkpoints.get(options.taskId) ?? [];
    taskCheckpoints.push(checkpoint);
    this.checkpoints.set(options.taskId, taskCheckpoints);

    // Save to disk
    this.save();

    return checkpoint;
  }

  /**
   * Get a checkpoint by ID
   */
  get(checkpointId: string): Checkpoint | null {
    for (const checkpoints of this.checkpoints.values()) {
      const found = checkpoints.find((c) => c.id === checkpointId);
      if (found) return found;
    }
    return null;
  }

  /**
   * List checkpoints for a task
   */
  list(taskId: string, limit?: number): Checkpoint[] {
    const taskCheckpoints = this.checkpoints.get(taskId) ?? [];
    const sorted = taskCheckpoints.sort((a, b) => b.timestamp - a.timestamp);
    return limit ? sorted.slice(0, limit) : sorted;
  }

  /**
   * List all checkpoints
   */
  listAll(limit?: number): Checkpoint[] {
    const all: Checkpoint[] = [];
    for (const checkpoints of this.checkpoints.values()) {
      all.push(...checkpoints);
    }
    const sorted = all.sort((a, b) => b.timestamp - a.timestamp);
    return limit ? sorted.slice(0, limit) : sorted;
  }

  /**
   * Delete a checkpoint
   */
  delete(checkpointId: string): boolean {
    for (const [taskId, checkpoints] of this.checkpoints.entries()) {
      const index = checkpoints.findIndex((c) => c.id === checkpointId);
      if (index !== -1) {
        checkpoints.splice(index, 1);
        if (checkpoints.length === 0) {
          this.checkpoints.delete(taskId);
        }
        this.save();
        return true;
      }
    }
    return false;
  }

  /**
   * Delete all checkpoints for a task
   */
  deleteTask(taskId: string): void {
    this.checkpoints.delete(taskId);
    this.save();
  }

  /**
   * Compare two checkpoints
   */
  diff(
    checkpointId1: string,
    checkpointId2: string,
  ): {
    checkpoint1: Checkpoint;
    checkpoint2: Checkpoint;
    differences: string[];
  } | null {
    const cp1 = this.get(checkpointId1);
    const cp2 = this.get(checkpointId2);

    if (!cp1 || !cp2) return null;

    const differences: string[] = [];

    // Compare state
    if (cp1.state.status !== cp2.state.status) {
      differences.push(`Status: ${cp1.state.status} → ${cp2.state.status}`);
    }
    if (cp1.state.progress !== cp2.state.progress) {
      differences.push(`Progress: ${cp1.state.progress}% → ${cp2.state.progress}%`);
    }
    if (cp1.state.currentStep !== cp2.state.currentStep) {
      differences.push(`Step: ${cp1.state.currentStep} → ${cp2.state.currentStep}`);
    }

    // Compare variables
    const vars1 = cp1.state.variables;
    const vars2 = cp2.state.variables;
    const allKeys = new Set([...Object.keys(vars1), ...Object.keys(vars2)]);
    for (const key of allKeys) {
      if (JSON.stringify(vars1[key]) !== JSON.stringify(vars2[key])) {
        differences.push(`Variable "${key}" changed`);
      }
    }

    // Compare history length
    if (cp1.state.history.length !== cp2.state.history.length) {
      differences.push(`History: ${cp1.state.history.length} → ${cp2.state.history.length} messages`);
    }

    // Compare modified files
    const files1 = cp1.state.modifiedFiles ?? [];
    const files2 = cp2.state.modifiedFiles ?? [];
    if (files1.length !== files2.length) {
      differences.push(`Modified files: ${files1.length} → ${files2.length}`);
    }

    return { checkpoint1: cp1, checkpoint2: cp2, differences };
  }

  /**
   * Rollback to a checkpoint
   * Returns the restored state
   */
  rollback(checkpointId: string): {
    success: boolean;
    state?: TaskState;
    rollbackActions?: string[];
    error?: string;
  } {
    const checkpoint = this.get(checkpointId);
    if (!checkpoint) {
      return { success: false, error: 'Checkpoint not found' };
    }

    const state = checkpoint.state;
    const rollbackActions: string[] = [];

    // Handle file rollback
    if (state.modifiedFiles) {
      for (const file of state.modifiedFiles) {
        try {
          if (file.operation === 'create') {
            if (existsSync(file.path)) unlinkSync(file.path);
            rollbackActions.push(`Removed created file: ${file.path}`);
          } else if (file.operation === 'delete' && file.originalContent !== undefined) {
            // Restore deleted file
            writeFileSync(file.path, file.originalContent, 'utf-8');
            rollbackActions.push(`Restored file: ${file.path}`);
          } else if (file.operation === 'modify' && file.originalContent !== undefined) {
            // Restore modified file
            writeFileSync(file.path, file.originalContent, 'utf-8');
            rollbackActions.push(`Reverted file: ${file.path}`);
          }
        } catch {
          rollbackActions.push(`Failed to rollback: ${file.path}`);
        }
      }
    }

    return {
      success: true,
      state: {
        ...state,
        status: 'paused',
      },
      rollbackActions,
    };
  }

  /**
   * Get checkpoint statistics
   */
  getStats(): {
    totalCheckpoints: number;
    tasksWithCheckpoints: number;
    oldestCheckpoint: number | null;
    newestCheckpoint: number | null;
  } {
    let total = 0;
    let oldest: number | null = null;
    let newest: number | null = null;

    for (const checkpoints of this.checkpoints.values()) {
      total += checkpoints.length;
      for (const cp of checkpoints) {
        if (oldest === null || cp.timestamp < oldest) oldest = cp.timestamp;
        if (newest === null || cp.timestamp > newest) newest = cp.timestamp;
      }
    }

    return {
      totalCheckpoints: total,
      tasksWithCheckpoints: this.checkpoints.size,
      oldestCheckpoint: oldest,
      newestCheckpoint: newest,
    };
  }

  /**
   * Save checkpoints to disk
   */
  private save(): void {
    try {
      this.ensureDir();

      // Convert Map to object for JSON serialization
      const obj: Record<string, Checkpoint[]> = {};
      for (const [taskId, checkpoints] of this.checkpoints) {
        obj[taskId] = checkpoints;
      }

      this.store = {
        checkpoints: obj,
        metadata: { version: 1, lastUpdated: Date.now() },
      };

      writeFileSync(join(this.dataDir, 'checkpoints.json'), JSON.stringify(this.store, null, 2));
    } catch (err) {
      console.error('[CheckpointManager] Failed to save:', err);
    }
  }

  /**
   * Load checkpoints from disk
   */
  private load(): void {
    try {
      this.ensureDir();
      const filePath = join(this.dataDir, 'checkpoints.json');

      if (existsSync(filePath)) {
        const data = JSON.parse(readFileSync(filePath, 'utf-8')) as CheckpointStore;
        this.store = data;

        // Convert object back to Map
        this.checkpoints = new Map(Object.entries(data.checkpoints ?? {}));
      }
    } catch (err) {
      console.error('[CheckpointManager] Failed to load:', err);
    }
  }

  private ensureDir(): void {
    if (!existsSync(this.dataDir)) {
      mkdirSync(this.dataDir, { recursive: true });
    }
  }
}

// Singleton instance
let manager: CheckpointManager | null = null;

export function getCheckpointManager(): CheckpointManager {
  if (!manager) {
    manager = new CheckpointManager();
  }
  return manager;
}
