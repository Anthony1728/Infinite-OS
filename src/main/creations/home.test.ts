import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let home = '';
const savedHome = process.env.INFINITE_TEST_HOME;

beforeEach(() => {
  vi.resetModules();
  home = mkdtempSync(join(tmpdir(), 'creations-'));
  process.env.INFINITE_TEST_HOME = home;
});

afterEach(() => {
  if (savedHome === undefined) delete process.env.INFINITE_TEST_HOME;
  else process.env.INFINITE_TEST_HOME = savedHome;
  if (home) rmSync(home, { recursive: true, force: true });
  home = '';
});

describe('creations home', () => {
  it('migrates legacy apps/websites once with stored path rewrites', async () => {
    const legacyApps = join(home, 'apps');
    mkdirSync(join(legacyApps, 'output'), { recursive: true });
    writeFileSync(
      join(legacyApps, 'projects.json'),
      JSON.stringify([[ 'p1', { id: 'p1', name: 'Demo', outputPath: join(legacyApps, 'output', 'demo') } ]]),
      'utf8',
    );
    writeFileSync(join(legacyApps, 'output', 'demo.txt'), 'built', 'utf8');
    const { migrateCreations, creationsAppsDir, creationsWebsitesDir } = await import('./home.js');
    migrateCreations();
    expect(existsSync(legacyApps)).toBe(false);
    expect(existsSync(join(creationsAppsDir(), 'output', 'demo.txt'))).toBe(true);
    const rewritten = readFileSync(join(creationsAppsDir(), 'projects.json'), 'utf8');
    const escaped = (p: string) => JSON.stringify(p).slice(1, -1);
    expect(rewritten).toContain(escaped(join(creationsAppsDir(), 'output', 'demo')));
    expect(rewritten).not.toContain(escaped(legacyApps));
    // Idempotent: second run changes nothing.
    migrateCreations();
    expect(existsSync(creationsWebsitesDir())).toBe(false);
  });

  it('leaves existing creations layout and custom dirs alone', async () => {
    const { migrateCreations, creationsAppsDir } = await import('./home.js');
    mkdirSync(creationsAppsDir(), { recursive: true });
    writeFileSync(join(creationsAppsDir(), 'keep.txt'), 'x', 'utf8');
    migrateCreations();
    expect(existsSync(join(creationsAppsDir(), 'keep.txt'))).toBe(true);
    expect(existsSync(join(home, 'apps'))).toBe(false);
  });
});
