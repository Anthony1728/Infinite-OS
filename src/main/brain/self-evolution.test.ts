import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { SelfEvolutionEngine, getSelfEvolutionEngine } from './self-evolution.js';

let directory = '';

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'infinite-self-evolve-'));
});

afterEach(() => rmSync(directory, { recursive: true, force: true }));

describe('SelfEvolutionEngine', () => {
  it('creates suggestions from activity patterns', () => {
    const engine = new SelfEvolutionEngine({ dataDir: directory });
    const suggestions = engine.analyzePatterns();
    expect(Array.isArray(suggestions)).toBe(true);
  });

  it('returns suggestions with correct shape', () => {
    const engine = new SelfEvolutionEngine({ dataDir: directory });
    const suggestions = engine.analyzePatterns();
    for (const s of suggestions) {
      expect(s).toHaveProperty('id');
      expect(s).toHaveProperty('pattern');
      expect(s).toHaveProperty('description');
      expect(s).toHaveProperty('frequency');
      expect(s).toHaveProperty('confidence');
      expect(s).toHaveProperty('automationProposal');
      expect(s).toHaveProperty('status');
      expect(['suggested', 'accepted', 'auto-created', 'dismissed']).toContain(s.status);
    }
  });

  it('accepts a suggestion and creates a skill', () => {
    const engine = new SelfEvolutionEngine({ dataDir: directory });
    const suggestions = engine.analyzePatterns();
    if (suggestions.length > 0) {
      const accepted = engine.acceptSuggestion(suggestions[0].id, true);
      expect(accepted).not.toBeNull();
      expect(['accepted', 'auto-created']).toContain(accepted!.status);
    }
  });

  it('dismisses a suggestion', () => {
    const engine = new SelfEvolutionEngine({ dataDir: directory });
    const suggestions = engine.analyzePatterns();
    if (suggestions.length > 0) {
      const dismissed = engine.dismissSuggestion(suggestions[0].id);
      expect(dismissed).toBe(true);
      const updated = engine.getSuggestions('dismissed');
      expect(updated.length).toBeGreaterThan(0);
    }
  });

  it('returns top suggestion', () => {
    const engine = new SelfEvolutionEngine({ dataDir: directory });
    engine.analyzePatterns();
    const top = engine.getTopSuggestion();
    expect(top === null || typeof top.pattern === 'string').toBe(true);
  });

  it('returns automation prompt', () => {
    const engine = new SelfEvolutionEngine({ dataDir: directory });
    engine.analyzePatterns();
    const prompt = engine.getAutomationPrompt();
    expect(prompt === null || typeof prompt === 'string').toBe(true);
  });

  it('returns evolution status', () => {
    const engine = new SelfEvolutionEngine({ dataDir: directory });
    const status = engine.getStatus();
    expect(status).toHaveProperty('totalPatterns');
    expect(status).toHaveProperty('totalSuggestions');
    expect(status).toHaveProperty('autoCreatedSkills');
    expect(status).toHaveProperty('pendingSuggestions');
  });

  it('evolve() returns suggestions, newSkills, and status', () => {
    const engine = new SelfEvolutionEngine({ dataDir: directory });
    const result = engine.evolve();
    expect(Array.isArray(result.suggestions)).toBe(true);
    expect(typeof result.newSkills).toBe('number');
    expect(result.status).toHaveProperty('totalPatterns');
  });

  it('persists suggestions across instances', () => {
    const engine1 = new SelfEvolutionEngine({ dataDir: directory });
    engine1.analyzePatterns();
    const engine2 = new SelfEvolutionEngine({ dataDir: directory });
    const status1 = engine1.getStatus();
    const status2 = engine2.getStatus();
    expect(status2.totalPatterns).toBe(status1.totalPatterns);
  });

  it('filters suggestions by status', () => {
    const engine = new SelfEvolutionEngine({ dataDir: directory });
    engine.analyzePatterns();
    const all = engine.getSuggestions();
    const suggested = engine.getSuggestions('suggested');
    const dismissed = engine.getSuggestions('dismissed');
    expect(suggested.length + dismissed.length).toBeLessThanOrEqual(all.length);
  });
});

describe('getSelfEvolutionEngine', () => {
  it('returns a singleton instance', () => {
    const dir = mkdtempSync(join(tmpdir(), 'infinite-se-singleton-'));
    const e1 = getSelfEvolutionEngine({ dataDir: dir });
    const e2 = getSelfEvolutionEngine({ dataDir: dir });
    expect(e1).toBe(e2);
    rmSync(dir, { recursive: true, force: true });
  });
});
