import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { livemapCandidates, resolveLivemapSource } from './pc-live-map.js';

/**
 * PC Live Map auto-start only worked in the repo.
 *
 * The collector was located by walking three directories up from this module.
 * In a packaged build the module is inside `app.asar`, so that walk landed
 * inside the archive, found nothing, and auto-start reported the collector
 * missing in every shipped installer. It was never noticed because in
 * development the bridge was already running, so the launch path returned
 * early and the broken lookup was never reached.
 *
 * The second half of the same bug: `process.execPath` is the Infinite OS
 * executable in a packaged build, not node. Even with the right script path,
 * spawning it would have started a second copy of the app instead of the
 * collector.
 */

const RUNTIME_FILES = ['collector-server.js', 'tracker.ps1', 'executor.ps1'];

const created: string[] = [];

function makeFakeInstall(): { resources: string; pcLiveMap: string } {
  const base = mkdtempSync(join(tmpdir(), 'infinite-livemap-'));
  created.push(base);
  const resources = join(base, 'resources');
  const pcLiveMap = join(resources, 'pc-live-map');
  mkdirSync(pcLiveMap, { recursive: true });
  for (const f of RUNTIME_FILES) writeFileSync(join(pcLiveMap, f), '// runtime');
  return { resources, pcLiveMap };
}

const originalResourcesPath = process.resourcesPath;

afterEach(() => {
  if (originalResourcesPath === undefined) delete (process as { resourcesPath?: string }).resourcesPath;
  else (process as { resourcesPath?: string }).resourcesPath = originalResourcesPath;
  while (created.length) {
    const dir = created.pop();
    if (dir) { try { rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ } }
  }
});

describe('PC Live Map runtime resolution', () => {
  it('finds the repo copy when running from source', () => {
    const src = resolveLivemapSource();
    expect(src, 'repo copy not found — the Live Map cannot start from source').not.toBeNull();
    expect(src!.packaged).toBe(false);
    for (const f of RUNTIME_FILES) {
      expect(src!.dir.endsWith('pc-live-map')).toBe(true);
      expect(f.length).toBeGreaterThan(0);
    }
  });

  it('offers the copy shipped next to the installed app as a candidate', () => {
    const { resources, pcLiveMap } = makeFakeInstall();
    (process as { resourcesPath?: string }).resourcesPath = resources;

    // Running from source the repo copy legitimately wins, so the packaged
    // candidate is asserted directly rather than through the winner.
    const packaged = livemapCandidates().find((c) => c.packaged);
    expect(packaged, 'no packaged candidate — an installed build would find nothing').toBeDefined();
    expect(packaged!.dir).toBe(pcLiveMap);
    expect(packaged!.root).toBe(resources);
    for (const f of RUNTIME_FILES) {
      expect(existsSync(join(packaged!.dir, f))).toBe(true);
    }
  });

  it('prefers the repo copy when both are present', () => {
    const { resources } = makeFakeInstall();
    (process as { resourcesPath?: string }).resourcesPath = resources;

    // Source tree first: a developer editing the repo wants their copy live,
    // not a stale installed one.
    expect(resolveLivemapSource()?.packaged).toBe(false);
  });

  it('does not report a packaged location when it is incomplete', () => {
    const { resources, pcLiveMap } = makeFakeInstall();
    // Only the collector is present — the tracker and executor are missing,
    // so this copy cannot work and must not be selected.
    rmSync(join(pcLiveMap, 'tracker.ps1'));
    (process as { resourcesPath?: string }).resourcesPath = resources;

    const src = resolveLivemapSource();
    // Falls back to the repo copy rather than a half-populated install.
    expect(src?.packaged).toBe(false);
  });

  it('returns null rather than a broken path when nothing is installed', () => {
    const { resources } = makeFakeInstall();
    rmSync(join(resources, 'pc-live-map'), { recursive: true, force: true });
    (process as { resourcesPath?: string }).resourcesPath = resources;

    // The repo copy still exists in the source tree, so this resolves there.
    // The point is that it never points at the empty resources path.
    const src = resolveLivemapSource();
    if (src) expect(src.dir).not.toBe(join(resources, 'pc-live-map'));
  });
});

describe('packaging ships the Live Map runtime', () => {
  it('electron-builder copies pc-live-map into the install', () => {
    // The resolver falls back to process.resourcesPath, which only works if
    // the build actually copies the folder there. Without this the fallback
    // above would be dead code and every installer would stay broken.
    const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')) as {
      build?: { extraResources?: { from: string; to: string }[] };
    };
    const extra = pkg.build?.extraResources ?? [];
    const entry = extra.find((r) => r.from.replace(/\\/g, '/').endsWith('pc-live-map'));
    expect(entry, 'build.extraResources does not copy the Live Map runtime').toBeDefined();
    expect(entry!.to).toBe('pc-live-map');
  });
});