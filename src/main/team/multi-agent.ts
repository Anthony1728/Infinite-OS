/**
 * Multi-Agent System
 *
 * Orchestrate multiple agents working together:
 * - Agent teams with an org chart (CEO / manager / employee)
 * - Task delegation with role-aware briefs
 * - Parallel and staged execution
 * - Result aggregation
 * - Communication between agents
 */

import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { infiniteHome } from '../profiles/home.js';
import type { AgentId } from '../agents/types.js';

export interface MultiAgentConfig {
  dataDir: string;
  maxConcurrent: number;
  defaultTimeout: number;
}

/** Human org role an agent plays inside a team. */
export type OrgRole = 'ceo' | 'manager' | 'employee';

export const ORG_ROLES: readonly OrgRole[] = ['ceo', 'manager', 'employee'];

export function isOrgRole(value: unknown): value is OrgRole {
  return typeof value === 'string' && (ORG_ROLES as readonly string[]).includes(value);
}

export interface AgentTeam {
  id: string;
  name: string;
  description: string;
  agents: string[];
  leader?: string;
  /** agentId -> org role. Missing agents default to `employee`. */
  roles: Record<string, OrgRole>;
  /** Standing mandate for this team (shown in the UI, injected into briefs). */
  mission?: string;
  /** Parent team id, so teams can form departments under one org. */
  parentTeamId?: string;
  createdAt: number;
  status: 'idle' | 'active' | 'paused';
}

export type AgentTaskStatus = 'pending' | 'in_progress' | 'completed' | 'failed';

export interface AgentTask {
  id: string;
  teamId?: string;
  assignedTo?: string;
  /** Org role captured at assignment time (survives role changes). */
  role?: OrgRole;
  type: string;
  title: string;
  description: string;
  input: Record<string, unknown>;
  status: AgentTaskStatus;
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

export interface CreateTaskInput {
  type?: string;
  title?: string;
  description?: string;
  input?: Record<string, unknown>;
  teamId?: string;
  assignedTo?: string;
  /** Renderer alias for assignedTo. */
  assignTo?: string;
  dependencies?: string[];
  priority?: AgentTask['priority'];
  role?: OrgRole;
}

export interface CreateTeamOptions {
  leader?: string;
  roles?: Record<string, OrgRole>;
  mission?: string;
  parentTeamId?: string;
}

export interface AgentOrg {
  teams: AgentTeam[];
  roots: string[];
  totals: Record<OrgRole, number> & { teams: number; agents: number };
}

const ROLE_BRIEF: Record<OrgRole, string> = {
  ceo: 'You are the CEO. Set direction, define the strategy and workstreams, name acceptance criteria, call out risks, and judge whether the final result actually achieves the mission. Do not do the employees\' execution work yourself.',
  manager: 'You are the manager. Convert the mission into a concrete, ordered plan with owners, acceptance criteria, and dependencies. Then review the work for correctness and completeness. Escalate only real blockers.',
  employee: 'You are the employee. Execute the assigned workstream end-to-end. Produce the concrete deliverable, verify it, and report exactly what you changed or produced.',
};

function clampRole(role: unknown): OrgRole | undefined {
  return isOrgRole(role) ? role : undefined;
}

export class MultiAgentSystem {
  private config: MultiAgentConfig;
  private teams: Map<string, AgentTeam> = new Map();
  private tasks: Map<string, AgentTask> = new Map();
  private messages: AgentMessage[] = [];
  private dataDir: string;

  constructor(config?: Partial<MultiAgentConfig>) {
    this.config = {
      dataDir: config?.dataDir ?? join(infiniteHome(), 'multi-agent'),
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
        if (Array.isArray(data)) {
          for (const [id, raw] of data) {
            if (!raw || typeof raw !== 'object') continue;
            const team = this.normalizeTeam(id, raw);
            this.teams.set(team.id, team);
          }
        }
      }
      const tasksPath = join(this.dataDir, 'tasks.json');
      if (existsSync(tasksPath)) {
        const data = JSON.parse(readFileSync(tasksPath, 'utf-8'));
        if (Array.isArray(data)) {
          for (const [id, raw] of data) {
            if (!raw || typeof raw !== 'object') continue;
            this.tasks.set(id, this.normalizeTask(id, raw));
          }
        }
      }
      const messagesPath = join(this.dataDir, 'messages.json');
      if (existsSync(messagesPath)) {
        const data = JSON.parse(readFileSync(messagesPath, 'utf-8'));
        if (Array.isArray(data)) this.messages = data;
      }
    } catch { /* silent */ }
  }

