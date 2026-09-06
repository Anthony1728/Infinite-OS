// Owner System — the sole authorized operator of Infinite OS.
//
// Infinite OS belongs to Anthony Matthews. This module records who the owner is,
// what elevated privileges they hold, the premium ("advanced") capabilities
// granted to them for working on Infinite OS from within itself, and an editable
// document store the owner can update through the AI at any time.
//
// All data is persisted locally in ~/.infinite-ai/owner.db via SQLite so it
// survives restarts and can be read by any future user-facing handler.

import Database from 'better-sqlite3';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { mkdirSync, existsSync } from 'node:fs';
import type { OwnerProfile, OwnerDocument, OwnerPublicInfo, OwnerAuditEntry, OwnerPermission, PremiumCapability, OwnerMutation } from '../../shared/owner.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type { OwnerProfile, OwnerDocument, OwnerPublicInfo, OwnerAuditEntry, OwnerPermission, PremiumCapability, OwnerMutation };

// ---------------------------------------------------------------------------
// Manager
// ---------------------------------------------------------------------------

export const DEFAULT_OWNER: Omit<OwnerProfile, 'verifiedAt' | 'updatedAt'> = {
  id: 'owner-local',
  fullName: 'Anthony Matthews',
  preferredName: 'Anthony',
  email: 'testexample@gmail.com',
  isOwner: true,
  role: 'owner',
  permissions: ['*'],
  premiumCapabilities: [
    'source.edit',
    'source.build',
    'self.hotswap',
    'backup.snapshot',
    'backup.restore',
    'git.power',
    'automation.system',
    'agent.roster',
    'audit.granular',
    'providers.manage',
    'memory.grand',
    'settings.system',
    'mcp.advanced',
    'deploy.auto',
    'plugins.advanced',
  ],
};

export class OwnerManager {
  private db: Database.Database;
  private profileCache: OwnerProfile | null = null;

  constructor(dbPath?: string) {
    const dir = join(homedir(), '.infinite-ai');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const path = dbPath || join(dir, 'owner.db');
    this.db = new Database(path);
    this.db.pragma('journal_mode = WAL');
    this.initTables();
    this.ensureDefaultOwnership();
  }

