/**
 * Multi-Agent System
 *
 * Orchestrate multiple agents working together:
 * - Agent teams
 * - Task delegation
 * - Parallel execution
 * - Result aggregation
 * - Communication between agents
 */

import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { AgentId } from '../agents/types.js';

export interface MultiAgentConfig {
  dataDir: string;
  maxConcurrent: number;
  defaultTimeout: number;
}

export interface AgentTeam {
  id: string;
  name: string;
  description: string;
  agents: string[];
  leader?: string;
  createdAt: number;
  status: 'idle' | 'active' | 'paused';
}

export interface AgentTask {
  id: string;
  teamId?: string;
  assignedTo?: string;
  type: string;
  input: Record<string, unknown>;
  status: 'pending' | 'assigned' | 'running' | 'completed' | 'failed';
  result?: string;
  error?: string;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  dependencies: string[];
  priority: 'low' | 'medium' | 'high';
}

export interface AgentMessage {
  id: string;
  from: string;
  to: string;
  type: 'task' | 'result' | 'question' | 'answer' | 'broadcast';
  content: string;
  timestamp: number;
  read: boolean;
}

export class MultiAgentSystem {
  private config: MultiAgentConfig;
  private teams: Map<string, AgentTeam> = new Map();
  private tasks: Map<string, AgentTask> = new Map();
  private messages: AgentMessage[] = [];
  private dataDir: string;

  constructor(config?: Partial<MultiAgentConfig>) {
    this.config = {
      dataDir: config?.dataDir ?? join(homedir(), '.infinite-ai', 'multi-agent'),
      maxConcurrent: config?.maxConcurrent ?? 10,
      defaultTimeout: config?.defaultTimeout ?? 120000,
    };
    this.dataDir = this.config.dataDir;
    this.ensureDir();
    this.loadData();
  }

  private ensureDir(): void {
    if (!existsSync(this.dataDir)) mkdirSync(this.dataDir, { recursive: true });
  }

  private loadData(): void {
    try {
      const teamsPath = join(this.dataDir, 'teams.json');
      if (existsSync(teamsPath)) {
        const data = JSON.parse(readFileSync(teamsPath, 'utf-8'));
        this.teams = new Map(data);
      }
      const tasksPath = join(this.dataDir, 'tasks.json');
      if (existsSync(tasksPath)) {
        const data = JSON.parse(readFileSync(tasksPath, 'utf-8'));
        this.tasks = new Map(data);
      }
      const messagesPath = join(this.dataDir, 'messages.json');
      if (existsSync(messagesPath)) {
        this.messages = JSON.parse(readFileSync(messagesPath, 'utf-8'));
      }
    } catch { /* silent */ }
  }

  private saveData(): void {
    try {
      writeFileSync(join(this.dataDir, 'teams.json'), JSON.stringify(Array.from(this.teams.entries()), null, 2));
      writeFileSync(join(this.dataDir, 'tasks.json'), JSON.stringify(Array.from(this.tasks.entries()), null, 2));
      writeFileSync(join(this.dataDir, 'messages.json'), JSON.stringify(this.messages.slice(-5000), null, 2));
    } catch { /* silent */ }
  }

  // Teams
  createTeam(name: string, description: string, agents: string[]): AgentTeam {
    const team: AgentTeam = {
      id: randomUUID(),
      name,
      description,
      agents,
      createdAt: Date.now(),
      status: 'idle',
    };
    this.teams.set(team.id, team);
    this.saveData();
    return team;
  }

  addAgentToTeam(teamId: string, agentId: string): boolean {
    const team = this.teams.get(teamId);
    if (!team) return false;
    if (!team.agents.includes(agentId)) team.agents.push(agentId);
    this.saveData();
    return true;
  }

  removeAgentFromTeam(teamId: string, agentId: string): boolean {
    const team = this.teams.get(teamId);
    if (!team) return false;
    team.agents = team.agents.filter((a) => a !== agentId);
    this.saveData();
    return true;
  }

  getTeam(teamId: string): AgentTeam | undefined {
    return this.teams.get(teamId);
  }

  listTeams(): AgentTeam[] {
    return Array.from(this.teams.values());
  }

  // Tasks
  createTask(data: {
    type: string;
    input: Record<string, unknown>;
    teamId?: string;
    assignedTo?: string;
    dependencies?: string[];
    priority?: AgentTask['priority'];
  }): AgentTask {
    const task: AgentTask = {
      id: randomUUID(),
      teamId: data.teamId,
      assignedTo: data.assignedTo,
      type: data.type,
      input: data.input,
      status: 'pending',
      createdAt: Date.now(),
      dependencies: data.dependencies ?? [],
      priority: data.priority ?? 'medium',
    };
    this.tasks.set(task.id, task);
    this.saveData();
    return task;
  }