  /** Heal legacy rows written by the old flat schema (no roles, `members`, `assigned`). */
  private normalizeTeam(id: string, raw: Partial<AgentTeam> & { members?: string[] }): AgentTeam {
    const agents = Array.isArray(raw.agents)
      ? raw.agents.filter((a): a is string => typeof a === 'string' && a.length > 0)
      : Array.isArray(raw.members)
        ? raw.members.filter((a): a is string => typeof a === 'string' && a.length > 0)
        : [];
    const roles: Record<string, OrgRole> = {};
    if (raw.roles && typeof raw.roles === 'object') {
      for (const [agentId, role] of Object.entries(raw.roles)) {
        const good = clampRole(role);
        if (good) roles[agentId] = good;
      }
    }
    const leader = typeof raw.leader === 'string' && agents.includes(raw.leader) ? raw.leader : undefined;
    for (const agentId of agents) {
      if (!roles[agentId]) roles[agentId] = agentId === leader ? 'manager' : 'employee';
    }
    if (!leader) {
      const existing = agents.find((a) => roles[a] === 'ceo') ?? agents.find((a) => roles[a] === 'manager');
      if (existing) roles[existing] = roles[existing] ?? 'manager';
    }
    return {
      id,
      name: typeof raw.name === 'string' && raw.name.trim() ? raw.name : 'Untitled team',
      description: typeof raw.description === 'string' ? raw.description : '',
      agents,
      roles,
      leader: leader ?? agents.find((a) => roles[a] === 'ceo') ?? agents.find((a) => roles[a] === 'manager'),
      mission: typeof raw.mission === 'string' ? raw.mission : undefined,
      parentTeamId: typeof raw.parentTeamId === 'string' ? raw.parentTeamId : undefined,
      createdAt: Number.isFinite(raw.createdAt) ? Number(raw.createdAt) : Date.now(),
      status: raw.status === 'active' || raw.status === 'paused' ? raw.status : 'idle',
    };
  }

  private normalizeTask(id: string, raw: Partial<AgentTask> & { input?: Record<string, unknown> }): AgentTask {
    const legacy = raw.status as string | undefined;
    const status: AgentTaskStatus =
      legacy === 'completed' || legacy === 'failed' || legacy === 'pending'
        ? legacy
        : legacy === 'assigned' || legacy === 'running' || legacy === 'in_progress'
          ? 'in_progress'
          : 'pending';
    const input = raw.input && typeof raw.input === 'object' ? raw.input : {};
    const title =
      typeof raw.title === 'string' && raw.title
        ? raw.title
        : typeof input.title === 'string' && input.title
          ? input.title
          : typeof raw.type === 'string' && raw.type
            ? raw.type
            : 'Task';
    const description =
      typeof raw.description === 'string' && raw.description
        ? raw.description
        : typeof input.description === 'string'
          ? input.description
          : '';
    return {
      id,
      teamId: typeof raw.teamId === 'string' ? raw.teamId : undefined,
      assignedTo: typeof raw.assignedTo === 'string' ? raw.assignedTo : undefined,
      role: clampRole(raw.role),
      type: typeof raw.type === 'string' && raw.type ? raw.type : title,
      title,
      description,
      input,
      status,
      result: typeof raw.result === 'string' ? raw.result : undefined,
      error: typeof raw.error === 'string' ? raw.error : undefined,
      createdAt: Number.isFinite(raw.createdAt) ? Number(raw.createdAt) : Date.now(),
      startedAt: Number.isFinite(raw.startedAt) ? Number(raw.startedAt) : undefined,
      completedAt: Number.isFinite(raw.completedAt) ? Number(raw.completedAt) : undefined,
      dependencies: Array.isArray(raw.dependencies) ? raw.dependencies.filter((d): d is string => typeof d === 'string') : [],
      priority: raw.priority === 'low' || raw.priority === 'high' ? raw.priority : 'medium',
    };
  }

