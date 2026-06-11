// Team Workspaces IPC handlers

import { ipcMain } from 'electron';
import { IPC } from '../../shared/ipc.js';
import { teamWorkspaces } from '../index.js';

export function registerWorkspaceIpc(): void {
  ipcMain.handle(IPC.WORKSPACE_CREATE, async (_e, data) => {
    return teamWorkspaces.createWorkspace(data);
  });

  ipcMain.handle(IPC.WORKSPACE_LIST, async (_e, { userId }) => {
    return teamWorkspaces.listWorkspaces(userId);
  });

  ipcMain.handle(IPC.WORKSPACE_GET, async (_e, { workspaceId }) => {
    return teamWorkspaces.getWorkspace(workspaceId);
  });

  ipcMain.handle(IPC.WORKSPACE_DELETE, async (_e, { workspaceId }) => {
    return teamWorkspaces.deleteWorkspace(workspaceId);
  });

  ipcMain.handle(IPC.WORKSPACE_ADD_MEMBER, async (_e, { workspaceId, ...data }) => {
    return teamWorkspaces.addMember(workspaceId, data);
  });

  ipcMain.handle(IPC.WORKSPACE_REMOVE_MEMBER, async (_e, { workspaceId, userId }) => {
    return teamWorkspaces.removeMember(workspaceId, userId);
  });

  ipcMain.handle(IPC.WORKSPACE_UPDATE_MEMBER_ROLE, async (_e, { workspaceId, userId, role }) => {
    return teamWorkspaces.updateMemberRole(workspaceId, userId, role);
  });

  ipcMain.handle(IPC.WORKSPACE_CREATE_PROJECT, async (_e, { workspaceId, ...data }) => {
    return teamWorkspaces.createProject(workspaceId, data);
  });

  ipcMain.handle(IPC.WORKSPACE_DELETE_PROJECT, async (_e, { workspaceId, projectId }) => {
    return teamWorkspaces.deleteProject(workspaceId, projectId);
  });

  ipcMain.handle(IPC.WORKSPACE_ADD_RESOURCE, async (_e, { workspaceId, ...data }) => {
    return teamWorkspaces.addResource(workspaceId, data);
  });

  ipcMain.handle(IPC.WORKSPACE_REMOVE_RESOURCE, async (_e, { workspaceId, resourceId }) => {
    return teamWorkspaces.removeResource(workspaceId, resourceId);
  });

  ipcMain.handle(IPC.WORKSPACE_GET_ACTIVITY, async (_e, { workspaceId, count }) => {
    return teamWorkspaces.getRecentActivity(workspaceId, count);
  });

  ipcMain.handle(IPC.WORKSPACE_STATS, async () => {
    return teamWorkspaces.getStats();
  });
}
