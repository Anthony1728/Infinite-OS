// Skills system — store, import, and manage reusable AI skills.
// Skills can come from Claude Code, Cursor, or custom sources.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

export interface Skill {
  id: string;
  name: string;
  description: string;
  source: 'custom' | 'claude-code' | 'cursor' | 'imported';
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

export class SkillsManager {
  private skillsDir: string;
  private manifestPath: string;
  private manifest: SkillManifest;

  constructor(workspaceRoot?: string) {
    const baseDir = workspaceRoot ?? join(homedir(), '.infinite-ai');
    this.skillsDir = join(baseDir, 'skills');
    this.manifestPath = join(this.skillsDir, 'manifest.json');

    if (!existsSync(this.skillsDir)) {
      mkdirSync(this.skillsDir, { recursive: true });
    }

    this.manifest = this.loadManifest();
  }

  private loadManifest(): SkillManifest {
    try {
      if (existsSync(this.manifestPath)) {
        return JSON.parse(readFileSync(this.manifestPath, 'utf-8'));
      }
    } catch { /* ignore */ }
    return { version: '1.0.0', skills: [] };
  }

  private saveManifest(): void {
    writeFileSync(this.manifestPath, JSON.stringify(this.manifest, null, 2));
  }

  listSkills(): Skill[] {
    return this.manifest.skills.filter((s) => s.enabled);
  }

  listAllSkills(): Skill[] {
    return [...this.manifest.skills];
  }

  getSkill(id: string): Skill | undefined {
    return this.manifest.skills.find((s) => s.id === id);
  }

  addSkill(skill: Omit<Skill, 'id' | 'created' | 'updated'>): Skill {
    const existing = this.manifest.skills.find((s) => s.name === skill.name && s.source === skill.source);
    if (existing) {
      throw new Error(`Skill "${skill.name}" already exists from ${skill.source}`);
    }

    const newSkill: Skill = {
      ...skill,
      id: `skill-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      created: Date.now(),
      updated: Date.now(),
    };

    this.manifest.skills.push(newSkill);
    this.saveManifest();
    return newSkill;
  }

  updateSkill(id: string, updates: Partial<Skill>): Skill | null {
    const idx = this.manifest.skills.findIndex((s) => s.id === id);
    if (idx === -1) return null;

    this.manifest.skills[idx] = {
      ...this.manifest.skills[idx],
      ...updates,
      updated: Date.now(),
    };
    this.saveManifest();
    return this.manifest.skills[idx];
  }

  removeSkill(id: string): boolean {
    const idx = this.manifest.skills.findIndex((s) => s.id === id);
    if (idx === -1) return false;
    this.manifest.skills.splice(idx, 1);
    this.saveManifest();
    return true;
  }

  toggleSkill(id: string): Skill | null {
    const skill = this.getSkill(id);
    if (!skill) return null;
    return this.updateSkill(id, { enabled: !skill.enabled });
  }

  searchSkills(query: string): Skill[] {
    const q = query.toLowerCase();
    return this.manifest.skills.filter(
      (s) =>
        s.enabled &&
        (s.name.toLowerCase().includes(q) ||
          s.description.toLowerCase().includes(q) ||
          s.category.toLowerCase().includes(q) ||
          s.triggers?.some((t) => t.toLowerCase().includes(q)))
    );
  }

  // Import from Claude Code format
  importClaudeCodeSkill(filePath: string): Skill {
    const content = readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');
    let name = '';
    let description = '';
    let instructions = '';
    let category = 'imported';

    // Parse Claude Code skill format
    for (const line of lines) {
      if (line.startsWith('# ')) {
        name = line.slice(2).trim();
      } else if (line.startsWith('description:')) {
        description = line.slice(12).trim();
      } else if (line.startsWith('category:')) {
        category = line.slice(9).trim();
      }
    }

    instructions = content;

    return this.addSkill({
      name: name || 'Unnamed Skill',
      description: description || 'Imported from Claude Code',
      source: 'claude-code',
      category,
      instructions,
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

  // Export skills for sharing
  exportSkills(skillIds?: string[]): SkillManifest {
    const skills = skillIds
      ? this.manifest.skills.filter((s) => skillIds.includes(s.id))
      : this.manifest.skills;
    return { version: this.manifest.version, skills };
  }

  // Get skills relevant to a task
  getRelevantSkills(taskDescription: string): Skill[] {
    const words = taskDescription.toLowerCase().split(/\s+/);
    return this.manifest.skills.filter((s) => {
      if (!s.enabled) return false;
      const text = `${s.name} ${s.description} ${s.category} ${(s.triggers ?? []).join(' ')}`.toLowerCase();
      return words.some((w) => w.length > 3 && text.includes(w));
    });
  }

  getStats(): { total: number; enabled: number; bySource: Record<string, number>; byCategory: Record<string, number> } {
    const bySource: Record<string, number> = {};
    const byCategory: Record<string, number> = {};
    let enabled = 0;

    for (const s of this.manifest.skills) {
      if (s.enabled) enabled++;
      bySource[s.source] = (bySource[s.source] || 0) + 1;
      byCategory[s.category] = (byCategory[s.category] || 0) + 1;
    }

    return { total: this.manifest.skills.length, enabled, bySource, byCategory };
  }
}

