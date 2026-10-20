/**
 * StudioStore — durable documents, sheets, and decks.
 *
 * One JSON file per profile, written with tmp+rename so a crash mid-save
 * leaves the previous good version intact. All mutations are synchronous and
 * cheap (the data is text), which makes the IPC handlers simple and keeps the
 * editor's debounced saves from racing each other.
 */

import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { infiniteHome } from '../profiles/home.js';
import {
  STUDIO_LIMITS,
  columnName,
  defaultDeck,
  defaultSheet,
  parseCellAddress,
  type StudioCreateInput,
  type StudioData,
  type StudioDeck,
  type StudioItem,
  type StudioKind,
  type StudioSheet,
  type StudioUpdateInput,
} from '../../shared/studio.js';
import { sanitizeDocumentHtml } from './sanitize.js';

export interface StudioStoreOptions {
  dataDir?: string;
  now?: () => number;
  id?: () => string;
}

function clampText(value: unknown, max: number): string {
  return typeof value === 'string' ? value.slice(0, max) : '';
}

function isKind(value: unknown): value is StudioKind {
  return value === 'document' || value === 'sheet' || value === 'slides';
}

function normalizeSheet(input: unknown): StudioSheet {
  if (!input || typeof input !== 'object') return defaultSheet();
  const raw = input as Partial<StudioSheet>;
  const columns = Math.min(STUDIO_LIMITS.columns, Math.max(1, Math.floor(Number(raw.columns) || 12)));
  const rows = Math.min(STUDIO_LIMITS.rows, Math.max(1, Math.floor(Number(raw.rows) || 30)));
  const cells: Record<string, string> = {};
  let count = 0;
  if (raw.cells && typeof raw.cells === 'object') {
    for (const [address, value] of Object.entries(raw.cells)) {
      if (count >= STUDIO_LIMITS.cells) break;
      if (!parseCellAddress(address)) continue; // also excludes __proto__
      if (typeof value !== 'string') continue;
      cells[address.toUpperCase()] = value.slice(0, STUDIO_LIMITS.cellLength);
      count++;
    }
  }
  return { columns, rows, cells };
}

function normalizeDeck(input: unknown, idFactory: () => string): StudioDeck {
  const raw = input && typeof input === 'object' ? (input as Partial<StudioDeck>) : {};
  const slides = Array.isArray(raw.slides) ? raw.slides.slice(0, STUDIO_LIMITS.slides) : [];
  const normalized = slides.map((slide) => ({
    id: clampText(slide?.id, 60) || idFactory(),
    title: clampText(slide?.title, STUDIO_LIMITS.slideTitle),
    body: clampText(slide?.body, STUDIO_LIMITS.slideBody),
    notes: clampText(slide?.notes, STUDIO_LIMITS.slideNotes) || undefined,
  }));
  return { slides: normalized.length ? normalized : defaultDeck().slides };
}

function normalizeTitle(value: unknown, fallback: string): string {
  const title = clampText(value, STUDIO_LIMITS.title).trim();
  return title || fallback;
}

export class StudioStore {
  readonly file: string;
  private readonly now: () => number;
  private readonly idFactory: () => string;
  private data: StudioData = { version: 1, items: [] };

  constructor(options: StudioStoreOptions = {}) {
    const dir = options.dataDir ?? join(infiniteHome(), 'studio');
    this.file = join(dir, 'studio.json');
    this.now = options.now ?? Date.now;
    this.idFactory = options.id ?? randomUUID;
    this.load();
  }

  private load(): void {
    if (!existsSync(this.file)) return;
    try {
      const parsed = JSON.parse(readFileSync(this.file, 'utf8')) as Partial<StudioData>;
      const items = Array.isArray(parsed.items) ? parsed.items : [];
      this.data = {
        version: 1,
        items: items.slice(0, STUDIO_LIMITS.items).map((item) => this.normalizeItem(item)),
      };
    } catch (error) {
      // A corrupt file must not take the section down or be silently
      // overwritten: keep the bytes for recovery and continue empty.
      try {
        renameSync(this.file, `${this.file}.corrupt-${Date.now()}`);
      } catch {
        /* best effort */
      }
      console.error('[studio] Could not read studio.json; preserved a corrupt copy:', error);
      this.data = { version: 1, items: [] };
    }
  }

