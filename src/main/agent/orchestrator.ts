// Task Orchestrator — analyzes complex requests, breaks them into sub-tasks,
// and deploys specialized agents. Runs autonomously until completion.

import { v4 as uuid } from 'uuid';
import type { AgentId, AgentRunState, AgentEvent } from '../agents/types.js';
import { spawnSubagent } from './runtime.js';
import { selectBestModel, getModelNotification } from '../providers/model-selector.js';

export interface OrchestratorTask {
  id: string;
  originalPrompt: string;
  subTasks: SubTask[];
  status: 'analyzing' | 'deploying' | 'running' | 'completed' | 'failed';
  modelSelection: { provider: string; model: string; free: boolean };
  paidModelNotification?: string;
  startedAt: number;
  completedAt?: number;
  results: Map<string, string>;
  errors: string[];
}

export interface SubTask {
  id: string;
  agentType: AgentId;
  description: string;
  dependencies: string[]; // IDs of sub-tasks that must complete first
  status: 'pending' | 'running' | 'completed' | 'failed';
  result?: string;
  error?: string;
  runState?: AgentRunState;
}

export interface OrchestratorEvent {
  type: 'task_analyzed' | 'subtask_deployed' | 'subtask_completed' | 'subtask_failed' | 'task_completed' | 'task_failed' | 'model_selected' | 'paid_model_warning';
  taskId: string;
  data: unknown;
}

type EventSink = (e: OrchestratorEvent) => void;

export class TaskOrchestrator {
  private tasks = new Map<string, OrchestratorTask>();
  private interjections = new Map<string, string[]>(); // taskId -> pending user messages

  constructor() {}

  /**
   * Analyze a big prompt and break it into sub-tasks.
   * Returns the orchestrated task with sub-tasks identified.
   */
  analyze(prompt: string, availableProviders: Map<string, { apiKey?: string; baseUrl?: string }>): OrchestratorTask {
    const task: OrchestratorTask = {
      id: uuid(),
      originalPrompt: prompt,
      subTasks: [],
      status: 'analyzing',
      modelSelection: { provider: 'openrouter', model: 'meta-llama/llama-3.3-70b-instruct:free', free: true },
      startedAt: Date.now(),
      results: new Map(),
      errors: [],
    };

    // Select best model for the overall task
    const selection = selectBestModel(this.classifyTask(prompt), availableProviders);
    task.modelSelection = { provider: selection.provider, model: selection.model, free: selection.free };
    if (!selection.free) {
      task.paidModelNotification = getModelNotification(selection) ?? undefined;
    }

    // Break down the task
    task.subTasks = this.decomposeTask(prompt, task.id);
    task.status = 'deploying';

    this.tasks.set(task.id, task);
    return task;
  }

  /**
   * Execute the full orchestrated task autonomously.
   * Deploys agents, monitors progress, handles failures.
   */
  async execute(
    taskId: string,
    sessionId: string,
    cwd: string,
    sink: EventSink,
  ): Promise<OrchestratorTask> {
    const task = this.tasks.get(taskId);
    if (!task) throw new Error(`Unknown task: ${taskId}`);

    const { provider, model } = task.modelSelection;

    // Deploy agents for tasks with no dependencies first
    const ready = task.subTasks.filter((st) => st.dependencies.length === 0);
    for (const subTask of ready) {
      this.deploySubTask(task, subTask, sessionId, cwd, provider, model, sink);
    }

    // Monitor and deploy dependent tasks as dependencies complete
    while (task.status === 'deploying' || task.status === 'running') {
      // Check for user interjections
      const pendingInterjections = this.interjections.get(taskId) ?? [];
      while (pendingInterjections.length > 0) {
        const msg = pendingInterjections.shift()!;
        this.handleInterjection(task, msg, sink);
      }

      // Check completed sub-tasks
      const completed = task.subTasks.filter((st) => st.status === 'completed' || st.status === 'failed');
      for (const st of completed) {
        if (st.status === 'completed') {
          task.results.set(st.id, st.result ?? '');
        } else {
          task.errors.push(`Sub-task "${st.description}" failed: ${st.error}`);
        }
      }

      // Deploy newly ready sub-tasks
      const pending = task.subTasks.filter((st) => st.status === 'pending');
      for (const subTask of pending) {
        const depsComplete = subTask.dependencies.every((depId) => {
          const dep = task.subTasks.find((s) => s.id === depId);
          return dep?.status === 'completed';
        });
        const depsFailed = subTask.dependencies.some((depId) => {
          const dep = task.subTasks.find((s) => s.id === depId);
          return dep?.status === 'failed';
        });

        if (depsFailed) {
          subTask.status = 'failed';
          subTask.error = 'Dependency failed';
          task.errors.push(`Sub-task "${subTask.description}" skipped: dependency failed`);
          continue;
        }

        if (depsComplete) {
          this.deploySubTask(task, subTask, sessionId, cwd, provider, model, sink);
        }
      }

      // Check if all sub-tasks are done
      const allDone = task.subTasks.every((st) => st.status === 'completed' || st.status === 'failed');
      if (allDone) {
        break;
      }

      // Wait before polling again
      await new Promise((r) => setTimeout(r, 1000));
    }

    // Final status
    const failedCount = task.subTasks.filter((st) => st.status === 'failed').length;
    task.status = failedCount === task.subTasks.length ? 'failed' : 'completed';
    task.completedAt = Date.now();

    sink({
      type: task.status === 'completed' ? 'task_completed' : 'task_failed',
      taskId: task.id,
      data: {
        totalSubTasks: task.subTasks.length,
        completed: task.subTasks.filter((st) => st.status === 'completed').length,
        failed: failedCount,
        duration: task.completedAt - task.startedAt,
      },
    });

    return task;
  }

