import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SkillsManager } from './manager.js';

let personal = '';
let workspace = '';

beforeEach(() => {
  personal = mkdtempSync(join(tmpdir(), 'infinite-skills-personal-'));
  workspace = mkdtempSync(join(tmpdir(), 'infinite-skills-workspace-'));
});

afterEach(() => {
  rmSync(personal, { recursive: true, force: true });
  rmSync(workspace, { recursive: true, force: true });
});

function personalManager(options: { seedBundled?: boolean } = {}) {
  return new SkillsManager({ personalDir: personal, seedBundled: options.seedBundled ?? false });
}

describe('SkillsManager CRUD', () => {
  it('adds, lists, gets, updates, toggles, and removes skills as SKILL.md files', () => {
    const manager = personalManager();
    expect(manager.listAllSkills()).toEqual([]);

    const created = manager.addSkill({
      name: 'Deep Research!',
      description: 'Do thorough research.',
      category: 'research',
      instructions: '1. Plan\n2. Gather\n3. Cite',
      triggers: ['research', 'sources'],
    });
    expect(created.name).toBe('deep-research');
    expect(created.id).toMatch(/^skill-/);
    expect(manager.listAllSkills()).toHaveLength(1);

    const filePath = join(personal, 'deep-research', 'SKILL.md');
    expect(existsSync(filePath)).toBe(true);

    const reloaded = new SkillsManager({ personalDir: personal, seedBundled: false });
    expect(reloaded.getSkill('deep-research')?.description).toBe('Do thorough research.');
    expect(reloaded.getSkill(created.id)?.name).toBe('deep-research');

    const updated = manager.updateSkill(created.id, { description: 'v2' });
    expect(updated?.description).toBe('v2');
    expect(reloaded.getSkill('deep-research')?.description).toBe('v2');

    expect(manager.toggleSkill('deep-research')?.enabled).toBe(false);
    expect(manager.listSkills()).toHaveLength(0);
    expect(manager.searchSkills('research')).toHaveLength(0);

    expect(manager.removeSkill('deep-research')).toBe(true);
    expect(manager.listAllSkills()).toEqual([]);
    expect(manager.removeSkill('deep-research')).toBe(false);
  });

  it('rejects duplicate names', () => {
    const manager = personalManager();
    manager.addSkill({ name: 'code-review', description: 'a', instructions: 'x' });
    expect(() =>
      manager.addSkill({ name: 'Code Review', description: 'b', instructions: 'y' })
    ).toThrow(/already exists/);
  });

  it('requires a valid name for new skills', () => {
    const manager = personalManager();
    expect(() => manager.addSkill({ name: '!!!', description: 'a', instructions: 'x' })).toThrow();
  });

  it('searches by name, description, category, and triggers', () => {
    const manager = personalManager();
    manager.addSkill({ name: 'code-review', description: 'Review code.', category: 'development', triggers: ['review'], instructions: 'x' });
    manager.addSkill({ name: 'meeting-notes', description: 'Take notes.', category: 'productivity', instructions: 'x' });
    expect(manager.searchSkills('review')).toHaveLength(1);
    expect(manager.searchSkills('notes')).toHaveLength(1);
    expect(manager.searchSkills('DEVELOPMENT')).toHaveLength(1);
    expect(manager.searchSkills('zzz')).toHaveLength(0);
  });

  it('ranks relevant skills: triggers > name > description', () => {
    const manager = personalManager();
    manager.addSkill({ name: 'alpha', description: 'Nothing about debugging.', triggers: ['debug'], instructions: 'x' });
    manager.addSkill({ name: 'debug-pro', description: 'Debugging helper.', instructions: 'x' });
    const relevant = manager.getRelevantSkills('please debug this crash for me');
    expect(relevant[0].name).toBe('alpha');
    expect(relevant.map((s) => s.name)).toContain('debug-pro');
  });

  it('does not return disabled skills from relevance or search', () => {
    const manager = personalManager();
    manager.addSkill({ name: 'alpha', description: 'Uses debug.', triggers: ['debug'], instructions: 'x' });
    const disabled = manager.addSkill({ name: 'beta', description: 'Also debug.', instructions: 'x' });
    manager.updateSkill(disabled.id, { enabled: false });
    expect(manager.getRelevantSkills('debug it')).toHaveLength(1);
  });

  it('reports stats by source and category', () => {
    const manager = personalManager();
    manager.addSkill({ name: 'a-skill', description: 'a', category: 'development', instructions: 'x' });
    manager.addSkill({ name: 'b-skill', description: 'b', category: 'research', instructions: 'x' });
    manager.addSkill({ name: 'c-skill', description: 'c', category: 'development', instructions: 'x' });
    manager.updateSkill('c-skill', { enabled: false });
    const stats = manager.getStats();
    expect(stats.total).toBe(3);
    expect(stats.enabled).toBe(2);
    expect(stats.byCategory.development).toBe(2);
    expect(stats.bySource.custom).toBe(3);
  });
});

