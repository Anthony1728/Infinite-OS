import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';
import { OwnerManager, DEFAULT_OWNER } from './manager.js';

// better-sqlite3 is a native module built for Electron. Under plain Node  the
// ABI can mismatch; skip the DB-backed suite in that case instead of failing.
let canUseNative = true;
try {
  new Database(':memory:').close();
} catch {
  canUseNative = false;
}

const maybeDescribe = canUseNative ? describe : describe.skip;

const createdDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(createdDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function createManager(): Promise<{ manager: OwnerManager; cleanup: () => Promise<void> }> {
  const directory = await mkdtemp(join(tmpdir(), 'infinite-os-owner-test-'));
  createdDirectories.push(directory);
  const manager = new OwnerManager(join(directory, 'owner.db'));
  return { manager, cleanup: async () => undefined };
}

maybeDescribe('OwnerManager', () => {
  it('boots with Anthony Matthews as the sole owner', async () => {
    const { manager } = await createManager();
    const profile = manager.getProfile();
    expect(profile.fullName).toBe('Anthony Matthews');
    expect(profile.preferredName).toBe('Anthony');
    expect(profile.email).toBe(DEFAULT_OWNER.email);
    expect(profile.isOwner).toBe(true);
    expect(profile.role).toBe('owner');
    expect(profile.permissions).toContain('*');
  });

  it('exposes premium owner-only capabilities', async () => {
    const { manager } = await createManager();
    const caps = manager.listPremiumCapabilities();
    expect(manager.hasCapability(DEFAULT_OWNER.email, 'source.edit')).toBe(true);
    expect(manager.hasCapability(DEFAULT_OWNER.email, 'backup.snapshot')).toBe(true);
    expect(caps.some((c) => c.capability === 'source.edit' && c.enabled)).toBe(true);
  });

  it('only recognizes the owner email as having permissions', async () => {
    const { manager } = await createManager();
    expect(manager.isOwnerEmail(DEFAULT_OWNER.email)).toBe(true);
    expect(manager.isOwnerEmail('someone@else.com')).toBe(false);
    expect(manager.hasPermission('someone@else.com', '*')).toBe(false);
  });

  it('seeds the owner-info document and allows the owner to update it', async () => {
    const { manager } = await createManager();
    const doc = manager.getDocument('owner-info');
    expect(doc).not.toBeNull();
    expect(doc!.title).toContain('Owner of Infinite OS');
    expect(doc!.locked).toBe(true);

    const updated = manager.upsertDocument('owner-info', 'Owner of Infinite OS v2', 'general', 'new body');
    expect(updated.body).toBe('new body');
  });

  it('prevents deleting locked documents but allows deleting custom ones', async () => {
    const { manager } = await createManager();
    expect(manager.deleteDocument('owner-info')).toBe(false);

    manager.upsertDocument('my-custom-note', 'Custom note', 'personal', 'body');
    expect(manager.deleteDocument('my-custom-note')).toBe(true);
    expect(manager.getDocument('my-custom-note')).toBeNull();
  });

  it('allows the owner to toggle premium capabilities off and on', async () => {
    const { manager } = await createManager();
    const off = manager.toggleCapability('source.edit', false);
    expect(off.find((c) => c.capability === 'source.edit')?.enabled).toBe(false);
    expect(manager.hasCapability(DEFAULT_OWNER.email, 'source.edit')).toBe(false);

    const on = manager.toggleCapability('source.edit', true);
    expect(on.find((c) => c.capability === 'source.edit')?.enabled).toBe(true);
  });

  it('logs every mutation to the audit trail', async () => {
    const { manager } = await createManager();
    manager.upsertDocument('audit-test', 'A', 'general', 'b');
    manager.toggleCapability('deploy.auto', false);
    const audit = manager.getAudit();
    expect(audit.some((e) => e.mutation === 'doc.create')).toBe(true);
    expect(audit.some((e) => e.mutation === 'capability.toggle')).toBe(true);
  });

  it('rejects non-owner mutations through requireOwner', async () => {
    const { manager } = await createManager();
    expect(() =>
      manager.requireOwner('intruder@example.com', { kind: 'profile.update' }, () => {
        manager.updateProfile({ fullName: 'Hacker' });
      }),
    ).toThrow(/only the Infinite OS owner/);
  });

  it('persists profile edits across reloads', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'infinite-os-owner-persist-'));
    createdDirectories.push(directory);
    const dbPath = join(directory, 'owner.db');

    const first = new OwnerManager(dbPath);
    first.updateProfile({ preferredName: 'A.M.' });
    first.close();

    const second = new OwnerManager(dbPath);
    expect(second.getProfile().preferredName).toBe('A.M.');
  });
});