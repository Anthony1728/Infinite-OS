import { describe, it, expect } from 'vitest';
import { OllamaBrain } from './brain.js';

// Exercise the prompt builder without touching the constructor (no timers,
// no filesystem): the method does not use instance state.
const promptFor = (uncensored: boolean): string =>
  OllamaBrain.prototype.getSystemPrompt.call(null, uncensored);

describe('OllamaBrain system prompt', () => {
  it('keeps the moral code by default', () => {
    const prompt = promptFor(false);
    expect(prompt).toContain('MORAL CODE');
    expect(prompt).not.toContain('UNCENSORED');
  });

  it('drops refusal rules when uncensored', () => {
    const prompt = promptFor(true);
    expect(prompt).toContain('UNCENSORED RESPONSE MODE IS ON');
    expect(prompt).not.toContain('MORAL CODE');
    expect(prompt).not.toContain('refuse credential theft');
  });
});
