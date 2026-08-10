// Screenshot Cleanup — auto-deletes old screenshots to save disk space.
//
// Screenshots are soft-deleted (moved to a trash folder) so they can be
// restored if needed. Hard deletion happens after an extended retention period.
//
// Runs on app startup and periodically (every 30 minutes).

import { readdir, stat, rename, unlink, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { existsSync } from 'node:fs';

const SCREENSHOTS_DIR = join(homedir(), '.infinite-ai', 'screenshots');
const OPERATOR_SCREENSHOTS_DIR = join(homedir(), '.infinite-ai', 'operator-screenshots');
const TRASH_DIR = join(homedir(), '.infinite-ai', '.screenshots-trash');

// Retention periods in milliseconds.
const SOFT_DELETE_AFTER_MS = 7 * 24 * 60 * 60 * 1000;   // 7 days → move to trash
const HARD_DELETE_AFTER_MS = 30 * 24 * 60 * 60 * 1000;  // 30 days → permanently delete from trash

// Files to never delete.
const PROTECTED_FILES = new Set(['live-frame.png']);

async function ensureDir(dir: string): Promise<void> {
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }
}

interface CleanupResult {
  softDeleted: number;
  hardDeleted: number;
  errors: string[];
}

/** Move old screenshots to the trash folder (soft delete). */
async function softDeleteOld(dir: string, cutoffMs: number): Promise<{ moved: number; errors: string[] }> {
  const errors: string[] = [];
  let moved = 0;

  if (!existsSync(dir)) return { moved: 0, errors };

  await ensureDir(TRASH_DIR);

  const files = await readdir(dir);
  for (const file of files) {
    if (PROTECTED_FILES.has(file)) continue;
    if (!file.endsWith('.png') && !file.endsWith('.jpg') && !file.endsWith('.webp')) continue;

    const filePath = join(dir, file);
    try {
      const s = await stat(filePath);
      if (s.mtimeMs < cutoffMs) {
        const trashPath = join(TRASH_DIR, `${Date.now()}-${file}`);
        await rename(filePath, trashPath);
        moved++;
      }
    } catch (e) {
      errors.push(`Failed to move ${file}: ${(e as Error).message}`);
    }
  }

  return { moved, errors };
}

/** Permanently delete old files from the trash folder (hard delete). */
async function hardDeleteOld(trashDir: string, cutoffMs: number): Promise<{ deleted: number; errors: string[] }> {
  const errors: string[] = [];
  let deleted = 0;

  if (!existsSync(trashDir)) return { deleted: 0, errors };

  const files = await readdir(trashDir);
  for (const file of files) {
    const filePath = join(trashDir, file);
    try {
      const s = await stat(filePath);
      if (s.mtimeMs < cutoffMs) {
        await unlink(filePath);
        deleted++;
      }
    } catch (e) {
      errors.push(`Failed to delete ${file}: ${(e as Error).message}`);
    }
  }

  return { deleted, errors };
}

/**
 * Run a full cleanup cycle:
 * 1. Soft-delete screenshots older than 7 days (move to trash)
 * 2. Hard-delete trashed screenshots older than 30 days
 */
export async function runScreenshotCleanup(): Promise<CleanupResult> {
  const now = Date.now();
  const errors: string[] = [];

  // Soft-delete old screenshots from active directories.
  const softCutoff = now - SOFT_DELETE_AFTER_MS;
  const r1 = await softDeleteOld(SCREENSHOTS_DIR, softCutoff);
  const r2 = await softDeleteOld(OPERATOR_SCREENSHOTS_DIR, softCutoff);
  errors.push(...r1.errors, ...r2.errors);

  // Hard-delete old trashed files.
  const hardCutoff = now - HARD_DELETE_AFTER_MS;
  const r3 = await hardDeleteOld(TRASH_DIR, hardCutoff);
  errors.push(...r3.errors);

  const softDeleted = r1.moved + r2.moved;
  const hardDeleted = r3.deleted;

  if (softDeleted > 0 || hardDeleted > 0 || errors.length > 0) {
    console.log(
      `[screenshot-cleanup] soft-deleted=${softDeleted} hard-deleted=${hardDeleted} errors=${errors.length}`,
    );
  }

  return { softDeleted, hardDeleted, errors };
}

/** Restore all trashed screenshots back to the active directory. */
export async function restoreTrashedScreenshots(): Promise<{ restored: number; errors: string[] }> {
  const errors: string[] = [];
  let restored = 0;

  if (!existsSync(TRASH_DIR)) return { restored: 0, errors };

  await ensureDir(SCREENSHOTS_DIR);

  const files = await readdir(TRASH_DIR);
  for (const file of files) {
    const trashPath = join(TRASH_DIR, file);
    // Strip the timestamp prefix we added during soft-delete.
    const originalName = file.replace(/^\d+-/, '');
    const destPath = join(SCREENSHOTS_DIR, originalName);
    try {
      await rename(trashPath, destPath);
      restored++;
    } catch (e) {
      errors.push(`Failed to restore ${file}: ${(e as Error).message}`);
    }
  }

  return { restored, errors };
}

/** Get count and total size of screenshots in all directories. */
export async function getScreenshotStats(): Promise<{
  active: { count: number; sizeBytes: number };
  trashed: { count: number; sizeBytes: number };
}> {
  async function dirStats(dir: string) {
    if (!existsSync(dir)) return { count: 0, sizeBytes: 0 };
    const files = await readdir(dir);
    let sizeBytes = 0;
    for (const file of files) {
      try {
        const s = await stat(join(dir, file));
        sizeBytes += s.size;
      } catch { /* ignore */ }
    }
    return { count: files.length, sizeBytes };
  }

  return {
    active: await dirStats(SCREENSHOTS_DIR),
    trashed: await dirStats(TRASH_DIR),
  };
}

/** Start periodic cleanup (every 30 minutes). Returns a stop function. */
export function startPeriodicCleanup(intervalMs = 30 * 60 * 1000): () => void {
  const timer = setInterval(() => {
    runScreenshotCleanup().catch((e) => {
      console.error('[screenshot-cleanup] periodic cleanup failed:', e);
    });
  }, intervalMs);
  return () => clearInterval(timer);
}
