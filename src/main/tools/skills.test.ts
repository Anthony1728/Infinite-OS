import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  interface FakeSkill {
    id: string;
    name: string;
    description: string;
    category: string;
    source: string;
    instructions: string;
    triggers?: string[];
    examples?: string[];
    enabled: boolean;
  }
  class FakeSkillsManager {
    static personal = new Map<string, FakeSkill>();
    static workspace = new Map<string, FakeSkill>();
    isPersonal: boolean;

    constructor(opts?: { workspaceRoot?: string }) {
      this.isPersonal = !opts?.workspaceRoot;
    }

    private store(): Map<string, FakeSkill> {
      return this.isPersonal ? FakeSkillsManager.personal : FakeSkillsManager.workspace;
    }

    private all(): FakeSkill[] {
      return [...FakeSkillsManager.workspace.values(), ...FakeSkillsManager.personal.values()];
    }

    listAllSkills(): FakeSkill[] {
      return this.all();
    }

    listSkills(): FakeSkill[] {
      return this.all().filter((s) => s.enabled);
    }

    getSkill(idOrName: string): FakeSkill | undefined {
      return this.all().find((s) => s.id === idOrName || s.name === idOrName);
    }

    getOwnSkill(idOrName: string): FakeSkill | undefined {
      return findByKey(this.store(), idOrName);
    }

    searchSkills(query: string): FakeSkill[] {
      return this.all().filter((s) => s.enabled && (s.name + s.description).toLowerCase().includes(query.toLowerCase()));
    }

    getRelevantSkills(_task: string, limit = 5): FakeSkill[] {
      return this.all().filter((s) => s.enabled && s.description.toLowerCase().includes('debug')).slice(0, limit);
    }

    addSkill(input: { name: string; description: string; category?: string; instructions: string; triggers?: string[]; examples?: string[]; enabled?: boolean }): FakeSkill {
      const skill: FakeSkill = {
        id: `skill-${input.name}`,
        name: input.name.toLowerCase(),
        description: input.description,
        category: input.category ?? 'custom',
        source: 'custom',
        instructions: input.instructions,
        triggers: input.triggers,
        examples: input.examples,
        enabled: input.enabled !== false,
      };
      this.store().set(skill.id, skill);
      return skill;
    }

    updateSkill(idOrName: string, updates: Partial<FakeSkill>): FakeSkill | null {
      const existing = findByKey(this.store(), idOrName);
      if (!existing) return null;
      const updated = { ...existing, ...updates };
      this.store().set(updated.id, updated);
      return updated;
    }

    toggleSkill(idOrName: string): FakeSkill | null {
      const existing = findByKey(this.store(), idOrName);
      if (!existing) return null;
      const updated = { ...existing, enabled: !existing.enabled };
      this.store().set(updated.id, updated);
      return updated;
    }

    removeSkill(idOrName: string): boolean {
      const existing = findByKey(this.store(), idOrName);
      return existing ? this.store().delete(existing.id) : false;
    }
  }
  function findByKey(store: Map<string, FakeSkill>, key: string): FakeSkill | undefined {
    return [...store.values()].find((s) => s.id === key || s.name === key);
  }
  return { FakeSkillsManager };
});

vi.mock('../skills/manager.js', () => ({
  SkillsManager: mocks.FakeSkillsManager,
}));

import { skillsTool, skillManageTool } from './skills.js';
import type { ToolContext } from './base.js';

function ctx(): ToolContext {
  return { cwd: 'C:\\work\\project', abortSignal: new AbortController().signal, sessionId: 's1', onUpdate: () => {} };
}

beforeEach(() => {
  mocks.FakeSkillsManager.personal.clear();
  mocks.FakeSkillsManager.workspace.clear();
});

