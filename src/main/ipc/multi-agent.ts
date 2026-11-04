// Multi-Agent System IPC handlers

import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { ipcMain } from 'electron';
import { IPC } from '../../shared/ipc.js';
import { multiAgentSystem } from '../index.js';
import { isOrgRole, type AgentTask, type OrgRole } from '../team/multi-agent.js';

const obj = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

const str = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined;

const strArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string' && v.length > 0) : [];

const idOf = (data: Record<string, unknown>): string | undefined =>
  str(data.taskId) ?? str(data.id);

export function registerMultiAgentIpc(): void {
  ipcMain.handle(IPC.MULTI_AGENT_CREATE_TEAM, async (_e, raw) => {
    const data = obj(raw);
    const members = strArray(data.agents).length ? strArray(data.agents) : strArray(data.members);
    const roles = obj(data.roles);
    const roleMap: Record<string, OrgRole> = {};
    for (const [agentId, role] of Object.entries(roles)) {
      if (isOrgRole(role)) roleMap[agentId] = role;
    }
    return multiAgentSystem.createTeam(
      str(data.name) ?? '',
      str(data.description) ?? '',
      members,
      {
        leader: str(data.leader),
        roles: roleMap,
        mission: str(data.mission),
        parentTeamId: str(data.parentTeamId),
      },
    );
  });

  ipcMain.handle(IPC.MULTI_AGENT_UPDATE_TEAM, async (_e, raw) => {
    const data = obj(raw);
    const teamId = str(data.teamId) ?? str(data.id);
    if (!teamId) return null;
    return multiAgentSystem.updateTeam(teamId, {
      name: str(data.name),
      description: typeof data.description === 'string' ? data.description : undefined,
      mission: typeof data.mission === 'string' ? data.mission : undefined,
      parentTeamId: typeof data.parentTeamId === 'string' || data.parentTeamId === null
        ? (data.parentTeamId as string | null)
        : undefined,
      leader: str(data.leader),
    });
  });

  ipcMain.handle(IPC.MULTI_AGENT_ADD_TO_TEAM, async (_e, raw) => {
    const data = obj(raw);
    const teamId = str(data.teamId) ?? str(data.id);
    const agentId = str(data.agentId);
    if (!teamId || !agentId) return false;
    return multiAgentSystem.addAgentToTeam(teamId, agentId, isOrgRole(data.role) ? data.role : 'employee');
  });

  ipcMain.handle(IPC.MULTI_AGENT_REMOVE_FROM_TEAM, async (_e, raw) => {
    const data = obj(raw);
    const teamId = str(data.teamId) ?? str(data.id);
    const agentId = str(data.agentId);
    if (!teamId || !agentId) return false;
    return multiAgentSystem.removeAgentFromTeam(teamId, agentId);
  });

  ipcMain.handle(IPC.MULTI_AGENT_SET_ROLE, async (_e, raw) => {
    const data = obj(raw);
    const teamId = str(data.teamId) ?? str(data.id);
    const agentId = str(data.agentId);
    const role = data.role;
    if (!teamId || !agentId || !isOrgRole(role)) return false;
    return multiAgentSystem.setAgentRole(teamId, agentId, role);
  });

  ipcMain.handle(IPC.MULTI_AGENT_SET_LEADER, async (_e, raw) => {
    const data = obj(raw);
    const teamId = str(data.teamId) ?? str(data.id);
    const agentId = str(data.agentId);
    if (!teamId || !agentId) return false;
    return multiAgentSystem.setTeamLeader(teamId, agentId);
  });

  ipcMain.handle(IPC.MULTI_AGENT_LIST_TEAMS, async () => {
    return multiAgentSystem.listTeams();
  });

  ipcMain.handle(IPC.MULTI_AGENT_ORG, async () => {
    return multiAgentSystem.getOrg();
  });

  ipcMain.handle(IPC.MULTI_AGENT_CREATE_TASK, async (_e, raw) => {
    const data = obj(raw);
    const priority = data.priority === 'low' || data.priority === 'high' ? data.priority : undefined;
    return multiAgentSystem.createTask({
      type: str(data.type),
      title: str(data.title),
      description: typeof data.description === 'string' ? data.description : undefined,
      input: obj(data.input),
      teamId: str(data.teamId),
      assignedTo: str(data.assignedTo) ?? str(data.assignTo),
      dependencies: strArray(data.dependencies),
      priority,
      role: isOrgRole(data.role) ? data.role : undefined,
    });
  });

  ipcMain.handle(IPC.MULTI_AGENT_ASSIGN_TASK, async (_e, raw) => {
    const data = obj(raw);
    const taskId = idOf(data);
    const agentId = str(data.agentId);
    if (!taskId || !agentId) return null;
    return multiAgentSystem.assignTask(taskId, agentId);
  });

  ipcMain.handle(IPC.MULTI_AGENT_START_TASK, async (_e, raw) => {
    const taskId = idOf(obj(raw));
    return taskId ? multiAgentSystem.startTask(taskId) : null;
  });

  ipcMain.handle(IPC.MULTI_AGENT_COMPLETE_TASK, async (_e, raw) => {
    const data = obj(raw);
    const taskId = idOf(data);
    if (!taskId) return null;
    return multiAgentSystem.completeTask(taskId, typeof data.result === 'string' ? data.result : 'Completed');
  });

  ipcMain.handle(IPC.MULTI_AGENT_LIST_TASKS, async (_e, raw) => {
    const data = obj(raw);
    const status = str(data.status) as AgentTask['status'] | undefined;
    return multiAgentSystem.listTasks(status, str(data.teamId));
  });

  ipcMain.handle(IPC.MULTI_AGENT_SEND_MESSAGE, async (_e, raw) => {
    const data = obj(raw);
    const from = str(data.from) ?? 'system';
    const to = str(data.to) ?? '*';
    const allowed = ['task', 'result', 'question', 'answer', 'broadcast'] as const;
    const type = allowed.includes(data.type as typeof allowed[number])
      ? data.type as typeof allowed[number]
      : to === '*' ? 'broadcast' : 'task';
    return multiAgentSystem.sendMessage(from, to, type, typeof data.content === 'string' ? data.content : '');
  });

  ipcMain.handle(IPC.MULTI_AGENT_GET_MESSAGES, async (_e, raw) => {
    const data = obj(raw);
    const agentId = str(data.agentId) ?? '*';
    const count = Number.isFinite(Number(data.count)) ? Math.max(1, Math.min(500, Math.round(Number(data.count)))) : 50;
    return multiAgentSystem.getMessages(agentId, count);
  });

  ipcMain.handle(IPC.MULTI_AGENT_EXECUTE_TEAM_TASK, async (_e, raw) => {
    const data = obj(raw);
    const teamId = str(data.teamId) ?? str(data.id);
    if (!teamId) throw new Error('teamId is required');
    const taskType = str(data.taskType) ?? str(data.type) ?? 'mission';
    const input = obj(data.input);
    // Without a sessionId/cwd the orchestrator only records task rows and
    // never spawns agents — synthesize defaults so teams always execute.
    const context = obj(data.context);
    const resolved = {
      ...context,
      sessionId: str(context.sessionId) ?? `team-${randomUUID()}`,
      cwd: str(context.cwd) ?? homedir(),
    };
    return multiAgentSystem.executeTeamTask(teamId, taskType, input, resolved);
  });

  ipcMain.handle(IPC.MULTI_AGENT_RUN_ORG_MISSION, async (_e, raw) => {
    const data = obj(raw);
    const teamId = str(data.teamId) ?? str(data.id);
    if (!teamId) throw new Error('teamId is required');
    const mission = str(data.mission) ?? str(data.prompt) ?? str(data.title);
    if (!mission) throw new Error('mission is required');
    const context = obj(data.context);
    return multiAgentSystem.runOrgMission(teamId, mission, {
      ...context,
      sessionId: str(context.sessionId) ?? `org-${randomUUID()}`,
      cwd: str(context.cwd) ?? homedir(),
    });
  });

  ipcMain.handle(IPC.MULTI_AGENT_STATS, async () => {
    return multiAgentSystem.getStats();
  });
}
