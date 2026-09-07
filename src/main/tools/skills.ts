// Agent-facing skills tools — progressive disclosure (Hermes/OpenClaw style).
// The catalog stays compact in the system prompt; `Skills invoke` loads the
// full instructions of one skill on demand. `SkillManage` gives the agent
// procedural memory: it can author, edit, and retire reusable skills.

import type { Tool, ToolResult } from './base.js';
import { SkillsManager } from '../skills/manager.js';
import { infiniteHome } from '../profiles/home.js';
import { join } from 'node:path';

interface SkillInput {
  action: string;
  skill?: string;
  query?: string;
  category?: string;
  limit?: number;
}

export const skillsTool: Tool = {
  name: 'Skills',
  description: 'Browse and load reusable procedural skills (SKILL.md). Actions: list (catalog), search (query), relevant (task), invoke (skill name or id — returns the full instructions to follow). Skills are compact in the prompt; invoke loads the details only when needed.',
  inputSchema: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['list', 'search', 'relevant', 'invoke'] },
      skill: { type: 'string', description: 'Skill name or id (for invoke).' },
      query: { type: 'string', description: 'Search text (for search).' },
      category: { type: 'string', description: 'Optional category filter (for list).' },
      limit: { type: 'number', description: 'Max results (default 20).' },
    },
    required: ['action'],
  },
  permission: 'none',

  async execute(args, ctx): Promise<ToolResult> {
    const input = args as SkillInput;
    const manager = new SkillsManager({ workspaceRoot: ctx.cwd });
    try {
      switch (input.action) {
        case 'list': {
          const all = manager.listAllSkills();
          const categoryFilter = input.category;
          const filtered = categoryFilter
            ? all.filter((s) => s.category.toLowerCase() === categoryFilter.toLowerCase())
            : all;
          const limit = Math.min(input.limit ?? 100, 200);
          const catalog = filtered.slice(0, limit).map((s) => formatLine(s));
          return json({
            total: filtered.length,
            shown: catalog.length,
            hint: 'Use action=invoke with a skill name to load its full instructions.',
            skills: catalog,
          });
        }
        case 'search': {
          const results = manager.searchSkills(input.query ?? '').slice(0, input.limit ?? 20);
          return json({ count: results.length, skills: results.map(formatLine) });
        }
        case 'relevant': {
          const results = manager.getRelevantSkills(input.query ?? '', input.limit ?? 5);
          return json({ count: results.length, skills: results.map(formatLine) });
        }
        case 'invoke': {
          if (!input.skill) return bad('invoke requires a skill name or id.');
          const skill = manager.getSkill(input.skill);
          if (!skill) {
            return bad(`Skill "${input.skill}" not found. Use action=list to see available skills.`);
          }
          if (!skill.enabled) return bad(`Skill "${skill.name}" is disabled. Enable it with SkillManage first.`);
          const parts = [
            `# Skill: ${skill.name}`,
            `Description: ${skill.description}`,
            `Category: ${skill.category}`,
            `Source: ${skill.source}`,
          ];
          if (skill.triggers?.length) parts.push(`Triggers: ${skill.triggers.join(', ')}`);
          parts.push('', skill.instructions);
          return { content: parts.join('\n') };
        }
        default:
          return bad(`Unknown Skills action: ${input.action}`);
      }
    } catch (error) {
      return bad((error as Error).message);
    }
  },
};

