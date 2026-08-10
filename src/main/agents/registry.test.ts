import { describe, expect, it } from 'vitest';
import { AGENTS } from './registry.js';

describe('built-in agent tool access', () => {
  it('gives the general agent access to every registered runtime tool', () => {
    expect(AGENTS.general.allowedTools).toContain('*');
  });

  it('gives web-capable specialists interactive browser routes', () => {
    expect(AGENTS.research.allowedTools).toEqual(expect.arrayContaining(['WebSearch', 'Browser', 'Operator']));
    expect(AGENTS.data.allowedTools).toContain('*');
  });
});
