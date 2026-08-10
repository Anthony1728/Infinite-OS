import { describe, expect, it } from 'vitest';
import { mathTool } from './math.js';
import { evaluate, computeStats, mulberry32 } from './math.js';

function exec(action: string, args: Record<string, unknown>) {
  return mathTool.execute({ action, ...args }, {} as never);
}

describe('Math tool', () => {
  describe('safe expression evaluation', () => {
    it('evaluates arithmetic with precedence', async () => {
      expect(JSON.parse(String((await exec('eval', { expression: '2 + 3 * 4' })).content)).value).toBe(14);
      expect(JSON.parse(String((await exec('eval', { expression: '(2 + 3) * 4' })).content)).value).toBe(20);
      expect(JSON.parse(String((await exec('eval', { expression: '2^10' })).content)).value).toBe(1024);
      expect(JSON.parse(String((await exec('eval', { expression: '10 % 3' })).content)).value).toBe(1);
      expect(JSON.parse(String((await exec('eval', { expression: '-5 + 3' })).content)).value).toBe(-2);
      expect(JSON.parse(String((await exec('eval', { expression: '10 - 3 - 2' })).content)).value).toBe(5);
      expect(JSON.parse(String((await exec('eval', { expression: '7 - 2 * 3' })).content)).value).toBe(1);
      expect(JSON.parse(String((await exec('eval', { expression: '2 * -3' })).content)).value).toBe(-6);
      expect(JSON.parse(String((await exec('eval', { expression: '10 / 2 + -4' })).content)).value).toBe(1);
    });

    it('supports constants and functions', async () => {
      expect(JSON.parse(String((await exec('eval', { expression: 'round(pi, 4)' })).content)).value).toBe(3.1416);
      expect(JSON.parse(String((await exec('eval', { expression: 'sqrt(144) + log10(1000)' })).content)).value).toBe(15);
      expect(JSON.parse(String((await exec('eval', { expression: 'min(3, 1, 2) + max(4, 9)' })).content)).value).toBe(10);
      expect(JSON.parse(String((await exec('eval', { expression: 'pow(2, 8)' })).content)).value).toBe(256);
    });

    it('rejects unsafe constructs', async () => {
      const cases = ['constructor', 'process.exit(1)', 'while(true){}', '1e999', '__proto__', 'Function("x")'];
      for (const expression of cases) {
        const result = await exec('eval', { expression });
        expect(result.is_error).toBe(true);
      }
    });

    it('rejects division by zero and malformed input', async () => {
      const divZero = await exec('eval', { expression: '1/0' });
      expect(divZero.is_error).toBe(true);
      const malformed = await exec('eval', { expression: '2 +' });
      expect(malformed.is_error).toBe(true);
    });

    it('exposes a standalone evaluator', () => {
      expect(evaluate('2 * (3 + 4)')).toBe(14);
      expect(evaluate('round(sqrt(100), 0)')).toBe(10);
    });
  });

  describe('statistics', () => {
    it('computes summary statistics', async () => {
      const result = await exec('stats', { values: [1, 2, 3, 4, 100] });
      const parsed = JSON.parse(String(result.content));
      expect(parsed.count).toBe(5);
      expect(parsed.sum).toBe(110);
      expect(parsed.mean).toBe(22);
      expect(parsed.median).toBe(3);
      expect(parsed.min).toBe(1);
      expect(parsed.max).toBe(100);
      expect(parsed.quartiles.q1).toBe(2);
      expect(parsed.quartiles.q3).toBe(4);
    });

    it('computes percentiles and detects a bimodal mode', async () => {
      const result = await exec('stats', { values: [1, 1, 2, 2, 3], percentile: 90 });
      const parsed = JSON.parse(String(result.content));
      expect(parsed.percentile).toBeCloseTo(2.6, 6); // R-7 linear interpolation
      expect(parsed.mode).toEqual([1, 2]);
    });

    it('requires values', async () => {
      const result = await exec('stats', { values: [] });
      expect(result.is_error).toBe(true);
    });
  });

  describe('bases, rounding, percent', () => {
    it('converts between bases', async () => {
      const hex = await exec('base_convert', { number: 255 });
      expect(JSON.parse(String(hex.content)).value).toBe('ff');
      const binary = await exec('base_convert', { number: 10, toBase: 2 });
      expect(JSON.parse(String(binary.content)).value).toBe('1010');
    });

    it('rounds to decimals and significant figures', async () => {
      const decimals = await exec('round', { number: 3.14159, decimals: 2 });
      expect(JSON.parse(String(decimals.content)).value).toBe(3.14);
      const significant = await exec('round', { number: 12345, significant: 3 });
      expect(JSON.parse(String(significant.content)).value).toBe(12300);
    });

    it('computes percentages', async () => {
      const result = await exec('percent', { part: 25, total: 200 });
      expect(JSON.parse(String(result.content)).percent).toBe(12.5);
    });
  });

  describe('random', () => {
    it('generates integers within an inclusive range', async () => {
      const result = await exec('random_int', { min: 5, max: 5, count: 10 });
      const parsed = JSON.parse(String(result.content));
      expect(parsed.numbers).toEqual(Array(10).fill(5));
    });

    it('produces a reproducible seeded sequence', async () => {
      const a = JSON.parse(String((await exec('random_float', { seed: 42, count: 5 })).content)).numbers;
      const b = JSON.parse(String((await exec('random_float', { seed: 42, count: 5 })).content)).numbers;
      expect(a).toEqual(b);
    });

    it('exposes a standalone PRNG', () => {
      const rng = mulberry32(123);
      const values = [rng(), rng(), rng()];
      expect(values.every((v) => v >= 0 && v < 1)).toBe(true);
      expect(new Set(values).size).toBe(3);
    });
  });

  it('lists available functions', async () => {
    const result = await exec('list', {});
    const parsed = JSON.parse(String(result.content));
    expect(parsed.functions).toContain('sqrt');
    expect(parsed.constants).toContain('pi');
  });

  it('computeStats handles single-value and empty edge cases', () => {
    expect(computeStats([7]).median).toBe(7);
    expect(Number.isNaN(computeStats([]).mean)).toBe(true);
  });
});
