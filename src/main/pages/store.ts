/**
 * PagesStore — the durable, profile-scoped Pages workspace.
 *
 * Layout under ~/.infinite-ai/pages:
 *   index.json          metadata only (title, parent, links, search text)
 *   data/<pageId>.json  one body per page (blocks, database, comments, versions)
 *
 * The split is intentional. Listing a large workspace never reads page bodies,
 * while opening a page never scans the index. Writes are synchronous and
 * atomic (tmp + rename), so the existing debounced editor saves cannot race
 * each other. A corrupt file is moved aside instead of being overwritten.
 */

import { randomUUID } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { infiniteHome } from '../profiles/home.js';
import { sanitizeDocumentHtml } from '../studio/sanitize.js';
import {
  DATABASE_COLORS,
  DEFAULT_PAGE_DATABASE,
  PAGES_LIMITS,
  type DatabaseFilter,
  type DatabaseFilterGroup,
  type DatabaseProperty,
  type DatabasePropertyType,
  type DatabaseRow,
  type DatabaseSelectOption,
  type DatabaseSort,
  type DatabaseValue,
  type DatabaseView,
  type DatabaseViewType,
  type PageBlock,
  type PageBlockTable,
  type PageBlockType,
  type PageComment,
  type PageCover,
  type PageDatabase,
  type PageDatabaseRowInput,
  type PageKind,
  type PageRecord,
  type PageSearchHit,
  type PageSummary,
  type PageTemplateId,
  type PageUpdateInput,
  type PageVersion,
} from '../../shared/pages.js';
import { buildTemplate } from './templates.js';

interface PageIndexEntry extends PageSummary {
  searchText: string;
}

interface PagesIndexFile {
  version: 1;
  pages: PageIndexEntry[];
}

interface PageBody {
  version: 1;
  id: string;
  blocks: PageBlock[];
  database?: PageDatabase;
  comments: PageComment[];
  versions: PageVersion[];
}

export interface PagesStoreOptions {
  dataDir?: string;
  now?: () => number;
  id?: () => string;
  /** Minimum gap between automatic snapshots. */
  autoVersionMs?: number;
}

const BLOCK_TYPES = new Set<PageBlockType>([
  'paragraph', 'heading1', 'heading2', 'heading3', 'bulleted', 'numbered',
  'todo', 'toggle', 'quote', 'callout', 'divider', 'code', 'image',
  'bookmark', 'table', 'child_page', 'child_database',
]);

const PROPERTY_TYPES = new Set<DatabasePropertyType>([
  'title', 'text', 'number', 'select', 'multi_select', 'status', 'date',
  'checkbox', 'url', 'email', 'phone', 'formula', 'relation',
]);

const VIEW_TYPES = new Set<DatabaseViewType>(['table', 'board', 'list', 'calendar', 'gallery']);
const FILTER_OPERATORS = new Set<DatabaseFilter['operator']>([
  'contains', 'not_contains', 'is', 'is_not', 'is_empty', 'is_not_empty',
  'gt', 'lt', 'before', 'after', 'is_checked', 'is_unchecked',
]);
const CALL_OUT_TONES = new Set(['violet', 'sky', 'green', 'amber', 'rose', 'zinc']);
const SAFE_ID = /^[a-zA-Z0-9_-]{1,80}$/;
const SAFE_DATE = /^\d{4}-\d{2}-\d{2}$/;
const SAFE_COLOR_IDS = new Set<string>(DATABASE_COLORS.map((color) => color.id));

function clampText(value: unknown, max: number): string {
  return typeof value === 'string' ? value.slice(0, max) : '';
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const number = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function safeId(value: unknown): string | null {
  const text = typeof value === 'string' ? value : '';
  return SAFE_ID.test(text) ? text : null;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function decodeEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_all, code: string) => String.fromCodePoint(Number(code)));
}

function htmlToText(html: string): string {
  if (!html) return '';
  return decodeEntities(
    html
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<\/(p|div|h[1-6]|li|blockquote|tr|pre|figcaption)>/gi, ' ')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/\s+/g, ' ')
    .trim();
}

function extractLinks(text: string): string[] {
  const links = new Set<string>();
  const matcher = /\[\[([^\]]{1,160})\]\]/g;
  let match: RegExpExecArray | null;
  while ((match = matcher.exec(text))) {
    const title = match[1]!.trim().toLowerCase();
    if (title) links.add(title);
  }
  return [...links].slice(0, 100);
}

function normalizeCover(input: unknown): PageCover | null {
  if (!input || typeof input !== 'object') return null;
  const raw = input as Partial<PageCover>;
  if (raw.type !== 'gradient' && raw.type !== 'color' && raw.type !== 'image') return null;
  const value = clampText(raw.value, PAGES_LIMITS.coverImageBytes);
  if (!value) return null;
  if (raw.type === 'image') {
    if (/^data:image\/(png|jpe?g|webp);base64,[a-z0-9+/=\s]+$/i.test(value)) return { type: 'image', value };
    if (/^https:\/\//i.test(value)) return { type: 'image', value };
    return null;
  }
  if (raw.type === 'gradient') {
    return /^linear-gradient\([^;]{1,400}\)$/i.test(value) ? { type: 'gradient', value } : null;
  }
  return /^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\))$/i.test(value) ? { type: 'color', value } : null;
}

