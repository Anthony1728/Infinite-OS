/**
 * Task Queue System
 * 
 * Provides priority-based task queue with background worker execution.
 */

import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

export interface QueuedTask {
  id: string;
  queueId: string;
  type: string;
  data: Record<string, unknown>;
  priority: number; // Higher = more priority
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  result?: unknown;
  error?: string;
  retries: number;
  maxRetries: number;
}

export interface Queue {
  id: string;
  name: string;
  priority: number; // Queue priority multiplier
  createdAt: number;
  taskCount: number;
  isPaused: boolean;
}

export interface QueueStats {
  totalQueues: number;
  totalTasks: number;
  pendingTasks: number;
  processingTasks: number;
  completedTasks: number;
  failedTasks: number;
}

/**
 * Task Queue Manager
 * 
 * Manages multiple priority queues with background processing.
 */
export class TaskQueueManager extends EventEmitter {
  private dataDir: string;
  private queues = new Map<string, Queue>();
  private tasks = new Map<string, QueuedTask>();
  private taskOrder: string[] = []; // Ordered by priority
  private isProcessing = false;
  private workerInterval: ReturnType<typeof setInterval> | null = null;

  constructor(dataDir?: string) {
    super();
    this.dataDir = dataDir ?? join(homedir(), '.infinite-ai', 'queues');
    this.load();
  }

  /**
   * Create a new queue
   */
  createQueue(name: string, priority: number = 0): Queue {
    const queue: Queue = {
      id: randomUUID(),
      name,
      priority,
      createdAt: Date.now(),
      taskCount: 0,
      isPaused: false,
    };

    this.queues.set(queue.id, queue);
    this.save();
    
    this.emit('queueCreated', queue);
    return queue;
  }

  /**
   * Get a queue by ID
   */
  getQueue(queueId: string): Queue | null {
    return this.queues.get(queueId) ?? null;
  }

  /**
   * List all queues
   */
  listQueues(): Queue[] {
    return Array.from(this.queues.values());
  }

  /**
   * Delete a queue
   */
  deleteQueue(queueId: string): boolean {
    const queue = this.queues.get(queueId);
    if (!queue) return false;

    // Remove all tasks in this queue
    for (const [taskId, task] of this.tasks) {
      if (task.queueId === queueId) {
        this.tasks.delete(taskId);
        const orderIndex = this.taskOrder.indexOf(taskId);
        if (orderIndex !== -1) {
          this.taskOrder.splice(orderIndex, 1);
        }
      }
    }

    this.queues.delete(queueId);
    this.save();
    
    this.emit('queueDeleted', { queueId });
    return true;
  }

  /**
   * Pause/resume a queue
   */
  setQueuePaused(queueId: string, paused: boolean): boolean {
    const queue = this.queues.get(queueId);
    if (!queue) return false;

    queue.isPaused = paused;
    this.save();
    
    this.emit('queuePaused', { queueId, paused });
    return true;
  }

  /**
   * Add a task to a queue
   */
  enqueue(queueId: string, type: string, data: Record<string, unknown>, priority: number = 0): QueuedTask | null {
    const queue = this.queues.get(queueId);
    if (!queue) return null;

    const task: QueuedTask = {
      id: randomUUID(),
      queueId,
      type,
      data,
      priority: priority + queue.priority, // Combine task and queue priority
      status: 'pending',
      createdAt: Date.now(),
      retries: 0,
      maxRetries: 3,
    };

    this.tasks.set(task.id, task);
    this.insertTaskOrder(task.id);
    queue.taskCount++;
    
    this.save();
    this.emit('taskEnqueued', task);

    return task;
  }

  /**
   * Get next task to process (highest priority)
   */
  dequeue(queueId?: string): QueuedTask | null {
    // Find first available task
    for (const taskId of this.taskOrder) {
      const task = this.tasks.get(taskId);
      if (!task) continue;
      if (task.status !== 'pending') continue;
      
      // Check if queue is paused
      const queue = this.queues.get(task.queueId);
      if (queue?.isPaused) continue;
      
      // Filter by specific queue if provided
      if (queueId && task.queueId !== queueId) continue;

      task.status = 'processing';
      task.startedAt = Date.now();
      
      this.save();
      this.emit('taskDequeued', task);
      
      return task;
    }
    
    return null;
  }

  /**
   * Peek at next task without removing it
   */
  peek(queueId?: string): QueuedTask | null {
    for (const taskId of this.taskOrder) {
      const task = this.tasks.get(taskId);
      if (!task) continue;
      if (task.status !== 'pending') continue;
      
      const queue = this.queues.get(task.queueId);
      if (queue?.isPaused) continue;
      
      if (queueId && task.queueId !== queueId) continue;

      return task;
    }
    
    return null;
  }

  /**
   * Get a task by ID
   */
  getTask(taskId: string): QueuedTask | null {
    return this.tasks.get(taskId) ?? null;
  }

  /**
   * Complete a task
   */
  completeTask(taskId: string, result: unknown): boolean {
    const task = this.tasks.get(taskId);
    if (!task) return false;

    task.status = 'completed';
    task.completedAt = Date.now();
    task.result = result;
    
    this.save();
    this.emit('taskCompleted', task);
    
    return true;
  }