  assignTask(taskId: string, agentId: string): AgentTask | null {
    const task = this.tasks.get(taskId);
    if (!task) return null;
    task.assignedTo = agentId;
    task.status = 'assigned';
    this.saveData();
    return task;
  }

  startTask(taskId: string): AgentTask | null {
    const task = this.tasks.get(taskId);
    if (!task) return null;
    task.status = 'running';
    task.startedAt = Date.now();
    this.saveData();
    return task;
  }

  completeTask(taskId: string, result: string): AgentTask | null {
    const task = this.tasks.get(taskId);
    if (!task) return null;
    task.status = 'completed';
    task.result = result;
    task.completedAt = Date.now();
    this.saveData();
    return task;
  }

  failTask(taskId: string, error: string): AgentTask | null {
    const task = this.tasks.get(taskId);
    if (!task) return null;
    task.status = 'failed';
    task.error = error;
    task.completedAt = Date.now();
    this.saveData();
    return task;
  }

  getTask(taskId: string): AgentTask | undefined {
    return this.tasks.get(taskId);
  }

  listTasks(status?: AgentTask['status'], teamId?: string): AgentTask[] {
    let tasks = Array.from(this.tasks.values());
    if (status) tasks = tasks.filter((t) => t.status === status);
    if (teamId) tasks = tasks.filter((t) => t.teamId === teamId);
    return tasks;
  }

  // Messages
  sendMessage(from: string, to: string, type: AgentMessage['type'], content: string): AgentMessage {
    const message: AgentMessage = {
      id: randomUUID(),
      from,
      to,
      type,
      content,
      timestamp: Date.now(),
      read: false,
    };
    this.messages.push(message);
    if (this.messages.length > 5000) this.messages.shift();
    this.saveData();
    return message;
  }

  getMessages(agentId: string, count: number = 50): AgentMessage[] {
    return this.messages
      .filter((m) => m.from === agentId || m.to === agentId || m.type === 'broadcast')
      .slice(-count);
  }

  markMessageRead(messageId: string): boolean {
    const message = this.messages.find((m) => m.id === messageId);
    if (!message) return false;
    message.read = true;
    this.saveData();
    return true;
  }

  // Orchestration
  async executeTeamTask(teamId: string, taskType: string, input: Record<string, unknown>, context?: {
    sessionId?: string;
    cwd?: string;
    model?: string;
    provider?: string;
  }): Promise<{ tasks: AgentTask[]; results?: Map<string, { result: string; error?: string }> }> {
    const team = this.teams.get(teamId);
    if (!team) throw new Error('Team not found');

    const tasks: AgentTask[] = [];
    for (const agentId of team.agents) {
      const task = this.createTask({
        type: taskType,
        input,
        teamId,
        assignedTo: agentId,
        priority: 'medium',
      });
      this.assignTask(task.id, agentId);
      this.startTask(task.id);
      tasks.push(task);
    }

    team.status = 'active';
    this.saveData();

    // If context provided, actually execute the agents in parallel
    if (context?.sessionId && context?.cwd) {
      const { spawnBatch } = await import('../agent/runtime.js');
      const agentTasks = team.agents.map((agentId) => ({
        agentId: agentId as AgentId,
        task: `${taskType}: ${JSON.stringify(input)}`,
      }));

      const results = await spawnBatch(agentTasks, {
        sessionId: context.sessionId,
        cwd: context.cwd,
        model: context.model ?? 'meta-llama/llama-3.3-70b-instruct:free',
        provider: context.provider ?? 'openrouter',
        parentHistory: [],
        sink: () => {},
      }, {
        maxConcurrent: Math.min(team.agents.length, 10),
        executionMode: 'parallel',
      });

      // Update task statuses
      const finalMap = results[0];
      for (const task of tasks) {
        const result = finalMap.get(task.assignedTo as AgentId);
        if (result?.error) {
          this.failTask(task.id, result.error);
        } else {
          this.completeTask(task.id, result?.result ?? 'Completed');
        }
      }

      team.status = 'idle';
      this.saveData();
      return { tasks, results: finalMap };
    }

    return { tasks };
  }

  getStats(): {
    totalTeams: number;
    activeTeams: number;
    totalTasks: number;
    pendingTasks: number;
    runningTasks: number;
    completedTasks: number;
    failedTasks: number;
    totalMessages: number;
  } {
    const teams = Array.from(this.teams.values());
    const tasks = Array.from(this.tasks.values());
    return {
      totalTeams: teams.length,
      activeTeams: teams.filter((t) => t.status === 'active').length,
      totalTasks: tasks.length,
      pendingTasks: tasks.filter((t) => t.status === 'pending').length,
      runningTasks: tasks.filter((t) => t.status === 'running').length,
      completedTasks: tasks.filter((t) => t.status === 'completed').length,
      failedTasks: tasks.filter((t) => t.status === 'failed').length,
      totalMessages: this.messages.length,
    };
  }
}

