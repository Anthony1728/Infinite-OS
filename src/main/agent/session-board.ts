// Session Board — kanban-style management of parallel agent sessions with
// worktree isolation.
//
// Competitors (Claude Code, OpenClaw, CodeBuff) all ship some form of parallel
// "session" management: multiple chats/agents working at once, each with its
// own isolated checkout and a live board showing what is queued, running,
// completed or failed. Infinite OS already has a Crew executor, a Task
// Orchestrator and a sub-agent runtime — this module is the board that unifies
// them: one place to create, start, monitor, cancel and clean up sessions of
// every type, each with optional git-worktree file isolation.
//
// Lifecycle: queued -> running -> completed | failed, or queued -> cancelled.
// Terminal sessions are auto-pruned to keep the board bounded.

import { v4 as uuid } from 'uuid';
import { createAgentWorktrees, cleanupWorktrees, type WorktreeInfo } from './worktree.js';
import { orchestrator, type OrchestratorTask } from './orchestrator.js';
import { runCrew, cancelCrewSession, type CrewRun } from './crew.js';
import { spawnSubagent, abortSubagent } from './runtime.js';

export type SessionType = 'orchestrator' | 'crew' | 'standalone';
export type SessionStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface Session {
  id: string;
  title: string;
  description?: string;
  type: SessionType;
  status: SessionStatus;
  startedAt?: number;
  completedAt?: number;
  /** Git worktree this session runs in, when the workspace is a git repo. */
  worktree?: WorktreeInfo;
  /** Reason worktree isolation was skipped (non-repo / dirty tree / git failure). */
  isolation?: string;
  agentId?: string;
  model?: string;
  provider?: string;
  cwd: string;
  progress: number;
  currentStep?: string;
  error?: string;
  results?: Record<string, string>;
  /** Underlying run id for standalone/crew sessions; used for cancellation. */
  runRef?: string;
  /** Task id for orchestrator sessions; used for cancellation/interjection. */
  taskId?: string;
}

export interface SessionEvent {
  type:
    | 'session_created'
    | 'session_started'
    | 'session_progress'
    | 'session_completed'
    | 'session_failed'
    | 'session_cancelled'
    | 'session_updated';
  sessionId: string;
  data: unknown;
}

export interface BoardStats {
  total: number;
  active: number;
  running: number;
  queued: number;
  completed: number;
  failed: number;
  cancelled: number;
}

type SessionEventHandler = (event: SessionEvent) => void;

export class SessionBoard {
  private sessions = new Map<string, Session>();
  private eventHandlers: SessionEventHandler[] = [];
  private autoCleanupInterval?: ReturnType<typeof setInterval>;
  private maxSessions = 20;
  private maxCompletedSessions = 100;

  constructor() {
    this.startAutoCleanup();
  }

  // ── Session management ───────────────────────────────────────────────────

  /** Create a queued session. Throws when the board is at capacity. */
  createSession(title: string, options: Partial<Session> = {}): Session {
    const id = options.id || uuid();

    // Evict old terminal sessions first; hard-cap only when still full.
    if (this.sessions.size >= this.maxSessions) {
      this.evictOlderThan(this.maxSessions - 1);
    }
    if (this.sessions.size >= this.maxSessions) {
      throw new RangeError(
        `Session board is full (${this.maxSessions}). Cancel or clear a session before starting another.`,
      );
    }

    const session: Session = {
      id,
      title,
      description: options.description,
      type: options.type || 'standalone',
      cwd: options.cwd || process.cwd(),
      progress: 0,
      ...options,
      status: 'queued',
    };
    this.sessions.set(id, session);
    this.emit('session_created', session);
    return session;
  }

  /**
   * Start a queued session and run it to completion. Non-repo workspaces skip
   * worktree isolation without failing the session — concurrent edits simply
   * share the workspace, matching the crew system's fallback behaviour.
   */
  async startSession(
    sessionId: string,
    task: string,
    agentId?: string,
    model?: string,
    provider?: string,
  ): Promise<Session | null> {
    const session = this.sessions.get(sessionId);
    if (!session) return null;
    if (session.status !== 'queued') {
      throw new Error(`Session "${session.title}" is already ${session.status}.`);
    }

    try {
      session.status = 'running';
      session.startedAt = Date.now();
      session.agentId = agentId;
      session.model = model;
      session.provider = provider;

      // Worktree isolation for anything that may fan out multi-agent.
      if (session.type === 'crew' || session.type === 'orchestrator') {
        const result = await createAgentWorktrees(session.cwd, [sessionId]);
        if (result.error) {
          session.isolation = result.error;
        } else {
          session.worktree = result.worktrees[0];
        }
      }

      this.emit('session_started', session);
      this.emit('session_progress', session);

      // Run in the roughed-in directory when isolation is available.
      const runCwd = session.worktree?.path ?? session.cwd;

      if (session.type === 'crew') {
        await this.runCrewSession(session, task, runCwd);
      } else if (session.type === 'orchestrator') {
        await this.runOrchestratorSession(session, task, runCwd);
      } else {
        await this.runStandaloneSession(session, task, runCwd, agentId, model, provider);
      }

      return session;
    } catch (error) {
      if (this.isCancelled(session.id)) return session;
      session.status = 'failed';
      session.error = error instanceof Error ? error.message : String(error);
      session.completedAt = Date.now();
      this.emit('session_failed', session);
      return session;
    }
  }