  private normalizeItem(input: Partial<StudioItem>): StudioItem {
    const kind: StudioKind = isKind(input.kind) ? input.kind : 'document';
    const createdAt = Number.isFinite(input.createdAt) ? Number(input.createdAt) : this.now();
    const updatedAt = Number.isFinite(input.updatedAt) ? Number(input.updatedAt) : createdAt;
    const item: StudioItem = {
      id: clampText(input.id, 80) || this.idFactory(),
      kind,
      title: normalizeTitle(input.title, kind === 'sheet' ? 'Untitled sheet' : kind === 'slides' ? 'Untitled deck' : 'Untitled document'),
      createdAt,
      updatedAt,
      starred: input.starred === true,
    };
    if (kind === 'document') item.html = sanitizeDocumentHtml(clampText(input.html, STUDIO_LIMITS.html));
    if (kind === 'sheet') item.sheet = normalizeSheet(input.sheet);
    if (kind === 'slides') item.deck = normalizeDeck(input.deck, this.idFactory);
    return item;
  }

  private save(): void {
    mkdirSync(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.data), 'utf8');
    renameSync(tmp, this.file);
  }

  private find(id: string): StudioItem | undefined {
    return this.data.items.find((item) => item.id === id);
  }

  list(): StudioItem[] {
    return [...this.data.items]
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map((item) => this.clone(item));
  }

  get(id: string): StudioItem | null {
    const item = this.find(id);
    return item ? this.clone(item) : null;
  }

  create(input: StudioCreateInput): StudioItem {
    if (!isKind(input?.kind)) throw new Error('Unknown Studio item kind');
    if (this.data.items.length >= STUDIO_LIMITS.items) throw new Error('Studio is full. Delete an item first.');
    const now = this.now();
    const blank: Partial<StudioItem> = {
      id: this.idFactory(),
      kind: input.kind,
      title: normalizeTitle(input.title, input.kind === 'document' ? 'Untitled document' : input.kind === 'sheet' ? 'Untitled sheet' : 'Untitled deck'),
      createdAt: now,
      updatedAt: now,
      starred: false,
    };
    if (input.kind === 'document') blank.html = '<p></p>';
    if (input.kind === 'sheet') blank.sheet = defaultSheet();
    if (input.kind === 'slides') blank.deck = defaultDeck();
    const item = this.normalizeItem(blank);
    this.data.items.push(item);
    this.save();
    return this.clone(item);
  }

  update(id: string, patch: StudioUpdateInput): StudioItem | null {
    const item = this.find(id);
    if (!item) return null;
    if (patch.title !== undefined) item.title = normalizeTitle(patch.title, item.title);
    if (patch.starred !== undefined) item.starred = patch.starred === true;

    if (item.kind === 'document' && patch.html !== undefined) {
      item.html = sanitizeDocumentHtml(clampText(patch.html, STUDIO_LIMITS.html));
    }
    if (item.kind === 'sheet' && patch.sheet !== undefined) {
      item.sheet = normalizeSheet(patch.sheet);
    }
    if (item.kind === 'slides' && patch.deck !== undefined) {
      item.deck = normalizeDeck(patch.deck, this.idFactory);
    }
    item.updatedAt = this.now();
    this.save();
    return this.clone(item);
  }

  delete(id: string): boolean {
    const index = this.data.items.findIndex((item) => item.id === id);
    if (index < 0) return false;
    this.data.items.splice(index, 1);
    this.save();
    return true;
  }

  duplicate(id: string): StudioItem | null {
    const source = this.find(id);
    if (!source) return null;
    if (this.data.items.length >= STUDIO_LIMITS.items) throw new Error('Studio is full. Delete an item first.');
    const now = this.now();
    const copy = this.normalizeItem({
      ...this.clone(source),
      id: this.idFactory(),
      title: `${source.title} copy`.slice(0, STUDIO_LIMITS.title),
      createdAt: now,
      updatedAt: now,
      starred: false,
    });
    this.data.items.push(copy);
    this.save();
    return this.clone(copy);
  }

  /**
   * Read-modify-write helper for the agent tool. Returns the updated item so
   * a tool call can report the resulting state instead of guessing.
   */
  updateWith(id: string, mutate: (draft: StudioItem) => void): StudioItem | null {
    const item = this.find(id);
    if (!item) return null;
    const draft = this.clone(item);
    mutate(draft);
    return this.update(id, {
      title: draft.title,
      starred: draft.starred,
      html: draft.html,
      sheet: draft.sheet,
      deck: draft.deck,
    });
  }

  /** Empty sheet helper used by "new sheet" flows and tests. */
  static blankCells(columns: number, rows: number): string[][] {
    return Array.from({ length: rows }, () => Array.from({ length: columns }, () => ''));
  }

  static address(column: number, row: number): string {
    return `${columnName(column)}${row + 1}`;
  }

  private clone<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
  }
}

let singleton: StudioStore | null = null;

export function getStudioStore(): StudioStore {
  if (!singleton) singleton = new StudioStore();
  return singleton;
}

/** Test hook — drop the process-wide instance after changing the profile home. */
export function resetStudioStore(): void {
  singleton = null;
}