  private saveData(): void {
    try {
      writeFileSync(join(this.dataDir, 'teams.json'), JSON.stringify(Array.from(this.teams.entries()), null, 2));
      writeFileSync(join(this.dataDir, 'tasks.json'), JSON.stringify(Array.from(this.tasks.entries()), null, 2));
      writeFileSync(join(this.dataDir, 'messages.json'), JSON.stringify(this.messages.slice(-5000), null, 2));
    } catch { /* silent */ }
  }

  // Teams
  createTeam(
    name: string,
    description: string,
    agents: string[] = [],
    options: CreateTeamOptions = {},
  ): AgentTeam {
    const members = Array.from(new Set((Array.isArray(agents) ? agents : []).filter((a) => typeof a === 'string' && a.length > 0)));
    const roles: Record<string, OrgRole> = {};
    const leader = typeof options.leader === 'string' && members.includes(options.leader) ? options.leader : undefined;

    for (const agentId of members) {
      const explicit = clampRole(options.roles?.[agentId]);
      if (explicit) roles[agentId] = explicit;
      else if (leader && agentId === leader) roles[agentId] = 'manager';
      else roles[agentId] = 'employee';
    }
    // No explicit leader: promote an existing CEO/manager, else the first member.
    const chosenLeader =
      leader ??
      members.find((a) => roles[a] === 'ceo') ??
      members.find((a) => roles[a] === 'manager') ??
      members[0];
    if (chosenLeader && roles[chosenLeader] === 'employee') roles[chosenLeader] = 'manager';

    const team: AgentTeam = {
      id: randomUUID(),
      name: typeof name === 'string' && name.trim() ? name.trim() : 'Untitled team',
      description: typeof description === 'string' ? description : '',
      agents: members,
      roles,
      leader: chosenLeader,
      mission: typeof options.mission === 'string' ? options.mission : undefined,
      parentTeamId: typeof options.parentTeamId === 'string' ? options.parentTeamId : undefined,
      createdAt: Date.now(),
      status: 'idle',
    };
    this.teams.set(team.id, team);
    this.saveData();
    return team;
  }

  updateTeam(teamId: string, patch: Partial<Pick<AgentTeam, 'name' | 'description' | 'mission' | 'leader'>> & { parentTeamId?: string | null }): AgentTeam | null {
    const team = this.teams.get(teamId);
    if (!team) return null;
    if (typeof patch.name === 'string' && patch.name.trim()) team.name = patch.name.trim();
    if (typeof patch.description === 'string') team.description = patch.description;
    if (typeof patch.mission === 'string') team.mission = patch.mission;
    if (patch.parentTeamId === null) team.parentTeamId = undefined;
    else if (typeof patch.parentTeamId === 'string') {
      team.parentTeamId = patch.parentTeamId && patch.parentTeamId !== teamId ? patch.parentTeamId : undefined;
    }
    if (typeof patch.leader === 'string' && team.agents.includes(patch.leader)) {
      this.setTeamLeader(teamId, patch.leader);
      return this.teams.get(teamId) ?? team;
    }
    this.saveData();
    return team;
  }

  addAgentToTeam(teamId: string, agentId: string, role: OrgRole = 'employee'): boolean {
    const team = this.teams.get(teamId);
    if (!team || typeof agentId !== 'string' || !agentId) return false;
    if (!team.agents.includes(agentId)) team.agents.push(agentId);
    if (!team.roles[agentId]) team.roles[agentId] = isOrgRole(role) ? role : 'employee';
    if (!team.leader && team.roles[agentId] !== 'employee') team.leader = agentId;
    this.saveData();
    return true;
  }

  removeAgentFromTeam(teamId: string, agentId: string): boolean {
    const team = this.teams.get(teamId);
    if (!team) return false;
    team.agents = team.agents.filter((a) => a !== agentId);
    delete team.roles[agentId];
    if (team.leader === agentId) {
      team.leader = team.agents.find((a) => team.roles[a] === 'ceo') ?? team.agents.find((a) => team.roles[a] === 'manager');
    }
    this.saveData();
    return true;
  }