  /**
   * Fail a task
   */
  failTask(taskId: string, error: string): boolean {
    const task = this.tasks.get(taskId);
    if (!task) return false;

    task.retries++;
    
    if (task.retries < task.maxRetries) {
      // Reset to pending for retry
      task.status = 'pending';
      task.error = error;
      // Re-insert to back of priority queue
      const index = this.taskOrder.indexOf(taskId);
      if (index !== -1) {
        this.taskOrder.splice(index, 1);
      }
      this.insertTaskOrder(taskId);
      
      this.emit('taskRetry', task);
    } else {
      task.status = 'failed';
      task.completedAt = Date.now();
      task.error = error;
      
      this.emit('taskFailed', task);
    }
    
    this.save();
    return true;
  }

  /**
   * Cancel a task
   */
  cancelTask(taskId: string): boolean {
    const task = this.tasks.get(taskId);
    if (!task) return false;
    if (task.status === 'processing') return false; // Can't cancel in-progress

    task.status = 'cancelled';
    task.completedAt = Date.now();
    
    // Remove from order
    const index = this.taskOrder.indexOf(taskId);
    if (index !== -1) {
      this.taskOrder.splice(index, 1);
    }
    
    this.save();
    this.emit('taskCancelled', task);
    
    return true;
  }

  /**
   * Get queue status
   */
  getQueueStatus(queueId: string): {
    queue: Queue;
    pending: number;
    processing: number;
    completed: number;
    failed: number;
  } | null {
    const queue = this.queues.get(queueId);
    if (!queue) return null;

    let pending = 0, processing = 0, completed = 0, failed = 0;
    
    for (const task of this.tasks.values()) {
      if (task.queueId !== queueId) continue;
      switch (task.status) {
        case 'pending': pending++; break;
        case 'processing': processing++; break;
        case 'completed': completed++; break;
        case 'failed': failed++; break;
      }
    }

    return { queue, pending, processing, completed, failed };
  }

  /**
   * Get overall statistics
   */
  getStats(): QueueStats {
    let pending = 0, processing = 0, completed = 0, failed = 0;
    
    for (const task of this.tasks.values()) {
      switch (task.status) {
        case 'pending': pending++; break;
        case 'processing': processing++; break;
        case 'completed': completed++; break;
        case 'failed': failed++; break;
      }
    }

    return {
      totalQueues: this.queues.size,
      totalTasks: this.tasks.size,
      pendingTasks: pending,
      processingTasks: processing,
      completedTasks: completed,
      failedTasks: failed,
    };
  }

  /**
   * Start background worker
   */
  startWorker(processor: (task: QueuedTask) => Promise<void>, interval: number = 1000): void {
    if (this.workerInterval) return;

    this.isProcessing = true;
    this.workerInterval = setInterval(async () => {
      if (!this.isProcessing) return;

      const task = this.dequeue();
      if (!task) return;

      try {
        await processor(task);
        this.completeTask(task.id, { success: true });
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        this.failTask(task.id, error);
      }
    }, interval);

    this.emit('workerStarted');
  }

  /**
   * Stop background worker
   */
  stopWorker(): void {
    this.isProcessing = false;
    if (this.workerInterval) {
      clearInterval(this.workerInterval);
      this.workerInterval = null;
    }
    this.emit('workerStopped');
  }

  /**
   * Insert task into priority order
   */
  private insertTaskOrder(taskId: string): void {
    const task = this.tasks.get(taskId);
    if (!task) return;

    // Find position based on priority
    for (let i = 0; i < this.taskOrder.length; i++) {
      const existingTask = this.tasks.get(this.taskOrder[i]);
      if (existingTask && existingTask.priority < task.priority) {
        this.taskOrder.splice(i, 0, taskId);
        return;
      }
    }

    this.taskOrder.push(taskId);
  }

  /**
   * Save to disk
   */
  private save(): void {
    try {
      if (!existsSync(this.dataDir)) {
        mkdirSync(this.dataDir, { recursive: true });
      }

      const data = {
        queues: Array.from(this.queues.values()),
        tasks: Array.from(this.tasks.values()),
        taskOrder: this.taskOrder,
      };

      writeFileSync(
        join(this.dataDir, 'queues.json'),
        JSON.stringify(data, null, 2)
      );
    } catch (err) {
      console.error('[TaskQueueManager] Failed to save:', err);
    }
  }

  /**
   * Load from disk
   */
  private load(): void {
    try {
      if (!existsSync(this.dataDir)) return;

      const filePath = join(this.dataDir, 'queues.json');
      if (!existsSync(filePath)) return;

      const data = JSON.parse(readFileSync(filePath, 'utf-8')) as {
        queues: Queue[];
        tasks: QueuedTask[];
        taskOrder: string[];
      };

      for (const queue of data.queues) {
        this.queues.set(queue.id, queue);
      }

      for (const task of data.tasks) {
        this.tasks.set(task.id, task);
      }

      this.taskOrder = data.taskOrder;
    } catch (err) {
      console.error('[TaskQueueManager] Failed to load:', err);
    }
  }
}

// Singleton
let manager: TaskQueueManager | null = null;

export function getTaskQueueManager(): TaskQueueManager {
  if (!manager) {
    manager = new TaskQueueManager();
  }
  return manager;
}