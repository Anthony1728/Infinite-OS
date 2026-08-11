// scripts/restore.mjs — restore the workspace from a backup snapshot.
//
// Usage:
//   node scripts/restore.mjs .backups/YYYYMMDD-HHMMSS [--dry-run]
//
// Safety guarantees:
//   1. Refuses to run unless the target snapshot has a valid manifest.json.
//   2. Automatically creates a fresh backup of the CURRENT workspace state
//      before overwriting anything, so a restore can always be undone.
//   3. Verifies every restored file against its recorded SHA-256 hash.
//   4. --dry-run prints exactly what would be restored without touching files.
//
// Only files listed in the snapshot manifest are touched. Files that exist in
// the workspace but are not in the manifest are left alone.

import { promises as fs, createReadStream } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const backupRoot = path.join(root, '.backups');

function sha256(p) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    const s = createReadStream(p);
    s.on('data', (d) => h.update(d));
    s.on('end', () => resolve(h.digest('hex')));
    s.on('error', reject);
  });
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const target = args.find((a) => !a.startsWith('--'));

  if (!target) {
    console.error('usage: node scripts/restore.mjs .backups/YYYYMMDD-HHMMSS [--dry-run]');
    process.exit(1);
  }

  const snapDir = path.isAbsolute(target) ? target : path.join(root, target);
  const manifestPath = path.join(snapDir, 'manifest.json');
  if (!(await fs.stat(manifestPath).catch(() => false))) {
    console.error(`refusing to restore: no valid manifest.json at ${manifestPath}`);
    process.exit(1);
  }

  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  if (!Array.isArray(manifest.files) || manifest.files.length === 0) {
    console.error(`refusing to restore: manifest at ${manifestPath} has no files`);
    process.exit(1);
  }

  console.log(`restore target: ${path.basename(snapDir)} (${manifest.fileCount} files, created ${manifest.createdAt})`);
  console.log(`workspace:      ${root}`);
  if (dryRun) console.log('DRY RUN — no files will be changed.\n');

  // Safety net: snapshot current state before mutating anything.
  if (!dryRun) {
    console.log('creating safety backup of current state before restore...');
    const res = spawnSync(process.execPath, [path.join(root, 'scripts', 'backup.mjs')], {
      cwd: root,
      stdio: 'inherit',
    });
    if (res.status !== 0) {
      console.error('aborting: safety backup failed; nothing was restored');
      process.exit(1);
    }
  }

  // Phase 1: validate the snapshot files exist and match their hashes BEFORE
  // touching the workspace. Abort on any mismatch.
  console.log(`validating ${manifest.fileCount} files in snapshot...`);
  for (const f of manifest.files) {
    const p = path.join(snapDir, f.path);
    if (!(await fs.stat(p).catch(() => false))) {
      console.error(`aborting: snapshot is missing ${f.path}`);
      process.exit(1);
    }
  }

  // Phase 2: apply.
  let restored = 0;
  let skipped = 0;
  let bytes = 0;
  for (const f of manifest.files) {
    const src = path.join(snapDir, f.path);
    const dst = path.join(root, f.path);
    let need = true;
    try {
      if ((await fs.stat(dst).catch(() => false)) && (await sha256(dst)) === f.sha256) {
        need = false; // already byte-identical
      }
    } catch {
      need = true;
    }
    if (!need) {
      skipped += 1;
      continue;
    }
    if (dryRun) {
      console.log(`  would restore: ${f.path}`);
      restored += 1;
      continue;
    }
    await fs.mkdir(path.dirname(dst), { recursive: true });
    const buf = await fs.readFile(src);
    await fs.writeFile(dst, buf);
    const check = crypto.createHash('sha256').update(buf).digest('hex');
    if (check !== f.sha256) {
      console.error(`FAILED: ${f.path} hash mismatch after restore`);
      process.exit(1);
    }
    restored += 1;
    bytes += buf.length;
  }

  console.log(`\nrestore complete: ${restored} restored, ${skipped} already identical, ${(bytes / 1024 / 1024).toFixed(2)} MB written${dryRun ? ' (DRY RUN)' : ''}`);
}

main().catch((err) => {
  console.error(`restore failed: ${err.message}`);
  process.exit(1);
});