  setAgentRole(teamId: string, agentId: string, role: OrgRole): boolean {
    const team = this.teams.get(teamId);
    if (!team || !isOrgRole(role) || typeof agentId !== 'string' || !agentId) return false;
    if (!team.agents.includes(agentId)) team.agents.push(agentId);
    team.roles[agentId] = role;
    if (role === 'ceo') {
      // One CEO per team: demote the previous one to manager.
      for (const [other, otherRole] of Object.entries(team.roles)) {
        if (other !== agentId && otherRole === 'ceo') team.roles[other] = 'manager';
      }
    }
    if (!team.leader || (team.leader === agentId && role === 'employee')) {
      team.leader = team.agents.find((a) => team.roles[a] === 'ceo') ?? team.agents.find((a) => team.roles[a] === 'manager');
    }
    this.saveData();
    return true;
  }

  setTeamLeader(teamId: string, agentId: string): boolean {
    const team = this.teams.get(teamId);
    if (!team || !team.agents.includes(agentId)) return false;
    team.leader = agentId;
    if (team.roles[agentId] === 'employee') team.roles[agentId] = 'manager';
    this.saveData();
    return true;
  }

  getTeam(teamId: string): AgentTeam | undefined {
    return this.teams.get(teamId);
  }

  listTeams(): AgentTeam[] {
    return Array.from(this.teams.values());
  }

  getOrg(): AgentOrg {
    const teams = this.listTeams();
    const totals: AgentOrg['totals'] = { teams: teams.length, agents: 0, ceo: 0, manager: 0, employee: 0 };
    for (const team of teams) {
      totals.agents += team.agents.length;
      for (const agentId of team.agents) {
        const role = team.roles[agentId] ?? 'employee';
        totals[role] += 1;
      }
    }
    const ids = new Set(teams.map((t) => t.id));
    return {
      teams,
      roots: teams.filter((t) => !t.parentTeamId || !ids.has(t.parentTeamId)).map((t) => t.id),
      totals,
    };
  }

  // Tasks
  createTask(data: CreateTaskInput): AgentTask {
    const input = data.input && typeof data.input === 'object' ? data.input : {};
    const title =
      (typeof data.title === 'string' && data.title.trim()) ||
      (typeof data.type === 'string' && data.type.trim()) ||
      (typeof input.title === 'string' && input.title.trim()) ||
      'Task';
    const description =
      (typeof data.description === 'string' && data.description) ||
      (typeof input.description === 'string' && input.description) ||
      '';
    const team = data.teamId ? this.teams.get(data.teamId) : undefined;
    const assignedTo = typeof data.assignedTo === 'string' ? data.assignedTo : typeof data.assignTo === 'string' ? data.assignTo : undefined;
    const role =
      clampRole(data.role) ??
      (team && assignedTo ? team.roles[assignedTo] : undefined);

    const task: AgentTask = {
      id: randomUUID(),
      teamId: data.teamId,
      assignedTo,
      role,
      type: typeof data.type === 'string' && data.type ? data.type : title,
      title,
      description,
      input,
      status: 'pending',
      createdAt: Date.now(),
      dependencies: Array.isArray(data.dependencies) ? data.dependencies : [],
      priority: data.priority === 'low' || data.priority === 'high' ? data.priority : 'medium',
    };
    this.tasks.set(task.id, task);
    this.saveData();
    return task;
  }

  assignTask(taskId: string, agentId: string): AgentTask | null {
    const task = this.tasks.get(taskId);
    if (!task || typeof agentId !== 'string' || !agentId) return null;
    task.assignedTo = agentId;
    const team = task.teamId ? this.teams.get(task.teamId) : undefined;
    if (team?.roles[agentId]) task.role = team.roles[agentId];
    task.status = 'in_progress';
    task.startedAt = task.startedAt ?? Date.now();
    this.saveData();
    return task;
  }

