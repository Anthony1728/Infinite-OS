/**
 * Team Workspaces
 *
 * Collaborative workspaces for teams:
 * - Shared projects
 * - Member management
 * - Role-based access
 * - Activity tracking
 * - Shared resources
 */

import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

export interface WorkspaceConfig {
  dataDir: string;
}

export interface WorkspaceMember {
  id: string;
  userId: string;
  name: string;
  email: string;
  role: 'owner' | 'admin' | 'member' | 'viewer';
  joinedAt: number;
  lastActive: number;
  avatar?: string;
}

export interface WorkspaceProject {
  id: string;
  name: string;
  description: string;
  ownerId: string;
  members: string[];
  status: 'active' | 'archived' | 'deleted';
  createdAt: number;
  updatedAt: number;
}

export interface WorkspaceActivity {
  id: string;
  userId: string;
  action: string;
  target: string;
  details: string;
  timestamp: number;
}

export interface WorkspaceResource {
  id: string;
  name: string;
  type: 'file' | 'document' | 'link' | 'note';
  url: string;
  ownerId: string;
  shared: boolean;
  createdAt: number;
}

export interface Workspace {
  id: string;
  name: string;
  description: string;
  ownerId: string;
  members: WorkspaceMember[];
  projects: WorkspaceProject[];
  resources: WorkspaceResource[];
  activities: WorkspaceActivity[];
  settings: {
    visibility: 'private' | 'team' | 'public';
    allowMemberInvite: boolean;
    defaultRole: WorkspaceMember['role'];
  };
  createdAt: number;
  updatedAt: number;
}

export class TeamWorkspaces {
  private config: WorkspaceConfig;
  private workspaces: Map<string, Workspace> = new Map();
  private dataDir: string;

  constructor(config?: Partial<WorkspaceConfig>) {
    this.config = {
      dataDir: config?.dataDir ?? join(homedir(), '.infinite-ai', 'workspaces'),
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
      const wsPath = join(this.dataDir, 'workspaces.json');
      if (existsSync(wsPath)) {
        const data = JSON.parse(readFileSync(wsPath, 'utf-8'));
        this.workspaces = new Map(data);
      }
    } catch { /* silent */ }
  }

  private saveData(): void {
    try {
      writeFileSync(join(this.dataDir, 'workspaces.json'), JSON.stringify(Array.from(this.workspaces.entries()), null, 2));
    } catch { /* silent */ }
  }

  private addActivity(workspace: Workspace, userId: string, action: string, target: string, details: string): void {
    workspace.activities.push({
      id: randomUUID(),
      userId,
      action,
      target,
      details,
      timestamp: Date.now(),
    });
    if (workspace.activities.length > 1000) workspace.activities.shift();
  }

