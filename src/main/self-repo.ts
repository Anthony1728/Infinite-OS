// Locates the Infinite OS source repository on disk.
//
// Self-evolution and self-apply need to know where the app's own code lives:
// - under `npm run dev`, main runs from out/main inside the repo checkout,
// - in a packaged build, the running code lives in app.asar with no source
//   checkout next to it (self-repo detection then fails, which is correct —
//   there is nothing editable/rebuildable on disk).

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

let cached: string | null | undefined;

/** Walk up from `startDir` (default: this module's directory) looking for the repo. */
export function findSelfRepoRoot(startDir?: string): string | null {
  const useCache = startDir === undefined;
  if (useCache && cached !== undefined) return cached;

  let found: string | null = null;
  try {
    let dir = startDir ?? dirname(fileURLToPath(import.meta.url));
    for (let i = 0; i < 6; i++) {
      const pkgPath = join(dir, 'package.json');
      if (existsSync(pkgPath)) {
        try {
          const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { name?: string };
          if (pkg.name === 'infinite-ai') {
            found = dir;
            break;
          }
        } catch {
          // unreadable package.json — keep walking
        }
      }
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  } catch {
    found = null;
  }

  if (useCache) cached = found;
  return found;
}

/** True when `dir` is the repo root or nested inside it. */
export function isInSelfRepo(dir: string): boolean {
  const root = findSelfRepoRoot();
  if (!root || !dir) return false;
  try {
    const target = resolve(dir);
    const base = resolve(root);
    return target === base || target.startsWith(base + sep);
  } catch {
    return false;
  }
}

/** Test hook — clears the memoized repo root. */
export function resetSelfRepoCache(): void {
  cached = undefined;
}
