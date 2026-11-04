/**
 * Pages — Infinite OS's Notion-style workspace.
 *
 * The shared model is deliberately boring and serialisable: a page is a list
 * of blocks plus an optional database. That keeps the renderer, the main
 * process store, exports, and agent tools speaking exactly the same language.
 *
 * Page bodies live in their own files (see main/pages/store.ts); only metadata
 * travels in the list index so a 5,000-page workspace still opens instantly.
 */

export type PageKind = 'page' | 'database';

export type PageBlockType =
  | 'paragraph'
  | 'heading1'
  | 'heading2'
  | 'heading3'
  | 'bulleted'
  | 'numbered'
  | 'todo'
  | 'toggle'
  | 'quote'
  | 'callout'
  | 'divider'
  | 'code'
  | 'image'
  | 'bookmark'
  | 'table'
  | 'child_page'
  | 'child_database';

export interface PageBlockTable {
  headers: string[];
  rows: string[][];
}

export interface PageBlock {
  id: string;
  type: PageBlockType;
  /** Rich text. Sanitised against the same allow-list as Studio documents. */
  html: string;
  /** 0–4, used by lists, toggles, and nested paragraphs. */
  depth: number;
  checked?: boolean;
  collapsed?: boolean;
  language?: string;
  url?: string;
  caption?: string;
  /** Callout glyph. */
  icon?: string;
  /** Callout tone key. */
  tone?: string;
  table?: PageBlockTable;
  /** Target page for child_page / child_database blocks. */
  pageId?: string;
}

export type DatabasePropertyType =
  | 'title'
  | 'text'
  | 'number'
  | 'select'
  | 'multi_select'
  | 'status'
  | 'date'
  | 'checkbox'
  | 'url'
  | 'email'
  | 'phone'
  | 'formula'
  | 'relation';

export interface DatabaseSelectOption {
  id: string;
  name: string;
  color: string;
}

export interface DatabaseProperty {
  id: string;
  name: string;
  type: DatabasePropertyType;
  options?: DatabaseSelectOption[];
  /** Safe formula expression — evaluated in the renderer, never with eval. */
  formula?: string;
  /** For relation properties: the database whose rows can be linked. */
  relationDatabaseId?: string;
}

export type DatabaseValue = string | number | boolean | string[] | null;

export interface DatabaseRow {
  id: string;
  values: Record<string, DatabaseValue>;
  order: number;
  /** Body page id, created lazily when the row is opened. */
  pageId?: string;
  createdAt: number;
  updatedAt: number;
}

export type DatabaseViewType = 'table' | 'board' | 'list' | 'calendar' | 'gallery';

export type DatabaseFilterOperator =
  | 'contains'
  | 'not_contains'
  | 'is'
  | 'is_not'
  | 'is_empty'
  | 'is_not_empty'
  | 'gt'
  | 'lt'
  | 'before'
  | 'after'
  | 'is_checked'
  | 'is_unchecked';

export interface DatabaseFilter {
  id: string;
  propertyId: string;
  operator: DatabaseFilterOperator;
  value?: string | number | boolean | string[];
}

export interface DatabaseFilterGroup {
  conjunction: 'and' | 'or';
  filters: DatabaseFilter[];
}

export interface DatabaseSort {
  propertyId: string;
  direction: 'asc' | 'desc';
}

export interface DatabaseView {
  id: string;
  name: string;
  type: DatabaseViewType;
  filters?: DatabaseFilterGroup;
  sorts?: DatabaseSort[];
  groupBy?: string;
  /** Calendar view date property. */
  datePropertyId?: string;
  /** Hidden properties, table view. */
  hiddenPropertyIds?: string[];
  /** Board grouping property. */
  boardGroupBy?: string;
}

export interface PageDatabase {
  properties: DatabaseProperty[];
  rows: DatabaseRow[];
  views: DatabaseView[];
  defaultViewId: string;
}

export type PageCoverType = 'gradient' | 'color' | 'image';

export interface PageCover {
  type: PageCoverType;
  /** Preset id for gradient/color; data URL (or https URL) for images. */
  value: string;
}

export interface PageComment {
  id: string;
  text: string;
  author: string;
  createdAt: number;
  updatedAt?: number;
  blockId?: string;
  resolved?: boolean;
}

export interface PageVersion {
  id: string;
  at: number;
  title: string;
  blocks: PageBlock[];
  database?: PageDatabase;
  reason: 'auto' | 'manual';
  author: string;
}

export interface PageRecord {
  id: string;
  parentId: string | null;
  kind: PageKind;
  title: string;
  icon: string;
  cover: PageCover | null;
  blocks: PageBlock[];
  database?: PageDatabase;
  favorite: boolean;
  archived: boolean;
  trashedAt: number | null;
  order: number;
  /** Set when this page is the body of a database row. */
  rowDatabaseId?: string;
  rowId?: string;
  comments: PageComment[];
  versions: PageVersion[];
  createdAt: number;
  updatedAt: number;
}

