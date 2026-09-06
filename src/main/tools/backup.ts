import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join, basename, extname } from 'node:path';

const BACKUP_DIR = '.backups';

/**
 * Create a timestamped backup of a file before overwriting.
 * Backup location: <file_dir>/.backups/<filename>.<timestamp>.bak
 * Returns the backup path if a backup was created, undefined otherwise.
 */
export async function backupFile(filePath: string): Promise<string | undefined> {
  try {
    const content = await readFile(filePath, { encoding: 'utf8' });
    if (!content) return undefined;

    const dir = dirname(filePath);
    const name = basename(filePath);
    const ext = extname(name);
    const stem = ext ? name.slice(0, -ext.length) : name;
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

    const backupDir = join(dir, BACKUP_DIR);
    await mkdir(backupDir, { recursive: true });

    const backupPath = join(backupDir, `${stem}.${timestamp}${ext}.bak`);
    await writeFile(backupPath, content, { encoding: 'utf8' });
    return backupPath;
  } catch {
    // File doesn't exist yet or read failed — no backup needed
    return undefined;
  }
}
