// Skills system — store, import, and manage reusable AI skills.
// Skills live as SKILL.md files (agentskills.io format, used by Hermes Agent
// and OpenClaw) in <base>/<name>/SKILL.md. The manager keeps the original
// API surface and adds:
//   - file-based persistence (human-editable, versionable, importable)
//   - personal + workspace precedence (workspace overrides personal)
//   - a bundled starter catalog seeded into fresh profiles
//   - one-time migration from the legacy manifest.json store

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { BUNDLED_SKILLS } from './bundled.js';
import { SkillFileStore, slugifySkillName } from './skill-store.js';

export interface Skill {
  id: string;
  name: string;
  description: string;
  source: 'custom' | 'claude-code' | 'cursor' | 'imported' | 'bundled' | 'workspace';
  category: string;
  instructions: string;
  tools?: SkillTool[];
  triggers?: string[];
  examples?: string[];
  created: number;
  updated: number;
  enabled: boolean;
}

export interface SkillTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  execute: string; // JS function body or command template
}

export interface SkillManifest {
  version: string;
  skills: Skill[];
}

/** Everything needed to author a skill; defaults fill the rest. */
export type SkillDraft = Omit<Partial<Skill>, 'id' | 'created' | 'updated'> & {
  name: string;
  description: string;
  instructions: string;
};

export interface SkillsManagerOptions {
  workspaceRoot?: string;
  /** Override the personal profile skills dir (tests). Defaults to ~/.infinite-ai/skills. */
  personalDir?: string;
  seedBundled?: boolean;
}

const DEFAULT_OPTIONS: SkillsManagerOptions = { seedBundled: true };

export class SkillsManager {
  /** Personal profile skills: ~/.infinite-ai/skills */
  readonly personalDir: string;
  /** Active store: workspace (<workspaceRoot>/.infinite/skills) or personal. */
  readonly ownDir: string;

  private readonly personalStore: SkillFileStore;
  private readonly ownStore: SkillFileStore;

  constructor(workspaceRootOrOptions?: string | SkillsManagerOptions) {
    const options: SkillsManagerOptions =
      typeof workspaceRootOrOptions === 'string'
        ? { workspaceRoot: workspaceRootOrOptions, seedBundled: true }
        : { ...DEFAULT_OPTIONS, ...(workspaceRootOrOptions ?? {}) };

    this.personalDir = options.personalDir ?? join(homedir(), '.infinite-ai', 'skills');
    this.ownDir = options.workspaceRoot
      ? join(options.workspaceRoot, '.infinite', 'skills')
      : this.personalDir;

    // Only the personal store is created eagerly; the workspace store is
    // created lazily on first write so read-only use never litters a project.
    mkdirSync(this.personalDir, { recursive: true });
    this.personalStore = new SkillFileStore(this.personalDir);
    this.ownStore = new SkillFileStore(this.ownDir);

    this.migrateLegacyManifest(this.personalStore);
    if (options.seedBundled !== false) this.seedBundledIfNeeded();
  }

  /** Whether this manager writes to the personal profile store. */
  get isPersonal(): boolean {
    return this.ownDir === this.personalDir;
  }

  // -------------------------------------------------------------------------
  // Reading — merged view (workspace overrides personal by name)
  // -------------------------------------------------------------------------

  /** All skills visible here: personal + workspace, workspace wins by name. */
  listAllSkills(): Skill[] {
    return this.loadMerged();
  }

  /** Enabled skills in the merged view. */
  listSkills(): Skill[] {
    return this.loadMerged().filter((s) => s.enabled);
  }

  /** Find by id (exact) or name (case-insensitive) in the merged view. */
  getSkill(idOrName: string): Skill | undefined {
    const merged = this.loadMerged();
    const byId = merged.find((s) => s.id === idOrName);
    if (byId) return byId;
    const lower = idOrName.toLowerCase();
    return merged.find((s) => s.name.toLowerCase() === lower);
  }

  /** Find a skill writable by this manager (own store, not just the merged view). */
  getOwnSkill(idOrName: string): Skill | undefined {
    return this.findOwn(idOrName);
  }

  searchSkills(query: string): Skill[] {
    const q = query.toLowerCase();
    return this.loadMerged().filter(
      (s) =>
        s.enabled &&
        (s.name.toLowerCase().includes(q) ||
          s.description.toLowerCase().includes(q) ||
          s.category.toLowerCase().includes(q) ||
          (s.triggers ?? []).some((t) => t.toLowerCase().includes(q)))
    );
  }

