import { describe, expect, it } from 'vitest';
import { findRepoRoot, osPushStatus } from './push.js';

describe('github push (Deploy → GitHub)', () => {
  it('finds the repo root from the working tree', () => {
    expect(findRepoRoot()).toBeTruthy();
  });

  it('reports live repository state without changing anything', async () => {
    const status = await osPushStatus();
    expect(status.ok).toBe(true);
    expect(status.branch).toBeTruthy();
    expect(typeof status.dirty).toBe('number');
  });
});
