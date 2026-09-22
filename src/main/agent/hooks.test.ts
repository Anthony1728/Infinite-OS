import { describe, it, expect } from 'vitest';
import { parseHookVerdict } from './hooks.js';

describe('hook verdict parsing', () => {
  it('parses block decisions', () => {
    const v = parseHookVerdict('{"decision":"block","reason":"no pushes on Friday"}');
    expect(v?.decision).toBe('block');
    expect(v?.reason).toBe('no pushes on Friday');
  });

  it('parses additionalContext', () => {
    const v = parseHookVerdict('{"additionalContext":"lint passed"}');
    expect(v?.additionalContext).toBe('lint passed');
  });

  it('returns null for plain output (backward compatible)', () => {
    expect(parseHookVerdict('')).toBeNull();
    expect(parseHookVerdict('formatted 3 files')).toBeNull();
    expect(parseHookVerdict('not json {')).toBeNull();
  });

  it('returns null for non-object JSON', () => {
    expect(parseHookVerdict('[1,2]')).toBeNull();
    expect(parseHookVerdict('"string"')).toBeNull();
  });
});
