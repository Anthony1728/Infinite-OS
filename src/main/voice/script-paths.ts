/**
 * Locate Python helper scripts under `resources/scripts/` in both dev and
 * packaged builds.
 *
 * Dev tree: the repo sits at `process.cwd()`.
 * Packaged: electron-builder copies `resources/**` into `app.asar`, which
 * Python cannot read or execute — `resources/scripts/**` is unpacked, so any
 * asar path must be rewritten to its `app.asar.unpacked` twin before it is
 * handed to `spawn()`.
 *
 * A bare `process.cwd()` lookup silently breaks the packaged app (cwd is the
 * user's shell directory, not the install dir), which is why every script
 * lookup goes through here.
 */

import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, sep } from 'node:path';

const ASAR = `${sep}app.asar${sep}`;
const ASAR_UNPACKED = `${sep}app.asar.unpacked${sep}`;

function toRealPath(path: string): string {
  return path.includes(ASAR) ? path.replace(ASAR, ASAR_UNPACKED) : path;
}

/** Candidate directories, most specific first. Never hits the filesystem. */
export function scriptRoots(): string[] {
  const roots = [join(process.cwd(), 'resources', 'scripts')];

  const resourcesPath = (process as { resourcesPath?: string }).resourcesPath;
  if (resourcesPath) {
    // Packaged layout: <resources>/app.asar/resources/scripts/… (unpacked).
    roots.push(join(resourcesPath, 'app.asar', 'resources', 'scripts'));
    // Flat variants some builds produce.
    roots.push(join(resourcesPath, 'app.asar', 'scripts'));
    roots.push(join(resourcesPath, 'scripts'));
  }

  // User-data copies the installer drops next to the profile.
  roots.push(join(homedir(), '.infinite-ai'));

  // Deduplicate while preserving priority order.
  return [...new Set(roots.map((root) => toRealPath(root)))];
}

/**
 * Resolve a script by filename. Returns the spawn-safe (possibly unpacked)
 * path, or null when the script is not installed anywhere we look.
 */
export function resolveScript(name: string): string | null {
  for (const root of scriptRoots()) {
    const candidate = join(root, name);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/**
 * Resolve a script, falling back to the first candidate so callers can still
 * surface a path in their error message when the script is missing.
 */
export function resolveScriptOrFirst(name: string): string {
  return resolveScript(name) ?? join(scriptRoots()[0] as string, name);
}
