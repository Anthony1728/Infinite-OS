import { describe, it, expect } from 'vitest';
import { getSelfModel, getSurfaceIds } from './self-model.js';

describe('self-model', () => {
  it('names the system the agent lives in', () => {
    const model = getSelfModel();
    expect(model).toContain('Infinite OS');
    expect(model).toContain('Infinite AI');
  });

  it('covers the surfaces the agent can direct users to', () => {
    const model = getSelfModel();
    for (const id of ['terminal', 'automations', 'deploy', 'plugins', 'replay', 'bots', 'artifacts', 'messaging']) {
      expect(model).toContain(id);
    }
    expect(getSurfaceIds()).toContain('terminal');
  });

  it('teaches chat powers (slash, @-refs) and execution powers (PTY, checkpoints)', () => {
    const model = getSelfModel();
    expect(model).toContain('@-reference');
    expect(model).toContain('PTY');
    expect(model).toContain('Ctrl+`');
  });

  it('is cached (same string, no rebuild cost)', () => {
    expect(getSelfModel()).toBe(getSelfModel());
  });
});
