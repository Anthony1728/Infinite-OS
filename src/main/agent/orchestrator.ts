// Task Orchestrator — analyzes complex requests, breaks them into sub-tasks,
// and deploys specialized agents. Runs autonomously until completion.

import { v4 as uuid } from 'uuid';
import type { AgentId, AgentRunState, AgentEvent } from '../agents/types.js';
import { abortSubagent, spawnSubagent } from './runtime.js';
import { selectBestModel, getModelNotification } from '../providers/model-selector.js';
import { providerRegistry } from '../providers/registry.js';

export interface OrchestratorTask {
  id: string;
  originalPrompt: string;
  subTasks: SubTask[];
  status: 'analyzing' | 'deploying' | 'running' | 'completed' | 'failed' | 'cancelled';
  modelSelection: { provider: string; model: string; free: boolean };
  paidModelNotification?: string;
  startedAt: number;
  completedAt?: number;
  results: Map<string, string>;
  errors: string[];
  sessionId?: string;
  report?: OrchestratorReport;
}

export interface OrchestratorReport {
  status: 'completed' | 'failed' | 'cancelled';
  summary: string;
  completed: Array<{ description: string; result: string }>;
  failed: Array<{ description: string; error: string; attempts: number }>;
  retries: Array<{ description: string; attempt: number; reason: string }>;
  unresolved: string[];
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
  attempts?: number;
  failureHistory?: string[];
}

