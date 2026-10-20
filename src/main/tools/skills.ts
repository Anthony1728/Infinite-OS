// Agent-facing skills tools — progressive disclosure (Hermes/OpenClaw style).
// The catalog stays compact in the system prompt; `Skills invoke` loads the
// full instructions of one skill on demand. `SkillManage` gives the agent
// procedural memory: it can author, edit, and retire reusable skills.

import type { Tool, ToolResult } from './base.js';
import { SkillsManager } from '../skills/manager.js';
import { SkillFileStore } from '../skills/skill-store.js';
import { loadSkillIndex, fetchSkillFile, searchSkills } from '../skills/hub.js';
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
  description: [
    'Browse and load reusable procedural skills (SKILL.md).',
    'Actions: list (catalog), search (query), relevant (task), invoke (skill name or id — returns the full instructions to follow).',
    'Skills are compact in the prompt; invoke loads the details only when needed.',
    'hub_search looks across a public library of ~388 expert-written skills (engineering, marketing, finance, research, productivity, C-level advisory) without installing anything.',
    'hub_install downloads one of them into the local skill store; afterwards it is an ordinary skill you can invoke like any other.',
    'Use hub_search first when a request calls for a process you do not already know — the library covers far more than you do.',
  ].join(' '),
  inputSchema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['list', 'search', 'relevant', 'invoke', 'hub_search', 'hub_install', 'hub_categories'],
      },
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
        // ── The public skill library ─────────────────────────────────────
        // On demand, never bundled. The library has ~388 skills whose
        // descriptions alone would dwarf the system prompt, and this machine
        // runs a local model where every token costs real seconds. So nothing
        // is loaded until the agent actually asks for it.
        case 'hub_search': {
          if (!input.query) return bad('hub_search requires a query — describe the process you need.');
          const result = await loadSkillIndex(join(infiniteHome(), 'cache', 'skills-hub'));
          if (result.index.entries.length === 0) {
            return bad(`The skill library could not be loaded: ${result.error ?? 'unknown reason'}`);
          }
          const found = searchSkills(result.index, input.query, input.limit ?? 15);
          if (found.length === 0) {
            return bad(
              `Nothing in the library matches "${input.query}". It covers ` +
              `${result.index.entries.length} skills across ${new Set(result.index.entries.map(e => e.category)).size} areas. ` +
              'Try a broader word, or action=hub_categories to see the areas.',
            );
          }
          return json({
            total_in_library: result.index.entries.length,
            matched: found.length,
            hint: 'Use action=hub_install with the exact id to download one, then action=invoke to load its instructions.',
            stale: result.error,
            skills: found.map(e => ({
              id: e.path,
              name: e.name,
              category: e.category,
              bundle: e.bundle,
              // The bundle description, not the skill's own: the skill's own
              // description only arrives when it is installed.
              about: e.description,
              keywords: e.keywords?.slice(0, 8),
            })),
          });
        }

        case 'hub_categories': {
          const result = await loadSkillIndex(join(infiniteHome(), 'cache', 'skills-hub'));
          if (result.index.entries.length === 0) {
            return bad(`The skill library could not be loaded: ${result.error ?? 'unknown reason'}`);
          }
          const counts = new Map<string, number>();
          for (const e of result.index.entries) counts.set(e.category, (counts.get(e.category) ?? 0) + 1);
          return ok(
            `${result.index.entries.length} skills: ` +
            [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} (${v})`).join(', '),
          );
        }

        case 'hub_install': {
          if (!input.skill) return bad('hub_install requires an id — the exact path returned by hub_search.');
          const result = await loadSkillIndex(join(infiniteHome(), 'cache', 'skills-hub'));
          const entry = result.index.entries.find(e => e.path === input.skill || e.name === input.skill);
          if (!entry) {
            return bad(
              `"${input.skill}" is not in the library. Use action=hub_search to find it, ` +
              'and pass back the exact id it returns.',
            );
          }
          const markdown = await fetchSkillFile(entry.path);
          // Written through the same store the local skills use, so it inherits
          // the path-traversal guard rather than bypassing it.
          const store = new SkillFileStore(join(infiniteHome(), 'skills'));
          const path = store.write({
            name: entry.name,
            description: entry.description ?? `Imported from the public skill library (${entry.category}).`,
            category: entry.category,
            instructions: markdown,
          });
          return ok(
            `Installed "${entry.name}" (${entry.category}).\nSaved to: ${path}\n\n` +
            'Use action=invoke with that name to load its full instructions.',
          );
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
function ok(content: string): ToolResult { return { content }; }
function bad(content: string): ToolResult { return { content, is_error: true }; }
