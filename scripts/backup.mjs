// scripts/backup.mjs — snapshot backup for the Infinite OS workspace.
//
// ALWAYS run this BEFORE editing any file in this repo:
//   node scripts/backup.mjs            (create a timestamped snapshot)
//   node scripts/backup.mjs --verify   (verify integrity of the newest snapshot)
//   node scripts/backup.mjs --keep N   (retain N snapshots, default 10)
//
// Snapshots are written to `.backups/<timestamp>/` inside the repo and are
// gitignored. Each snapshot contains a full copy of the workspace (excluding
// generated/heavy folders) plus `manifest.json` with SHA-256 hashes so a
// snapshot can be verified and restored byte-for-byte.
//
// Restore with:  node scripts/restore.mjs .backups/<timestamp>

import { promises as fs, createReadStream } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const backupRoot = path.join(root, '.backups');

// Directories never copied into a snapshot (generated / heavy / versioned).
const EXCLUDE_DIRS = new Set([
  'node_modules',
  'out',
  'dist',
  'release',
  '.git',
  '.backups',
  '.vite',
  'coverage',
  'playwright-report',
  'test-results',
  '.pnpm-store',
  '.cache',
]);
// File extensions never copied into a snapshot.
const EXCLUDE_EXT = new Set(['.log', '.tsbuildinfo']);

function sha256(p) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    const s = createReadStream(p);
    s.on('data', (d) => h.update(d));
    s.on('end', () => resolve(h.digest('hex')));
    s.on('error', reject);
  });
}

async function collectFiles(dir, base, files) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const e of entries) {
    if (e.isDirectory()) {
      if (EXCLUDE_DIRS.has(e.name)) continue;
      await collectFiles(path.join(dir, e.name), base, files);
    } else if (e.isFile()) {
      if (EXCLUDE_EXT.has(path.extname(e.name).toLowerCase())) continue;
      const abs = path.join(dir, e.name);
      const rel = path.relative(base, abs).split(path.sep).join('/');
      files.push(rel);
    }
  }
}

async function pruneOldSnapshots(keep) {
  const entries = (await fs.readdir(backupRoot, { withFileTypes: true }))
    .filter((e) => e.isDirectory() && /^\d{8}-\d{6}$/.test(e.name))
    .map((e) => e.name)
    .sort()
    .reverse();
  const remove = entries.slice(keep);
  for (const name of remove) {
    await fs.rm(path.join(backupRoot, name), { recursive: true, force: true });
    console.log(`pruned old snapshot: ${name}`);
  }
  return entries.length - remove.length;
}

async function snapshot() {
  const stamp = new Date()
    .toISOString()
    .replace(/[-:]/g, '')
    .replace('T', '-')
    .slice(0, 15); // YYYYMMDD-HHMMSS
  const dest = path.join(backupRoot, stamp);
  await fs.mkdir(dest, { recursive: true });

  const files = [];
  await collectFiles(root, root, files);

  const manifest = {
    createdAt: new Date().toISOString(),
    workspace: root,
    snapshot: stamp,
    fileCount: files.length,
    files: [],
  };

  let copied = 0;
  let bytes = 0;
  for (const rel of files) {
    const src = path.join(root, rel);
    const dst = path.join(dest, rel);
    await fs.mkdir(path.dirname(dst), { recursive: true });
    const buf = await fs.readFile(src);
    await fs.writeFile(dst, buf);
    const hash = crypto.createHash('sha256').update(buf).digest('hex');
    manifest.files.push({ path: rel, size: buf.length, sha256: hash });
    copied += 1;
    bytes += buf.length;
  }

  manifest.fileCount = copied;
  await fs.writeFile(
    path.join(dest, 'manifest.json'),
    JSON.stringify(manifest, null, 2),
    'utf8',
  );

  const kept = await pruneOldSnapshots(10);
  console.log(`snapshot created: .backups/${stamp}`);
  console.log(`files: ${copied}  size: ${(bytes / 1024 / 1024).toFixed(2)} MB  retained snapshots: ${kept}`);
  return path.join(dest, 'manifest.json');
}

async function verify(manifestPath) {
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  const dest = path.dirname(manifestPath);
  let ok = 0;
  let bad = 0;
  for (const f of manifest.files) {
    const p = path.join(dest, f.path);
    let hash;
    try {
      hash = await sha256(p);
    } catch {
      bad += 1;
      console.error(`MISSING: ${f.path}`);
      continue;
    }
    if (hash === f.sha256) ok += 1;
    else {
      bad += 1;
      console.error(`CORRUPT: ${f.path}`);
    }
  }
  console.log(`verify ${path.basename(dest)}: ${ok} ok, ${bad} bad (of ${manifest.fileCount})`);
  return bad === 0;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--verify')) {
    const snapshots = (await fs.readdir(backupRoot, { withFileTypes: true }))
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort()
      .reverse();
    if (snapshots.length === 0) {
      console.error('no snapshots to verify');
      process.exit(1);
    }
    // Accept either ".backups/NAME" or bare "NAME"; default to newest.
    const raw = args[args.indexOf('--verify') + 1];
    let target = raw;
    if (raw) {
      const norm = raw.replace(/\\/g, '/').replace(/^\.backups\//, '').replace(/\/+$/, '');
      if (norm.includes('/')) {
        console.error(`invalid snapshot name: ${raw}`);
        process.exit(1);
      }
      target = norm;
    } else {
      target = snapshots[0];
    }
    const mp = path.join(backupRoot, target, 'manifest.json');
    if (!(await fs.stat(mp).catch(() => false))) {
      console.error(`no manifest at ${mp}`);
      process.exit(1);
    }
    const clean = await verify(mp);
    process.exit(clean ? 0 : 1);
  }
  await snapshot();
}

main().catch((err) => {
  console.error(`backup failed: ${err.message}`);
  process.exit(1);
});
