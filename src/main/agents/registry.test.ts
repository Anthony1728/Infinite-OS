import { describe, expect, it } from 'vitest';
import { AGENTS } from './registry.js';

/**
 * "'*'" means the complete tool registry. A named tool means that tool is
 * reachable. This helper states the capability question the way the product
 * actually asks it, so a test can assert reachability without caring which
 * mechanism the registry uses to grant it.
 */
function canReach(agentId: string, tool: string): boolean {
  const allowed = AGENTS[agentId]?.allowedTools ?? [];
  return allowed.includes('*') || allowed.includes(tool);
}

describe('built-in agent tool access', () => {
  it('gives the general agent access to every registered runtime tool', () => {
    expect(AGENTS.general.allowedTools).toContain('*');
  });

  it('gives web-capable specialists interactive browser routes', () => {
    expect(canReach('research', 'WebSearch')).toBe(true);
    expect(canReach('research', 'Browser')).toBe(true);
    expect(canReach('research', 'Operator')).toBe(true);
    expect(AGENTS.data.allowedTools).toContain('*');
  });

  /**
   * Regression guard for "no agent is tool-starved".
   *
   * Research and SEO were once pinned to a read-only subset, which meant a
   * research task that needed to save its findings, run a command, or drive the
   * browser had to fail or hand off. Every built-in agent now carries the full
   * registry; this test fails if a future agent is added with a narrower list,
   * so the restriction cannot quietly come back.
   */
  it('gives every built-in agent the full registry — no capability starvation', () => {
    const starved = Object.values(AGENTS)
      .filter((agent) => !agent.allowedTools.includes('*'))
      .map((agent) => agent.id);
    expect(starved).toEqual([]);
  });

  it('registers the Conway automaton with full capability and a real persona', () => {
    const conway = AGENTS.conway;
    expect(conway).toBeDefined();
    expect(conway.allowedTools).toContain('*');
    expect(conway.name).toBe('Automaton');
    // A persona is what makes it feel like a person rather than a preset.
    expect(conway.systemPrompt.length).toBeGreaterThan(400);
    // Every agent inherits the determination + voice contract.
    expect(conway.systemPrompt).toContain('DETERMINATION');
    expect(conway.systemPrompt).toContain('VOICE');
  });

  it('gives every agent the determination and voice contract', () => {
    const missing = Object.values(AGENTS)
      .filter((agent) => !agent.systemPrompt.includes('UNIVERSAL EXECUTION CONTRACT'))
      .map((agent) => agent.id);
    expect(missing).toEqual([]);
  });
});