export interface OrchestratorEvent {
  type: 'task_analyzed' | 'task_updated' | 'subtask_deployed' | 'subtask_progress' | 'subtask_completed' | 'subtask_failed' | 'subtask_retrying' | 'task_completed' | 'task_failed' | 'model_selected' | 'paid_model_warning';
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
  analyze(
    prompt: string,
    availableProviders: Map<string, { apiKey?: string; baseUrl?: string }>,
    preferred?: { provider: string; model: string },
  ): OrchestratorTask {
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
    const taskType = this.classifyTask(prompt);
    if (preferred?.provider && preferred.model && this.modelSupportsTools(preferred.provider, preferred.model, taskType)) {
      task.modelSelection = {
        provider: preferred.provider,
        model: preferred.model,
        free: providerRegistry[preferred.provider]?.freeModels.some((item) => item.id === preferred.model && item.free) ?? false,
      };
    } else {
      const selection = selectBestModel(taskType, availableProviders);
      task.modelSelection = { provider: selection.provider, model: selection.model, free: selection.free };
      if (!selection.free) {
        task.paidModelNotification = getModelNotification(selection) ?? undefined;
      }
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
    task.sessionId = sessionId;

    const { provider, model } = task.modelSelection;
    const recorded = new Set<string>();
    const MAX_PARALLEL = 10;

    // Deploy all tasks with no dependencies immediately (up to MAX_PARALLEL)
    const ready = task.subTasks.filter((st) => st.dependencies.length === 0);
    let deployedCount = 0;
    for (const subTask of ready) {
      if (deployedCount >= MAX_PARALLEL) break;
      this.deploySubTask(task, subTask, sessionId, cwd, provider, model, sink);
      deployedCount++;
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
        if (recorded.has(st.id)) continue;
        recorded.add(st.id);
        if (st.status === 'completed') {
          task.results.set(st.id, st.result ?? '');
        } else {
          task.errors.push(`Sub-task "${st.description}" failed: ${st.error}`);
        }
      }

      // Count currently running tasks
      const runningCount = task.subTasks.filter((st) => st.status === 'running').length;

      // Deploy newly ready sub-tasks (up to MAX_PARALLEL)
      if (runningCount < MAX_PARALLEL) {
        const pending = task.subTasks.filter((st) => st.status === 'pending');
        for (const subTask of pending) {
          if (runningCount >= MAX_PARALLEL) break;

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
      }

      // Check if all sub-tasks are done
      const allDone = task.subTasks.every((st) => st.status === 'completed' || st.status === 'failed');
      if (allDone) {
        break;
      }

      // Wait before polling again
      await new Promise((r) => setTimeout(r, 100));
    }

    // Final status
    const failedCount = task.subTasks.filter((st) => st.status === 'failed').length;
    const completedCount = task.subTasks.filter((st) => st.status === 'completed').length;
    task.status = task.status === 'cancelled'
      ? 'cancelled'
      : failedCount === 0 && completedCount === task.subTasks.length ? 'completed' : 'failed';
    task.completedAt = Date.now();
    task.report = buildReport(task);

    sink({
      type: task.status === 'completed' ? 'task_completed' : 'task_failed',
      taskId: task.id,
      data: {
        totalSubTasks: task.subTasks.length,
        completed: completedCount,
        failed: failedCount,
        errors: task.errors,
        duration: task.completedAt - task.startedAt,
        report: task.report,
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

  cancelSession(sessionId: string): boolean {
    const tasks = this.getActiveTasks().filter((task) => task.sessionId === sessionId);
    for (const task of tasks) this.cancelTask(task);
    return tasks.length > 0;
  }

  cancelAll(): number {
    const tasks = this.getActiveTasks();
    for (const task of tasks) this.cancelTask(task);
    return tasks.length;
  }

  // --- Private helpers ---

  private cancelTask(task: OrchestratorTask): void {
    task.errors.push('Task cancelled by user.');
    task.status = 'cancelled';
    for (const subTask of task.subTasks) {
      if (subTask.runState?.id && subTask.status === 'running') abortSubagent(subTask.runState.id);
      if (subTask.status === 'running' || subTask.status === 'pending') {
        subTask.status = 'failed';
        subTask.error = 'Cancelled by user.';
      }
    }
  }

  private classifyTask(prompt: string): 'code' | 'research' | 'design' | 'data' | 'seo' | 'general' {
    const lower = prompt.toLowerCase();
    if (lower.includes('build') || lower.includes('code') || lower.includes('app') || lower.includes('api') || lower.includes('function')) return 'code';
    if (lower.includes('research') || lower.includes('analyze') || lower.includes('find') || lower.includes('compare')) return 'research';
    if (lower.includes('design') || lower.includes('ui') || lower.includes('css') || lower.includes('layout')) return 'design';
    if (lower.includes('data') || lower.includes('csv') || lower.includes('database') || lower.includes('sql')) return 'data';
    if (lower.includes('seo') || lower.includes('ranking') || lower.includes('keyword')) return 'seo';
    return 'general';
  }

  /**
   * Pick the single best agent for a task. Returns null when the task is truly
   * multi-part and should be decomposed. This prevents over-spawning agents for
   * straightforward requests like "send an email" or "search the web for X".
   */
  private pickBestAgent(prompt: string): AgentId | null {
    const lower = prompt.toLowerCase();

    // --- Single-domain tasks: return the best-fit agent directly ---
    // Email
    if (/\b(send|write|draft|compose|reply)\b.*\bemail\b|\bemail\b.*\b(send|write|draft|compose)\b/i.test(lower)) return 'general';
    if (/\bemail\b|\binbox\b|\bmail\b/i.test(lower) && !/\b(and|then|also|while|build|create)\b/.test(lower)) return 'general';

    // Security
    if (/\b(security|vulnerab|penetrat|渗透|hack|exploit|audit|compliance|secret.?scan)\b/i.test(lower)) return 'security';

    // DevOps / deployment
    if (/\b(deploy|docker|ci[/]?cd|pipeline|container|kubernetes|k8s|terraform|aws|gcp|azure|vercel|netlify)\b/i.test(lower)) return 'devops';

    // Writing / documentation
    if (/\b(write|draft|document|blog|article|essay|book|grant|proposal|copy|content)\b.*\b(doc|docu|article|blog|book|essay|page|post)\b/i.test(lower)) return 'writer';
    if (/\b(documentation|technical.?writing|readme|changelog)\b/i.test(lower)) return 'writer';

    // Finance
    if (/\b(financ|invoice|budget|tax|bookkeep|accounting|invoice|profit|revenue|expense)\b/i.test(lower)) return 'finance';

    // Marketing
    if (/\b(market|growth|campaign|seo|content.?market|social.?media|email.?market|brand)\b/i.test(lower)) return 'marketing';

    // Testing
    if (/\b(test|qa|quality|benchmark|performance.?test|load.?test|accessib|wcag)\b/i.test(lower)) return 'tester';

    // Architecture
    if (/\b(architect|system.?design|database.?design|api.?design|microservice|schema)\b/i.test(lower)) return 'architect';

    // Mobile
    if (/\b(mobile|ios|android|react.?native|flutter|swift|kotlin|app.?store)\b/i.test(lower)) return 'mobile';

    // AI/ML
    if (/\b(machine.?learn|ml|ai.?model|rag|llm|prompt.?engineer|fine.?tun|neural|deep.?learn)\b/i.test(lower)) return 'aieng';

    // Business
    if (/\b(business|crm|sales|lead|deal|pitch|strategy|project.?manage|roadmap)\b/i.test(lower)) return 'business';

    // Automation
    if (/\b(automate|workflow|schedule|cron|trigger|pipeline|batch.?process)\b/i.test(lower)) return 'automation';

    // Desktop / computer control
    if (/\b(desktop|mouse|keyboard|screenshot|screen|window|launch.?app|open.?app|computer)\b/i.test(lower)) return 'desktop';

    // Research
    if (/\b(research|analyze|compare|investigate|survey|review|summarize)\b/i.test(lower)) return 'research';

    // Code / build
    if (/\b(build|code|implement|develop|function|class|module|fix|bug|refactor|feature)\b/i.test(lower)) return 'code';

    // Design
    if (/\b(design|ui|ux|css|style|layout|responsive|mockup|wireframe)\b/i.test(lower)) return 'design';

    // Data
    if (/\b(data|csv|database|sql|query|dataset|analytics|dashboard)\b/i.test(lower)) return 'data';

    return null; // truly ambiguous → may need decomposition
  }

  private modelSupportsTools(providerId: string, model: string, taskType: ReturnType<TaskOrchestrator['classifyTask']>): boolean {
    if (taskType === 'general' || taskType === 'research' || taskType === 'seo') return true;
    const provider = providerRegistry[providerId];
    if (!provider) return false;
    const knownModel = provider.freeModels.find((item) => item.id === model);
    return knownModel?.supports_tools !== false;
  }

  private decomposeTask(prompt: string, _taskId: string): SubTask[] {
    const lower = prompt.toLowerCase();
    const subTasks: SubTask[] = [];

    // Detect if this is a website/app building task
    const isBuildTask = lower.includes('build') || lower.includes('create') || lower.includes('make') || lower.includes('develop');
    const isWebsite = lower.includes('website') || lower.includes('web app') || lower.includes('landing page') || lower.includes('dashboard');
    const isApp = lower.includes('app') || lower.includes('application') || lower.includes('software');
    const isResearch = lower.includes('research') || lower.includes('analyze') || lower.includes('compare') || lower.includes('investigate');
    const isMultiPart = lower.includes('and') || lower.includes('then') || lower.includes('also') || lower.includes('while');

    // PREFER single-agent: use pickBestAgent to find the best fit.
    // Only decompose for genuinely complex multi-phase build tasks.
    const bestAgent = this.pickBestAgent(prompt);

    if (isBuildTask && (isWebsite || isApp)) {
      // Genuinely complex: decompose into phases — research and planning can run in parallel

      // Phase 1: Research & Planning (can start immediately)
      const researchId = uuid();
      subTasks.push({
        id: researchId,
        agentType: 'research',
        description: 'Research best practices, tech stack, and architecture for the project',
        dependencies: [],
        status: 'pending',
      });

      // Phase 2: Core implementation (depends on research)
      const codeId = uuid();
      subTasks.push({
        id: codeId,
        agentType: 'code',
        description: 'Implement the core code, file structure, and functionality',
        dependencies: [researchId],
        status: 'pending',
      });

      // Phase 3: Design polish runs after the core implementation. Serialising
      // workspace edits prevents two agents from overwriting the same files.
      const designId = uuid();
      subTasks.push({
        id: designId,
        agentType: 'design',
        description: 'Create UI components, styling, and responsive layout',
        dependencies: [codeId],
        status: 'pending',
      });

      let finalImplementationId = designId;

      // Phase 4: implement website-specific accessibility, metadata and
      // performance work with an agent that can actually edit the project.
      if (isWebsite) {
        const seoId = uuid();
        subTasks.push({
          id: seoId,
          agentType: 'code',
          description: 'Implement accessibility, metadata, SEO, and performance improvements in the project',
          dependencies: [designId],
          status: 'pending',
        });
        finalImplementationId = seoId;
      }

      // The last phase must run the real validation commands, inspect the
      // completed artifact, and fix clear defects before the task can pass.
      subTasks.push({
        id: uuid(),
        agentType: 'code',
        description: 'Audit the complete implementation against the original request, run the relevant tests/build/lint, fix failures, and verify the final artifact',
        dependencies: [finalImplementationId],
        status: 'pending',
      });
    } else if (bestAgent) {
      // Single-agent path: the best agent handles the entire task directly.
      // No decomposition, no over-spawning.
      subTasks.push({
        id: uuid(),
        agentType: bestAgent,
        description: prompt,
        dependencies: [],
        status: 'pending',
      });
    } else if (isMultiPart || isResearch) {
      // Multi-part task: try to split into independent subtasks
      // Look for patterns like "X and Y and Z" or "X, Y, Z"
      const parts = this.splitMultiPartTask(prompt);
      if (parts.length > 1 && parts.length <= 4) {
        // Only decompose if there are 2-4 clearly distinct parts
        for (const part of parts) {
          const taskType = this.classifyTask(part);
          const agentType = taskType === 'general' ? 'general' : taskType;
          subTasks.push({
            id: uuid(),
            agentType,
            description: part.trim(),
            dependencies: [],
            status: 'pending',
          });
        }
      } else {
        // Too many parts or unsplitable — use general agent
        subTasks.push({
          id: uuid(),
          agentType: 'general',
          description: prompt,
          dependencies: [],
          status: 'pending',
        });
      }
    } else {
      // Generic: assign to the most appropriate agent type
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

  /**
   * Split a multi-part task into independent subtasks.
   * Handles patterns like "X and Y", "X, Y, Z", "X; Y; Z".
   */
  private splitMultiPartTask(prompt: string): string[] {
    // Try splitting by semicolons first
    if (prompt.includes(';')) {
      return prompt.split(';').map((s) => s.trim()).filter(Boolean);
    }

    // Try splitting by " and " patterns
    const andParts = prompt.split(/\s+and\s+/i);
    if (andParts.length > 1) {
      return andParts.map((s) => s.trim()).filter(Boolean);
    }

    // Try splitting by commas (only if 3+ items)
    const commaParts = prompt.split(',').map((s) => s.trim()).filter(Boolean);
    if (commaParts.length >= 3) {
      return commaParts;
    }

    return [prompt];
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
    subTask.attempts = (subTask.attempts ?? 0) + 1;
    subTask.status = 'running';
    task.status = 'running';

    const sink2 = (e: AgentEvent) => {
      if (e.type === 'complete') {
        subTask.status = 'completed';
        subTask.result = typeof e.result === 'string' ? e.result : 'Completed successfully';
        sink({ type: 'subtask_completed', taskId: task.id, data: { subTaskId: subTask.id, result: subTask.result } });
      } else if (e.type === 'fail') {
        const error = typeof e.error === 'string' ? e.error : 'Unknown error';
        if (this.shouldRetry(task, subTask, error)) {
          this.scheduleRetry(task, subTask, error, sink);
          return;
        }
        subTask.status = 'failed';
        subTask.error = error;
        sink({ type: 'subtask_failed', taskId: task.id, data: { subTaskId: subTask.id, error: subTask.error } });
      } else if (e.type === 'activity' || e.type === 'text_delta' || e.type === 'tool_call' || e.type === 'retrying') {
        sink({ type: 'subtask_progress', taskId: task.id, data: { subTaskId: subTask.id, agentType: subTask.agentType, event: e } });
      }
    };

    const dependencyContext = subTask.dependencies
      .map((dependencyId) => task.subTasks.find((item) => item.id === dependencyId))
      .filter((dependency): dependency is SubTask => Boolean(dependency))
      .map((dependency) => {
        const result = dependency.result?.trim() || '(phase completed without a written report)';
        return `### ${dependency.description}\n${result.slice(0, 12_000)}`;
      })
      .join('\n\n');
    const effectiveTask = [
      '# Original user request',
      task.originalPrompt,
      '',
      '# Your assigned phase',
      subTask.description,
      dependencyContext ? `\n# Completed dependency reports\n${dependencyContext}` : '',
      '',
      'Carry out this phase using the tools available to you. For implementation, design, optimization, or verification phases, work on the real files in the selected workspace; do not return a plan as if it were completed work. Inspect existing files first, preserve correct user work, resolve clear errors, and run proportionate validation before your final report.',
    ].filter(Boolean).join('\n');

    const { state, done } = spawnSubagent({
      agentId: subTask.agentType,
      task: effectiveTask,
      sessionId,
      cwd,
      model,
      provider,
      parentHistory: [],
      sink: sink2,
      background: true,
      retry: { maxAttempts: 1 },
    });

    subTask.runState = state;
    done.catch((error: unknown) => {
      if (subTask.status !== 'running') return;
      const message = error instanceof Error ? error.message : String(error);
      if (this.shouldRetry(task, subTask, message)) {
        this.scheduleRetry(task, subTask, message, sink);
        return;
      }
      subTask.status = 'failed';
      subTask.error = message;
      sink({ type: 'subtask_failed', taskId: task.id, data: { subTaskId: subTask.id, error: subTask.error } });
    });

    sink({ type: 'subtask_deployed', taskId: task.id, data: { subTaskId: subTask.id, agentType: subTask.agentType, description: subTask.description } });
  }

  private shouldRetry(task: OrchestratorTask, subTask: SubTask, error: string): boolean {
    if ((task.status !== 'deploying' && task.status !== 'running') || subTask.status !== 'running') return false;
    if ((subTask.attempts ?? 0) >= 3) return false;
    if (/permission denied|invalid api key|unauthorized|forbidden|missing credential|cancelled by user|user cancelled/i.test(error)) return false;
    return /cancelled before completion|timed out|timeout|stalled|network|fetch|connection|rate limit|429|5\d\d|provider|no available model|could not complete|unknown error/i.test(error);
  }

  private scheduleRetry(task: OrchestratorTask, subTask: SubTask, reason: string, sink: EventSink): void {
    const attempt = subTask.attempts ?? 1;
    subTask.failureHistory = [...(subTask.failureHistory ?? []), reason];
    subTask.error = reason;
    subTask.status = 'pending';
    sink({
      type: 'subtask_retrying',
      taskId: task.id,
      data: { subTaskId: subTask.id, attempt: attempt + 1, reason },
    });
  }

  private handleInterjection(task: OrchestratorTask, message: string, sink: EventSink): void {
    // Find running sub-tasks and inject context
    // The interjection becomes additional context for the next sub-task deployment
    task.originalPrompt += `\n\n[User update while work was in progress]: ${message}`;
    sink({
      type: 'task_updated',
      taskId: task.id,
      data: { interjection: message, affectedPendingTasks: task.subTasks.filter((s) => s.status === 'pending').length },
    });
  }
}

// Singleton
export const orchestrator = new TaskOrchestrator();

function buildReport(task: OrchestratorTask): OrchestratorReport {
  const completed = task.subTasks
    .filter((subTask) => subTask.status === 'completed')
    .map((subTask) => ({ description: subTask.description, result: subTask.result ?? '' }));
  const failed = task.subTasks
    .filter((subTask) => subTask.status === 'failed')
    .map((subTask) => ({
      description: subTask.description,
      error: subTask.error ?? 'Unknown failure',
      attempts: subTask.attempts ?? 1,
    }));
  const retries = task.subTasks.flatMap((subTask) =>
    (subTask.failureHistory ?? []).map((reason, index) => ({
      description: subTask.description,
      attempt: index + 2,
      reason,
    })),
  );
  const unresolved = failed.map((item) => item.description);
  const status = task.status === 'completed' ? 'completed' : task.status === 'cancelled' ? 'cancelled' : 'failed';
  const summary = status === 'completed'
    ? `Completed all ${completed.length} phase(s) successfully${retries.length ? ` after ${retries.length} recovery attempt(s)` : ''}.`
    : `Completed ${completed.length} phase(s), but ${failed.length} phase(s) remain unresolved after ${retries.length} recovery attempt(s).`;
  return { status, summary, completed, failed, retries, unresolved };
}

