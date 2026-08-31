import { readdir, rename, stat, unlink, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { existsSync } from "node:fs";
const SCREENSHOTS_DIR = join(homedir(), ".infinite-ai", "screenshots");
const OPERATOR_SCREENSHOTS_DIR = join(homedir(), ".infinite-ai", "operator-screenshots");
const TRASH_DIR = join(homedir(), ".infinite-ai", ".screenshots-trash");
const SOFT_DELETE_AFTER_MS = 7 * 24 * 60 * 60 * 1e3;
const HARD_DELETE_AFTER_MS = 30 * 24 * 60 * 60 * 1e3;
const PROTECTED_FILES = /* @__PURE__ */ new Set(["live-frame.png"]);
async function ensureDir(dir) {
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }
}
async function softDeleteOld(dir, cutoffMs) {
  const errors = [];
  let moved = 0;
  if (!existsSync(dir)) return { moved: 0, errors };
  await ensureDir(TRASH_DIR);
  const files = await readdir(dir);
  for (const file of files) {
    if (PROTECTED_FILES.has(file)) continue;
    if (!file.endsWith(".png") && !file.endsWith(".jpg") && !file.endsWith(".webp")) continue;
    const filePath = join(dir, file);
    try {
      const s = await stat(filePath);
      if (s.mtimeMs < cutoffMs) {
        const trashPath = join(TRASH_DIR, `${Date.now()}-${file}`);
        await rename(filePath, trashPath);
        moved++;
      }
    } catch (e) {
      errors.push(`Failed to move ${file}: ${e.message}`);
    }
  }
  return { moved, errors };
}
async function hardDeleteOld(trashDir, cutoffMs) {
  const errors = [];
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
      errors.push(`Failed to delete ${file}: ${e.message}`);
    }
  }
  return { deleted, errors };
}
async function runScreenshotCleanup() {
  const now = Date.now();
  const errors = [];
  const softCutoff = now - SOFT_DELETE_AFTER_MS;
  const r1 = await softDeleteOld(SCREENSHOTS_DIR, softCutoff);
  const r2 = await softDeleteOld(OPERATOR_SCREENSHOTS_DIR, softCutoff);
  errors.push(...r1.errors, ...r2.errors);
  const hardCutoff = now - HARD_DELETE_AFTER_MS;
  const r3 = await hardDeleteOld(TRASH_DIR, hardCutoff);
  errors.push(...r3.errors);
  const softDeleted = r1.moved + r2.moved;
  const hardDeleted = r3.deleted;
  if (softDeleted > 0 || hardDeleted > 0 || errors.length > 0) {
    console.log(
      `[screenshot-cleanup] soft-deleted=${softDeleted} hard-deleted=${hardDeleted} errors=${errors.length}`
    );
  }
  return { softDeleted, hardDeleted, errors };
}
async function restoreTrashedScreenshots() {
  const errors = [];
  let restored = 0;
  if (!existsSync(TRASH_DIR)) return { restored: 0, errors };
  await ensureDir(SCREENSHOTS_DIR);
  const files = await readdir(TRASH_DIR);
  for (const file of files) {
    const trashPath = join(TRASH_DIR, file);
    const originalName = file.replace(/^\d+-/, "");
    const destPath = join(SCREENSHOTS_DIR, originalName);
    try {
      await rename(trashPath, destPath);
      restored++;
    } catch (e) {
      errors.push(`Failed to restore ${file}: ${e.message}`);
    }
  }
  return { restored, errors };
}
async function getScreenshotStats() {
  async function dirStats(dir) {
    if (!existsSync(dir)) return { count: 0, sizeBytes: 0 };
    const files = await readdir(dir);
    let sizeBytes = 0;
    for (const file of files) {
      try {
        const s = await stat(join(dir, file));
        sizeBytes += s.size;
      } catch {
      }
    }
    return { count: files.length, sizeBytes };
  }
  return {
    active: await dirStats(SCREENSHOTS_DIR),
    trashed: await dirStats(TRASH_DIR)
  };
}
function startPeriodicCleanup(intervalMs = 30 * 60 * 1e3) {
  const timer = setInterval(() => {
    runScreenshotCleanup().catch((e) => {
      console.error("[screenshot-cleanup] periodic cleanup failed:", e);
    });
  }, intervalMs);
  return () => clearInterval(timer);
}
export {
  getScreenshotStats,
  restoreTrashedScreenshots,
  runScreenshotCleanup,
  startPeriodicCleanup
};
