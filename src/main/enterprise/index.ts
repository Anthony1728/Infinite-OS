import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';

export interface TeamMember {
  id: string;
  name: string;
  email: string;
  role: 'owner' | 'admin' | 'developer' | 'viewer';
  avatar?: string;
  permissions: string[];
  lastActive: number;
  createdAt: number;
}

export interface TeamProject {
  id: string;
  name: string;
  description: string;
  ownerId: string;
  members: string[];
  visibility: 'private' | 'team' | 'public';
  settings: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

export interface AuditLogEntry {
  id: string;
  userId: string;
  action: string;
  resource: string;
  resourceId: string;
  details: Record<string, unknown>;
  timestamp: number;
  ipAddress?: string;
}

export interface ComplianceRule {
  id: string;
  name: string;
  description: string;
  category: 'security' | 'privacy' | 'data-retention' | 'access-control' | 'encryption';
  severity: 'low' | 'medium' | 'high' | 'critical';
  enabled: boolean;
  check: string;
  lastChecked?: number;
  status: 'compliant' | 'non-compliant' | 'unknown';
}

class EnterpriseManager extends EventEmitter {
  private members: Map<string, TeamMember> = new Map();
  private projects: Map<string, TeamProject> = new Map();
  private auditLog: AuditLogEntry[] = [];
  private complianceRules: Map<string, ComplianceRule> = new Map();

  addMember(name: string, email: string, role: TeamMember['role'] = 'developer'): TeamMember {
    const member: TeamMember = {
      id: uuidv4(),
      name,
      email,
      role,
      permissions: this.getPermissionsForRole(role),
      lastActive: Date.now(),
      createdAt: Date.now(),
    };
    this.members.set(member.id, member);
    this.logAudit(member.id, 'member.added', 'team', member.id, { name, role });
    this.emit('memberAdded', member);
    return member;
  }

  getMember(id: string): TeamMember | undefined {
    return this.members.get(id);
  }

  listMembers(): TeamMember[] {
    return Array.from(this.members.values());
  }

  updateMemberRole(id: string, role: TeamMember['role']): boolean {
    const member = this.members.get(id);
    if (!member) return false;
    member.role = role;
    member.permissions = this.getPermissionsForRole(role);
    this.emit('memberUpdated', member);
    return true;
  }

  removeMember(id: string): boolean {
    const deleted = this.members.delete(id);
    if (deleted) this.emit('memberRemoved', id);
    return deleted;
  }

  createProject(name: string, ownerId: string, description = ''): TeamProject {
    const project: TeamProject = {
      id: uuidv4(),
      name,
      description,
      ownerId,
      members: [ownerId],
      visibility: 'team',
      settings: {},
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    this.projects.set(project.id, project);
    this.logAudit(ownerId, 'project.created', 'project', project.id, { name });
    return project;
  }

  getProject(id: string): TeamProject | undefined {
    return this.projects.get(id);
  }

  listProjects(): TeamProject[] {
    return Array.from(this.projects.values());
  }

  addMemberToProject(projectId: string, memberId: string): boolean {
    const project = this.projects.get(projectId);
    if (!project || project.members.includes(memberId)) return false;
    project.members.push(memberId);
    project.updatedAt = Date.now();
    return true;
  }

  removeMemberFromProject(projectId: string, memberId: string): boolean {
    const project = this.projects.get(projectId);
    if (!project) return false;
    project.members = project.members.filter((m) => m !== memberId);
    project.updatedAt = Date.now();
    return true;
  }

  logAudit(userId: string, action: string, resource: string, resourceId: string, details: Record<string, unknown> = {}): void {
    const entry: AuditLogEntry = {
      id: uuidv4(),
      userId,
      action,
      resource,
      resourceId,
      details,
      timestamp: Date.now(),
    };
    this.auditLog.push(entry);
    if (this.auditLog.length > 10000) this.auditLog.shift();
    this.emit('auditEntry', entry);
  }

  getAuditLog(filters?: { userId?: string; action?: string; since?: number }): AuditLogEntry[] {
    let log = [...this.auditLog];
    if (filters?.userId) log = log.filter((e) => e.userId === filters.userId);
    if (filters?.action) log = log.filter((e) => e.action === filters.action);
    if (filters?.since) log = log.filter((e) => e.timestamp >= (filters.since ?? 0));
    return log;
  }

  addComplianceRule(name: string, description: string, category: ComplianceRule['category'], severity: ComplianceRule['severity'], check: string): ComplianceRule {
    const rule: ComplianceRule = {
      id: uuidv4(),
      name,
      description,
      category,
      severity,
      enabled: true,
      check,
      status: 'unknown',
    };
    this.complianceRules.set(rule.id, rule);
    return rule;
  }

  listComplianceRules(): ComplianceRule[] {
    return Array.from(this.complianceRules.values());
  }

  getComplianceStatus(): { total: number; compliant: number; nonCompliant: number; unknown: number } {
    let total = 0, compliant = 0, nonCompliant = 0, unknown = 0;
    for (const rule of this.complianceRules.values()) {
      total++;
      if (rule.status === 'compliant') compliant++;
      else if (rule.status === 'non-compliant') nonCompliant++;
      else unknown++;
    }
    return { total, compliant, nonCompliant, unknown };
  }

  private getPermissionsForRole(role: TeamMember['role']): string[] {
    const perms: Record<string, string[]> = {
      owner: ['*'],
      admin: ['project.create', 'project.delete', 'member.add', 'member.remove', 'member.role', 'settings.edit', 'audit.view'],
      developer: ['project.edit', 'code.write', 'code.review', 'deploy.run', 'test.run'],
      viewer: ['project.view', 'code.view', 'audit.view'],
    };
    return perms[role] || [];
  }

  exportAuditLog(): string {
    return JSON.stringify(this.auditLog, null, 2);
  }
}

export const enterpriseManager = new EnterpriseManager();

