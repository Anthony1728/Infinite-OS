/**
 * Business knowledge base — the Knowledge tab's own store, SEPARATE from the
 * agent's memory (Memory tab). This is where the business lives: facts about
 * the company plus uploaded files (PDF, Excel, CSV, text) whose contents are
 * extracted at attach time so the agent can read and answer from them.
 * The agent reaches it through the BusinessKnowledge tool, and Infinite Brain
 * recall includes top KB hits alongside memory.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, statSync } from 'node:fs';
import { join, basename, extname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { infiniteHome } from '../profiles/home.js';

export interface KbEntry {
  id: string;
  title: string;
  content: string;
  tags: string[];
  fileName: string | null;
  createdAt: number;
  updatedAt: number;
}

const MAX_ENTRY_CHARS = 60_000;
const MAX_FILE_BYTES = 25 * 1024 * 1024;

function kbDir(): string {
  return join(infiniteHome(), 'knowledge');
}

function kbFile(): string {
  return join(kbDir(), 'kb.json');
}

function filesDir(): string {
  return join(kbDir(), 'files');
}

/**
 * Parsed KB, keyed by the file's mtime and size.
 *
 * `searchKb` runs on the agent's recall path and `listKb` runs whenever the
 * Knowledge tab paints; both re-read and re-parsed the entire store before.
 * The file only changes through `writeAll`, which drops the cache, so the
 * stat check is a cheap guard against an edit made outside the app.
 */
let cache: { entries: KbEntry[]; mtimeMs: number; size: number } | null = null;

function readAll(): KbEntry[] {
  try {
    const p = kbFile();
    if (!existsSync(p)) return [];
    const stats = statSync(p);
    if (cache && cache.mtimeMs === stats.mtimeMs && cache.size === stats.size) {
      // Copy: callers such as `addEntry` mutate the array they get back.
      return cache.entries.slice();
    }
    const raw = JSON.parse(readFileSync(p, 'utf8')) as KbEntry[];
    const entries = Array.isArray(raw) ? raw.filter((e) => e && typeof e.title === 'string') : [];
    cache = { entries, mtimeMs: stats.mtimeMs, size: stats.size };
    return entries.slice();
  } catch {
    return [];
  }
}

function writeAll(entries: KbEntry[]): void {
  mkdirSync(kbDir(), { recursive: true });
  writeFileSync(kbFile(), JSON.stringify(entries, null, 2), 'utf8');
  cache = null;
}

export function listKb(): KbEntry[] {
  return readAll().sort((a, b) => b.updatedAt - a.updatedAt);
}

export function getKb(id: string): KbEntry | null {
  return readAll().find((e) => e.id === id) ?? null;
}

export function saveKb(input: { id?: string; title: string; content?: string; tags?: string[] }): KbEntry {
  const title = input.title.trim();
  if (!title) throw new Error('title is required');
  const entries = readAll();
  const now = Date.now();
  const existing = input.id ? entries.find((e) => e.id === input.id) : undefined;
  if (existing) {
    existing.title = title;
    if (typeof input.content === 'string') existing.content = input.content.slice(0, MAX_ENTRY_CHARS);
    if (Array.isArray(input.tags)) existing.tags = input.tags.filter((t) => typeof t === 'string');
    existing.updatedAt = now;
    writeAll(entries);
    return existing;
  }
  const entry: KbEntry = {
    id: randomUUID(),
    title,
    content: (input.content ?? '').slice(0, MAX_ENTRY_CHARS),
    tags: Array.isArray(input.tags) ? input.tags.filter((t) => typeof t === 'string') : [],
    fileName: null,
    createdAt: now,
    updatedAt: now,
  };
  entries.unshift(entry);
  writeAll(entries);
  return entry;
}

export function deleteKb(id: string): boolean {
  const entries = readAll();
  if (!entries.some((e) => e.id === id)) return false;
  writeAll(entries.filter((e) => e.id !== id));
  return true;
}