  startTask(taskId: string): AgentTask | null {
    const task = this.tasks.get(taskId);
    if (!task) return null;
    task.status = 'in_progress';
    task.startedAt = task.startedAt ?? Date.now();
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

  listTasks(status?: AgentTaskStatus | 'running' | 'assigned', teamId?: string): AgentTask[] {
    let tasks = Array.from(this.tasks.values());
    if (status) {
      const wanted: AgentTaskStatus = status === 'running' || status === 'assigned' ? 'in_progress' : status;
      tasks = tasks.filter((t) => t.status === wanted);
    }
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
  private roleOf(team: AgentTeam, agentId: string): OrgRole {
    return team.roles[agentId] ?? 'employee';
  }

  private rolePrefix(team: AgentTeam, agentId: string, mission: string): string {
    const role = this.roleOf(team, agentId);
    return [
      `MISSION: ${mission}`,
      team.mission ? `STANDING MANDATE: ${team.mission}` : '',
      `YOUR ROLE: ${role.toUpperCase()}`,
      ROLE_BRIEF[role],
    ].filter(Boolean).join('\n');
  }

  async executeTeamTask(teamId: string, taskType: string, input: Record<string, unknown>, context?: {
    sessionId?: string;
    cwd?: string;
    model?: string;
    provider?: string;
  }): Promise<{ tasks: AgentTask[]; results?: Map<string, { result: string; error?: string }> }> {
    const team = this.teams.get(teamId);
    if (!team) throw new Error('Team not found');
    if (team.agents.length === 0) throw new Error('Team has no agents');

    const mission = typeof input.mission === 'string' && input.mission
      ? input.mission
      : typeof input.prompt === 'string' && input.prompt
        ? input.prompt
        : `${taskType}: ${JSON.stringify(input)}`;
    const tasks: AgentTask[] = [];
    for (const agentId of team.agents) {
      const task = this.createTask({
        type: taskType,
        title: mission.slice(0, 120),
        description: mission,
        input: { ...input, role: this.roleOf(team, agentId) },
        teamId,
        assignedTo: agentId,
        role: this.roleOf(team, agentId),
      });
      this.assignTask(task.id, agentId);
      tasks.push(task);
    }

    team.status = 'active';
    this.saveData();

    if (context?.sessionId && context?.cwd) {
      const { spawnBatch } = await import('../agent/runtime.js');
      const agentTasks = team.agents.map((agentId) => ({
        agentId: agentId as AgentId,
        task: `${this.rolePrefix(team, agentId, mission)}\n\nTASK TYPE: ${taskType}\nINPUT: ${JSON.stringify(input)}`,
      }));

      const results = await spawnBatch(agentTasks, {
        sessionId: context.sessionId,
        cwd: context.cwd,
        model: context.model ?? 'meta-llama/llama-3.3-70b-instruct:free',
        provider: context.provider ?? 'openrouter',
        parentHistory: [],
        sink: () => {},
      }, {
        maxConcurrent: Math.min(team.agents.length, this.config.maxConcurrent),
        executionMode: 'parallel',
      });

      const finalMap = results[0] ?? new Map();
      for (const task of tasks) {
        const result = finalMap.get(task.assignedTo as AgentId);
        if (result?.error) this.failTask(task.id, result.error);
        else this.completeTask(task.id, result?.result ?? 'Completed');
      }

      team.status = 'idle';
      this.saveData();
      return { tasks, results: finalMap };
    }

    return { tasks };
  }

  /**
   * Run a mission through the chain of command:
   *  1. CEO + managers produce a plan (parallel with each other).
   *  2. Employees execute against that plan.
   * Teams without leads collapse to a single employee stage.
   */
  async runOrgMission(teamId: string, mission: string, context?: {
    sessionId?: string;
    cwd?: string;
    model?: string;
    provider?: string;
  }): Promise<{ tasks: AgentTask[]; plan: string; results: Map<string, { result: string; error?: string }> }> {
    const team = this.teams.get(teamId);
    if (!team) throw new Error('Team not found');
    if (!mission || !mission.trim()) throw new Error('Mission is required');
    if (team.agents.length === 0) throw new Error('Team has no agents');

    const brief = mission.trim();
    const leads = team.agents.filter((a) => this.roleOf(team, a) !== 'employee');
    const employees = team.agents.filter((a) => this.roleOf(team, a) === 'employee');
    const stages: string[][] = [];
    if (leads.length) stages.push(leads);
    if (employees.length) stages.push(employees);
    if (!stages.length) stages.push(team.agents);

    const { spawnBatch } = await import('../agent/runtime.js');
    const tasks: AgentTask[] = [];
    const results = new Map<string, { result: string; error?: string }>();
    let plan = '';

    team.status = 'active';
    this.saveData();

    for (let i = 0; i < stages.length; i += 1) {
      const stageAgents = stages[i];
      const isPlanStage = i === 0 && leads.length > 0;
      const stageTasks = stageAgents.map((agentId) => {
        const role = this.roleOf(team, agentId);
        const task = this.createTask({
          type: 'org-mission',
          title: brief.slice(0, 120),
          description: brief,
          input: { mission: brief, stage: isPlanStage ? 'plan' : 'execute', role },
          teamId,
          assignedTo: agentId,
          role,
        });
        this.assignTask(task.id, agentId);
        tasks.push(task);
        return { agentId: agentId as AgentId, task: task.id };
      });

      const stageBrief = isPlanStage
        ? [
            this.rolePrefix(team, stageAgents[0], brief),
            `MISSION: ${brief}`,
            'Produce the plan now: objectives, ordered workstreams, owners, acceptance criteria, risks, and definition of done. Do not execute employee tasks.',
          ].join('\n\n')
        : [
            this.rolePrefix(team, stageAgents[0], brief),
            `MISSION: ${brief}`,
            plan ? `PLAN FROM LEADERSHIP:\n${plan}` : '',
            'Execute your assigned workstream end-to-end. Return the concrete deliverable and how you verified it.',
          ].filter(Boolean).join('\n\n');

      const batch = await spawnBatch(
        stageTasks.map((t) => ({ agentId: t.agentId, task: stageBrief })),
        {
          sessionId: context?.sessionId ?? `org-${randomUUID()}`,
          cwd: context?.cwd ?? process.cwd(),
          model: context?.model ?? 'meta-llama/llama-3.3-70b-instruct:free',
          provider: context?.provider ?? 'openrouter',
          parentHistory: [],
          sink: () => {},
        },
        { maxConcurrent: Math.min(stageAgents.length, this.config.maxConcurrent), executionMode: 'parallel' },
      );

      const stageMap = batch[0] ?? new Map();
      for (const stageTask of stageTasks) {
        const task = this.tasks.get(stageTask.task);
        if (!task) continue;
        const result = stageMap.get(stageTask.agentId);
        if (result) results.set(stageTask.agentId, result);
        if (result?.error) this.failTask(task.id, result.error);
        else this.completeTask(task.id, result?.result ?? 'Completed');
      }

      if (isPlanStage) {
        plan = Array.from(stageMap.values())
          .map((r) => r.result)
          .filter((r): r is string => typeof r === 'string' && r.length > 0)
          .join('\n\n');
      }
    }

    team.status = 'idle';
    this.saveData();
    return { tasks, plan, results };
  }

  getStats(): {
    totalTeams: number;
    teams: number;
    activeTeams: number;
    totalTasks: number;
    tasks: number;
    pendingTasks: number;
    inProgressTasks: number;
    runningTasks: number;
    completedTasks: number;
    failedTasks: number;
    totalMessages: number;
    agents: number;
  } {
    const teams = Array.from(this.teams.values());
    const tasks = Array.from(this.tasks.values());
    const inProgress = tasks.filter((t) => t.status === 'in_progress').length;
    const agents = new Set(teams.flatMap((t) => t.agents)).size;
    return {
      totalTeams: teams.length,
      teams: teams.length,
      activeTeams: teams.filter((t) => t.status === 'active').length,
      totalTasks: tasks.length,
      tasks: tasks.length,
      pendingTasks: tasks.filter((t) => t.status === 'pending').length,
      inProgressTasks: inProgress,
      runningTasks: inProgress,
      completedTasks: tasks.filter((t) => t.status === 'completed').length,
      failedTasks: tasks.filter((t) => t.status === 'failed').length,
      totalMessages: this.messages.length,
      agents,
    };
  }
}
