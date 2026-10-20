import { describe, expect, it, vi } from 'vitest';

// The registry imports tools that touch electron, so mock the surface used.
vi.mock('electron', () => {
  const Notify = Object.assign(vi.fn(), { isSupported: (): boolean => false });
  return { Notification: Notify };
});

import { registerBuiltinTools } from './registry.js';
import { toolRegistry, CORE_TOOL_NAMES } from './base.js';

/**
 * The capability layer has to actually be reachable.
 *
 * A tool that is written, tested and never registered is a tool that does not
 * exist — and a tool that is registered but missing from the always-attached
 * set is one the model never sees. Both failures are silent, so they are
 * checked here rather than discovered when a user asks for something it
 * should have been able to do.
 */
describe('the CLI capability layer', () => {
  it('is registered', () => {
    registerBuiltinTools();
    expect(toolRegistry.list().map(t => t.name)).toContain('CliHub');
  });

  it('ships a schema the model can actually call', () => {
    registerBuiltinTools();
    const def = toolRegistry.asProviderTools().find(t => t.name === 'CliHub');
    expect(def, 'provider def for CliHub').toBeDefined();
    const schema = def!.input_schema as { properties?: Record<string, unknown>; required?: string[] };
    expect(Object.keys(schema.properties ?? {})).toEqual(
      expect.arrayContaining(['action', 'query', 'name', 'args']),
    );
    // `run` takes argv, which is the whole reason it is safe to drive a real
    // application with it.
    expect((schema.properties!.args as { type?: string }).type).toBe('array');
  });

  it('asks before changing the machine', () => {
    registerBuiltinTools();
    // Installing software and running it both change the PC. A tool that
    // installs 79 applications unattended should not be `allow`.
    expect(toolRegistry.get('CliHub')?.permission).toBe('ask');
  });

  it('is attached by default, so the model can reach it without being told', () => {
    registerBuiltinTools();
    // With no explicit allow-list every tool is attached, which is how the
    // agent knows it exists.
    const all = toolRegistry.list();
    expect(all.some(t => t.name === 'CliHub')).toBe(true);
    // Not a core tool: the always-loaded core set has no room, and this is a
    // specialist tool rather than one every request needs.
    expect(CORE_TOOL_NAMES.has('CliHub')).toBe(false);
  });

  it('tells the model the order of operations, not just what the actions are', () => {
    registerBuiltinTools();
    const description = toolRegistry.get('CliHub')?.description ?? '';
    // The action names alone are not enough: an agent that calls `run` before
    // `install` gets a confusing error. The description is what prevents that.
    expect(description).toContain('search');
    expect(description).toContain('install');
    expect(description).toMatch(/search.*install.*run|install.*search.*run/s);
  });

  it('warns against inventing a command when nothing matches', () => {
    registerBuiltinTools();
    const description = toolRegistry.get('CliHub')?.description ?? '';
    expect(description).toMatch(/JSON|structured/i);
  });
});