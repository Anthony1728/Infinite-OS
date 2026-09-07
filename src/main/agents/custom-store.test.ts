import { describe, it, expect } from 'vitest';
import { customAgentToAgentType, type CustomAgent } from './custom-store.js';

const base: CustomAgent = {
  id: 'custom-test',
  name: 'Researcher',
  description: 'Reads docs',
  icon: '✦',
  color: '#8b5cf6',
  systemPrompt: 'Be thorough.',
  allowedTools: ['Read'],
  maxTurns: 20,
  createdAt: 0,
  updatedAt: 0,
};

describe('customAgentToAgentType (bot profile)', () => {
  it('leaves legacy bots untouched (no pin, no soul)', () => {
    const t = customAgentToAgentType(base);
    expect(t.systemPrompt).toBe('Be thorough.');
    expect(t.preferredModel).toBeUndefined();
  });

  it('merges SOUL persona into the system prompt', () => {
    const t = customAgentToAgentType({ ...base, soul: 'Speak plainly.' });
    expect(t.systemPrompt).toContain('Be thorough.');
    expect(t.systemPrompt).toContain('Bot persona (SOUL)');
    expect(t.systemPrompt).toContain('Speak plainly.');
  });

  it('exposes a model pin only when both provider and model are set', () => {
    expect(customAgentToAgentType({ ...base, model: 'qwen3:4b' }).preferredModel).toBeUndefined();
    expect(
      customAgentToAgentType({ ...base, model: 'qwen3:4b', provider: 'ollama' }).preferredModel,
    ).toEqual({ provider: 'ollama', model: 'qwen3:4b' });
  });
});
