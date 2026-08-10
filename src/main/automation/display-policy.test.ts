import { describe, expect, it } from 'vitest';
import { resolveAutomationDisplayMode } from './display-policy.js';

describe('automation display policy', () => {
  it('runs visibly when Infinite OS is windowed by default', () => {
    expect(resolveAutomationDisplayMode('smart', false)).toBe('visible');
  });

  it('runs in the background when Infinite OS is full screen by default', () => {
    expect(resolveAutomationDisplayMode('smart', true)).toBe('background');
  });

  it('honors explicit user overrides', () => {
    expect(resolveAutomationDisplayMode('always-background', false)).toBe('background');
    expect(resolveAutomationDisplayMode('always-visible', true)).toBe('visible');
  });
});

