/**
 * Shared, versioned task lifecycle contract.
 *
 * This module is intentionally dependency-free so the agent orchestrator,
 * crews, automations, and recovery code can adopt one state model without
 * importing one another. Persistence is owned by the task service, not here.
 */

export const TASK_CONTRACT_VERSION = 1 as const;

export type TaskStatus =
  | 'queued'
  | 'planning'
  | 'awaiting_approval'
  | 'ready'
  | 'running'
  | 'verifying'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'interrupted';

export type TaskTerminalStatus = Extract<TaskStatus, 'completed' | 'failed' | 'cancelled'>;

export interface TaskRecord {
  contractVersion: typeof TASK_CONTRACT_VERSION;
  id: string;
  sessionId: string;
  parentTaskId: string | null;
  objective: string;
  workspace: string;
  status: TaskStatus;
  planRevision: number;
  createdAt: number;
  updatedAt: number;
  startedAt: number | null;
  completedAt: number | null;
  attempt: number;
  maxAttempts: number;
  cancelRequested: boolean;
  failure: string | null;
}

export type TaskEventType =
  | 'task.created'
  | 'task.transitioned'
  | 'task.plan_revised'
  | 'task.cancel_requested'
  | 'task.attempt_started'
  | 'task.interrupted'
  | 'task.resumed';

export interface TaskEvent {
  contractVersion: typeof TASK_CONTRACT_VERSION;
  id: string;
  taskId: string;
  sequence: number;
  type: TaskEventType;
  occurredAt: number;
  payload: Record<string, unknown>;
}

export interface ExecutionAttempt {
  id: string;
  taskId: string;
  attempt: number;
  agentId: string;
  provider: string;
  model: string;
  startedAt: number;
  finishedAt: number | null;
  outcome: 'running' | 'succeeded' | 'failed' | 'cancelled';
  failure: string | null;
}

export interface VerificationEvidence {
  id: string;
  taskId: string;
  attemptId: string;
  verifier: string;
  description: string;
  outcome: 'passed' | 'failed' | 'not_verifiable';
  startedAt: number;
  finishedAt: number;
  detail: string;
}

export interface TaskArtifact {
  id: string;
  taskId: string;
  attemptId: string;
  kind: 'file' | 'url' | 'text' | 'structured_data';
  name: string;
  location: string | null;
  mediaType: string | null;
  createdAt: number;
}

const TRANSITIONS: Readonly<Record<TaskStatus, readonly TaskStatus[]>> = {
  queued: ['planning', 'cancelled'],
  planning: ['awaiting_approval', 'ready', 'failed', 'cancelled', 'interrupted'],
  awaiting_approval: ['ready', 'cancelled', 'failed', 'interrupted'],
  ready: ['running', 'cancelled', 'failed', 'interrupted'],
  running: ['verifying', 'failed', 'cancelled', 'interrupted'],
  verifying: ['running', 'completed', 'failed', 'cancelled', 'interrupted'],
  interrupted: ['planning', 'ready', 'running', 'cancelled', 'failed'],
  completed: [],
  failed: [],
  cancelled: [],
};

/** True only when a state transition is explicitly supported by the contract. */
export function canTransitionTask(from: TaskStatus, to: TaskStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

/**
 * Validate a transition and return the next immutable snapshot.
 * Terminal tasks cannot be reopened; retries must create a new task attempt
 * or an explicit child task rather than rewriting history.
 */
export function transitionTask(
  task: TaskRecord,
  next: TaskStatus,
  now = Date.now(),
  failure: string | null = null,
): TaskRecord {
  if (!canTransitionTask(task.status, next)) {
    throw new Error(`Invalid task transition: ${task.status} -> ${next}`);
  }
  if (!Number.isFinite(now) || now < task.updatedAt) {
    throw new Error('Task transition timestamp must be finite and monotonic.');
  }

  const startsNow = next === 'running' && task.startedAt === null;
  const terminal = next === 'completed' || next === 'failed' || next === 'cancelled';
  return {
    ...task,
    status: next,
    updatedAt: now,
    startedAt: startsNow ? now : task.startedAt,
    completedAt: terminal ? now : null,
    failure: next === 'failed' ? (failure?.trim() || 'Task failed without a recorded reason.') : null,
  };
}

/** Validate task dependency IDs and reject cycles before scheduling any work. */
export function validateTaskDependencies(
  tasks: ReadonlyArray<{ id: string; dependencies: readonly string[] }>,
): { valid: true; topologicalOrder: string[] } | { valid: false; errors: string[] } {
  const errors: string[] = [];
  const byId = new Map<string, { id: string; dependencies: readonly string[] }>();

  for (const task of tasks) {
    if (!task.id.trim()) errors.push('Task IDs must not be empty.');
    if (byId.has(task.id)) errors.push(`Duplicate task ID: ${task.id}`);
    byId.set(task.id, task);
  }

  for (const task of tasks) {
    const seen = new Set<string>();
    for (const dependency of task.dependencies) {
      if (dependency === task.id) errors.push(`Task ${task.id} cannot depend on itself.`);
      if (!byId.has(dependency)) errors.push(`Task ${task.id} has unknown dependency ${dependency}.`);
      if (seen.has(dependency)) errors.push(`Task ${task.id} repeats dependency ${dependency}.`);
      seen.add(dependency);
    }
  }

  if (errors.length) return { valid: false, errors };

  const indegree = new Map<string, number>();
  const dependents = new Map<string, string[]>();
  for (const task of tasks) {
    indegree.set(task.id, task.dependencies.length);
    for (const dependency of task.dependencies) {
      const list = dependents.get(dependency) ?? [];
      list.push(task.id);
      dependents.set(dependency, list);
    }
  }

  // Preserve declaration order among simultaneously ready nodes for stable tests.
  const ready = tasks.filter((task) => indegree.get(task.id) === 0).map((task) => task.id);
  const order: string[] = [];
  for (let index = 0; index < ready.length; index++) {
    const id = ready[index];
    order.push(id);
    for (const child of dependents.get(id) ?? []) {
      const remaining = (indegree.get(child) ?? 0) - 1;
      indegree.set(child, remaining);
      if (remaining === 0) ready.push(child);
    }
  }

  if (order.length !== tasks.length) {
    const cycleNodes = tasks.filter((task) => (indegree.get(task.id) ?? 0) > 0).map((task) => task.id);
    return { valid: false, errors: [`Dependency cycle detected involving: ${cycleNodes.join(', ')}`] };
  }
  return { valid: true, topologicalOrder: order };
}

/** A task is safe to resume only from a non-terminal interrupted state. */
export function canResumeTask(task: Pick<TaskRecord, 'status' | 'cancelRequested' | 'attempt' | 'maxAttempts'>): boolean {
  return task.status === 'interrupted'
    && !task.cancelRequested
    && task.attempt < task.maxAttempts;
}
