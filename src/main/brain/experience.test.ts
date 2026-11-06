import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ExperienceStore, classifyFailure, classifyIntent } from './experience.js';

let directory = '';
let clock = 1_700_000_000_000;

function store(): ExperienceStore {
  return new ExperienceStore({ dataDir: directory, now: () => clock++ });
}

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'infinite-experience-'));
  clock = 1_700_000_000_000;
});

afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
});

describe('outcome-driven experience learning', () => {
  it('classifies intents and failure categories deterministically', () => {
    expect(classifyIntent('Fix the failing TypeScript build')).toBe('debugging');
    expect(classifyIntent('Implement the login page')).toBe('coding');
    expect(classifyIntent('Research the latest release notes')).toBe('research');
    expect(classifyFailure('Run ended with UNVERIFIED file edits')?.id).toBe('unverified-edits');
    expect(classifyFailure('vitest failed on the auth spec')?.id).toBe('tests');
    expect(classifyFailure('All 3 model(s) have been tried')).toBeNull();
  });

  it('derives a failure guard only after repeated evidence', () => {
    const experience = store();
    experience.record({
      task: 'Fix the login bug',
      provider: 'p',
      model: 'm',
      outcome: 'failure',
      verified: false,
      tools: ['Edit'],
      durationMs: 100,
      failure: 'Run ended with UNVERIFIED file edits — Verify was not run after the last edit.',
    });
    expect(experience.deriveDirectives()).toEqual([]);

    experience.record({
      task: 'Fix the signup bug',
      provider: 'p',
      model: 'm',
      outcome: 'failure',
      verified: false,
      tools: ['Edit'],
      durationMs: 100,
      failure: 'Run ended with UNVERIFIED file edits — Verify was not run after the last edit.',
    });

    const directives = experience.deriveDirectives();
    expect(directives).toHaveLength(1);
    expect(directives[0]).toMatchObject({
      kind: 'failure-guard',
      intent: 'all',
      evidence: 2,
      failures: 2,
    });
    expect(experience.formatForContext('fix another bug')).toContain('run Verify');
  });

  it('promotes repeated verified tool sequences into a procedure', () => {
    const experience = store();
    for (const task of ['Implement the settings page', 'Implement the profile page', 'Implement the billing page']) {
      experience.record({
        task,
        provider: 'p',
        model: 'm',
        outcome: 'success',
        verified: true,
        tools: ['Read', 'Edit', 'Verify'],
        durationMs: 200,
      });
    }
    const directives = experience.deriveDirectives();
    const procedure = directives.find((entry) => entry.kind === 'verified-procedure');
    expect(procedure).toBeTruthy();
    expect(procedure?.evidence).toBe(3);
    expect(procedure?.rule).toContain('Read → Edit → Verify');
    expect(experience.learnedDirectives('implement a new page').some((entry) => entry.id === procedure?.id)).toBe(true);
  });

  it('does not turn one-off successes or unverified runs into procedures', () => {
    const experience = store();
    experience.record({
      task: 'Implement the settings page',
      provider: 'p',
      model: 'm',
      outcome: 'success',
      verified: true,
      tools: ['Read', 'Edit', 'Verify'],
      durationMs: 200,
    });
    experience.record({
      task: 'Implement the billing page',
      provider: 'p',
      model: 'm',
      outcome: 'success',
      verified: false,
      tools: ['Read', 'Edit', 'Verify'],
      durationMs: 200,
    });
    expect(experience.deriveDirectives()).toEqual([]);
  });

  it('persists records and reports honest evidence statistics', () => {
    const first = store();
    first.record({
      task: 'Research release notes',
      provider: 'groq',
      model: 'fast',
      outcome: 'success',
      verified: true,
      tools: ['WebSearch', 'WebFetch'],
      durationMs: 50,
    });
    first.record({
      task: 'Research pricing changes',
      provider: 'groq',
      model: 'fast',
      outcome: 'success',
      verified: true,
      tools: ['WebSearch', 'WebFetch'],
      durationMs: 50,
    });

    const reloaded = new ExperienceStore({ dataDir: directory, now: () => clock++ });
    expect(reloaded.list()).toHaveLength(2);
    const stats = reloaded.stats();
    expect(stats).toMatchObject({ total: 2, verifiedSuccesses: 2, failures: 0 });
    expect(reloaded.formatForContext('research the new release')).toContain('WebSearch → WebFetch');
  });

  it('redacts secrets before persisting task and failure text', () => {
    const experience = store();
    experience.record({
      task: 'Use api_key=sk-super-secret-token-1234567890 to deploy',
      provider: 'p',
      model: 'm',
      outcome: 'failure',
      verified: false,
      tools: [],
      durationMs: 10,
      failure: 'permission denied using Bearer abcdefghijklmnopqrstuvwxyz123456',
    });
    const saved = experience.list()[0];
    expect(saved.task).not.toContain('sk-super-secret');
    expect(saved.failureDetail).not.toContain('abcdefghijklmnopqrstuvwxyz');
    expect(saved.failureCategory).toBe('permission');
  });
});