describe('SkillsManager workspace mode', () => {
  it('merges personal and workspace skills with workspace winning by name', () => {
    const personalMgr = personalManager();
    personalMgr.addSkill({ name: 'meeting-notes', description: 'personal version', instructions: 'personal' });
    personalMgr.addSkill({ name: 'code-review', description: 'personal only', instructions: 'x' });

    const wsMgr = new SkillsManager({ personalDir: personal, workspaceRoot: workspace, seedBundled: false });
    wsMgr.addSkill({ name: 'meeting-notes', description: 'workspace version', instructions: 'workspace' });

    const merged = wsMgr.listAllSkills();
    expect(merged).toHaveLength(2);
    expect(wsMgr.getSkill('meeting-notes')?.description).toBe('workspace version');
    expect(wsMgr.getSkill('code-review')?.description).toBe('personal only');

    expect(wsMgr.isPersonal).toBe(false);
    expect(existsSync(join(workspace, '.infinite', 'skills', 'meeting-notes', 'SKILL.md'))).toBe(true);
    expect(existsSync(join(personal, 'meeting-notes', 'SKILL.md'))).toBe(true);
  });

  it('writes mutations to the workspace store only', () => {
    const wsMgr = new SkillsManager({ personalDir: personal, workspaceRoot: workspace, seedBundled: false });
    wsMgr.addSkill({ name: 'local-skill', description: 'ws', instructions: 'y' });
    expect(existsSync(join(workspace, '.infinite', 'skills', 'local-skill', 'SKILL.md'))).toBe(true);
    expect(existsSync(join(personal, 'local-skill', 'SKILL.md'))).toBe(false);

    expect(wsMgr.removeSkill('code-review-not-there')).toBe(false);
  });

  it('does not create the workspace skills dir for read-only use', () => {
    const wsMgr = new SkillsManager({ personalDir: personal, workspaceRoot: workspace, seedBundled: false });
    expect(wsMgr.listAllSkills()).toEqual([]);
    expect(existsSync(join(workspace, '.infinite'))).toBe(false);
  });
});

