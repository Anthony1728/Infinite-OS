import { describe, it, expect } from 'vitest';
import { normalizeUsage, extractCatalogEntries } from './openai-compatible.js';

describe('normalizeUsage', () => {
  it('parses OpenAI prompt_tokens_details.cached_tokens', () => {
    const u = normalizeUsage({ prompt_tokens: 1000, completion_tokens: 50, prompt_tokens_details: { cached_tokens: 800 } });
    expect(u.input).toBe(1000);
    expect(u.output).toBe(50);
    expect(u.cache_read).toBe(800);
  });

  it('parses OpenRouter cache_read_input_tokens', () => {
    const u = normalizeUsage({ input_tokens: 2000, output_tokens: 10, cache_read_input_tokens: 1500 });
    expect(u.cache_read).toBe(1500);
  });

  it('parses DeepSeek prompt_cache_hit_tokens', () => {
    const u = normalizeUsage({ prompt_tokens: 900, completion_tokens: 5, prompt_cache_hit_tokens: 700 });
    expect(u.cache_read).toBe(700);
  });

  it('omits cache_read when zero', () => {
    const u = normalizeUsage({ prompt_tokens: 100, completion_tokens: 10 });
    expect(u.cache_read).toBeUndefined();
    expect(u.input).toBe(100);
  });

  it('handles null/undefined usage safely', () => {
    expect(normalizeUsage(null)).toEqual({ input: 0, output: 0 });
    expect(normalizeUsage(undefined)).toEqual({ input: 0, output: 0 });
  });
});

describe('extractCatalogEntries (regression)', () => {
  it('still unwraps OpenAI data envelopes', () => {
    expect(extractCatalogEntries({ data: [{ id: 'a' }] })).toEqual([{ id: 'a' }]);
  });
});
