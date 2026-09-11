import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EnterpriseManager } from './index.js';

function freshDir(): string {
  return mkdtempSync(join(tmpdir(), 'enterprise-'));
}

describe('enterprise persistence', () => {
  it('round-trips members, projects, audit, and compliance across restarts', () => {
    const dir = freshDir();
    try {
      const first = new EnterpriseManager(dir);
      const member = first.addMember('Ada', 'ada@example.com', 'admin');
      expect(first.updateMemberRole(member.id, 'owner')).toBe(true);
      const project = first.createProject('Website', member.id, 'Company site');
      const member2 = first.addMember('Ben', 'ben@example.com', 'viewer');
      expect(first.addMemberToProject(project.id, member2.id)).toBe(true);
      first.addComplianceRule('Backups', 'Daily backups', 'data-retention', 'high', 'check snapshots');

      // A new manager on the same dir sees everything (simulates app restart).
      const second = new EnterpriseManager(dir);
      expect(second.listMembers()).toHaveLength(2);
      expect(second.getMember(member.id)?.role).toBe('owner');
      expect(second.listProjects()).toHaveLength(1);
      expect(second.getProject(project.id)?.members).toContain(member2.id);
      expect(second.listComplianceRules()).toHaveLength(1);
      const audit = second.getAuditLog();
      expect(audit.some((e) => e.action === 'member.added')).toBe(true);
      expect(audit.some((e) => e.action === 'project.created')).toBe(true);

      // Mutations after reload persist too.
      expect(second.removeMember(member2.id)).toBe(true);
      const third = new EnterpriseManager(dir);
      expect(third.listMembers()).toHaveLength(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('starts empty on corrupt data instead of crashing', () => {
    const dir = freshDir();
    try {
      writeFileSync(join(dir, 'members.json'), '{broken', 'utf8');
      const mgr = new EnterpriseManager(dir);
      expect(mgr.listMembers()).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