export const skillManageTool: Tool = {
  name: 'SkillManage',
  description: 'Author, edit, or retire reusable skills (procedural memory). Use create when you learn a repeatable workflow the user will want again. Skills are stored as SKILL.md files: personal by default, or workspace-scoped with scope="workspace". update/toggle/delete work on workspace or personal skills.',
  inputSchema: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['create', 'update', 'toggle', 'delete'] },
      name: { type: 'string', description: 'Skill name (slug).' },
      description: { type: 'string', description: 'What the skill does and when to use it.' },
      category: { type: 'string', description: 'e.g. development, research, productivity, writing.' },
      instructions: { type: 'string', description: 'The procedural instructions (markdown body).' },
      triggers: { type: 'array', items: { type: 'string' }, description: 'Keywords that suggest this skill.' },
      examples: { type: 'array', items: { type: 'string' }, description: 'Example requests.' },
      enabled: { type: 'boolean' },
      scope: { type: 'string', enum: ['personal', 'workspace'], description: 'For create: personal (default) or workspace.' },
      skill: { type: 'string', description: 'Skill name or id (for update/toggle/delete).' },
    },
    required: ['action'],
  },
  permission: 'ask',

  async execute(args, ctx): Promise<ToolResult> {
    const input = args as {
      action: string;
      name?: string;
      description?: string;
      category?: string;
      instructions?: string;
      triggers?: string[];
      examples?: string[];
      enabled?: boolean;
      scope?: 'personal' | 'workspace';
      skill?: string;
    };
    const workspaceManager = new SkillsManager({ workspaceRoot: ctx.cwd });
    const personalManager = new SkillsManager();
    try {
      switch (input.action) {
        case 'create': {
          if (!input.name || !input.description || input.instructions == null) {
            return bad('create requires name, description, and instructions.');
          }
          const manager = input.scope === 'workspace' ? workspaceManager : personalManager;
          const skill = manager.addSkill({
            name: input.name,
            description: input.description,
            category: input.category ?? 'custom',
            instructions: input.instructions,
            triggers: input.triggers,
            examples: input.examples,
            enabled: input.enabled !== false,
          });
          const rawPath = manager.isPersonal
            ? join(infiniteHome(), 'skills', skill.name, 'SKILL.md')
            : join(ctx.cwd, '.infinite', 'skills', skill.name, 'SKILL.md');
          return json({
            ok: true,
            skill: summary(skill),
            stored: rawPath.replace(/\\/g, '/'),
          });
        }
        case 'update': {
          const target = input.skill ?? input.name;
          if (!target) return bad('update requires a skill name or id.');
          const manager = resolveManager(target, workspaceManager, personalManager);
          if (!manager) return bad(`Skill "${target}" not found.`);
          const updated = manager.updateSkill(target, {
            ...(input.name ? { name: input.name } : {}),
            ...(input.description !== undefined ? { description: input.description } : {}),
            ...(input.category !== undefined ? { category: input.category } : {}),
            ...(input.instructions !== undefined ? { instructions: input.instructions } : {}),
            ...(input.triggers !== undefined ? { triggers: input.triggers } : {}),
            ...(input.examples !== undefined ? { examples: input.examples } : {}),
            ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
          });
          return updated ? json({ ok: true, skill: summary(updated) }) : bad(`Failed to update skill "${target}".`);
        }
        case 'toggle': {
          const target = input.skill ?? input.name;
          if (!target) return bad('toggle requires a skill name or id.');
          const manager = resolveManager(target, workspaceManager, personalManager);
          if (!manager) return bad(`Skill "${target}" not found.`);
          const toggled = manager.toggleSkill(target);
          return toggled ? json({ ok: true, skill: summary(toggled) }) : bad(`Failed to toggle skill "${target}".`);
        }
        case 'delete': {
          const target = input.skill ?? input.name;
          if (!target) return bad('delete requires a skill name or id.');
          const manager = resolveManager(target, workspaceManager, personalManager);
          if (!manager) return bad(`Skill "${target}" not found.`);
          const deleted = manager.removeSkill(target);
          return json({ ok: deleted, deleted: target });
        }
        default:
          return bad(`Unknown SkillManage action: ${input.action}`);
      }
    } catch (error) {
      return bad((error as Error).message);
    }
  },
};

function resolveManager(skill: string, workspace: SkillsManager, personal: SkillsManager): SkillsManager | null {
  if (workspace.getOwnSkill(skill)) return workspace;
  if (personal.getOwnSkill(skill)) return personal;
  return null;
}

function summary(skill: { name: string; id: string; category: string; description: string; enabled: boolean }): Record<string, unknown> {
  return { name: skill.name, id: skill.id, category: skill.category, description: skill.description, enabled: skill.enabled };
}

function formatLine(s: { name: string; description: string; category: string; source: string }): string {
  return `${s.name} — ${s.description} [${s.category}] (${s.source})`;
}

function json(value: unknown): ToolResult { return { content: JSON.stringify(value, null, 2) }; }
function bad(content: string): ToolResult { return { content, is_error: true }; }