  // Workspaces
  createWorkspace(data: { name: string; description: string; ownerId: string; ownerName: string; ownerEmail: string }): Workspace {
    const workspace: Workspace = {
      id: randomUUID(),
      name: data.name,
      description: data.description,
      ownerId: data.ownerId,
      members: [{
        id: randomUUID(),
        userId: data.ownerId,
        name: data.ownerName,
        email: data.ownerEmail,
        role: 'owner',
        joinedAt: Date.now(),
        lastActive: Date.now(),
      }],
      projects: [],
      resources: [],
      activities: [],
      settings: {
        visibility: 'team',
        allowMemberInvite: true,
        defaultRole: 'member',
      },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    this.addActivity(workspace, data.ownerId, 'created', 'workspace', `Created workspace "${data.name}"`);
    this.workspaces.set(workspace.id, workspace);
    this.saveData();
    return workspace;
  }

  getWorkspace(workspaceId: string): Workspace | undefined {
    return this.workspaces.get(workspaceId);
  }

  listWorkspaces(userId?: string): Workspace[] {
    const workspaces = Array.from(this.workspaces.values());
    if (!userId) return workspaces;
    return workspaces.filter((w) => w.members.some((m) => m.userId === userId));
  }

  deleteWorkspace(workspaceId: string): boolean {
    const result = this.workspaces.delete(workspaceId);
    this.saveData();
    return result;
  }

  // Members
  addMember(workspaceId: string, data: { userId: string; name: string; email: string; role?: WorkspaceMember['role'] }): WorkspaceMember | null {
    const workspace = this.workspaces.get(workspaceId);
    if (!workspace) return null;

    const member: WorkspaceMember = {
      id: randomUUID(),
      userId: data.userId,
      name: data.name,
      email: data.email,
      role: data.role ?? workspace.settings.defaultRole,
      joinedAt: Date.now(),
      lastActive: Date.now(),
    };

    workspace.members.push(member);
    workspace.updatedAt = Date.now();
    this.addActivity(workspace, data.userId, 'joined', 'workspace', `${data.name} joined the workspace`);
    this.saveData();
    return member;
  }

  removeMember(workspaceId: string, userId: string): boolean {
    const workspace = this.workspaces.get(workspaceId);
    if (!workspace) return false;
    workspace.members = workspace.members.filter((m) => m.userId !== userId);
    workspace.updatedAt = Date.now();
    this.saveData();
    return true;
  }

  updateMemberRole(workspaceId: string, userId: string, role: WorkspaceMember['role']): boolean {
    const workspace = this.workspaces.get(workspaceId);
    if (!workspace) return false;
    const member = workspace.members.find((m) => m.userId === userId);
    if (!member) return false;
    member.role = role;
    workspace.updatedAt = Date.now();
    this.saveData();
    return true;
  }

  // Projects
  createProject(workspaceId: string, data: { name: string; description: string; ownerId: string }): WorkspaceProject | null {
    const workspace = this.workspaces.get(workspaceId);
    if (!workspace) return null;

    const project: WorkspaceProject = {
      id: randomUUID(),
      name: data.name,
      description: data.description,
      ownerId: data.ownerId,
      members: [data.ownerId],
      status: 'active',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    workspace.projects.push(project);
    workspace.updatedAt = Date.now();
    this.addActivity(workspace, data.ownerId, 'created', 'project', `Created project "${data.name}"`);
    this.saveData();
    return project;
  }

  deleteProject(workspaceId: string, projectId: string): boolean {
    const workspace = this.workspaces.get(workspaceId);
    if (!workspace) return false;
    workspace.projects = workspace.projects.filter((p) => p.id !== projectId);
    workspace.updatedAt = Date.now();
    this.saveData();
    return true;
  }

  // Resources
  addResource(workspaceId: string, data: { name: string; type: WorkspaceResource['type']; url: string; ownerId: string; shared?: boolean }): WorkspaceResource | null {
    const workspace = this.workspaces.get(workspaceId);
    if (!workspace) return null;

    const resource: WorkspaceResource = {
      id: randomUUID(),
      name: data.name,
      type: data.type,
      url: data.url,
      ownerId: data.ownerId,
      shared: data.shared ?? true,
      createdAt: Date.now(),
    };

    workspace.resources.push(resource);
    workspace.updatedAt = Date.now();
    this.saveData();
    return resource;
  }

  removeResource(workspaceId: string, resourceId: string): boolean {
    const workspace = this.workspaces.get(workspaceId);
    if (!workspace) return false;
    workspace.resources = workspace.resources.filter((r) => r.id !== resourceId);
    workspace.updatedAt = Date.now();
    this.saveData();
    return true;
  }

  // Activity
  getRecentActivity(workspaceId: string, count: number = 50): WorkspaceActivity[] {
    const workspace = this.workspaces.get(workspaceId);
    if (!workspace) return [];
    return workspace.activities.slice(-count);
  }

  // Stats
  getStats(): {
    totalWorkspaces: number;
    totalMembers: number;
    totalProjects: number;
    totalResources: number;
  } {
    const workspaces = Array.from(this.workspaces.values());
    return {
      totalWorkspaces: workspaces.length,
      totalMembers: workspaces.reduce((sum, w) => sum + w.members.length, 0),
      totalProjects: workspaces.reduce((sum, w) => sum + w.projects.length, 0),
      totalResources: workspaces.reduce((sum, w) => sum + w.resources.length, 0),
    };
  }
}

