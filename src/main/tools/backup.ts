import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, basename, extname, relative, resolve, sep } from 'node:path';

const BACKUP_DIR = '.backups';
export const SNAPSHOT_DIR = '.infinite-backups';
export const MANIFEST = 'manifest.json';

export interface SnapshotManifest {
  sessionId: string;
  createdAt: number;
  repoRoot: string;
  files: string[];
}

/** Walk up from a file to the Infinite OS repo root (package.json named infinite-ai). */
export function findInfiniteRepoRoot(filePath: string, read: (p: string) => string | null = (p) => {
  try {
    return readFileSync(p, 'utf8');
  } catch {
    return null;
  }
}): string | null {
  let dir = dirname(resolve(filePath));
  for (let depth = 0; depth < 10; depth++) {
    let raw: string | null = null;
    try {
      raw = read(join(dir, 'package.json'));
    } catch {
      raw = null;
    }
    if (raw) {
      try {
        if ((JSON.parse(raw) as { name?: string }).name === 'infinite-ai') return dir;
      } catch { /* not JSON — keep climbing */ }
    }
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
  return null;
}

export function sessionDir(repoRoot: string, sessionId: string): string {
  const safe = String(sessionId || 'manual').replace(/[^a-zA-Z0-9-_]/g, '_').slice(0, 64) || 'manual';
  return join(repoRoot, SNAPSHOT_DIR, safe);
}

async function appendManifest(dir: string, repoRoot: string, sessionId: string, rel: string): Promise<void> {
  await mkdir(dir, { recursive: true });
  const path = join(dir, MANIFEST);
  let manifest: SnapshotManifest = { sessionId, createdAt: Date.now(), repoRoot, files: [] };
  try {
    const raw = await readFile(path, 'utf8');
    const parsed = JSON.parse(raw) as Partial<SnapshotManifest>;
    if (Array.isArray(parsed.files)) manifest = { ...manifest, ...parsed, files: parsed.files };
  } catch { /* first file of the session */ }
  if (!manifest.files.includes(rel)) manifest.files.push(rel);
  await writeFile(path, JSON.stringify(manifest, null, 2), 'utf8');
}

/**
 * Create a timestamped backup of a file before overwriting.
 * Legacy location: <file_dir>/.backups/<filename>.<timestamp>.bak
 * Inside the Infinite OS repo (with a session id): session-grouped snapshot
 * <repo>/.infinite-backups/<session>/<relpath> + manifest — one restorable
 * version per agent run. First write of the run wins, so the snapshot is the
 * WORKING version, not a history of intermediate edits.
 * Returns the backup path if a backup was created, undefined otherwise.
 */
export async function backupFile(filePath: string, sessionId?: string): Promise<string | undefined> {
  try {
    const content = await readFile(filePath, { encoding: 'utf8' });
    if (!content) return undefined;

    if (sessionId) {
      const repoRoot = findInfiniteRepoRoot(filePath);
      if (repoRoot) {
        const rel = relative(repoRoot, resolve(filePath));
        if (rel && !rel.startsWith('..') && !rel.split(sep).includes(SNAPSHOT_DIR)) {
          const dir = sessionDir(repoRoot, sessionId);
          const dest = join(dir, rel);
          if (!existsSync(dest)) {
            await mkdir(dirname(dest), { recursive: true });
            await writeFile(dest, content, 'utf8');
            await appendManifest(dir, repoRoot, sessionId, rel);
          }
          return dest;
        }
      }
    }

    const dir = dirname(filePath);
    const name = basename(filePath);
    const ext = extname(name);
    const stem = ext ? name.slice(0, -ext.length) : name;
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

    const backupDir = join(dir, BACKUP_DIR);
    await mkdir(backupDir, { recursive: true });

    const backupPath = join(backupDir, `${stem}.${timestamp}${ext}.bak`);
    await writeFile(backupPath, content, 'utf8');
    return backupPath;
  } catch {
    // File doesn't exist yet or read failed — no backup needed
    return undefined;
  }
}
