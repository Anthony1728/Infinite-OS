import { describe, it, expect } from 'vitest';
import { buildCrewPlan } from './crew.js';

const leader = { provider: 'openrouter', model: 'meta-llama/llama-3.3-70b-instruct:free', free: true };

describe('buildCrewPlan paired model', () => {
  it('always seats the user-paired model as Collaborator', () => {
    const plan = buildCrewPlan('Summarize this file', leader, new Map(), undefined, {
      provider: 'ollama',
      model: 'qwen3:4b',
    });
    const collab = plan.members.find((m) => m.role === 'Collaborator');
    expect(collab).toBeDefined();
    expect(collab?.assignment).toMatchObject({ provider: 'ollama', model: 'qwen3:4b' });
    expect(plan.reasons.join(' ')).toContain('User-paired model');
  });

  it('skips the duplicate when paired model equals the leader', () => {
    const plan = buildCrewPlan('Summarize this file', leader, new Map(), undefined, {
      provider: 'openrouter',
      model: 'meta-llama/llama-3.3-70b-instruct:free',
    });
    expect(plan.members.find((m) => m.role === 'Collaborator')).toBeUndefined();
    expect(plan.reasons.join(' ')).toContain('skipping duplicate');
  });
});
