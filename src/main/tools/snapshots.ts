/**
 * Versioned self-edit snapshots — list, restore, and prune the per-session
 * versions that Write/Edit snapshot automatically (see backup.ts).
 */

import { readFile, mkdir, readdir, stat, cp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { sessionDir, SNAPSHOT_DIR, MANIFEST, type SnapshotManifest } from './backup.js';

export async function listSnapshots(repoRoot: string): Promise<SnapshotManifest[]> {
  const base = join(repoRoot, SNAPSHOT_DIR);
  let entries: string[] = [];
  try {
    entries = (await readdir(base)).filter((e) => !e.startsWith('.'));
  } catch {
    return [];
  }
  const out: SnapshotManifest[] = [];
  for (const entry of entries) {
    try {
      const st = await stat(join(base, entry));
      if (!st.isDirectory()) continue;
      const raw = await readFile(join(base, entry, MANIFEST), 'utf8');
      const manifest = JSON.parse(raw) as SnapshotManifest;
      if (Array.isArray(manifest.files)) out.push({ ...manifest, sessionId: entry });
    } catch { /* incomplete snapshot — skip */ }
  }
  return out.sort((a, b) => b.createdAt - a.createdAt);
}

/** Restore files from a session snapshot back into the repo. Returns restored rel paths. */
export async function restoreSnapshot(repoRoot: string, sessionId: string, onlyFiles?: string[]): Promise<{ restored: string[]; missing: string[] }> {
  const dir = sessionDir(repoRoot, sessionId);
  const restored: string[] = [];
  const missing: string[] = [];
  let files: string[] = [];
  try {
    const raw = await readFile(join(dir, MANIFEST), 'utf8');
    files = (JSON.parse(raw) as SnapshotManifest).files ?? [];
  } catch {
    return { restored, missing: ['(no such snapshot — check the session id)'] };
  }
  const wanted = onlyFiles?.length ? new Set(onlyFiles) : null;
  try {
    const { allowWrite } = await import('../guard/source-guard.js');
    for (const rel of files) {
      if (wanted && !wanted.has(rel)) continue;
      const src = join(dir, rel);
      const dest = join(repoRoot, rel);
      if (!existsSync(src)) {
        missing.push(rel);
        continue;
      }
      allowWrite(dest);
      await mkdir(dirname(dest), { recursive: true });
      await cp(src, dest);
      restored.push(rel);
    }
  } catch (e) {
    missing.push(`restore aborted: ${(e as Error).message}`);
  }
  return { restored, missing };
}

/** Remove snapshots older than maxAgeDays (keeps the 10 newest regardless). */
export async function pruneSnapshots(repoRoot: string, maxAgeDays = 14): Promise<number> {
  const snapshots = await listSnapshots(repoRoot);
  const cutoff = Date.now() - maxAgeDays * 86_400_000;
  let removed = 0;
  for (const snap of snapshots.slice(10)) {
    if (snap.createdAt < cutoff) {
      try {
        await rm(sessionDir(repoRoot, snap.sessionId), { recursive: true, force: true });
        removed++;
      } catch { /* best-effort */ }
    }
  }
  return removed;
}
