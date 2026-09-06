// Shared owner-system types — used by main (owner manager + IPC) and renderer.

export type OwnerPermission = string;

export type PremiumCapability =
  | 'source.edit'
  | 'source.build'
  | 'self.hotswap'
  | 'backup.snapshot'
  | 'backup.restore'
  | 'git.power'
  | 'automation.system'
  | 'agent.roster'
  | 'audit.granular'
  | 'providers.manage'
  | 'memory.grand'
  | 'settings.system'
  | 'mcp.advanced'
  | 'deploy.auto'
  | 'plugins.advanced';

export interface OwnerProfile {
  id: string;
  fullName: string;
  preferredName: string;
  email: string;
  isOwner: boolean;
  role: 'owner';
  permissions: OwnerPermission[];
  premiumCapabilities: PremiumCapability[];
  verifiedAt: number;
  updatedAt: number;
}

export interface OwnerDocument {
  id: string;
  key: string;
  title: string;
  body: string;
  category: string;
  locked: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface OwnerPublicInfo {
  ownerName: string;
  isConfigured: boolean;
  capabilities: PremiumCapability[];
}

export interface OwnerAuditEntry {
  id: string;
  actor: string;
  mutation: string;
  detail?: string;
  timestamp: number;
}

export interface PremiumCapabilityStatus {
  capability: PremiumCapability;
  enabled: boolean;
}

export type OwnerMutation =
  | { kind: 'profile.update' }
  | { kind: 'doc.create' }
  | { kind: 'doc.update' }
  | { kind: 'doc.delete' }
  | { kind: 'grant.revoke'; permission: string }
  | { kind: 'capability.toggle'; capability: PremiumCapability }
  | { kind: 'owner.reset' };