async function extractPdf(absPath: string): Promise<string> {
  const { readFile } = await import('node:fs/promises');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pdfjs = (await import('pdfjs-dist/legacy/build/pdf.mjs')) as any;
  const data = await readFile(absPath);
  const doc = await pdfjs.getDocument({ data: new Uint8Array(data), useSystemFonts: true }).promise;
  const pages: string[] = [];
  const count = Math.min(doc.numPages ?? 0, 60);
  for (let i = 1; i <= count; i++) {
    const page = await doc.getPage(i);
    const tc = await page.getTextContent();
    const strs = (tc.items ?? []).map((it: { str?: string }) => it?.str ?? '').filter(Boolean);
    pages.push(strs.join(' '));
    try { await page.cleanup(); } catch { /* best-effort */ }
  }
  try { await doc.destroy(); } catch { /* best-effort */ }
  return pages.join('\n\n');
}

async function extractSheet(absPath: string): Promise<string> {
  const ExcelJS = (await import('exceljs')).default ?? (await import('exceljs'));
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(absPath);
  const out: string[] = [];
  wb.eachSheet((ws) => {
    out.push(`## Sheet: ${ws.name}`);
    let rows = 0;
    ws.eachRow((row) => {
      if (rows++ > 500) return;
      const vals = (Array.isArray(row.values) ? row.values : []).slice(1).map((v) => {
        if (v == null) return '';
        if (v instanceof Date) return v.toISOString().slice(0, 10);
        if (typeof v === 'object') {
          const o = v as unknown as Record<string, unknown>;
          const text = o.text ?? o.result;
          return String(typeof text === 'string' || typeof text === 'number' ? text : '');
        }
        return String(v);
      });
      const line = vals.join(' | ').trim();
      if (line.replace(/[\s|]/g, '')) out.push(line);
    });
  });
  return out.join('\n');
}

/** Attach a file to the KB: copies it into the store, extracts readable text,
 * and creates an entry. Returns the entry. Throws on unsupported/oversize files. */
export async function attachKbFile(srcPath: string, title?: string): Promise<KbEntry> {
  if (!existsSync(srcPath) || !statSync(srcPath).isFile()) throw new Error('File not found.');
  if (statSync(srcPath).size > MAX_FILE_BYTES) throw new Error('File is larger than 25MB.');
  const ext = extname(srcPath).toLowerCase();
  const supported = ['.pdf', '.xlsx', '.xls', '.csv', '.txt', '.md', '.markdown'];
  if (!supported.includes(ext)) throw new Error(`Unsupported file type ${ext || '(none)'} — PDF, Excel, CSV, or text.`);
  mkdirSync(filesDir(), { recursive: true });
  const stored = `${Date.now()}-${basename(srcPath)}`;
  copyFileSync(srcPath, join(filesDir(), stored));

  let content: string;
  if (ext === '.pdf') content = await extractPdf(join(filesDir(), stored));
  else if (ext === '.xlsx' || ext === '.xls') content = await extractSheet(join(filesDir(), stored));
  else content = readFileSync(join(filesDir(), stored), 'utf8');
  content = content.replace(/\r/g, '').trim();
  if (!content) throw new Error('No readable text found in that file.');

  const entries = readAll();
  const now = Date.now();
  const entry: KbEntry = {
    id: randomUUID(),
    title: (title ?? basename(srcPath, ext)).trim() || basename(srcPath),
    content: content.slice(0, MAX_ENTRY_CHARS),
    tags: ['file', ext.replace('.', '')],
    fileName: basename(srcPath),
    createdAt: now,
    updatedAt: now,
  };
  entries.unshift(entry);
  writeAll(entries);
  return entry;
}

/** Ranked substring search: title hits count most, then tags, then content. */
export function searchKb(query: string, limit = 10): KbEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return listKb().slice(0, limit);
  const terms = q.split(/\s+/).filter(Boolean);
  const scored: Array<{ entry: KbEntry; score: number }> = [];
  for (const entry of readAll()) {
    const title = entry.title.toLowerCase();
    const tags = entry.tags.join(' ').toLowerCase();
    const content = entry.content.toLowerCase();
    let score = 0;
    for (const t of terms) {
      if (title.includes(t)) score += 3;
      if (tags.includes(t)) score += 2;
      const hits = content.split(t).length - 1;
      score += Math.min(hits, 5) * 0.2;
    }
    if (score > 0) scored.push({ entry, score });
  }
  scored.sort((a, b) => b.score - a.score || b.entry.updatedAt - a.entry.updatedAt);
  return scored.slice(0, limit).map((s) => s.entry);
}
