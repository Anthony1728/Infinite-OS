import { describe, expect, it } from 'vitest';
import { UNTIL_DONE_STORAGE_KEY, wrapUntilDone } from './untilDone.js';

describe('wrapUntilDone', () => {
  it('preserves the original request verbatim at the end', () => {
    const request = 'Build a dashboard, add auth, and write tests for both.';
    const wrapped = wrapUntilDone(request);
    expect(wrapped.endsWith(request)).toBe(true);
  });

  it('states the completion contract: every item, verified, report at the end', () => {
    const wrapped = wrapUntilDone('do things');
    expect(wrapped).toContain('WORK-UNTIL-DONE MODE');
    expect(wrapped).toContain('every clause is a requirement');
    expect(wrapped).toContain('Verify each finished item');
    expect(wrapped).toContain('completion report');
    expect(wrapped).toContain('genuinely impossible');
  });

  it('trims surrounding whitespace so the contract does not double-space', () => {
    const wrapped = wrapUntilDone('  padded request  ');
    expect(wrapped.endsWith('padded request')).toBe(true);
  });

  it('exposes a stable storage key for the toggle', () => {
    expect(UNTIL_DONE_STORAGE_KEY).toBe('infinite:untilDone');
  });
});