  private async runStandaloneSession(
    session: Session,
    task: string,
    cwd: string,
    agentId?: string,
    model?: string,
    provider?: string,
  ): Promise<void> {
    const agent = agentId || 'auto';
    const assignedModel = model || 'meta-llama/llama-3.3-70b-instruct:free';
    const assignedProvider = provider || 'openrouter';

    this.updateProgress(session, 5, 'Starting standalone agent session');

    const { state, done } = spawnSubagent({
      agentId: agent,
      task,
      sessionId: session.id,
      cwd,
      model: assignedModel,
      provider: assignedProvider,
      parentHistory: [],
      sink: (event) => {
        if (event.type === 'tool_call' && session.status === 'running') {
          this.bumpProgress(session, 2, (event as { tool?: { name?: string } }).tool?.name);
        }
      },
    });
    session.runRef = state.id;
    session.agentId = agent;
    this.emit('session_updated', session);

    try {
      const result = await done;
      if (this.isCancelled(session.id)) return;
      session.results = { result };
      this.completeSession(session.id, { result });
    } catch (error) {
      if (this.isCancelled(session.id)) return;
      this.failSession(session.id, error instanceof Error ? error.message : String(error));
    }
  }

  private async runCrewSession(session: Session, task: string, cwd: string): Promise<void> {
    const plan = {
      leader: {
        provider: session.provider || 'openrouter',
        model: session.model || 'meta-llama/llama-3.3-70b-instruct:free',
        free: true,
      },
      members: [],
      strategy: 'single' as const,
      reasons: ['Session board crew'],
    };

    const run = await runCrew(plan, {
      prompt: task,
      sessionId: session.id,
      cwd,
      parentHistory: [],
      sink: (event) => {
        if (event.type === 'crew_member_started') {
          this.updateProgress(session, 25, 'Crew member working');
        } else if (event.type === 'crew_member_completed') {
          this.bumpProgress(session, 25, 'Crew member completed');
        }
      },
    });
    session.runRef = run.id;
    this.emit('session_updated', session);
    this.finishCrewSession(session, run);
  }

  private finishCrewSession(session: Session, run: CrewRun): void {
    if (this.isCancelled(session.id)) return;
    if (run.status === 'completed' && run.report) {
      session.results = { result: run.report.leaderResult ?? 'Crew completed.' };
      this.completeSession(session.id, session.results);
    } else if (run.status === 'cancelled') {
      this.cancelSession(session.id);
    } else {
      this.failSession(session.id, run.report?.summary ?? 'Crew failed.', session.results);
    }
  }

  private async runOrchestratorSession(session: Session, task: string, cwd: string): Promise<void> {
    const availableProviders = new Map<string, { apiKey?: string; baseUrl?: string }>();
    const preferred = session.model && session.provider
      ? { provider: session.provider, model: session.model }
      : undefined;
    const orchestratorTask = orchestrator.analyze(task, availableProviders, preferred);
    session.taskId = orchestratorTask.id;
    session.model = orchestratorTask.modelSelection?.model ?? session.model;
    session.provider = orchestratorTask.modelSelection?.provider ?? session.provider;
    this.emit('session_updated', session);

    const total = orchestratorTask.subTasks.length;
    await orchestrator.execute(orchestratorTask.id, session.id, cwd, (event) => {
      if (event.type === 'subtask_deployed') {
        this.bumpProgress(session, 5, 'Deploying sub-tasks');
      } else if (event.type === 'subtask_completed') {
        this.bumpProgress(session, total > 0 ? 75 / total : 0, 'Sub-task completed');
      } else if (event.type === 'subtask_failed') {
        this.bumpProgress(session, total > 0 ? 75 / total : 0, 'Sub-task failed');
      }
    });
    this.finishOrchestratorSession(session, orchestratorTask);
  }

  private finishOrchestratorSession(session: Session, task: OrchestratorTask): void {
    if (this.isCancelled(session.id)) return;
    const status = task.status === 'completed' ? 'completed' : task.status === 'cancelled' ? 'cancelled' : 'failed';
    if (status === 'completed') {
      session.results = { result: `Task completed: ${task.subTasks.filter((st) => st.status === 'completed').length}/${task.subTasks.length} sub-tasks.` };
      this.completeSession(session.id, session.results);
    } else if (status === 'cancelled') {
      this.cancelSession(session.id);
    } else {
      this.failSession(session.id, task.errors[0] ?? 'Orchestrator task failed.', session.results);
    }
  }

  // ── Monitoring ───────────────────────────────────────────────────────────

  updateProgress(session: Session, progress: number, currentStep?: string): void {
    if (session.status !== 'running') return;
    session.progress = Math.min(100, Math.max(0, progress));
    if (currentStep) session.currentStep = currentStep;
    this.emit('session_progress', session);
  }