describe('SkillsManager bundled seeding', () => {
  it('seeds the bundled catalog once, then marks the profile', () => {
    const manager = new SkillsManager({ personalDir: personal, seedBundled: true });
    const skills = manager.listAllSkills();
    expect(skills.length).toBeGreaterThanOrEqual(5);
    expect(skills.every((s) => s.source === 'bundled' && s.enabled)).toBe(true);
    expect(existsSync(join(personal, '.bundled-seeded'))).toBe(true);

    // Re-instantiating does not duplicate bundled skills.
    const again = new SkillsManager({ personalDir: personal, seedBundled: true });
    expect(again.listAllSkills()).toHaveLength(skills.length);
  });

  it('does not overwrite a user skill that shares a bundled name', () => {
    const manager = personalManager();
    manager.addSkill({ name: 'code-review', description: 'user edition', instructions: 'mine' });
    const seeded = new SkillsManager({ personalDir: personal, seedBundled: true });
    expect(seeded.getSkill('code-review')?.description).toBe('user edition');
  });

  it('is skipped when seedBundled is false', () => {
    const manager = personalManager();
    expect(manager.listAllSkills()).toEqual([]);
  });

  it('bundled catalog is valid: unique names, real descriptions, complete instructions', () => {
    const manager = new SkillsManager({ personalDir: personal, seedBundled: true });
    const skills = manager.listAllSkills();
    const names = skills.map((s) => s.name);
    expect(new Set(names).size).toBe(names.length);
    for (const skill of skills) {
      expect(skill.description.length).toBeGreaterThan(20);
      expect(skill.instructions.length).toBeGreaterThan(200);
      expect(skill.category).toBeTruthy();
      expect(Array.isArray(skill.triggers) && skill.triggers.length > 0).toBe(true);
      expect(skill.instructions.startsWith('# ')).toBe(true);
    }
    // New bundled skills from this feature set.
    expect(names).toContain('automation-builder');
    expect(names).toContain('api-designer');
    expect(names).toContain('data-analysis');
    expect(names).toContain('sql-analyst');
    expect(names).toContain('prompt-engineering');
    expect(names).toContain('system-design');
  });
});

describe('SkillsManager legacy manifest migration', () => {
  it('migrates manifest.json skills into SKILL.md files once', () => {
    writeFileSync(
      join(personal, 'manifest.json'),
      JSON.stringify({
        version: '1.0.0',
        skills: [
          { id: 'skill-old-1', name: 'Legacy Skill', source: 'claude-code', category: 'imported', description: 'old', instructions: 'old steps', enabled: true, created: 1, updated: 2 },
          { id: 'skill-old-2', name: 'another-one', source: 'custom', category: 'custom', description: 'd2', instructions: 'steps 2', enabled: false, created: 3, updated: 4, triggers: ['t1'] },
        ],
      })
    );

    const manager = personalManager();
    const skills = manager.listAllSkills();
    expect(skills).toHaveLength(2);
    const legacy = skills.find((s) => s.name === 'legacy-skill');
    expect(legacy?.id).toBe('skill-old-1');
    expect(legacy?.source).toBe('claude-code');
    expect(legacy?.instructions).toBe('old steps');
    const disabled = skills.find((s) => s.name === 'another-one');
    expect(disabled?.enabled).toBe(false);
    expect(disabled?.triggers).toEqual(['t1']);

    expect(existsSync(join(personal, 'manifest.migrated.json'))).toBe(true);
    expect(existsSync(join(personal, 'manifest.json'))).toBe(false);

    // Migration does not run twice.
    const again = personalManager();
    expect(again.listAllSkills()).toHaveLength(2);
  });
});

describe('SkillsManager imports and exports', () => {
  it('imports Claude Code skills and creates skills from conversation', () => {
    const manager = personalManager();
    const source = join(personal, 'claude-skill.md');
    writeFileSync(source, '# My Tool\ndescription: Does things.\ncategory: tools\nBody text here.');
    const imported = manager.importClaudeCodeSkill(source);
    expect(imported.source).toBe('claude-code');
    expect(imported.description).toBe('Does things.');
    expect(manager.getSkill('my-tool')?.instructions).toContain('Body text here.');

    const fromChat = manager.createFromConversation('chat-skill', 'Learned', 'Steps');
    expect(fromChat.source).toBe('custom');
    expect(manager.getSkill('chat-skill')?.instructions).toBe('Steps');
  });

  it('exports selected skills as a manifest', () => {
    const manager = personalManager();
    const a = manager.addSkill({ name: 'aaa', description: 'a', instructions: 'x' });
    manager.addSkill({ name: 'bbb', description: 'b', instructions: 'y' });
    const exported = manager.exportSkills([a.id]);
    expect(exported.skills).toHaveLength(1);
    expect(exported.skills[0].name).toBe('aaa');
  });
});