function safeUrl(value: string, image = false): string | null {
  const url = value.trim();
  if (!url) return null;
  if (image && /^data:image\/(png|jpe?g|webp);base64,[a-z0-9+/=\s]+$/i.test(url)) return url;
  if (/^https?:\/\//i.test(url)) return url;
  return null;
}

function normalizeTable(input: unknown): PageBlockTable {
  const raw = input && typeof input === 'object' ? (input as Partial<PageBlockTable>) : {};
  const headers = Array.isArray(raw.headers)
    ? raw.headers.slice(0, PAGES_LIMITS.tableColumns).map((cell) => sanitizeDocumentHtml(clampText(cell, PAGES_LIMITS.tableCell), PAGES_LIMITS.tableCell))
    : [];
  const rows = Array.isArray(raw.rows)
    ? raw.rows.slice(0, PAGES_LIMITS.tableRows).map((cells) =>
      Array.isArray(cells)
        ? cells.slice(0, PAGES_LIMITS.tableColumns).map((cell) => sanitizeDocumentHtml(clampText(cell, PAGES_LIMITS.tableCell), PAGES_LIMITS.tableCell))
        : [],
    )
    : [];
  const columns = Math.max(1, headers.length, ...rows.map((cells) => cells.length));
  const empty = () => Array.from({ length: columns }, () => '');
  return {
    headers: Array.from({ length: columns }, (_, index) => headers[index] ?? ''),
    rows: (rows.length ? rows : [empty()]).map((cells) => (
      Array.from({ length: columns }, (_, index) => cells[index] ?? '')
    )),
  };
}

function normalizeBlock(input: unknown, idFactory: () => string): PageBlock | null {
  if (!input || typeof input !== 'object') return null;
  const raw = input as Partial<PageBlock>;
  const type = BLOCK_TYPES.has(raw.type as PageBlockType) ? raw.type as PageBlockType : 'paragraph';
  const id = safeId(raw.id) ?? idFactory();
  const depth = clampNumber(raw.depth, 0, PAGES_LIMITS.blockDepth, 0);
  const block: PageBlock = { id, type, html: '', depth };
  if (type === 'code') {
    block.html = escapeHtml(clampText(raw.html, PAGES_LIMITS.code));
    block.language = clampText(raw.language, 40) || 'plain text';
  } else {
    block.html = sanitizeDocumentHtml(clampText(raw.html, PAGES_LIMITS.blockHtml), PAGES_LIMITS.blockHtml);
  }
  if (type === 'todo') block.checked = raw.checked === true;
  if (type === 'toggle') block.collapsed = raw.collapsed === true;
  if (type === 'callout') {
    block.icon = clampText(raw.icon, 16) || '💡';
    block.tone = CALL_OUT_TONES.has(String(raw.tone)) ? String(raw.tone) : 'violet';
  }
  if (type === 'image' || type === 'bookmark') {
    const url = safeUrl(clampText(raw.url, PAGES_LIMITS.url), type === 'image');
    if (url) block.url = url;
    block.caption = clampText(raw.caption, PAGES_LIMITS.caption) || undefined;
  }
  if (type === 'table') block.table = normalizeTable(raw.table);
  if (type === 'child_page' || type === 'child_database') {
    const pageId = safeId(raw.pageId);
    if (pageId) block.pageId = pageId;
  }
  return block;
}

export function normalizeBlocks(input: unknown, idFactory: () => string): PageBlock[] {
  if (!Array.isArray(input)) return [];
  const blocks: PageBlock[] = [];
  const seen = new Set<string>();
  for (const item of input.slice(0, PAGES_LIMITS.blocks)) {
    const block = normalizeBlock(item, idFactory);
    if (!block) continue;
    if (seen.has(block.id)) block.id = idFactory();
    seen.add(block.id);
    blocks.push(block);
  }
  return blocks;
}

function normalizeOption(input: unknown, idFactory: () => string): DatabaseSelectOption | null {
  if (!input || typeof input !== 'object') return null;
  const raw = input as Partial<DatabaseSelectOption>;
  const name = clampText(raw.name, PAGES_LIMITS.optionName).trim();
  if (!name) return null;
  const color = SAFE_COLOR_IDS.has(String(raw.color)) ? String(raw.color) : 'zinc';
  return { id: safeId(raw.id) ?? idFactory(), name, color };
}

function normalizeValue(value: unknown, property: DatabaseProperty): DatabaseValue {
  switch (property.type) {
    case 'title':
    case 'text':
    case 'url':
    case 'email':
    case 'phone':
      return clampText(value, 10_000);
    case 'number': {
      if (value === '' || value === null || value === undefined) return null;
      const number = typeof value === 'number' ? value : Number(value);
      return Number.isFinite(number) ? number : null;
    }
    case 'checkbox':
      return value === true;
    case 'date': {
      const text = clampText(value, 40);
      if (!text) return null;
      const day = text.slice(0, 10);
      return SAFE_DATE.test(day) ? day : null;
    }
    case 'select':
    case 'status': {
      const id = clampText(value, 80);
      if (!id) return null;
      return property.options?.some((option) => option.id === id) ? id : null;
    }
    case 'multi_select': {
      if (!Array.isArray(value)) return [];
      const allowed = new Set(property.options?.map((option) => option.id) ?? []);
      return [...new Set(value.map((item) => clampText(item, 80)).filter((id) => allowed.has(id)))].slice(0, PAGES_LIMITS.options);
    }
    case 'relation': {
      if (!Array.isArray(value)) return [];
      return [...new Set(value.map((item) => safeId(item)).filter((id): id is string => Boolean(id)))].slice(0, PAGES_LIMITS.relations);
    }
    case 'formula':
      return null;
    default:
      return null;
  }
}

function defaultTitleValue(property: DatabaseProperty): DatabaseValue {
  if (property.type === 'title') return 'Untitled';
  if (property.type === 'multi_select') return [];
  if (property.type === 'checkbox') return false;
  if (property.type === 'relation') return [];
  return null;
}

function normalizeProperty(input: unknown, idFactory: () => string): DatabaseProperty | null {
  if (!input || typeof input !== 'object') return null;
  const raw = input as Partial<DatabaseProperty>;
  const type = PROPERTY_TYPES.has(raw.type as DatabasePropertyType) ? raw.type as DatabasePropertyType : 'text';
  const name = clampText(raw.name, PAGES_LIMITS.propertyName).trim() || 'Untitled';
  const property: DatabaseProperty = {
    id: safeId(raw.id) ?? idFactory(),
    name,
    type,
  };
  if (type === 'select' || type === 'multi_select' || type === 'status') {
    const options: DatabaseSelectOption[] = [];
    const seen = new Set<string>();
    if (Array.isArray(raw.options)) {
      for (const optionInput of raw.options.slice(0, PAGES_LIMITS.options)) {
        const option = normalizeOption(optionInput, idFactory);
        if (!option || seen.has(option.id)) continue;
        seen.add(option.id);
        options.push(option);
      }
    }
    property.options = options;
  }
  if (type === 'formula') property.formula = clampText(raw.formula, 1_000);
  if (type === 'relation') {
    const relationId = safeId(raw.relationDatabaseId);
    if (relationId) property.relationDatabaseId = relationId;
  }
  return property;
}

function normalizeFilterGroup(input: unknown): DatabaseFilterGroup | undefined {
  if (!input || typeof input !== 'object') return undefined;
  const raw = input as Partial<DatabaseFilterGroup>;
  const filters: DatabaseFilter[] = [];
  if (Array.isArray(raw.filters)) {
    for (const item of raw.filters.slice(0, PAGES_LIMITS.filters)) {
      if (!item || typeof item !== 'object') continue;
      const filter = item as Partial<DatabaseFilter>;
      const propertyId = safeId(filter.propertyId);
      if (!propertyId || !FILTER_OPERATORS.has(filter.operator as DatabaseFilter['operator'])) continue;
      filters.push({
        id: safeId(filter.id) ?? randomUUID(),
        propertyId,
        operator: filter.operator as DatabaseFilter['operator'],
        value: typeof filter.value === 'string' || typeof filter.value === 'number' || typeof filter.value === 'boolean' || Array.isArray(filter.value)
          ? filter.value as string | number | boolean | string[]
          : undefined,
      });
    }
  }
  return { conjunction: raw.conjunction === 'or' ? 'or' : 'and', filters };
}

function normalizeView(input: unknown, idFactory: () => string): DatabaseView | null {
  if (!input || typeof input !== 'object') return null;
  const raw = input as Partial<DatabaseView>;
  const view: DatabaseView = {
    id: safeId(raw.id) ?? idFactory(),
    name: clampText(raw.name, PAGES_LIMITS.viewName).trim() || 'View',
    type: VIEW_TYPES.has(raw.type as DatabaseViewType) ? raw.type as DatabaseViewType : 'table',
  };
  const filters = normalizeFilterGroup(raw.filters);
  if (filters) view.filters = filters;
  if (Array.isArray(raw.sorts)) {
    view.sorts = raw.sorts.slice(0, PAGES_LIMITS.sorts).flatMap((sortInput): DatabaseSort[] => {
      if (!sortInput || typeof sortInput !== 'object') return [];
      const sort = sortInput as Partial<DatabaseSort>;
      const propertyId = safeId(sort.propertyId);
      if (!propertyId) return [];
      return [{ propertyId, direction: sort.direction === 'desc' ? 'desc' : 'asc' }];
    });
  }
  const groupBy = safeId(raw.groupBy);
  if (groupBy) view.groupBy = groupBy;
  const datePropertyId = safeId(raw.datePropertyId);
  if (datePropertyId) view.datePropertyId = datePropertyId;
  const boardGroupBy = safeId(raw.boardGroupBy);
  if (boardGroupBy) view.boardGroupBy = boardGroupBy;
  if (Array.isArray(raw.hiddenPropertyIds)) {
    view.hiddenPropertyIds = raw.hiddenPropertyIds.map((id) => safeId(id)).filter((id): id is string => Boolean(id));
  }
  return view;
}

export function normalizeDatabase(input: unknown, idFactory: () => string): PageDatabase {
  const raw = input && typeof input === 'object' ? (input as Partial<PageDatabase>) : {};
  const properties: DatabaseProperty[] = [];
  const seenProperties = new Set<string>();
  if (Array.isArray(raw.properties)) {
    for (const propertyInput of raw.properties.slice(0, PAGES_LIMITS.properties)) {
      const property = normalizeProperty(propertyInput, idFactory);
      if (!property || seenProperties.has(property.id)) continue;
      seenProperties.add(property.id);
      properties.push(property);
    }
  }
  if (!properties.length) {
    properties.push({ id: idFactory(), name: 'Name', type: 'title' });
  }
  let titleProperty = properties.find((property) => property.type === 'title');
  if (!titleProperty) {
    titleProperty = properties[0]!;
    titleProperty.type = 'title';
    titleProperty.options = undefined;
    titleProperty.formula = undefined;
    titleProperty.relationDatabaseId = undefined;
  }
  for (const property of properties) {
    if (property !== titleProperty && property.type === 'title') property.type = 'text';
  }
  const propertyById = new Map(properties.map((property) => [property.id, property]));

  const rows: DatabaseRow[] = [];
  const seenRows = new Set<string>();
  if (Array.isArray(raw.rows)) {
    for (const rowInput of raw.rows.slice(0, PAGES_LIMITS.rows)) {
      if (!rowInput || typeof rowInput !== 'object') continue;
      const inputRow = rowInput as Partial<DatabaseRow>;
      const rowId = safeId(inputRow.id) ?? idFactory();
      if (seenRows.has(rowId)) continue;
      seenRows.add(rowId);
      const inputValues = inputRow.values && typeof inputRow.values === 'object' ? inputRow.values : {};
      const values: Record<string, DatabaseValue> = Object.create(null) as Record<string, DatabaseValue>;
      for (const property of properties) {
        values[property.id] = normalizeValue(inputValues[property.id], property);
      }
      const title = values[titleProperty.id];
      if (typeof title !== 'string' || !title.trim()) values[titleProperty.id] = 'Untitled';
      const createdAt = Number.isFinite(inputRow.createdAt) ? Number(inputRow.createdAt) : Date.now();
      rows.push({
        id: rowId,
        values,
        order: Number.isFinite(inputRow.order) ? Number(inputRow.order) : rows.length,
        pageId: safeId(inputRow.pageId) ?? undefined,
        createdAt,
        updatedAt: Number.isFinite(inputRow.updatedAt) ? Number(inputRow.updatedAt) : createdAt,
      });
    }
  }
  for (const property of properties) {
    if (property.type !== 'relation') continue;
    for (const row of rows) {
      const value = row.values[property.id];
      if (Array.isArray(value)) row.values[property.id] = value.filter((id) => id !== row.id);
    }
  }

  const views: DatabaseView[] = [];
  const seenViews = new Set<string>();
  if (Array.isArray(raw.views)) {
    for (const viewInput of raw.views.slice(0, PAGES_LIMITS.views)) {
      const view = normalizeView(viewInput, idFactory);
      if (!view || seenViews.has(view.id)) continue;
      seenViews.add(view.id);
      if (view.filters) {
        view.filters.filters = view.filters.filters.filter((filter) => propertyById.has(filter.propertyId));
      }
      if (view.sorts) view.sorts = view.sorts.filter((sort) => propertyById.has(sort.propertyId));
      if (view.groupBy && !propertyById.has(view.groupBy)) delete view.groupBy;
      if (view.datePropertyId && !propertyById.has(view.datePropertyId)) delete view.datePropertyId;
      if (view.boardGroupBy && !propertyById.has(view.boardGroupBy)) delete view.boardGroupBy;
      if (view.hiddenPropertyIds) view.hiddenPropertyIds = view.hiddenPropertyIds.filter((id) => propertyById.has(id));
      views.push(view);
    }
  }
  if (!views.length) views.push({ id: idFactory(), name: 'Table', type: 'table' });
  const defaultViewId = views.some((view) => view.id === raw.defaultViewId) ? String(raw.defaultViewId) : views[0]!.id;

  return { properties, rows, views, defaultViewId };
}

function databaseSearchText(database: PageDatabase): string {
  const parts: string[] = [];
  for (const property of database.properties) {
    parts.push(property.name);
    if (property.formula) parts.push(property.formula);
    for (const option of property.options ?? []) parts.push(option.name);
  }
  for (const view of database.views) parts.push(view.name);
  for (const row of database.rows) {
    for (const property of database.properties) {
      const value = row.values[property.id];
      if (Array.isArray(value)) {
        for (const id of value) {
          const option = property.options?.find((candidate) => candidate.id === id);
          parts.push(option?.name ?? id);
        }
      } else if (typeof value === 'string') {
        const option = property.options?.find((candidate) => candidate.id === value);
        parts.push(option?.name ?? value);
      } else if (typeof value === 'number' || typeof value === 'boolean') {
        parts.push(String(value));
      }
    }
  }
  return parts.join(' ');
}

export function pageSearchText(record: Pick<PageRecord, 'title' | 'kind' | 'blocks' | 'database'>): string {
  const parts: string[] = [record.title];
  for (const block of record.blocks) {
    if (block.html) parts.push(htmlToText(block.html));
    if (block.caption) parts.push(block.caption);
    if (block.table) {
      parts.push(...block.table.headers.map(htmlToText));
      for (const row of block.table.rows) parts.push(...row.map(htmlToText));
    }
  }
  if (record.database) parts.push(databaseSearchText(record.database));
  return parts.join(' ').replace(/\s+/g, ' ').trim().slice(0, PAGES_LIMITS.searchText);
}

function hasVisibleContent(record: Pick<PageRecord, 'blocks' | 'database'>): boolean {
  if (record.database?.rows.length) return true;
  return record.blocks.some((block) => {
    if (block.html && htmlToText(block.html)) return true;
    if (block.url) return true;
    if (block.table?.rows.some((row) => row.some((cell) => htmlToText(cell)))) return true;
    return false;
  });
}

function normalizePageTitle(value: unknown, fallback = 'Untitled'): string {
  // eslint-disable-next-line no-control-regex
  const title = clampText(value, PAGES_LIMITS.title).replace(/[\u0000-\u001f]/g, ' ').trim();
  return title || fallback;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function toSummary(entry: PageIndexEntry): PageSummary {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { searchText: _searchText, ...summary } = entry;
  return {
    ...summary,
    links: [...summary.links],
  };
}

function compareOrder(a: PageIndexEntry, b: PageIndexEntry): number {
  return a.order - b.order || a.createdAt - b.createdAt;
}

export class PagesStore {
  readonly dir: string;
  readonly indexFile: string;
  readonly dataDir: string;
  private readonly now: () => number;
  private readonly idFactory: () => string;
  private readonly autoVersionMs: number;
  private index: PageIndexEntry[] = [];
  private cache = new Map<string, PageBody>();

  constructor(options: PagesStoreOptions = {}) {
    this.dir = options.dataDir ?? join(infiniteHome(), 'pages');
    this.indexFile = join(this.dir, 'index.json');
    this.dataDir = join(this.dir, 'data');
    this.now = options.now ?? Date.now;
    this.idFactory = options.id ?? randomUUID;
    this.autoVersionMs = options.autoVersionMs ?? 10 * 60_000;
    this.loadIndex();
  }

  // ── Disk ────────────────────────────────────────────────────────────────

  private loadIndex(): void {
    if (!existsSync(this.indexFile)) return;
    try {
      const parsed = JSON.parse(readFileSync(this.indexFile, 'utf8')) as Partial<PagesIndexFile>;
      const seen = new Set<string>();
      const pages: PageIndexEntry[] = [];
      if (Array.isArray(parsed.pages)) {
        for (const raw of parsed.pages.slice(0, PAGES_LIMITS.pages)) {
          const id = safeId(raw?.id);
          if (!id || seen.has(id)) continue;
          const createdAt = Number.isFinite(raw.createdAt) ? Number(raw.createdAt) : this.now();
          const entry: PageIndexEntry = {
            id,
            parentId: safeId(raw.parentId),
            kind: raw.kind === 'database' ? 'database' : 'page',
            title: normalizePageTitle(raw.title),
            icon: clampText(raw.icon, PAGES_LIMITS.icon) || '📄',
            cover: normalizeCover(raw.cover),
            favorite: raw.favorite === true,
            archived: raw.archived === true,
            trashedAt: Number.isFinite(raw.trashedAt) ? Number(raw.trashedAt) : null,
            order: Number.isFinite(raw.order) ? Number(raw.order) : pages.length,
            rowDatabaseId: safeId(raw.rowDatabaseId) ?? undefined,
            rowId: safeId(raw.rowId) ?? undefined,
            links: Array.isArray(raw.links) ? raw.links.map((link) => clampText(link, 200).toLowerCase()).filter(Boolean).slice(0, 100) : [],
            createdAt,
            updatedAt: Number.isFinite(raw.updatedAt) ? Number(raw.updatedAt) : createdAt,
            searchText: clampText(raw.searchText, PAGES_LIMITS.searchText),
          };
          seen.add(id);
          pages.push(entry);
        }
      }
      this.index = pages;
    } catch (error) {
      try {
        renameSync(this.indexFile, `${this.indexFile}.corrupt-${Date.now()}`);
      } catch {
        /* best effort */
      }
      console.error('[pages] Could not read index.json; preserved a corrupt copy:', error);
      this.index = [];
    }
  }

  private writeIndex(): void {
    mkdirSync(this.dir, { recursive: true });
    const tmp = `${this.indexFile}.tmp`;
    writeFileSync(tmp, JSON.stringify({ version: 1, pages: this.index }), 'utf8');
    renameSync(tmp, this.indexFile);
  }

  private fileFor(id: string): string | null {
    return safeId(id) ? join(this.dataDir, `${id}.json`) : null;
  }

  private readBody(id: string): PageBody {
    const cached = this.cache.get(id);
    if (cached) {
      this.cache.delete(id);
      this.cache.set(id, cached);
      return clone(cached);
    }
    const file = this.fileFor(id);
    if (!file || !existsSync(file)) {
      return { version: 1, id, blocks: [], comments: [], versions: [] };
    }
    try {
      const parsed = JSON.parse(readFileSync(file, 'utf8')) as Partial<PageBody>;
      const body: PageBody = {
        version: 1,
        id,
        blocks: normalizeBlocks(parsed.blocks, this.idFactory),
        database: parsed.database ? normalizeDatabase(parsed.database, this.idFactory) : undefined,
        comments: this.normalizeComments(parsed.comments),
        versions: this.normalizeVersions(parsed.versions),
      };
      this.remember(id, body);
      return clone(body);
    } catch (error) {
      try {
        renameSync(file, `${file}.corrupt-${Date.now()}`);
      } catch {
        /* best effort */
      }
      console.error(`[pages] Could not read ${id}.json; preserved a corrupt copy:`, error);
      return { version: 1, id, blocks: [], comments: [], versions: [] };
    }
  }

  private remember(id: string, body: PageBody): void {
    this.cache.delete(id);
    this.cache.set(id, body);
    while (this.cache.size > 24) {
      const oldest = this.cache.keys().next().value as string | undefined;
      if (!oldest) break;
      this.cache.delete(oldest);
    }
  }

  private writeBody(body: PageBody): void {
    mkdirSync(this.dataDir, { recursive: true });
    const file = this.fileFor(body.id);
    if (!file) throw new Error('Invalid page id');
    const tmp = `${file}.tmp`;
    writeFileSync(tmp, JSON.stringify(body), 'utf8');
    renameSync(tmp, file);
    this.remember(body.id, body);
  }

  private deleteBody(id: string): void {
    const file = this.fileFor(id);
    this.cache.delete(id);
    if (!file) return;
    try {
      unlinkSync(file);
    } catch {
      /* already gone */
    }
  }

  // ── Normalisation ──────────────────────────────────────────────────────

  private normalizeComments(input: unknown): PageComment[] {
    if (!Array.isArray(input)) return [];
    const comments: PageComment[] = [];
    for (const item of input.slice(-PAGES_LIMITS.comments)) {
      if (!item || typeof item !== 'object') continue;
      const raw = item as Partial<PageComment>;
      const text = clampText(raw.text, PAGES_LIMITS.commentText).trim();
      if (!text) continue;
      const createdAt = Number.isFinite(raw.createdAt) ? Number(raw.createdAt) : this.now();
      comments.push({
        id: safeId(raw.id) ?? this.idFactory(),
        text,
        author: clampText(raw.author, 80) || 'You',
        createdAt,
        updatedAt: Number.isFinite(raw.updatedAt) ? Number(raw.updatedAt) : undefined,
        blockId: safeId(raw.blockId) ?? undefined,
        resolved: raw.resolved === true,
      });
    }
    return comments;
  }

  private normalizeVersions(input: unknown): PageVersion[] {
    if (!Array.isArray(input)) return [];
    const versions: PageVersion[] = [];
    for (const item of input.slice(-PAGES_LIMITS.versions)) {
      if (!item || typeof item !== 'object') continue;
      const raw = item as Partial<PageVersion>;
      if (!Number.isFinite(raw.at)) continue;
      versions.push({
        id: safeId(raw.id) ?? this.idFactory(),
        at: Number(raw.at),
        title: normalizePageTitle(raw.title),
        blocks: normalizeBlocks(raw.blocks, this.idFactory).slice(0, PAGES_LIMITS.versionBlocks),
        database: raw.database ? normalizeDatabase(raw.database, this.idFactory) : undefined,
        reason: raw.reason === 'auto' ? 'auto' : 'manual',
        author: clampText(raw.author, 80) || 'You',
      });
    }
    return versions;
  }

  private summaryFrom(record: PageRecord, searchText: string): PageIndexEntry {
    return {
      id: record.id,
      parentId: record.parentId,
      kind: record.kind,
      title: record.title,
      icon: record.icon,
      cover: record.cover,
      favorite: record.favorite,
      archived: record.archived,
      trashedAt: record.trashedAt,
      order: record.order,
      rowDatabaseId: record.rowDatabaseId,
      rowId: record.rowId,
      links: [...new Set(extractLinks(searchText))],
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      searchText,
    };
  }

  private entryById(id: string): PageIndexEntry | undefined {
    return this.index.find((entry) => entry.id === id);
  }

  private recordFrom(entry: PageIndexEntry, body: PageBody): PageRecord {
    return {
      id: entry.id,
      parentId: entry.parentId,
      kind: entry.kind,
      title: entry.title,
      icon: entry.icon,
      cover: entry.cover,
      blocks: clone(body.blocks),
      database: body.database ? clone(body.database) : undefined,
      favorite: entry.favorite,
      archived: entry.archived,
      trashedAt: entry.trashedAt,
      order: entry.order,
      rowDatabaseId: entry.rowDatabaseId,
      rowId: entry.rowId,
      comments: clone(body.comments),
      versions: clone(body.versions),
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
    };
  }

  private nextOrder(parentId: string | null): number {
    let max = -1;
    for (const entry of this.index) {
      if (entry.parentId === parentId) max = Math.max(max, entry.order);
    }
    return max + 1;
  }

  private requireEntry(id: string): PageIndexEntry {
    const entry = this.entryById(id);
    if (!entry) throw new Error('That page no longer exists.');
    return entry;
  }

  private assertParent(parentId: string | null, movingId?: string): void {
    if (!parentId) return;
    const parent = this.entryById(parentId);
    if (!parent) throw new Error('The destination page no longer exists.');
    if (movingId && parentId === movingId) throw new Error('A page cannot contain itself.');
    if (movingId) {
      let cursor: PageIndexEntry | undefined = parent;
      const seen = new Set<string>();
      while (cursor) {
        if (cursor.id === movingId) throw new Error('A page cannot be moved inside itself.');
        if (seen.has(cursor.id)) break;
        seen.add(cursor.id);
        cursor = cursor.parentId ? this.entryById(cursor.parentId) : undefined;
      }
    }
  }

  private descendants(id: string, includeSelf = false): PageIndexEntry[] {
    const out: PageIndexEntry[] = [];
    const stack = [id];
    const seen = new Set<string>();
    while (stack.length) {
      const current = stack.pop()!;
      if (seen.has(current)) continue;
      seen.add(current);
      const entry = this.entryById(current);
      if (entry && (includeSelf || current !== id)) out.push(entry);
      for (const child of this.index) {
        if (child.parentId === current) stack.push(child.id);
      }
    }
    return out;
  }

  // ── Public reads ───────────────────────────────────────────────────────

  list(): PageSummary[] {
    return [...this.index].sort(compareOrder).map(toSummary);
  }

  get(id: string): PageRecord | null {
    const entry = this.entryById(id);
    if (!entry) return null;
    const body = this.readBody(id);
    return this.recordFrom(entry, body);
  }

  getSummary(id: string): PageSummary | null {
    const entry = this.entryById(id);
    return entry ? toSummary(entry) : null;
  }

  search(query: string, limit = 30): PageSearchHit[] {
    const needle = clampText(query, 200).trim().toLowerCase();
    const capped = Math.min(100, Math.max(1, limit));
    const hits: Array<PageSearchHit & { score: number }> = [];
    for (const entry of this.index) {
      if (entry.rowDatabaseId && !needle) continue;
      const title = entry.title.toLowerCase();
      let score = 0;
      let index = -1;
      if (needle) {
        if (title === needle) score += 200;
        else if (title.startsWith(needle)) score += 120;
        else if (title.includes(needle)) score += 80;
        index = entry.searchText.toLowerCase().indexOf(needle);
        if (index >= 0) score += 30 + Math.min(50, entry.searchText.split(needle).length - 1);
        if (!score) continue;
      } else {
        score = entry.trashedAt ? 0 : 1;
        if (!score) continue;
      }
      const source = entry.searchText || entry.title;
      let excerpt = '';
      if (needle && index >= 0 && !title.includes(needle)) {
        const start = Math.max(0, index - 45);
        excerpt = source.slice(start, Math.min(source.length, index + needle.length + 85)).trim();
        if (start > 0) excerpt = `…${excerpt}`;
        if (index + needle.length + 85 < source.length) excerpt += '…';
      } else {
        excerpt = source.slice(0, 140);
      }
      hits.push({
        id: entry.id,
        title: entry.title,
        icon: entry.icon,
        parentId: entry.parentId,
        kind: entry.kind,
        trashed: entry.trashedAt !== null,
        excerpt,
        updatedAt: entry.updatedAt,
        score: score + (entry.favorite ? 8 : 0) + (entry.trashedAt ? -200 : 0),
      });
    }
    return hits
      .sort((a, b) => b.score - a.score || b.updatedAt - a.updatedAt)
      .slice(0, capped)
      .map(({ score: _score, ...hit }) => hit);
  }

  backlinksTo(id: string): PageSummary[] {
    const entry = this.entryById(id);
    if (!entry) return [];
    const title = entry.title.toLowerCase();
    return this.index
      .filter((candidate) => !candidate.trashedAt && candidate.id !== id && candidate.links.includes(title))
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 40)
      .map(toSummary);
  }

  // ── Page lifecycle ─────────────────────────────────────────────────────

  private createStoredPage(input: {
    id?: string;
    parentId: string | null;
    kind: PageKind;
    title: string;
    icon: string;
    cover: PageCover | null;
    blocks: PageBlock[];
    database?: PageDatabase;
    order: number;
    rowDatabaseId?: string;
    rowId?: string;
  }): PageRecord {
    const id = safeId(input.id) ?? this.idFactory();
    if (this.entryById(id)) throw new Error('That page id already exists.');
    const now = this.now();
    const record: PageRecord = {
      id,
      parentId: input.parentId,
      kind: input.kind,
      title: normalizePageTitle(input.title),
      icon: clampText(input.icon, PAGES_LIMITS.icon) || '📄',
      cover: input.cover,
      blocks: input.blocks,
      database: input.kind === 'database' ? input.database ?? normalizeDatabase(DEFAULT_PAGE_DATABASE, this.idFactory) : undefined,
      favorite: false,
      archived: false,
      trashedAt: null,
      order: input.order,
      rowDatabaseId: input.rowDatabaseId,
      rowId: input.rowId,
      comments: [],
      versions: [],
      createdAt: now,
      updatedAt: now,
    };
    const body: PageBody = {
      version: 1,
      id,
      blocks: record.blocks,
      database: record.database,
      comments: [],
      versions: [],
    };
    this.writeBody(body);
    this.index.push(this.summaryFrom(record, pageSearchText(record)));
    return record;
  }

  create(input: {
    kind?: PageKind;
    parentId?: string | null;
    title?: string;
    icon?: string;
    templateId?: PageTemplateId;
  } = {}): PageRecord {
    if (this.index.length >= PAGES_LIMITS.pages) throw new Error('This workspace has reached its page limit.');
    const parentId = input.parentId ?? null;
    this.assertParent(parentId);
    const kind: PageKind = input.kind === 'database' ? 'database' : 'page';
    const templateId = input.templateId ?? 'blank';
    if (templateId !== 'blank') {
      return this.createFromTemplate(templateId, parentId);
    }
    const record = this.createStoredPage({
      parentId,
      kind,
      title: input.title?.trim() || (kind === 'database' ? 'Untitled database' : 'Untitled'),
      icon: input.icon || (kind === 'database' ? '🗂️' : '📄'),
      cover: null,
      blocks: [{ id: this.idFactory(), type: 'paragraph', html: '', depth: 0 }],
      database: kind === 'database' ? normalizeDatabase(DEFAULT_PAGE_DATABASE, this.idFactory) : undefined,
      order: this.nextOrder(parentId),
    });
    this.writeIndex();
    return clone(record);
  }

  createFromTemplate(templateId: PageTemplateId, parentId: string | null = null): PageRecord {
    if (this.index.length >= PAGES_LIMITS.pages) throw new Error('This workspace has reached its page limit.');
    this.assertParent(parentId);
    const template = buildTemplate(templateId, parentId, this.idFactory, this.now());
    if (!template) throw new Error('That template is not available.');
    if (this.index.length + template.seeds.length > PAGES_LIMITS.pages) {
      throw new Error('This workspace has reached its page limit.');
    }
    const created: PageRecord[] = [];
    for (const seed of template.seeds) {
      const existingParent = seed.parentId;
      if (existingParent && !this.entryById(existingParent) && !created.some((page) => page.id === existingParent)) {
        throw new Error('The template parent no longer exists.');
      }
      const order = seed.parentId === parentId ? this.nextOrder(parentId) : seed.order;
      const record = this.createStoredPage({
        id: seed.id,
        parentId: seed.parentId,
        kind: seed.kind,
        title: seed.title,
        icon: seed.icon,
        cover: seed.cover,
        blocks: normalizeBlocks(seed.blocks, this.idFactory),
        database: seed.database ? normalizeDatabase(seed.database, this.idFactory) : undefined,
        order,
      });
      created.push(record);
    }
    this.writeIndex();
    const root = created.find((page) => page.id === template.rootId);
    if (!root) throw new Error('Template root was not created.');
    return clone(root);
  }

  update(id: string, patch: PageUpdateInput): PageRecord {
    const entry = this.requireEntry(id);
    const body = this.readBody(id);
    const now = this.now();
    const oldRecord = this.recordFrom(entry, body);
    const changesContent = patch.blocks !== undefined || patch.database !== undefined;

    if (changesContent && hasVisibleContent(oldRecord)) {
      const lastVersion = body.versions[body.versions.length - 1];
      if (!lastVersion || now - lastVersion.at >= this.autoVersionMs) {
        this.pushVersion(body, oldRecord, 'auto');
      }
    }

    if (patch.title !== undefined) entry.title = normalizePageTitle(patch.title);
    if (patch.icon !== undefined) entry.icon = clampText(patch.icon, PAGES_LIMITS.icon) || '📄';
    if (patch.cover !== undefined) entry.cover = normalizeCover(patch.cover);
    if (patch.favorite !== undefined) entry.favorite = patch.favorite === true;
    if (patch.archived !== undefined) entry.archived = patch.archived === true;
    if (patch.parentId !== undefined) {
      const nextParent = patch.parentId ?? null;
      this.assertParent(nextParent, id);
      if (nextParent !== entry.parentId) {
        entry.parentId = nextParent;
        entry.order = this.nextOrder(nextParent);
      }
    }
    if (patch.order !== undefined) entry.order = clampNumber(patch.order, -1_000_000, 1_000_000, entry.order);
    if (patch.blocks !== undefined) body.blocks = normalizeBlocks(patch.blocks, this.idFactory);

    // Database patches carry row edits. When a row title changes, keep its
    // body page and the sidebar index in sync with the table.
    const linkedRowSummaries = new Map<string, PageIndexEntry>();
    if (patch.database !== undefined && entry.kind === 'database') {
      const database = normalizeDatabase(patch.database, this.idFactory);
      body.database = database;
      const titleProperty = database.properties.find((property) => property.type === 'title');
      if (titleProperty) {
        for (const row of database.rows) {
          if (!row.pageId) continue;
          const rowEntry = this.entryById(row.pageId);
          if (!rowEntry) continue;
          const title = this.titleOfRow(database, row);
          if (rowEntry.title === title) continue;
          const rowBody = this.readBody(rowEntry.id);
          const nextRowEntry = { ...rowEntry, title, updatedAt: row.updatedAt };
          const rowRecord = this.recordFrom(nextRowEntry, rowBody);
          linkedRowSummaries.set(rowEntry.id, this.summaryFrom(rowRecord, pageSearchText(rowRecord)));
        }
      }
    }
    entry.updatedAt = now;
    body.blocks = body.blocks ?? [];
    body.comments = body.comments ?? [];
    body.versions = body.versions ?? [];
    this.writeBody(body);

    // A row's body page and its database row are two views of one title. If
    // the title is edited in the page, reflect it back into the row so the
    // table does not keep showing the old name until a reload.
    let linkedDatabaseSummary: PageIndexEntry | null = null;
    if (patch.title !== undefined && entry.rowDatabaseId && entry.rowId) {
      const databaseEntry = this.entryById(entry.rowDatabaseId);
      if (databaseEntry?.kind === 'database') {
        const databaseBody = this.readBody(databaseEntry.id);
        if (databaseBody.database) {
          const database = normalizeDatabase(databaseBody.database, this.idFactory);
          const row = database.rows.find((candidate) => candidate.id === entry.rowId);
          const titleProperty = database.properties.find((property) => property.type === 'title');
          if (row && titleProperty) {
            row.values[titleProperty.id] = entry.title;
            row.updatedAt = now;
            databaseEntry.updatedAt = now;
            databaseBody.database = database;
            this.writeBody(databaseBody);
            const databaseRecord = this.recordFrom(databaseEntry, databaseBody);
            linkedDatabaseSummary = this.summaryFrom(databaseRecord, pageSearchText(databaseRecord));
          }
        }
      }
    }

    const record = this.recordFrom(entry, body);
    const nextEntry = this.summaryFrom(record, pageSearchText(record));
    this.index = this.index.map((candidate) => {
      if (candidate.id === id) return nextEntry;
      if (linkedDatabaseSummary && candidate.id === linkedDatabaseSummary.id) return linkedDatabaseSummary;
      const linkedRow = linkedRowSummaries.get(candidate.id);
      if (linkedRow) return linkedRow;
      return candidate;
    });
    this.writeIndex();
    return clone(this.recordFrom(nextEntry, body));
  }

  setParent(id: string, parentId: string | null, order?: number): PageRecord {
    return this.update(id, { parentId, order });
  }

  duplicate(id: string): PageRecord | null {
    const rootEntry = this.entryById(id);
    if (!rootEntry) return null;
    if (rootEntry.rowDatabaseId) throw new Error('Open the row page from its database instead of duplicating it.');
    if (this.index.length >= PAGES_LIMITS.pages) throw new Error('This workspace has reached its page limit.');

    const subtree = [rootEntry, ...this.descendants(id)].filter((entry) => !entry.rowDatabaseId);
    const newIds = new Map<string, string>();
    for (const entry of subtree) newIds.set(entry.id, this.idFactory());
    const parentId = rootEntry.parentId;
    const rootOrder = this.nextOrder(parentId);
    const now = this.now();
    const created: PageRecord[] = [];

    for (const oldEntry of subtree) {
      const body = this.readBody(oldEntry.id);
      const newId = newIds.get(oldEntry.id)!;
      const blockIds = new Map<string, string>();
      for (const block of body.blocks) blockIds.set(block.id, this.idFactory());

      const oldDatabase = body.database;
      const database = oldDatabase ? clone(oldDatabase) : undefined;
      const propertyIds = new Map<string, string>();
      const rowIds = new Map<string, string>();
      if (oldDatabase && database) {
        for (const property of oldDatabase.properties) propertyIds.set(property.id, this.idFactory());
        for (const row of oldDatabase.rows) rowIds.set(row.id, this.idFactory());
        const optionIds = new Map<string, Map<string, string>>();
        database.properties = oldDatabase.properties.map((property) => {
          const id = propertyIds.get(property.id)!;
          const optionMap = new Map<string, string>();
          const options = property.options?.map((option) => {
            const optionId = this.idFactory();
            optionMap.set(option.id, optionId);
            return { ...option, id: optionId };
          });
          if (options) optionIds.set(property.id, optionMap);
          return {
            ...property,
            id,
            options,
            relationDatabaseId: property.relationDatabaseId && newIds.has(property.relationDatabaseId)
              ? newIds.get(property.relationDatabaseId)
              : property.relationDatabaseId,
          };
        });
        const newPropertyByOldId = new Map(
          oldDatabase.properties.map((property) => [
            property.id,
            database.properties.find((candidate) => candidate.id === propertyIds.get(property.id)),
          ]),
        );
        database.rows = oldDatabase.rows.map((row) => {
          const values: Record<string, DatabaseValue> = {};
          for (const oldProperty of oldDatabase.properties) {
            const property = newPropertyByOldId.get(oldProperty.id);
            if (!property) continue;
            let value = row.values[oldProperty.id];
            const optionMap = optionIds.get(oldProperty.id);
            if (optionMap) {
              if (typeof value === 'string') value = optionMap.get(value) ?? null;
              else if (Array.isArray(value)) value = value.map((optionId) => optionMap.get(optionId)).filter((optionId): optionId is string => Boolean(optionId));
            }
            if (oldProperty.type === 'relation' && Array.isArray(value)) {
              value = value.map((relationId) => rowIds.get(relationId) ?? relationId);
            }
            values[property.id] = normalizeValue(value, property);
          }
          return {
            ...row,
            id: rowIds.get(row.id)!,
            values,
            pageId: undefined,
            createdAt: now,
            updatedAt: now,
          };
        });
        const oldDefaultIndex = Math.max(0, oldDatabase.views.findIndex((view) => view.id === oldDatabase.defaultViewId));
        database.views = oldDatabase.views.map((view) => ({
          ...view,
          id: this.idFactory(),
          filters: view.filters
            ? {
              ...view.filters,
              filters: view.filters.filters.flatMap((filter): DatabaseFilter[] => {
                const oldProperty = oldDatabase.properties.find((property) => property.id === filter.propertyId);
                const propertyId = propertyIds.get(filter.propertyId);
                if (!oldProperty || !propertyId) return [];
                const optionMap = optionIds.get(oldProperty.id);
                let value = filter.value;
                if (optionMap && typeof value === 'string') value = optionMap.get(value) ?? value;
                if (optionMap && Array.isArray(value)) value = value.map((optionId) => optionMap.get(optionId)).filter((optionId): optionId is string => Boolean(optionId));
                return [{ ...filter, id: this.idFactory(), propertyId, value }];
              }),
            }
            : undefined,
          sorts: view.sorts?.flatMap((sort): DatabaseSort[] => {
            const propertyId = propertyIds.get(sort.propertyId);
            return propertyId ? [{ ...sort, propertyId }] : [];
          }),
          groupBy: view.groupBy ? propertyIds.get(view.groupBy) : undefined,
          boardGroupBy: view.boardGroupBy ? propertyIds.get(view.boardGroupBy) : undefined,
          datePropertyId: view.datePropertyId ? propertyIds.get(view.datePropertyId) : undefined,
          hiddenPropertyIds: view.hiddenPropertyIds?.map((propertyId) => propertyIds.get(propertyId)).filter((propertyId): propertyId is string => Boolean(propertyId)),
        }));
        database.defaultViewId = database.views[oldDefaultIndex]?.id ?? database.views[0]!.id;
      }

      const record = this.createStoredPage({
        id: newId,
        parentId: oldEntry.id === id ? parentId : (newIds.get(oldEntry.parentId ?? '') ?? parentId),
        kind: oldEntry.kind,
        title: oldEntry.id === id ? `${rootEntry.title} copy` : oldEntry.title,
        icon: oldEntry.icon,
        cover: null,
        blocks: body.blocks.map((block) => ({
          ...block,
          id: blockIds.get(block.id) ?? this.idFactory(),
          pageId: block.pageId && newIds.has(block.pageId) ? newIds.get(block.pageId) : undefined,
        })),
        database,
        order: oldEntry.id === id ? rootOrder : oldEntry.order,
      });
      created.push(record);
    }
    this.writeIndex();
    return clone(created[0] ?? null);
  }

  trash(id: string): PageSummary[] {
    const entry = this.requireEntry(id);
    if (entry.trashedAt === null) {
      const now = this.now();
      const ids = new Set([entry.id, ...this.descendants(entry.id).map((child) => child.id)]);
      this.index = this.index.map((candidate) => (
        ids.has(candidate.id) && candidate.trashedAt === null
          ? { ...candidate, trashedAt: now, updatedAt: now }
          : candidate
      ));
      this.writeIndex();
    }
    return this.list().filter((page) => page.trashedAt !== null);
  }

  restore(id: string): PageRecord {
    const entry = this.requireEntry(id);
    const parent = entry.parentId ? this.entryById(entry.parentId) : undefined;
    const ids = new Set([entry.id, ...this.descendants(entry.id).map((child) => child.id)]);
    this.index = this.index.map((candidate) => {
      if (!ids.has(candidate.id)) return candidate;
      return {
        ...candidate,
        trashedAt: null,
        parentId: candidate.id === id && parent?.trashedAt ? null : candidate.parentId,
        order: candidate.id === id && parent?.trashedAt ? this.nextOrder(null) : candidate.order,
        updatedAt: this.now(),
      };
    });
    this.writeIndex();
    const body = this.readBody(entry.id);
    return clone(this.recordFrom(this.requireEntry(entry.id), body));
  }

  deletePermanent(id: string): void {
    const entry = this.requireEntry(id);
    const ids = new Set([entry.id, ...this.descendants(entry.id).map((child) => child.id)]);
    for (const candidate of [...this.index]) {
      if (!ids.has(candidate.id)) continue;
      if (candidate.rowDatabaseId && !ids.has(candidate.rowDatabaseId)) {
        const database = this.get(candidate.rowDatabaseId);
        if (database?.database) {
          const nextRows = database.database.rows.filter((row) => row.id !== candidate.rowId);
          if (nextRows.length !== database.database.rows.length) {
            this.update(candidate.rowDatabaseId, { database: { ...database.database, rows: nextRows } });
          }
        }
      }
      this.deleteBody(candidate.id);
    }
    this.index = this.index.filter((candidate) => !ids.has(candidate.id));
    this.writeIndex();
  }

  emptyTrash(): void {
    const trashed = this.index.filter((entry) => entry.trashedAt !== null);
    const trashedIds = new Set(trashed.map((entry) => entry.id));
    const roots = trashed.filter((entry) => !entry.parentId || !trashedIds.has(entry.parentId));
    for (const root of roots) {
      if (!this.entryById(root.id)) continue;
      this.deletePermanent(root.id);
    }
  }

  // ── Comments & versions ────────────────────────────────────────────────

  addComment(id: string, text: string, blockId?: string): PageRecord {
    const entry = this.requireEntry(id);
    const body = this.readBody(id);
    const trimmed = clampText(text, PAGES_LIMITS.commentText).trim();
    if (!trimmed) throw new Error('Write a comment first.');
    body.comments.push({
      id: this.idFactory(),
      text: trimmed,
      author: 'You',
      createdAt: this.now(),
      blockId: safeId(blockId) ?? undefined,
    });
    body.comments = body.comments.slice(-PAGES_LIMITS.comments);
    entry.updatedAt = this.now();
    this.writeBody(body);
    this.writeIndex();
    return clone(this.recordFrom(entry, body));
  }

  deleteComment(id: string, commentId: string): PageRecord {
    const entry = this.requireEntry(id);
    const body = this.readBody(id);
    body.comments = body.comments.filter((comment) => comment.id !== commentId);
    entry.updatedAt = this.now();
    this.writeBody(body);
    this.writeIndex();
    return clone(this.recordFrom(entry, body));
  }

  resolveComment(id: string, commentId: string, resolved: boolean): PageRecord {
    const entry = this.requireEntry(id);
    const body = this.readBody(id);
    body.comments = body.comments.map((comment) => (
      comment.id === commentId ? { ...comment, resolved, updatedAt: this.now() } : comment
    ));
    entry.updatedAt = this.now();
    this.writeBody(body);
    this.writeIndex();
    return clone(this.recordFrom(entry, body));
  }

  private pushVersion(body: PageBody, record: PageRecord, reason: 'auto' | 'manual'): void {
    const version: PageVersion = {
      id: this.idFactory(),
      at: this.now(),
      title: record.title,
      blocks: clone(record.blocks).slice(0, PAGES_LIMITS.versionBlocks),
      database: record.database ? clone(record.database) : undefined,
      reason,
      author: 'You',
    };
    body.versions.push(version);
    body.versions = body.versions.slice(-PAGES_LIMITS.versions);
  }

  saveVersion(id: string): PageRecord {
    const entry = this.requireEntry(id);
    const body = this.readBody(id);
    const record = this.recordFrom(entry, body);
    this.pushVersion(body, record, 'manual');
    entry.updatedAt = this.now();
    this.writeBody(body);
    this.writeIndex();
    return clone(this.recordFrom(entry, body));
  }

  restoreVersion(id: string, versionId: string): PageRecord {
    const entry = this.requireEntry(id);
    const body = this.readBody(id);
    const version = body.versions.find((candidate) => candidate.id === versionId);
    if (!version) throw new Error('That version is no longer available.');
    const current = this.recordFrom(entry, body);
    this.pushVersion(body, current, 'manual');
    body.blocks = normalizeBlocks(version.blocks, this.idFactory);
    if (entry.kind === 'database' && version.database) {
      body.database = normalizeDatabase(version.database, this.idFactory);
    }
    entry.title = normalizePageTitle(version.title);
    entry.updatedAt = this.now();
    this.writeBody(body);
    // Route the restored state through update() so linked database rows and
    // row pages keep the same titles as the page that was just restored.
    // The manual snapshot pushed above is newer than the restore clock, so
    // this does not create a second, redundant automatic version.
    return this.update(id, {
      title: entry.title,
      ...(entry.kind === 'database' && body.database ? { database: body.database } : {}),
    });
  }

  // ── Database rows ──────────────────────────────────────────────────────

  private databasePage(databaseId: string): { entry: PageIndexEntry; body: PageBody; database: PageDatabase } {
    const entry = this.requireEntry(databaseId);
    if (entry.kind !== 'database') throw new Error('That page is not a database.');
    const body = this.readBody(databaseId);
    if (!body.database) throw new Error('This database has no schema.');
    body.database = normalizeDatabase(body.database, this.idFactory);
    return { entry, body, database: body.database };
  }

  private titleOfRow(database: PageDatabase, row: DatabaseRow): string {
    const titleProperty = database.properties.find((property) => property.type === 'title');
    const value = titleProperty ? row.values[titleProperty.id] : null;
    return normalizePageTitle(typeof value === 'string' ? value : 'Untitled');
  }

  createDatabaseRow(databaseId: string, input: PageDatabaseRowInput = {}): PageDatabase {
    const { entry, body, database } = this.databasePage(databaseId);
    if (database.rows.length >= PAGES_LIMITS.rows) throw new Error('This database has reached its row limit.');
    const now = this.now();
    const values: Record<string, DatabaseValue> = {};
    for (const property of database.properties) {
      values[property.id] = propValueOr(input.values?.[property.id], defaultTitleValue(property), property);
    }
    const title = values[database.properties.find((property) => property.type === 'title')!.id];
    if (typeof title !== 'string' || !title.trim()) {
      const titleProperty = database.properties.find((property) => property.type === 'title')!;
      values[titleProperty.id] = 'Untitled';
    }
    database.rows.push({
      id: this.idFactory(),
      values,
      order: database.rows.length ? Math.max(...database.rows.map((row) => row.order)) + 1 : 0,
      createdAt: now,
      updatedAt: now,
    });
    entry.updatedAt = now;
    body.database = database;
    this.writeBody(body);
    const record = this.recordFrom(entry, body);
    this.index = this.index.map((candidate) => (
      candidate.id === databaseId ? this.summaryFrom(record, pageSearchText(record)) : candidate
    ));
    this.writeIndex();
    return clone(database);
  }

  updateDatabaseRow(databaseId: string, rowId: string, patch: PageDatabaseRowInput): PageDatabase {
    const { entry, body, database } = this.databasePage(databaseId);
    const row = database.rows.find((candidate) => candidate.id === rowId);
    if (!row) throw new Error('That row no longer exists.');
    const values: Record<string, DatabaseValue> = { ...row.values };
    for (const property of database.properties) {
      if (patch.values && Object.prototype.hasOwnProperty.call(patch.values, property.id)) {
        values[property.id] = normalizeValue(patch.values[property.id], property);
      }
    }
    const titleProperty = database.properties.find((property) => property.type === 'title')!;
    if (typeof values[titleProperty.id] !== 'string' || !String(values[titleProperty.id]).trim()) {
      values[titleProperty.id] = 'Untitled';
    }
    row.values = values;
    if (patch.order !== undefined) row.order = clampNumber(patch.order, -1_000_000, 1_000_000, row.order);
    row.updatedAt = this.now();
    entry.updatedAt = row.updatedAt;
    body.database = database;
    this.writeBody(body);

    const nextIndex = this.index.map((candidate) => {
      if (candidate.id === databaseId) {
        const record = this.recordFrom(entry, body);
        return this.summaryFrom(record, pageSearchText(record));
      }
      if (row.pageId && candidate.id === row.pageId) {
        // Rebuild the row-page summary from its body with the row title, so
        // repeated renames do not keep prepending the old title to searchText.
        const rowEntry = {
          ...candidate,
          title: this.titleOfRow(database, row),
          updatedAt: row.updatedAt,
        };
        const rowRecord = this.recordFrom(rowEntry, this.readBody(row.pageId));
        return this.summaryFrom(rowRecord, pageSearchText(rowRecord));
      }
      return candidate;
    });
    this.index = nextIndex;
    this.writeIndex();
    return clone(database);
  }

  deleteDatabaseRow(databaseId: string, rowId: string): PageDatabase {
    const { entry, body, database } = this.databasePage(databaseId);
    const row = database.rows.find((candidate) => candidate.id === rowId);
    if (!row) throw new Error('That row no longer exists.');
    database.rows = database.rows.filter((candidate) => candidate.id !== rowId);
    entry.updatedAt = this.now();
    body.database = database;
    this.writeBody(body);
    const record = this.recordFrom(entry, body);
    this.index = this.index.map((candidate) => (
      candidate.id === databaseId ? this.summaryFrom(record, pageSearchText(record)) : candidate
    ));
    this.writeIndex();
    if (row.pageId && this.entryById(row.pageId)) this.trash(row.pageId);
    return clone(database);
  }

  duplicateDatabaseRow(databaseId: string, rowId: string): PageDatabase {
    const { entry, body, database } = this.databasePage(databaseId);
    const source = database.rows.find((candidate) => candidate.id === rowId);
    if (!source) throw new Error('That row no longer exists.');
    if (database.rows.length >= PAGES_LIMITS.rows) throw new Error('This database has reached its row limit.');
    const copy: DatabaseRow = {
      id: this.idFactory(),
      values: clone(source.values),
      order: Math.max(...database.rows.map((row) => row.order)) + 1,
      createdAt: this.now(),
      updatedAt: this.now(),
    };
    const titleProperty = database.properties.find((property) => property.type === 'title')!;
    const title = copy.values[titleProperty.id];
    if (typeof title === 'string') copy.values[titleProperty.id] = `${title} copy`;
    database.rows.push(copy);
    entry.updatedAt = copy.updatedAt;
    body.database = database;
    this.writeBody(body);
    const record = this.recordFrom(entry, body);
    this.index = this.index.map((candidate) => (
      candidate.id === databaseId ? this.summaryFrom(record, pageSearchText(record)) : candidate
    ));
    this.writeIndex();
    return clone(database);
  }

  openRowPage(databaseId: string, rowId: string): PageRecord {
    const { entry: dbEntry, body: dbBody, database } = this.databasePage(databaseId);
    const row = database.rows.find((candidate) => candidate.id === rowId);
    if (!row) throw new Error('That row no longer exists.');
    if (row.pageId) {
      const existing = this.get(row.pageId);
      if (existing) return existing;
    }
    const title = this.titleOfRow(database, row);
    const now = this.now();
    const page = this.createStoredPage({
      parentId: databaseId,
      kind: 'page',
      title,
      icon: '📄',
      cover: null,
      blocks: [{ id: this.idFactory(), type: 'paragraph', html: '', depth: 0 }],
      order: this.nextOrder(databaseId),
      rowDatabaseId: databaseId,
      rowId,
    });
    row.pageId = page.id;
    row.updatedAt = now;
    dbEntry.updatedAt = now;
    dbBody.database = database;
    this.writeBody(dbBody);
    const record = this.recordFrom(dbEntry, dbBody);
    this.index = this.index.map((candidate) => (
      candidate.id === databaseId ? this.summaryFrom(record, pageSearchText(record)) : candidate
    ));
    this.writeIndex();
    return clone(this.recordFrom(this.requireEntry(page.id), this.readBody(page.id)));
  }

  // ── Helpers for tests and UI counts ────────────────────────────────────

  stats(): { pages: number; databases: number; trashed: number; favorites: number; rows: number } {
    let databases = 0;
    let trashed = 0;
    let favorites = 0;
    let rows = 0;
    for (const entry of this.index) {
      if (entry.kind === 'database') databases += 1;
      if (entry.trashedAt) trashed += 1;
      if (entry.favorite && !entry.trashedAt) favorites += 1;
      if (entry.kind === 'database' && !entry.rowDatabaseId) {
        rows += this.readBody(entry.id).database?.rows.length ?? 0;
      }
    }
    return { pages: this.index.length, databases, trashed, favorites, rows };
  }
}

function propValueOr(value: DatabaseValue | undefined, fallback: DatabaseValue, property: DatabaseProperty): DatabaseValue {
  return value === undefined ? fallback : normalizeValue(value, property);
}

let singleton: PagesStore | null = null;

export function getPagesStore(): PagesStore {
  if (!singleton) singleton = new PagesStore();
  return singleton;
}

export function setPagesStoreForTests(store: PagesStore | null): void {
  singleton = store;
}