  private initTables(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS owner_profile (
        id TEXT PRIMARY KEY,
        full_name TEXT NOT NULL,
        preferred_name TEXT NOT NULL,
        email TEXT NOT NULL,
        is_owner INTEGER NOT NULL DEFAULT 1,
        role TEXT NOT NULL DEFAULT 'owner',
        permissions TEXT NOT NULL DEFAULT '[]',
        premium_capabilities TEXT NOT NULL DEFAULT '[]',
        verified_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS owner_documents (
        id TEXT PRIMARY KEY,
        key TEXT UNIQUE NOT NULL,
        title TEXT NOT NULL,
        body TEXT NOT NULL DEFAULT '',
        category TEXT NOT NULL DEFAULT 'general',
        locked INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS owner_audit (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        actor TEXT NOT NULL,
        mutation TEXT NOT NULL,
        detail TEXT,
        timestamp INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_owner_docs_category ON owner_documents(category);
      CREATE INDEX IF NOT EXISTS idx_owner_audit_ts ON owner_audit(timestamp);
    `);
  }

  private ensureDefaultOwnership(): void {
    const row = this.db.prepare('SELECT id FROM owner_profile WHERE id = ?').get(DEFAULT_OWNER.id);
    if (!row) {
      const now = Date.now();
      this.db.prepare(`
        INSERT INTO owner_profile (id, full_name, preferred_name, email, is_owner, role, permissions, premium_capabilities, verified_at, updated_at)
        VALUES (?, ?, ?, ?, 1, 'owner', ?, ?, ?, ?)
      `).run(
        DEFAULT_OWNER.id,
        DEFAULT_OWNER.fullName,
        DEFAULT_OWNER.preferredName,
        DEFAULT_OWNER.email,
        JSON.stringify(DEFAULT_OWNER.permissions),
        JSON.stringify(DEFAULT_OWNER.premiumCapabilities),
        now,
        now,
      );
      this.profileCache = null;
      // Seed the intro document.
      this.seedDefaultDocument();
    }
  }

  private seedDefaultDocument(): void {
    const existing = this.getDocument('owner-info');
    if (existing) return;
    const now = Date.now();
    this.db.prepare(`
      INSERT OR IGNORE INTO owner_documents (id, key, title, body, category, locked, created_at, updated_at)
      VALUES (?, 'owner-info', 'Owner of Infinite OS', ?, 'general', 1, ?, ?)
    `).run(
      `doc-owner-info-${now}`,
      `# Anthony Matthews — Owner of Infinite OS

- **Full name:** Anthony Matthews
- **Preferred name:** Anthony
- **Email:** testexample@gmail.com
- **Role:** Owner (sole operator / founder)

## About this document

This document is managed by Anthony through the Infinite AI assistant. The owner
may ask Infinite AI to update any of this information at any time and it will be
persisted here so that any future session can recall who owns Infinite OS and
what privileges the owner holds.

If any other user asks who owns Infinite OS or who has special administrative
permissions, the answer is Anthony Matthews. Only this account holds owner-level
permissions.

## Owner permissions

The owner holds wildcard ('*') permissions plus an established set of premium
capabilities that unlock advanced, self-hosted workflows for building Infinite
OS from within itself (source editing, snapshots/restore, git power, automation
at system level, agent roster control, granular audit, provider management, and
more).

To edit: tell Infinite AI what to change and it will update this record.`,
      now,
      now,
    );
  }

  // ---- Profile ----

  getProfile(): OwnerProfile {
    if (this.profileCache) return { ...this.profileCache };
    const row = this.db.prepare('SELECT * FROM owner_profile LIMIT 1').get() as
      | Record<string, unknown>
      | undefined;
    if (!row) this.ensureDefaultOwnership();
    const r =
      (this.db.prepare('SELECT * FROM owner_profile LIMIT 1').get() as Record<string, unknown>) ?? {};
    const profile: OwnerProfile = {
      id: r.id as string,
      fullName: r.full_name as string,
      preferredName: r.preferred_name as string,
      email: r.email as string,
      isOwner: !!r.is_owner,
      role: 'owner',
      permissions: JSON.parse(r.permissions as string) as OwnerPermission[],
      premiumCapabilities: JSON.parse(r.premium_capabilities as string) as PremiumCapability[],
      verifiedAt: r.verified_at as number,
      updatedAt: r.updated_at as number,
    };
    this.profileCache = profile;
    return { ...profile };
  }

  updateProfile(updates: Partial<Pick<OwnerProfile, 'fullName' | 'preferredName' | 'email'>>): OwnerProfile {
    const current = this.getProfile();
    const next: OwnerProfile = {
      ...current,
      ...updates,
      updatedAt: Date.now(),
    };
    this.db.prepare(`
      UPDATE owner_profile
      SET full_name = ?, preferred_name = ?, email = ?, updated_at = ?
      WHERE id = ?
    `).run(next.fullName, next.preferredName, next.email, next.updatedAt, current.id);
    this.profileCache = next;
    this.audit(current.email ?? next.email, 'profile.update', 'Accessible fields updated');
    return { ...next };
  }

  getPublicInfo(): OwnerPublicInfo {
    const p = this.getProfile();
    return {
      ownerName: p.preferredName,
      isConfigured: true,
      capabilities: p.premiumCapabilities,
    };
  }

  isOwnerEmail(email: string | null | undefined): boolean {
    if (!email) return false;
    const p = this.getProfile();
    return p.email.toLowerCase() === email.trim().toLowerCase();
  }

  hasPermission(email: string, permission: OwnerPermission): boolean {
    if (!this.isOwnerEmail(email)) return false;
    const p = this.getProfile();
    return p.permissions.includes('*') || p.permissions.includes(permission);
  }

  hasCapability(email: string, cap: PremiumCapability): boolean {
    if (!this.isOwnerEmail(email)) return false;
    const p = this.getProfile();
    return p.premiumCapabilities.includes(cap);
  }

  listPremiumCapabilities(): { capability: PremiumCapability; enabled: boolean }[] {
    const enabled = new Set(this.getProfile().premiumCapabilities);
    const all: PremiumCapability[] = [
      'source.edit', 'source.build', 'self.hotswap', 'backup.snapshot', 'backup.restore',
      'git.power', 'automation.system', 'agent.roster', 'audit.granular', 'providers.manage',
      'memory.grand', 'settings.system', 'mcp.advanced', 'deploy.auto', 'plugins.advanced',
    ];
    return all.map((cap) => ({ capability: cap, enabled: enabled.has(cap) }));
  }

  toggleCapability(cap: PremiumCapability, enabled: boolean): { capability: PremiumCapability; enabled: boolean }[] {
    const p = this.getProfile();
    const set = new Set<PremiumCapability>(p.premiumCapabilities as PremiumCapability[]);
    if (enabled) set.add(cap);
    else set.delete(cap);
    const arr = [...set];
    this.db.prepare('UPDATE owner_profile SET premium_capabilities = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify(arr), Date.now(), p.id);
    this.profileCache = { ...p, premiumCapabilities: arr as PremiumCapability[], updatedAt: Date.now() };
    this.audit(p.email, 'capability.toggle', `${cap} -> ${enabled ? 'on' : 'off'}`);
    return this.listPremiumCapabilities();
  }

  // ---- Documents ----

  listDocuments(): OwnerDocument[] {
    const rows = this.db.prepare('SELECT * FROM owner_documents ORDER BY category, title').all() as Record<string, unknown>[];
    return rows.map((r) => this.mapDoc(r));
  }

  getDocument(key: string): OwnerDocument | null {
    const r = this.db.prepare('SELECT * FROM owner_documents WHERE key = ?').get(key) as
      | Record<string, unknown>
      | undefined;
    return r ? this.mapDoc(r) : null;
  }

  upsertDocument(key: string, title: string, category: string, body: string): OwnerDocument {
    const existing = this.getDocument(key);
    const now = Date.now();
    const id = existing?.id ?? `doc-${now}-${Math.random().toString(36).slice(2, 8)}`;
    const locked = existing?.locked ?? false;
    this.db.prepare(`
      INSERT INTO owner_documents (id, key, title, body, category, locked, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        title = excluded.title,
        body = excluded.body,
        category = excluded.category,
        updated_at = excluded.updated_at
    `).run(id, key, title, body, category, locked ? 1 : 0, existing?.createdAt ?? now, now);
    const doc = this.getDocument(key)!;
    this.audit(DEFAULT_OWNER.email, existing ? 'doc.update' : 'doc.create', key);
    return doc;
  }

  deleteDocument(key: string): boolean {
    const doc = this.getDocument(key);
    if (!doc) return false;
    if (doc.locked) return false; // core documents cannot be deleted, only edited
    this.db.prepare('DELETE FROM owner_documents WHERE key = ?').run(key);
    this.audit(DEFAULT_OWNER.email, 'doc.delete', key);
    return true;
  }

  // ---- Audit ----

  private audit(actor: string, mutation: string, detail?: string): void {
    this.db.prepare('INSERT INTO owner_audit (actor, mutation, detail, timestamp) VALUES (?, ?, ?, ?)')
      .run(actor, mutation, detail ?? '', Date.now());
  }

  getAudit(limit = 100): OwnerAuditEntry[] {
    const rows = this.db.prepare('SELECT * FROM owner_audit ORDER BY timestamp DESC LIMIT ?').all(limit) as Record<string, unknown>[];
    return rows.map((r) => ({
      id: String(r.id),
      actor: r.actor as string,
      mutation: r.mutation as string,
      detail: (r.detail as string) || undefined,
      timestamp: r.timestamp as number,
    }));
  }

  // ---- Protected helpers ----

  /** Run a mutating operation only when the caller is the owner email. */
  requireOwner<T>(email: string, mutation: OwnerMutation, fn: () => T): T {
    if (!this.isOwnerEmail(email)) {
      throw new Error('Access denied: only the Infinite OS owner may perform this operation.');
    }
    const label = mutation.kind;
    const detail = 'permission' in mutation ? mutation.permission : undefined;
    const result = fn();
    void this.audit(email, label, detail);
    return result;
  }

  private mapDoc(r: Record<string, unknown>): OwnerDocument {
    return {
      id: r.id as string,
      key: r.key as string,
      title: r.title as string,
      body: r.body as string,
      category: r.category as string,
      locked: !!r.locked,
      createdAt: r.created_at as number,
      updatedAt: r.updated_at as number,
    };
  }

  close(): void {
    this.db.close();
  }
}

let ownerManagerInstance: OwnerManager | null = null;

/** Lazily instantiate the owner manager (avoids SQLite at import time). */
export function getOwnerManager(dbPath?: string): OwnerManager {
  if (!ownerManagerInstance) ownerManagerInstance = new OwnerManager(dbPath);
  return ownerManagerInstance;
}