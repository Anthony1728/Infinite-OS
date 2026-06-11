// Multi-Agent System IPC handlers

import { ipcMain } from 'electron';
import { IPC } from '../../shared/ipc.js';
import { multiAgentSystem } from '../index.js';

export function registerMultiAgentIpc(): void {
  ipcMain.handle(IPC.MULTI_AGENT_CREATE_TEAM, async (_e, { name, description, agents }) => {
    return multiAgentSystem.createTeam(name, description, agents);
  });

  ipcMain.handle(IPC.MULTI_AGENT_ADD_TO_TEAM, async (_e, { teamId, agentId }) => {
    return multiAgentSystem.addAgentToTeam(teamId, agentId);
  });

  ipcMain.handle(IPC.MULTI_AGENT_REMOVE_FROM_TEAM, async (_e, { teamId, agentId }) => {
    return multiAgentSystem.removeAgentFromTeam(teamId, agentId);
  });

  ipcMain.handle(IPC.MULTI_AGENT_LIST_TEAMS, async () => {
    return multiAgentSystem.listTeams();
  });

  ipcMain.handle(IPC.MULTI_AGENT_CREATE_TASK, async (_e, data) => {
    return multiAgentSystem.createTask(data);
  });

  ipcMain.handle(IPC.MULTI_AGENT_ASSIGN_TASK, async (_e, { taskId, agentId }) => {
    return multiAgentSystem.assignTask(taskId, agentId);
  });

  ipcMain.handle(IPC.MULTI_AGENT_START_TASK, async (_e, { taskId }) => {
    return multiAgentSystem.startTask(taskId);
  });

  ipcMain.handle(IPC.MULTI_AGENT_COMPLETE_TASK, async (_e, { taskId, result }) => {
    return multiAgentSystem.completeTask(taskId, result);
  });

  ipcMain.handle(IPC.MULTI_AGENT_LIST_TASKS, async (_e, { status, teamId }) => {
    return multiAgentSystem.listTasks(status, teamId);
  });

  ipcMain.handle(IPC.MULTI_AGENT_SEND_MESSAGE, async (_e, { from, to, type, content }) => {
    return multiAgentSystem.sendMessage(from, to, type, content);
  });

  ipcMain.handle(IPC.MULTI_AGENT_GET_MESSAGES, async (_e, { agentId, count }) => {
    return multiAgentSystem.getMessages(agentId, count);
  });

  ipcMain.handle(IPC.MULTI_AGENT_EXECUTE_TEAM_TASK, async (_e, { teamId, taskType, input }) => {
    return multiAgentSystem.executeTeamTask(teamId, taskType, input);
  });

  ipcMain.handle(IPC.MULTI_AGENT_STATS, async () => {
    return multiAgentSystem.getStats();
  });
}