/** Metadata returned by pagesList(). Never contains blocks or rows. */
export interface PageSummary {
  id: string;
  parentId: string | null;
  kind: PageKind;
  title: string;
  icon: string;
  cover: PageCover | null;
  favorite: boolean;
  archived: boolean;
  trashedAt: number | null;
  order: number;
  rowDatabaseId?: string;
  rowId?: string;
  /** Lower-cased [[wikilink]] targets found in the page text. */
  links: string[];
  createdAt: number;
  updatedAt: number;
}

export interface PageSearchHit {
  id: string;
  title: string;
  icon: string;
  parentId: string | null;
  kind: PageKind;
  trashed: boolean;
  excerpt: string;
  updatedAt: number;
}

export interface PageCreateInput {
  kind?: PageKind;
  parentId?: string | null;
  title?: string;
  icon?: string;
  templateId?: PageTemplateId;
}

export type PageTemplateId =
  | 'blank'
  | 'meeting'
  | 'project'
  | 'weekly'
  | 'wiki'
  | 'task'
  | 'crm'
  | 'content'
  | 'okr'
  | 'reading'
  | 'habit';

export interface PageTemplateInfo {
  id: PageTemplateId;
  name: string;
  description: string;
  icon: string;
  kind: PageKind;
  accent: string;
}

export interface PageUpdateInput {
  title?: string;
  icon?: string;
  cover?: PageCover | null;
  blocks?: PageBlock[];
  database?: PageDatabase;
  favorite?: boolean;
  archived?: boolean;
  parentId?: string | null;
  order?: number;
}

export interface PageDatabaseRowInput {
  values?: Record<string, DatabaseValue>;
  order?: number;
}

export interface PageExportInput {
  id: string;
  format?: 'md' | 'csv';
}

export const PAGES_LIMITS = {
  pages: 5000,
  title: 300,
  icon: 24,
  blocks: 2000,
  blockHtml: 20_000,
  blockDepth: 4,
  tableRows: 100,
  tableColumns: 12,
  tableCell: 2_000,
  comments: 200,
  commentText: 5_000,
  versions: 20,
  versionBlocks: 600,
  properties: 40,
  propertyName: 80,
  options: 60,
  optionName: 60,
  rows: 2_000,
  views: 16,
  viewName: 60,
  filters: 12,
  sorts: 4,
  relations: 50,
  url: 4_000,
  caption: 1_000,
  code: 100_000,
  coverImageBytes: 3_000_000,
  searchText: 32_000,
  trash: 1_000,
} as const;

export const PAGE_TEMPLATES: PageTemplateInfo[] = [
  {
    id: 'blank',
    name: 'Blank page',
    description: 'A clean canvas for a thought, a brief, or a plan.',
    icon: '📄',
    kind: 'page',
    accent: 'zinc',
  },
  {
    id: 'meeting',
    name: 'Meeting notes',
    description: 'Agenda, decisions, action items, and follow-ups.',
    icon: '🗓️',
    kind: 'page',
    accent: 'sky',
  },
  {
    id: 'project',
    name: 'Project plan',
    description: 'Milestones, notes, and a live task database.',
    icon: '🚀',
    kind: 'page',
    accent: 'violet',
  },
  {
    id: 'weekly',
    name: 'Weekly review',
    description: 'What moved, what stalled, and what comes next.',
    icon: '🧭',
    kind: 'page',
    accent: 'emerald',
  },
  {
    id: 'wiki',
    name: 'Team wiki',
    description: 'A structured home for how your team works.',
    icon: '🏛️',
    kind: 'page',
    accent: 'amber',
  },
  {
    id: 'task',
    name: 'Task tracker',
    description: 'Table, board, and calendar views over one task list.',
    icon: '✅',
    kind: 'database',
    accent: 'emerald',
  },
  {
    id: 'crm',
    name: 'CRM',
    description: 'People, companies, stages, and next steps.',
    icon: '🤝',
    kind: 'database',
    accent: 'rose',
  },
  {
    id: 'content',
    name: 'Content calendar',
    description: 'Ideas and posts from draft through published.',
    icon: '📣',
    kind: 'database',
    accent: 'orange',
  },
  {
    id: 'okr',
    name: 'OKRs',
    description: 'Objectives, key results, owners, and progress.',
    icon: '🎯',
    kind: 'database',
    accent: 'violet',
  },
  {
    id: 'reading',
    name: 'Reading list',
    description: 'Books, authors, status, ratings, and takeaways.',
    icon: '📚',
    kind: 'database',
    accent: 'sky',
  },
  {
    id: 'habit',
    name: 'Habit tracker',
    description: 'Daily habits, consistency, and streaks.',
    icon: '🌱',
    kind: 'database',
    accent: 'emerald',
  },
];

