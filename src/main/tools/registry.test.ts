import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// Registry integration guard: importing the full registry pulls in tools that
// depend on electron, so mock the electron module surface used by tools.
vi.mock('electron', () => {
  const Notify = Object.assign(vi.fn(), { isSupported: (): boolean => false });
  return { Notification: Notify };
});

import { registerBuiltinTools } from './registry.js';
import { toolRegistry } from './base.js';
import { AGENTS } from '../agents/registry.js';

const NEW_TOOLS = ['Json', 'Text', 'Crypto', 'Time', 'Math', 'Timer'];

describe('tool registry', () => {
  it('registers the new deterministic utility tools', () => {
    registerBuiltinTools();
    const names = toolRegistry.list().map((t) => t.name);
    for (const name of NEW_TOOLS) {
      expect(names).toContain(name);
      const tool = toolRegistry.get(name);
      expect(tool?.permission).toBeDefined();
      expect(tool?.description.length).toBeGreaterThan(10);
    }
  });

  it('ships tool definitions as provider-ready schemas', () => {
    registerBuiltinTools();
    const tools = toolRegistry.asProviderTools();
    for (const name of NEW_TOOLS) {
      const def = tools.find((t) => t.name === name);
      expect(def, `provider def for ${name}`).toBeDefined();
      expect(def!.input_schema).toBeDefined();
    }
  });

  it('keeps the registry source imports and registrations in sync', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(join(here, 'registry.ts'), 'utf8');
    const registeredInSource = NEW_TOOLS.every((name) => {
      const importAlias = `${name.toLowerCase()}Tool`;
      const hasImport = source.includes(`import { ${importAlias} }`);
      const hasRegistration = new RegExp(`\\b${importAlias}\\b`).test(source.split('// Deterministic utility tools')[1] ?? source);
      return hasImport && hasRegistration;
    });
    expect(registeredInSource).toBe(true);
  });

  it('exposes every registered capability to implementation agents', () => {
    registerBuiltinTools();
    const names = new Set(toolRegistry.list().map((tool) => tool.name));
    for (const id of ['general', 'code', 'design', 'data']) {
      expect(AGENTS[id]?.allowedTools).toContain('*');
    }
    expect(names.size).toBeGreaterThan(30);
  });

  it('resolves model-emitted tool name variants to canonical tools', () => {
    registerBuiltinTools();
    const canonical = toolRegistry.get('Bash')!;
    expect(toolRegistry.get('bash')).toBe(canonical);
    expect(toolRegistry.get('BASH')).toBe(canonical);
    expect(toolRegistry.get('run_command')).toBe(canonical);
    expect(toolRegistry.get('execute_command')).toBe(canonical);
    expect(toolRegistry.get('Read')).toBe(toolRegistry.get('read_file'));
    expect(toolRegistry.get('WebSearch')).toBe(toolRegistry.get('web_search'));
    expect(toolRegistry.get('WebSearch')).toBe(toolRegistry.get('search_web'));
    expect(toolRegistry.get('writeFile')).toBe(toolRegistry.get('Write'));
    expect(toolRegistry.get('TODO_WRITE')).toBe(toolRegistry.get('TodoWrite'));
    expect(toolRegistry.get('no_such_tool_xyz')).toBeUndefined();
  });

  it('suggests nearest canonical names for unresolvable tools', () => {
    registerBuiltinTools();
    expect(toolRegistry.suggest('Bashh')).toContain('Bash');
    expect(toolRegistry.suggest('Webfetch')).toContain('WebFetch');
  });
});
