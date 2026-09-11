import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { infiniteHome } from '../profiles/home.js';

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

export class EnterpriseManager extends EventEmitter {
  private members: Map<string, TeamMember> = new Map();
  private projects: Map<string, TeamProject> = new Map();
  private auditLog: AuditLogEntry[] = [];
  private complianceRules: Map<string, ComplianceRule> = new Map();
  private dataDir: string;

  constructor(dataDir?: string) {
    super();
    this.dataDir = dataDir ?? join(infiniteHome(), 'enterprise');
    this.loadData();
  }

  private loadData(): void {
    try {
      if (!existsSync(this.dataDir)) return;
      const load = (name: string): Array<[string, unknown]> | unknown[] => {
        const p = join(this.dataDir, `${name}.json`);
        if (!existsSync(p)) return [];
        return JSON.parse(readFileSync(p, 'utf-8')) as Array<[string, unknown]>;
      };
      this.members = new Map(load('members') as Array<[string, TeamMember]>);
      this.projects = new Map(load('projects') as Array<[string, TeamProject]>);
      const audit = load('audit');
      this.auditLog = (Array.isArray(audit) ? audit : []) as AuditLogEntry[];
      this.complianceRules = new Map(load('compliance') as Array<[string, ComplianceRule]>);
    } catch { /* corrupt data — start empty, never crash boot */ }
  }

  private saveData(): void {
    try {
      mkdirSync(this.dataDir, { recursive: true });
      const save = (name: string, data: unknown) =>
        writeFileSync(join(this.dataDir, `${name}.json`), JSON.stringify(data, null, 2));
      save('members', Array.from(this.members.entries()));
      save('projects', Array.from(this.projects.entries()));
      save('audit', this.auditLog.slice(-10000));
      save('compliance', Array.from(this.complianceRules.entries()));
    } catch { /* disk failure must not break the caller's flow */ }
  }

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
    this.saveData();
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
    this.saveData();
    return true;
  }

  removeMember(id: string): boolean {
    const deleted = this.members.delete(id);
    if (deleted) this.emit('memberRemoved', id);
    if (deleted) this.saveData();
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
    this.saveData();
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
    this.saveData();
    return true;
  }

  removeMemberFromProject(projectId: string, memberId: string): boolean {
    const project = this.projects.get(projectId);
    if (!project) return false;
    project.members = project.members.filter((m) => m !== memberId);
    project.updatedAt = Date.now();
    this.saveData();
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
    this.saveData();
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
    this.saveData();
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