describe('Skills tool', () => {
  it('lists the compact catalog with a progressive-disclosure hint', async () => {
    mocks.FakeSkillsManager.personal.set('skill-a', { id: 'skill-a', name: 'code-review', description: 'Review code.', category: 'development', source: 'bundled', instructions: 'x', enabled: true });
    const result = await skillsTool.execute({ action: 'list' }, ctx());
    const parsed = JSON.parse(String(result.content)) as { total: number; skills: string[]; hint: string };
    expect(parsed.total).toBe(1);
    expect(parsed.skills[0]).toContain('code-review');
    expect(parsed.hint).toContain('invoke');
  });

  it('searches and ranks relevant skills', async () => {
    mocks.FakeSkillsManager.personal.set('skill-b', { id: 'skill-b', name: 'debug-pro', description: 'Debugging helper.', category: 'development', source: 'custom', instructions: 'steps', enabled: true });
    const search = await skillsTool.execute({ action: 'search', query: 'debug' }, ctx());
    expect(String(search.content)).toContain('debug-pro');
    const relevant = await skillsTool.execute({ action: 'relevant', query: 'debug this crash' }, ctx());
    expect(String(relevant.content)).toContain('debug-pro');
  });

  it('invoke returns the full instructions of one skill', async () => {
    mocks.FakeSkillsManager.personal.set('skill-c', { id: 'skill-c', name: 'meeting-notes', description: 'Take notes.', category: 'productivity', source: 'bundled', instructions: '1. Summarize\n2. List actions', enabled: true });
    const result = await skillsTool.execute({ action: 'invoke', skill: 'meeting-notes' }, ctx());
    expect(result.is_error).toBeUndefined();
    expect(String(result.content)).toContain('# Skill: meeting-notes');
    expect(String(result.content)).toContain('1. Summarize');
  });

  it('reports unknown skills and unknown actions', async () => {
    const missing = await skillsTool.execute({ action: 'invoke', skill: 'nope' }, ctx());
    expect(missing.is_error).toBe(true);
    expect(String(missing.content)).toContain('not found');

    const unknown = await skillsTool.execute({ action: 'explode' }, ctx());
    expect(unknown.is_error).toBe(true);
  });
});

describe('SkillManage tool', () => {
  it('creates a personal skill by default with the stored path', async () => {
    const result = await skillManageTool.execute(
      { action: 'create', name: 'onboarding', description: 'Onboard a user.', category: 'productivity', instructions: 'Step 1, step 2.' },
      ctx()
    );
    const parsed = JSON.parse(String(result.content)) as { ok: boolean; stored: string };
    expect(parsed.ok).toBe(true);
    expect(parsed.stored).toContain('skills/onboarding');
    expect(mocks.FakeSkillsManager.personal.has('skill-onboarding')).toBe(true);
  });

  it('creates a workspace skill when scoped', async () => {
    const result = await skillManageTool.execute(
      { action: 'create', name: 'ws-skill', description: 'Project skill.', instructions: 'Do the thing.', scope: 'workspace' },
      ctx()
    );
    const parsed = JSON.parse(String(result.content)) as { stored: string };
    expect(parsed.stored).toContain('.infinite/skills/ws-skill');
    expect(mocks.FakeSkillsManager.workspace.has('skill-ws-skill')).toBe(true);
    expect(mocks.FakeSkillsManager.personal.has('skill-ws-skill')).toBe(false);
  });

  it('requires name, description, and instructions on create', async () => {
    const result = await skillManageTool.execute({ action: 'create', name: 'x', description: 'd' }, ctx());
    expect(result.is_error).toBe(true);
  });

  it('updates and toggles a workspace skill', async () => {
    await skillManageTool.execute({ action: 'create', name: 'ws-skill', description: 'v1', instructions: 'x', scope: 'workspace' }, ctx());
    const updated = await skillManageTool.execute({ action: 'update', skill: 'ws-skill', description: 'v2' }, ctx());
    expect(String(updated.content)).toContain('v2');

    const toggled = await skillManageTool.execute({ action: 'toggle', skill: 'ws-skill' }, ctx());
    expect(String(toggled.content)).toContain('"enabled": false');
  });

  it('falls back to the personal store for skills not in the workspace', async () => {
    mocks.FakeSkillsManager.personal.set('skill-personal', { id: 'skill-personal', name: 'personal-skill', description: 'mine', category: 'custom', source: 'custom', instructions: 'x', enabled: true });
    const result = await skillManageTool.execute({ action: 'toggle', skill: 'personal-skill' }, ctx());
    expect(result.is_error).toBeUndefined();
    expect(mocks.FakeSkillsManager.personal.get('skill-personal')?.enabled).toBe(false);
  });

  it('deletes skills and reports misses', async () => {
    await skillManageTool.execute({ action: 'create', name: 'tmp-skill', description: 't', instructions: 'x' }, ctx());
    const deleted = await skillManageTool.execute({ action: 'delete', skill: 'tmp-skill' }, ctx());
    expect(String(deleted.content)).toContain('"ok": true');
    expect(mocks.FakeSkillsManager.personal.size).toBe(0);

    const missing = await skillManageTool.execute({ action: 'delete', skill: 'ghost' }, ctx());
    expect(missing.is_error).toBe(true);
  });
});