  /**
   * User sends a message while the orchestrator is running.
   * The interjection is processed and may modify ongoing work.
   */
  interject(taskId: string, message: string): void {
    const existing = this.interjections.get(taskId) ?? [];
    existing.push(message);
    this.interjections.set(taskId, existing);
  }

  getTask(taskId: string): OrchestratorTask | undefined {
    return this.tasks.get(taskId);
  }

  getActiveTasks(): OrchestratorTask[] {
    return Array.from(this.tasks.values()).filter(
      (t) => t.status === 'deploying' || t.status === 'running'
    );
  }

  // --- Private helpers ---

  private classifyTask(prompt: string): 'code' | 'research' | 'design' | 'data' | 'seo' | 'general' {
    const lower = prompt.toLowerCase();
    if (lower.includes('build') || lower.includes('code') || lower.includes('app') || lower.includes('api') || lower.includes('function')) return 'code';
    if (lower.includes('research') || lower.includes('analyze') || lower.includes('find') || lower.includes('compare')) return 'research';
    if (lower.includes('design') || lower.includes('ui') || lower.includes('css') || lower.includes('layout')) return 'design';
    if (lower.includes('data') || lower.includes('csv') || lower.includes('database') || lower.includes('sql')) return 'data';
    if (lower.includes('seo') || lower.includes('ranking') || lower.includes('keyword')) return 'seo';
    return 'general';
  }

  private decomposeTask(prompt: string, _taskId: string): SubTask[] {
    const lower = prompt.toLowerCase();
    const subTasks: SubTask[] = [];

    // Detect if this is a website/app building task
    const isBuildTask = lower.includes('build') || lower.includes('create') || lower.includes('make') || lower.includes('develop');
    const isWebsite = lower.includes('website') || lower.includes('web app') || lower.includes('landing page') || lower.includes('dashboard');
    const isApp = lower.includes('app') || lower.includes('application') || lower.includes('software');

    if (isBuildTask && (isWebsite || isApp)) {
      // Decompose into phases

      // Phase 1: Research & Planning
      const researchId = uuid();
      subTasks.push({
        id: researchId,
        agentType: 'research',
        description: 'Research best practices, tech stack, and architecture for the project',
        dependencies: [],
        status: 'pending',
      });

      // Phase 2: Code (depends on research)
      const codeId = uuid();
      subTasks.push({
        id: codeId,
        agentType: 'code',
        description: 'Implement the core code, file structure, and functionality',
        dependencies: [researchId],
        status: 'pending',
      });

      // Phase 3: Design (depends on research, can run parallel with code)
      const designId = uuid();
      subTasks.push({
        id: designId,
        agentType: 'design',
        description: 'Create UI components, styling, and responsive layout',
        dependencies: [researchId],
        status: 'pending',
      });

      // Phase 4: SEO (depends on code and design)
      if (isWebsite) {
        const seoId = uuid();
        subTasks.push({
          id: seoId,
          agentType: 'seo',
          description: 'Optimize for search engines, meta tags, performance',
          dependencies: [codeId, designId],
          status: 'pending',
        });
      }
    } else {
      // Generic decomposition: assign to the most appropriate agent type
      const taskType = this.classifyTask(prompt);
      const agentType = taskType === 'general' ? 'general' : taskType;

      subTasks.push({
        id: uuid(),
        agentType,
        description: prompt,
        dependencies: [],
        status: 'pending',
      });
    }

    return subTasks;
  }

  private deploySubTask(
    task: OrchestratorTask,
    subTask: SubTask,
    sessionId: string,
    cwd: string,
    provider: string,
    model: string,
    sink: EventSink,
  ): void {
    subTask.status = 'running';
    task.status = 'running';

    const sink2 = (e: AgentEvent) => {
      if (e.type === 'complete') {
        subTask.status = 'completed';
        subTask.result = typeof e.result === 'string' ? e.result : 'Completed successfully';
        sink({ type: 'subtask_completed', taskId: task.id, data: { subTaskId: subTask.id, result: subTask.result } });
      } else if (e.type === 'fail') {
        subTask.status = 'failed';
        subTask.error = typeof e.error === 'string' ? e.error : 'Unknown error';
        sink({ type: 'subtask_failed', taskId: task.id, data: { subTaskId: subTask.id, error: subTask.error } });
      }
    };

    const { state, done } = spawnSubagent({
      agentId: subTask.agentType,
      task: subTask.description,
      sessionId,
      cwd,
      model,
      provider,
      parentHistory: [],
      sink: sink2,
      background: true,
    });

    subTask.runState = state;
    done.catch(() => {});

    sink({ type: 'subtask_deployed', taskId: task.id, data: { subTaskId: subTask.id, agentType: subTask.agentType, description: subTask.description } });
  }

  private handleInterjection(task: OrchestratorTask, message: string, sink: EventSink): void {
    // Find running sub-tasks and inject context
    // The interjection becomes additional context for the next sub-task deployment
    for (const st of task.subTasks) {
      if (st.status === 'pending') {
        st.description += `\n\n[User update]: ${message}`;
      }
    }

    sink({
      type: 'subtask_deployed',
      taskId: task.id,
      data: { interjection: message, affectedPendingTasks: task.subTasks.filter((s) => s.status === 'pending').length },
    });
  }
}

// Singleton
export const orchestrator = new TaskOrchestrator();

