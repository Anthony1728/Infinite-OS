import { guardSelfModification, type GuardResult } from '../agent/self-modification.js';
import { findInfiniteRepoRoot } from './backup.js';
import { join } from 'node:path';

/**
 * Guard for tools that write generated output rather than source.
 *
 * Every generator (documents, charts, images, video, music) accepts an
 * agent-chosen `outputDir` and writes into it. Those writes went straight to
 * disk, so a generated file could be dropped inside `src/` or over
 * `package.json` — the same protected machinery `Write` and `Edit` refuse to
 * touch. Asking for a chart would have been a way around the guard rather than
 * subject to it, which made the guard advisory rather than real.
 *
 * This routes those writes through the same decision the file tools use, so
 * there is one rule rather than six.
 */

/** Matches the error shape the generators already return. */
type Denial = { allowed: false; reason: string } | GuardResult;

/**
 * Check a whole output directory instead of individual files.
 *
 * Two probes are needed because PROTECTED_PATHS mixes exact files with
 * directory prefixes:
 *
 *  - `src/main/tools/snapshots.ts` is an exact match, so only the path itself
 *    is protected — appending a child would miss it entirely.
 *  - `src/main/audit/` is a prefix, so it only matches a path *inside* it.
 *
 * Testing both closes each with the other's blind spot: the path itself covers
 * exact files, the child covers directories.
 */
const GUARD_PROBE = '__infinite_write_guard_probe__';

export function guardOutputDirectory(outDir: string, cwd?: string): Denial {
  const from = cwd || process.cwd();
  const repoRoot = findInfiniteRepoRoot(from) || findInfiniteRepoRoot(outDir) || from;

  if (repoRoot) {
    const asIs = guardSelfModification(repoRoot, outDir, 'create');
    if (!asIs.allowed) return asIs;
    return guardSelfModification(repoRoot, join(outDir, GUARD_PROBE), 'create');
  }

  // Installed app: no repo, but the install tree is just as much the app's own
  // machinery. Writing generated files into it corrupts the installation.
  const resourcesPath = process.resourcesPath;
  const install = resourcesPath ? `${resourcesPath.replace(/[\\/]+$/, '')}\\` : '';
  if (install && outDir.toLowerCase().startsWith(install.toLowerCase())) {
    return {
      allowed: false,
      reason:
        `Refused to write into ${outDir} — it is inside the installed application folder. ` +
        'Generated files belong in your documents or output folder, not over the app itself. ' +
        'Choose a different output directory.',
    };
  }

  return { allowed: true };
}

/** Convenience: the user-facing message, or null when the directory is fine. */
export function outputDirectoryDenial(outDir: string, cwd?: string): string | null {
  const result = guardOutputDirectory(outDir, cwd);
  return result.allowed ? null : result.reason ?? 'Refused: that directory is protected.';
}