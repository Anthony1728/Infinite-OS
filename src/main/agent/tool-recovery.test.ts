import { describe, expect, it } from 'vitest';
import { buildToolRecoveryDirective, fallbackToolsFor, toolAttemptSignature } from './tool-recovery.js';

describe('cross-tool recovery', () => {
  it('provides a hidden-CDP/web fallback ladder for browser operator failures', () => {
    expect(fallbackToolsFor('Operator')).toEqual(expect.arrayContaining(['Browser', 'WebFetch', 'WebSearch']));
  });

  it('detects identical attempts regardless of object identity', () => {
    expect(toolAttemptSignature('Operator', { action: 'navigate', url: 'https://example.com' }))
      .toBe(toolAttemptSignature('Operator', { action: 'navigate', url: 'https://example.com' }));
  });

  it('requires a different method without encouraging permission bypass', () => {
    const directive = buildToolRecoveryDirective([{ name: 'Computer', input: {}, error: 'visible control unavailable' }]);
    expect(directive).toContain('materially different authorized tool');
    expect(directive).toContain('must not be bypassed');
  });
});