  private bumpProgress(session: Session, delta: number, toolHint?: string): void {
    if (session.status !== 'running') return;
    session.progress = Math.min(99, session.progress + delta);
    if (toolHint) session.currentStep = `Using ${toolHint}`;
    this.emit('session_progress', session);
  }

  completeSession(sessionId: string, results?: Record<string, string>): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    session.status = 'completed';
    session.progress = 100;
    session.completedAt = Date.now();
    if (results) session.results = results;
    this.emit('session_completed', session);
    this.cleanupOldSessions();
  }

  failSession(sessionId: string, error: string, results?: Record<string, string>): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    session.status = 'failed';
    session.error = error;
    session.completedAt = Date.now();
    if (results) session.results = results;
    this.emit('session_failed', session);
    this.cleanupOldSessions();
  }

  cancelSession(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;
    if (session.status !== 'queued' && session.status !== 'running') {
      this.cleanupOldSessions();
      return false;
    }

    session.status = 'cancelled';
    session.completedAt = Date.now();
    session.currentStep = 'Cancelling…';

    // Best-effort cancellation of the underlying work.
    if (session.type === 'crew' && session.runRef) {
      cancelCrewSession(session.id);
    } else if (session.type === 'orchestrator') {
      orchestrator.cancelSession(session.id);
    } else if (session.runRef) {
      abortSubagent(session.runRef);
    }

    this.emit('session_cancelled', session);
    this.cleanupOldSessions();
    return true;
  }

  /** Interject a message into a running orchestrator session. */
  interject(sessionId: string, message: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session || session.type !== 'orchestrator' || !session.taskId) return false;
    orchestrator.interject(session.taskId, message);
    return true;
  }

  // ── Query ────────────────────────────────────────────────────────────────

  private isCancelled(id: string): boolean {
    return this.sessions.get(id)?.status === 'cancelled';
  }

  getSession(sessionId: string): Session | undefined {
    return this.sessions.get(sessionId);
  }

  getSessionsByStatus(status: SessionStatus): Session[] {
    return Array.from(this.sessions.values()).filter((s) => s.status === status);
  }

  getAllSessions(): Session[] {
    return Array.from(this.sessions.values());
  }

  getBoardData(): { columns: Record<SessionStatus, Session[]>; stats: BoardStats } {
    const columns: Record<SessionStatus, Session[]> = {
      queued: [],
      running: [],
      completed: [],
      failed: [],
      cancelled: [],
    };
    for (const session of this.sessions.values()) {
      columns[session.status].push(session);
    }
    return {
      columns,
      stats: {
        total: this.sessions.size,
        active: columns.queued.length + columns.running.length,
        running: columns.running.length,
        queued: columns.queued.length,
        completed: columns.completed.length,
        failed: columns.failed.length,
        cancelled: columns.cancelled.length,
      },
    };
  }

  // ── Events ───────────────────────────────────────────────────────────────

  onEvent(handler: SessionEventHandler): () => void {
    this.eventHandlers.push(handler);
    return () => {
      const index = this.eventHandlers.indexOf(handler);
      if (index > -1) this.eventHandlers.splice(index, 1);
    };
  }

  private emit(type: SessionEvent['type'], session: Session): void {
    const event: SessionEvent = { type, sessionId: session.id, data: { ...session } };
    for (const handler of this.eventHandlers) {
      try {
        handler(event);
      } catch {
        // A misbehaving subscriber must not break the board.
      }
    }
  }

  // ── Cleanup ──────────────────────────────────────────────────────────────

  private startAutoCleanup(): void {
    this.autoCleanupInterval = setInterval(() => {
      this.cleanupOldSessions();
    }, 5 * 60 * 1000); // Every 5 minutes.
  }

  private cleanupOldSessions(): void {
    // Trim completed/cancelled sessions past the soft cap, oldest first.
    this.evictOlderThan(this.maxCompletedSessions);

    // Drop failed sessions after 24 hours.
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    for (const [id, session] of this.sessions.entries()) {
      if (session.status === 'failed' && session.completedAt && session.completedAt < cutoff) {
        this.removeSession(id);
      }
    }
  }

  /** Remove terminal sessions below a target size, oldest first. */
  private evictOlderThan(target: number): void {
    if (this.sessions.size <= target) return;
    const terminal = Array.from(this.sessions.values())
      .filter((s) => s.status !== 'queued' && s.status !== 'running')
      .sort((a, b) => (a.completedAt ?? 0) - (b.completedAt ?? 0));
    for (const session of terminal) {
      if (this.sessions.size <= target) break;
      this.removeSession(session.id);
    }
  }

  private removeSession(id: string): void {
    const session = this.sessions.get(id);
    if (!session) return;
    if (session.worktree) {
      void cleanupWorktrees(session.cwd, [session.worktree]).catch(() => {});
    }
    this.sessions.delete(id);
  }

  /** Reset the board, cleaning up every worktree. Use on shutdown. */
  cleanup(): void {
    if (this.autoCleanupInterval) clearInterval(this.autoCleanupInterval);
    for (const session of [ ...this.sessions.values() ]) {
      this.removeSession(session.id);
    }
    this.sessions.clear();
  }
}

export const sessionBoard = new SessionBoard();