export const PAGE_ICONS = [
  '📄', '📝', '📌', '📎', '🗂️', '📁', '🗃️', '📊', '📈', '📉',
  '🧠', '💡', '🎯', '🚀', '⭐', '✨', '🔥', '🌱', '🌿', '🌊',
  '🏔️', '🌅', '🌙', '☀️', '⛅', '🏠', '🏛️', '🧭', '🗺️', '🧳',
  '💼', '🤝', '👥', '🧑‍💻', '🧑‍🎨', '🧑‍🏫', '🛠️', '⚙️', '🔧', '🔬',
  '📚', '📖', '✍️', '🎨', '🎬', '🎧', '🎵', '🎮', '🏆', '🥇',
  '✅', '☑️', '⏳', '📅', '⏰', '🔔', '💬', '✉️', '🔗', '🔖',
  '❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '💎', '🪄',
  '🍀', '🌸', '🌻', '🍎', '🍵', '☕', '🍕', '🏃', '🧘', '💪',
  '🐾', '🐶', '🐱', '🦋', '🌍', '🌈', '❄️', '⚡', '🕯️', '📷',
  '🖥️', '💾', '🧩', '🪴', '🛋️', '🚗', '✈️', '🏝️', '🎁', '🧾',
];

export const PAGE_COVER_PRESETS: Array<{ id: string; type: 'gradient' | 'color'; label: string; value: string }> = [
  { id: 'aurora', type: 'gradient', label: 'Aurora', value: 'linear-gradient(120deg, #0f172a 0%, #1e3a8a 35%, #0f766e 70%, #a3e635 100%)' },
  { id: 'sunset', type: 'gradient', label: 'Sunset', value: 'linear-gradient(120deg, #1c1917 0%, #7c2d12 40%, #db2777 75%, #fbbf24 100%)' },
  { id: 'violet', type: 'gradient', label: 'Violet', value: 'linear-gradient(120deg, #1e1b4b 0%, #6d28d9 50%, #c026d3 100%)' },
  { id: 'ocean', type: 'gradient', label: 'Ocean', value: 'linear-gradient(120deg, #082f49 0%, #0369a1 50%, #22d3ee 100%)' },
  { id: 'forest', type: 'gradient', label: 'Forest', value: 'linear-gradient(120deg, #052e16 0%, #166534 55%, #84cc16 100%)' },
  { id: 'mono', type: 'gradient', label: 'Graphite', value: 'linear-gradient(120deg, #09090b 0%, #27272a 55%, #71717a 100%)' },
  { id: 'slate', type: 'color', label: 'Slate', value: '#1e293b' },
  { id: 'plum', type: 'color', label: 'Plum', value: '#3b1d3f' },
  { id: 'moss', type: 'color', label: 'Moss', value: '#1f3324' },
  { id: 'navy', type: 'color', label: 'Navy', value: '#172554' },
  { id: 'sand', type: 'color', label: 'Sand', value: '#3f3324' },
  { id: 'rose', type: 'color', label: 'Rose', value: '#3f1d2b' },
];

export const DATABASE_COLORS = [
  { id: 'zinc', value: '#a1a1aa', bg: 'rgba(161,161,170,0.16)' },
  { id: 'red', value: '#f87171', bg: 'rgba(248,113,113,0.16)' },
  { id: 'orange', value: '#fb923c', bg: 'rgba(251,146,60,0.16)' },
  { id: 'amber', value: '#fbbf24', bg: 'rgba(251,191,36,0.16)' },
  { id: 'green', value: '#4ade80', bg: 'rgba(74,222,128,0.16)' },
  { id: 'teal', value: '#2dd4bf', bg: 'rgba(45,212,191,0.16)' },
  { id: 'sky', value: '#38bdf8', bg: 'rgba(56,189,248,0.16)' },
  { id: 'blue', value: '#60a5fa', bg: 'rgba(96,165,250,0.16)' },
  { id: 'violet', value: '#a78bfa', bg: 'rgba(167,139,250,0.16)' },
  { id: 'pink', value: '#f472b6', bg: 'rgba(244,114,182,0.16)' },
] as const;

export const DEFAULT_PAGE_DATABASE: PageDatabase = {
  properties: [
    { id: 'title', name: 'Name', type: 'title' },
    { id: 'status', name: 'Status', type: 'status', options: [
      { id: 'status-todo', name: 'Not started', color: 'zinc' },
      { id: 'status-doing', name: 'In progress', color: 'sky' },
      { id: 'status-done', name: 'Done', color: 'green' },
    ] },
    { id: 'assignee', name: 'Owner', type: 'text' },
    { id: 'date', name: 'Date', type: 'date' },
  ],
  rows: [],
  views: [
    { id: 'view-table', name: 'Table', type: 'table', sorts: [] },
    { id: 'view-board', name: 'Board', type: 'board', boardGroupBy: 'status' },
    { id: 'view-calendar', name: 'Calendar', type: 'calendar', datePropertyId: 'date' },
  ],
  defaultViewId: 'view-table',
};

export function emptyPageBlock(type: PageBlockType = 'paragraph', id: string): PageBlock {
  const block: PageBlock = { id, type, html: '', depth: 0 };
  if (type === 'todo') block.checked = false;
  if (type === 'toggle') block.collapsed = false;
  if (type === 'callout') {
    block.icon = '💡';
    block.tone = 'violet';
  }
  if (type === 'code') block.language = 'plain text';
  if (type === 'table') {
    block.table = {
      headers: ['Column 1', 'Column 2', 'Column 3'],
      rows: [
        ['', '', ''],
        ['', '', ''],
      ],
    };
  }
  return block;
}
