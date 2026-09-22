import { describe, it, expect } from 'vitest';
import { priceForModel, estimateCost, estimateTotalCost, formatCost } from './pricing.js';

describe('priceForModel', () => {
  it('resolves bare and gateway-prefixed ids', () => {
    expect(priceForModel('anthropic', 'claude-sonnet-4-5')?.input).toBe(3);
    expect(priceForModel('openrouter', 'anthropic/claude-sonnet-4-5')?.output).toBe(15);
    expect(priceForModel(undefined, 'deepseek-chat')?.input).toBeCloseTo(0.27);
  });

  it('strips free/latest suffixes', () => {
    expect(priceForModel('bluesminds', 'deepseek-reasoner:free')?.input).toBe(0.55);
  });

  it('returns null for unknown models (reported as free)', () => {
    expect(priceForModel('ollama', 'qwen3:4b')).toBeNull();
    expect(priceForModel(undefined, 'mystery-model')).toBeNull();
  });
});

describe('estimateCost', () => {
  it('charges input+output at list price', () => {
    const usd = estimateCost({ provider: 'anthropic', model: 'claude-sonnet-4-5', input: 1_000_000, output: 100_000 });
    expect(usd).toBeCloseTo(3 + 1.5, 5);
  });

  it('applies the cheaper cache-read rate to cached tokens', () => {
    const usd = estimateCost({ provider: 'anthropic', model: 'claude-sonnet-4-5', input: 1_000_000, output: 0, cache_read: 900_000 });
    // 100k uncached at $3 + 900k cached at $0.30
    expect(usd).toBeCloseTo(0.3 + 0.27, 5);
  });

  it('unknown models cost zero', () => {
    expect(estimateCost({ provider: 'ollama', model: 'qwen3:4b', input: 500_000, output: 5_000 })).toBe(0);
  });

  it('totals across samples', () => {
    const total = estimateTotalCost([
      { provider: 'openai', model: 'gpt-4o', input: 1_000_000, output: 0 },
      { provider: 'openai', model: 'gpt-4o', input: 0, output: 1_000_000 },
    ]);
    expect(total).toBeCloseTo(12.5, 5);
  });
});

describe('formatCost', () => {
  it('formats sane amounts', () => {
    expect(formatCost(0)).toBe('$0.00');
    expect(formatCost(1.234)).toBe('$1.23');
    expect(formatCost(0.0031)).toBe('$0.0031');
    expect(formatCost(-1)).toBe('$0.00');
  });
});