  /** Ranked relevance: triggers > name > description/category, capped. */
  getRelevantSkills(taskDescription: string, limit = 5): Skill[] {
    const tokens = taskDescription.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2);
    if (!tokens.length) return [];
    const scored: Array<{ skill: Skill; score: number }> = [];
    for (const s of this.loadMerged()) {
      if (!s.enabled) continue;
      const name = s.name.toLowerCase();
      const description = s.description.toLowerCase();
      const category = s.category.toLowerCase();
      const triggers = (s.triggers ?? []).join(' ').toLowerCase();
      let score = 0;
      for (const token of tokens) {
        if (triggers.includes(token)) score += 3;
        if (name.includes(token)) score += 2;
        if (description.includes(token)) score += 1;
        if (category.includes(token)) score += 1;
      }
      if (score > 0) scored.push({ skill: s, score });
    }
    scored.sort((a, b) => b.score - a.score || a.skill.name.localeCompare(b.skill.name));
    return scored.slice(0, limit).map((s) => s.skill);
  }

  getStats(): { total: number; enabled: number; bySource: Record<string, number>; byCategory: Record<string, number> } {
    const bySource: Record<string, number> = {};
    const byCategory: Record<string, number> = {};
    let enabled = 0;
    for (const s of this.loadMerged()) {
      if (s.enabled) enabled++;
      bySource[s.source] = (bySource[s.source] || 0) + 1;
      byCategory[s.category] = (byCategory[s.category] || 0) + 1;
    }
    return { total: this.loadMerged().length, enabled, bySource, byCategory };
  }

  // -------------------------------------------------------------------------
  // Writing — mutations target the own (workspace) store
  // -------------------------------------------------------------------------

  addSkill(skill: SkillDraft): Skill {
    const slug = slugifySkillName(skill.name);
    // Workspace skills may override a personal/bundled skill of the same
    // name (workspace precedence), so uniqueness is scoped to this store.
    const own = this.loadSkillsFrom(this.ownStore);
    if (own.some((s) => s.name.toLowerCase() === slug)) {
      throw new Error(`Skill "${skill.name}" already exists`);
    }
    const now = Date.now();
    const newSkill: Skill = {
      ...skill,
      id: `skill-${now}-${Math.random().toString(36).slice(2, 8)}`,
      name: slug,
      source: skill.source ?? 'custom',
      category: skill.category || 'custom',
      created: now,
      updated: now,
      enabled: skill.enabled !== false,
    };
    this.writeOwn(newSkill);
    return newSkill;
  }

  updateSkill(idOrName: string, updates: Partial<Skill>): Skill | null {
    const existing = this.findOwn(idOrName);
    if (!existing) return null;
    const updated: Skill = {
      ...existing,
      ...updates,
      name: updates.name ? slugifySkillName(updates.name) : existing.name,
      updated: Date.now(),
    };
    this.writeOwn(updated);
    return updated;
  }

  removeSkill(idOrName: string): boolean {
    const existing = this.findOwn(idOrName);
    if (!existing) return false;
    return this.ownStore.remove(existing.name);
  }

  toggleSkill(idOrName: string): Skill | null {
    const existing = this.findOwn(idOrName);
    if (!existing) return null;
    return this.updateSkill(idOrName, { enabled: !existing.enabled });
  }

  // Import from Claude Code format (SKILL.md / # title style)
  importClaudeCodeSkill(filePath: string): Skill {
    const content = readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');
    let name = '';
    let description = '';
    let category = 'imported';

    for (const line of lines) {
      if (line.startsWith('# ')) {
        name = line.slice(2).trim();
      } else if (line.startsWith('description:')) {
        description = line.slice(12).trim();
      } else if (line.startsWith('category:')) {
        category = line.slice(9).trim();
      }
    }

    return this.addSkill({
      name: name || 'Unnamed Skill',
      description: description || 'Imported from Claude Code',
      source: 'claude-code',
      category,
      instructions: content,
      enabled: true,
    });
  }

  // Import from Cursor format
  importCursorSkill(filePath: string): Skill {
    const content = readFileSync(filePath, 'utf-8');
    let name = '';
    let description = '';

    try {
      const parsed = JSON.parse(content);
      name = parsed.name || '';
      description = parsed.description || '';
    } catch {
      name = filePath.split(/[/\\]/).pop()?.replace(/\.\w+$/, '') ?? 'Unnamed';
      description = 'Imported from Cursor';
    }

    return this.addSkill({
      name: name || 'Unnamed Skill',
      description: description || 'Imported from Cursor',
      source: 'cursor',
      category: 'imported',
      instructions: content,
      enabled: true,
    });
  }

  // Create a custom skill from chat conversation
  createFromConversation(name: string, description: string, instructions: string, category: string = 'custom'): Skill {
    return this.addSkill({
      name,
      description,
      source: 'custom',
      category,
      instructions,
      enabled: true,
    });
  }

  // Export skills for sharing (merged view)
  exportSkills(skillIds?: string[]): SkillManifest {
    const merged = this.loadMerged();
    const skills = skillIds ? merged.filter((s) => skillIds.includes(s.id)) : merged;
    return { version: '1.0.0', skills };
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private loadSkillsFrom(store: SkillFileStore): Skill[] {
    return store.list().map((file) => this.toSkill(file.name, file.frontmatter, file.instructions));
  }

  private toSkill(slug: string, frontmatter: Record<string, unknown>, instructions: string): Skill {
    const name = String(frontmatter.name ?? slug) || slug;
    const num = (value: unknown, fallback: number): number => {
      const n = typeof value === 'number' ? value : Number(value);
      return Number.isFinite(n) ? n : fallback;
    };
    return {
      id: String(frontmatter.id ?? `skill-${slug}`),
      name,
      description: String(frontmatter.description ?? ''),
      source: (frontmatter.source as Skill['source']) ?? 'custom',
      category: String(frontmatter.category ?? 'custom'),
      instructions,
      tools: Array.isArray(frontmatter.tools)
        ? (frontmatter.tools as unknown[]).map((t) => ({ name: String(t), description: '', inputSchema: {}, execute: '' }))
        : undefined,
      triggers: Array.isArray(frontmatter.triggers) ? (frontmatter.triggers as unknown[]).map(String) : undefined,
      examples: Array.isArray(frontmatter.examples) ? (frontmatter.examples as unknown[]).map(String) : undefined,
      created: num(frontmatter.created, Date.now()),
      updated: num(frontmatter.updated, Date.now()),
      enabled: frontmatter.enabled !== false && frontmatter.enabled !== 'false',
    };
  }

  private writeOwn(skill: Skill): void {
    this.ownStore.write({
      name: skill.name,
      id: skill.id,
      source: skill.source,
      description: skill.description,
      category: skill.category,
      enabled: skill.enabled,
      created: skill.created,
      updated: skill.updated,
      tools: (skill.tools ?? []).map((t) => t.name),
      triggers: skill.triggers,
      examples: skill.examples,
      instructions: skill.instructions,
    });
  }

  private loadMerged(): Skill[] {
    const personal = this.loadSkillsFrom(this.personalStore);
    if (this.isPersonal) return personal;
    const workspace = this.loadSkillsFrom(this.ownStore);
    const byName = new Map(personal.map((s) => [s.name.toLowerCase(), s]));
    for (const s of workspace) byName.set(s.name.toLowerCase(), s); // workspace wins
    return [...byName.values()];
  }

  /** Find a skill by id or name inside the own (writable) store only. */
  private findOwn(idOrName: string): Skill | undefined {
    const own = this.loadSkillsFrom(this.ownStore);
    const byId = own.find((s) => s.id === idOrName);
    if (byId) return byId;
    const lower = idOrName.toLowerCase();
    return own.find((s) => s.name.toLowerCase() === lower);
  }

  /** One-time migration from the legacy manifest.json store to SKILL.md files. */
  private migrateLegacyManifest(store: SkillFileStore): void {
    const manifestPath = join(store.baseDir, 'manifest.json');
    if (!existsSync(manifestPath)) return;
    try {
      const raw = JSON.parse(readFileSync(manifestPath, 'utf8')) as { skills?: Array<Partial<Skill> & { name: string }> };
      for (const s of raw.skills ?? []) {
        if (!s.name) continue;
        const slug = slugifySkillName(s.name);
        if (store.read(slug)) continue;
        const now = Date.now();
        store.write({
          name: slug,
          id: s.id,
          source: s.source ?? 'custom',
          description: s.description ?? 'Migrated skill',
          category: s.category ?? 'custom',
          enabled: s.enabled !== false,
          created: typeof s.created === 'number' ? s.created : now,
          updated: typeof s.updated === 'number' ? s.updated : now,
          tools: (s.tools ?? []).map((t) => t.name),
          triggers: s.triggers,
          examples: s.examples,
          instructions: s.instructions ?? '',
        });
      }
      store.moveManifestTo('manifest.json', 'manifest.migrated.json');
    } catch {
      // Leave the manifest untouched; migration retries on next launch.
    }
  }

  /** Seed the bundled starter catalog once per fresh profile (Hermes-style). */
  private seedBundledIfNeeded(): void {
    if (!this.isPersonal) return;
    const marker = join(this.personalDir, '.bundled-seeded');
    // Additive: seed any bundled skill that is missing. The marker only
    // suppresses the initial full seed; new bundled skills ship in app
    // updates and are added to existing profiles on next launch.
    let seeded = 0;
    for (const bundled of BUNDLED_SKILLS) {
      const slug = slugifySkillName(bundled.name);
      if (this.personalStore.read(slug)) continue;
      const now = Date.now();
      this.personalStore.write({
        name: slug,
        id: `skill-${slug}`,
        source: 'bundled',
        description: bundled.description,
        category: bundled.category,
        enabled: true,
        created: now,
        updated: now,
        triggers: bundled.triggers,
        examples: bundled.examples,
        instructions: bundled.instructions,
      });
      seeded++;
    }
    writeFileSync(marker, JSON.stringify({ seededAt: Date.now(), count: BUNDLED_SKILLS.length, lastSeeded: seeded }));
  }
}
