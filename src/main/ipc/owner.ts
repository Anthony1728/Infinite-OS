// Owner System IPC handlers

import { ipcMain } from 'electron';
import { IPC } from '../../shared/ipc.js';
import { getOwnerManager } from '../owner/manager.js';
import type { OwnerDocument, OwnerProfile, PremiumCapability } from '../../shared/owner.js';

const ownerManager = getOwnerManager();

// The renderer may pass the owner email explicitly for safety checks, or use
// the verified owner stored on disk. Reads are safe always; writes are guarded
// by isOwnerEmail so a non-owner caller cannot mutate owner records.
function guardEmail(email?: string | null): string {
  return ownerManager.isOwnerEmail(email) ? (email as string) : ownerManager.getProfile().email;
}

export function registerOwnerIpc(): void {
  ipcMain.handle(IPC.OWNER_GET_PROFILE, async (): Promise<OwnerProfile> => ownerManager.getProfile());

  ipcMain.handle(IPC.OWNER_GET_PUBLIC_INFO, async () => ownerManager.getPublicInfo());

  ipcMain.handle(
    IPC.OWNER_UPDATE_PROFILE,
    async (_e, args: { email?: string; updates: Partial<Pick<OwnerProfile, 'fullName' | 'preferredName' | 'email'>> }) => {
      const actor = guardEmail(args?.email);
      return ownerManager.requireOwner(actor, { kind: 'profile.update' }, () =>
        ownerManager.updateProfile(args.updates),
      );
    },
  );

  ipcMain.handle(IPC.OWNER_LIST_DOCUMENTS, async (): Promise<OwnerDocument[]> => ownerManager.listDocuments());

  ipcMain.handle(IPC.OWNER_GET_DOCUMENT, async (_e, args: { key: string }) => ownerManager.getDocument(args.key));

  ipcMain.handle(
    IPC.OWNER_UPSERT_DOCUMENT,
    async (_e, args: { email?: string; key: string; title: string; category?: string; body: string }) => {
      const actor = guardEmail(args?.email);
      const existing = ownerManager.getDocument(args.key);
      return ownerManager.requireOwner(actor, { kind: existing ? 'doc.update' : 'doc.create' }, () =>
        ownerManager.upsertDocument(args.key, args.title, args.category ?? 'general', args.body),
      );
    },
  );

  ipcMain.handle(
    IPC.OWNER_DELETE_DOCUMENT,
    async (_e, args: { email?: string; key: string }) => {
      const actor = guardEmail(args?.email);
      return ownerManager.requireOwner(actor, { kind: 'doc.delete' }, () => ownerManager.deleteDocument(args.key));
    },
  );

  ipcMain.handle(IPC.OWNER_LIST_CAPABILITIES, async () => ownerManager.listPremiumCapabilities());

  ipcMain.handle(
    IPC.OWNER_TOGGLE_CAPABILITY,
    async (_e, args: { email?: string; capability: PremiumCapability; enabled: boolean }) => {
      const actor = guardEmail(args?.email);
      return ownerManager.requireOwner(
        actor,
        { kind: 'capability.toggle', capability: args.capability },
        () => ownerManager.toggleCapability(args.capability, args.enabled),
      );
    },
  );

  ipcMain.handle(IPC.OWNER_GET_AUDIT, async (_e, args?: { limit?: number }) => ownerManager.getAudit(args?.limit));
}