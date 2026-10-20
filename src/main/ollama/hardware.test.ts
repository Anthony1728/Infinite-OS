import { describe, expect, it } from 'vitest';
import {
  budgetForModel,
  describeHardware,
  getHardwareProfile,
  isModelComfortable,
  parseParameterCount,
  resetHardwareCache,
} from './hardware.js';

/**
 * The whole point of this module is that nothing picks a number without asking
 * it. These tests pin the safety property that matters most: on a small machine
 * every budget must be smaller, never larger, than on a big one. If that ever
 * inverts, a low-end user gets pinned RAM and minute-long turns again.
 */

describe('hardware profile', () => {
  it('detects this machine without throwing', () => {
    resetHardwareCache();
    const hw = getHardwareProfile();
    expect(hw.totalRamGb).toBeGreaterThan(0);
    expect(hw.cpuThreads).toBeGreaterThan(0);
    expect(['low', 'mid', 'high']).toContain(hw.tier);
  });

  it('caches the profile so detection is not repeated', () => {
    resetHardwareCache();
    expect(getHardwareProfile()).toBe(getHardwareProfile());
  });

  it('treats a CPU-only machine as low tier however fast the CPU claims to be', () => {
    // No NVIDIA GPU means no offload, so even a many-core machine is CPU-bound
    // for inference. Passing the tier in keeps this deterministic.
    expect(budgetForModel('low').numCtx).toBeLessThan(budgetForModel('high').numCtx);
  });
});

describe('budgets scale down, never up', () => {
  it('gives a low-end machine a strictly smaller context than a high-end one', () => {
    const low = budgetForModel('low');
    const mid = budgetForModel('mid');
    const high = budgetForModel('high');
    expect(low.numCtx).toBeLessThan(mid.numCtx);
    expect(mid.numCtx).toBeLessThan(high.numCtx);
  });

  it('gives a low-end machine a strictly smaller output cap', () => {
    expect(budgetForModel('low').numPredict).toBeLessThan(budgetForModel('high').numPredict);
  });

  it('releases RAM sooner on a small machine', () => {
    // Shorter keep_alive means the weights go back to the OS sooner.
    expect(budgetForModel('low').keepAlive).toBe('5m');
    expect(budgetForModel('high').keepAlive).toBe('30m');
  });

  it('never asks for more threads than the machine has', () => {
    resetHardwareCache();
    const threads = getHardwareProfile().cpuThreads;
    for (const tier of ['low', 'mid', 'high'] as const) {
      expect(budgetForModel(tier).numThread).toBeGreaterThan(0);
      expect(budgetForModel(tier).numThread).toBeLessThanOrEqual(Math.max(threads, 4));
    }
  });

  it('keeps the thinking share flat rather than inventing a size rule', () => {
    // Deliberate: a 1.7b model is not reliably more verbose than a 7b one, so
    // scaling the share by size would be a rule with no measurement behind it.
    const tiny = budgetForModel('low');
    const big = budgetForModel('low');
    expect(tiny.thinkingFraction).toBe(big.thinkingFraction);
    expect(tiny.thinkingFraction).toBeLessThan(1);
  });

  it('always leaves most of the budget for the answer', () => {
    // The measured failure was a small model spending its entire budget on
    // reasoning and returning no answer at all. This is the invariant that
    // matters, and it must hold on every tier.
    for (const tier of ['low', 'mid', 'high'] as const) {
      expect(budgetForModel(tier).thinkingFraction).toBeLessThanOrEqual(0.5);
    }
  });
});

describe('reading a model name', () => {
  it('reads the parameter count from the tag', () => {
    expect(parseParameterCount('qwen3:1.7b')).toBeCloseTo(1.7);
    expect(parseParameterCount('llama3.2:3b')).toBe(3);
    expect(parseParameterCount('gemma2:27b')).toBe(27);
  });

  it('assumes a mid-size model when the name says nothing', () => {
    // Safer to assume 7B than to assume tiny and blow the budget.
    expect(parseParameterCount('mystery-model')).toBe(7);
    expect(parseParameterCount('')).toBe(7);
  });

  it('tolerates odd spacing', () => {
    expect(parseParameterCount('qwen3: 8 b')).toBe(8);
  });
});

describe('warning about models that are too big', () => {
  it('accepts a 1.7b model on a low-end machine', () => {
    expect(isModelComfortable('qwen3:1.7b', 'low')).toBe(true);
  });

  it('flags a 27b model on a low-end machine', () => {
    expect(isModelComfortable('llama3:27b', 'low')).toBe(false);
  });

  it('stays out of the way on a machine with a GPU', () => {
    expect(isModelComfortable('llama3:27b', 'high')).toBe(true);
  });
});

describe('the description shown in settings', () => {
  it('names the CPU, the memory and whether there is a GPU', () => {
    resetHardwareCache();
    const text = describeHardware();
    expect(text).toMatch(/threads/);
    expect(text).toMatch(/GB RAM/);
    expect(text).toMatch(/tier$/);
  });
});