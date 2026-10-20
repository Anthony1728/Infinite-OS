// Script discovery for the Python helpers. The packaged app cannot exec out of
// app.asar, so the important guarantees are: the dev tree resolves, a missing
// script yields null (so callers can fail loudly), and a packaged root is
// always rewritten to its app.asar.unpacked twin.

import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { join, sep } from 'node:path';
import { resolveScript, resolveScriptOrFirst, scriptRoots } from './script-paths.js';

const SHIPPED = [
  'local_voice_server.py',
  'local-whisper-worker.py',
  'local-kokoro-worker.py',
  'edge-tts-wrapper.py',
  'local-whisper.py',
];

describe('script-paths', () => {
  it('resolves every shipped script from the dev tree', () => {
    for (const name of SHIPPED) {
      const resolved = resolveScript(name);
      expect(resolved, name).toBeTruthy();
      expect(existsSync(resolved as string), name).toBe(true);
    }
  });

  it('returns null for a script that is not installed', () => {
    expect(resolveScript('definitely-not-installed.py')).toBe(null);
  });

  it('falls back to the first candidate so callers can show a path', () => {
    const resolved = resolveScriptOrFirst('definitely-not-installed.py');
    expect(resolved.endsWith(`definitely-not-installed.py`)).toBe(true);
    expect(resolved.startsWith(scriptRoots()[0] as string)).toBe(true);
  });

  it('repacks app.asar roots so Python can execute them', () => {
    const processRef = process as { resourcesPath?: string };
    const saved = processRef.resourcesPath;
    try {
      processRef.resourcesPath = join(sep, 'opt', 'infinite', 'resources');
      const roots = scriptRoots();
      const asarSegment = /(^|[\\/])app\.asar([\\/]|$)/;
      for (const root of roots) {
        expect(asarSegment.test(root), `root still points inside asar: ${root}`).toBe(false);
      }
      expect(roots.some((root) => root.includes(`${sep}app.asar.unpacked${sep}`))).toBe(true);
    } finally {
      if (saved === undefined) delete processRef.resourcesPath;
      else processRef.resourcesPath = saved;
    }
  });
});
