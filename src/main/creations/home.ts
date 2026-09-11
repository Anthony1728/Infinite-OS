/**
 * AI Creations home — every app or website Infinite OS builds lives under
 * <profile-home>/creations/{apps,websites} instead of two top-level folders.
 * migrateCreations() moves legacy <home>/apps + <home>/websites once (with
 * stored outputPath rewrites), so existing work survives the move.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { infiniteHome } from '../profiles/home.js';

export function creationsRoot(): string {
  return join(infiniteHome(), 'creations');
}

export function creationsAppsDir(): string {
  return join(creationsRoot(), 'apps');
}

export function creationsWebsitesDir(): string {
  return join(creationsRoot(), 'websites');
}

function rewriteStoredPaths(jsonPath: string, fromPrefix: string, toPrefix: string): void {
  try {
    if (!existsSync(jsonPath)) return;
    let raw = readFileSync(jsonPath, 'utf8');
    let changed = false;
    // Paths may be stored raw (config files) or JSON-escaped (manifests) —
    // rewrite whichever form appears.
    for (const [from, to] of [
      [fromPrefix, toPrefix],
      [JSON.stringify(fromPrefix).slice(1, -1), JSON.stringify(toPrefix).slice(1, -1)],
    ]) {
      if (raw.includes(from)) {
        raw = raw.split(from).join(to);
        changed = true;
      }
    }
    if (changed) writeFileSync(jsonPath, raw, 'utf8');
  } catch { /* corrupt manifest — builders load defensively */ }
}

function migrateOne(legacyDir: string, targetDir: string, manifestFile: string): void {
  try {
    if (!existsSync(legacyDir) || existsSync(targetDir)) return;
    mkdirSync(creationsRoot(), { recursive: true });
    renameSync(legacyDir, targetDir);
    rewriteStoredPaths(join(targetDir, manifestFile), legacyDir, targetDir);
  } catch { /* best-effort; builders fall back to fresh dirs */ }
}

/** Idempotent: safe to call from every builder constructor. */
export function migrateCreations(): void {
  const home = infiniteHome();
  migrateOne(join(home, 'apps'), creationsAppsDir(), 'projects.json');
  migrateOne(join(home, 'websites'), creationsWebsitesDir(), 'websites.json');
}
