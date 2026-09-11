/**
 * Company board — the Enterprise tab's editable company profile. Both the
 * user (Enterprise view) and Infinite AI (EnterpriseCompany tool) read and
 * write the same company.json, so the agent can record complaints, decisions,
 * contacts, and situational notes against the user's actual company — and the
 * user sees everything it adds, edits, or removes.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { infiniteHome } from '../profiles/home.js';

export type CompanyNoteKind = 'note' | 'complaint' | 'decision' | 'contact';

export interface CompanyNote {
  id: string;
  kind: CompanyNoteKind;
  text: string;
  /** Who wrote it: the owner in the UI, or the agent acting for them. */
  by: 'user' | 'agent';
  createdAt: number;
}

export interface CompanyProfile {
  name: string;
  industry: string;
  website: string;
  notes: CompanyNote[];
  updatedAt: number;
}

const EMPTY: CompanyProfile = { name: '', industry: '', website: '', notes: [], updatedAt: 0 };

function filePath(): string {
  return join(infiniteHome(), 'enterprise', 'company.json');
}

export function getCompany(): CompanyProfile {
  try {
    const p = filePath();
    if (!existsSync(p)) return { ...EMPTY };
    const raw = JSON.parse(readFileSync(p, 'utf8')) as Partial<CompanyProfile>;
    return {
      name: typeof raw.name === 'string' ? raw.name : '',
      industry: typeof raw.industry === 'string' ? raw.industry : '',
      website: typeof raw.website === 'string' ? raw.website : '',
      notes: Array.isArray(raw.notes) ? raw.notes.filter((n) => n && typeof n.text === 'string') : [],
      updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : 0,
    };
  } catch {
    return { ...EMPTY };
  }
}

function save(profile: CompanyProfile): CompanyProfile {
  const next = { ...profile, updatedAt: Date.now() };
  mkdirSync(join(infiniteHome(), 'enterprise'), { recursive: true });
  writeFileSync(filePath(), JSON.stringify(next, null, 2), 'utf8');
  return next;
}

export function updateCompany(patch: { name?: string; industry?: string; website?: string }): CompanyProfile {
  const cur = getCompany();
  return save({
    ...cur,
    ...(typeof patch.name === 'string' ? { name: patch.name } : {}),
    ...(typeof patch.industry === 'string' ? { industry: patch.industry } : {}),
    ...(typeof patch.website === 'string' ? { website: patch.website } : {}),
  });
}

export function addCompanyNote(
  text: string,
  kind: CompanyNoteKind = 'note',
  by: 'user' | 'agent' = 'user',
): CompanyNote {
  const cur = getCompany();
  const note: CompanyNote = { id: randomUUID(), kind, text, by, createdAt: Date.now() };
  save({ ...cur, notes: [note, ...cur.notes] });
  return note;
}

export function deleteCompanyNote(id: string): boolean {
  const cur = getCompany();
  if (!cur.notes.some((n) => n.id === id)) return false;
  save({ ...cur, notes: cur.notes.filter((n) => n.id !== id) });
  return true;
}
