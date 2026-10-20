/**
 * Studio — documents, spreadsheets, and decks that live inside Infinite OS.
 *
 * The model is deliberately small and plain JSON:
 *   • document  → sanitized HTML produced by the in-app editor
 *   • sheet     → a sparse map of "A1" → raw input (formulas included)
 *   • slides    → an ordered list of slides with a title and body
 *
 * Keeping the data shape boring is what makes it durable: the agent tools,
 * IPC layer, exporter, and UI all read the same object, and an older file
 * opened later is still valid. Limits are enforced in the main-process store
 * so a runaway editor or a tool call can never write an unbounded blob.
 */

export type StudioKind = 'document' | 'sheet' | 'slides';

export interface StudioSheet {
  /** Visible grid dimensions. Cells outside this range are preserved but hidden. */
  columns: number;
  rows: number;
  /** Sparse map of A1-notation cell address → raw input (may start with "="). */
  cells: Record<string, string>;
}

export interface StudioSlide {
  id: string;
  title: string;
  body: string;
  notes?: string;
}

export interface StudioDeck {
  slides: StudioSlide[];
}

export interface StudioItem {
  id: string;
  kind: StudioKind;
  title: string;
  createdAt: number;
  updatedAt: number;
  starred: boolean;
  /** Document HTML (kind === 'document'). */
  html?: string;
  /** Sheet grid (kind === 'sheet'). */
  sheet?: StudioSheet;
  /** Slide deck (kind === 'slides'). */
  deck?: StudioDeck;
}

export interface StudioData {
  version: 1;
  items: StudioItem[];
}

export interface StudioCreateInput {
  kind: StudioKind;
  title?: string;
}

export interface StudioUpdateInput {
  title?: string;
  starred?: boolean;
  html?: string;
  sheet?: StudioSheet;
  deck?: StudioDeck;
}

export type StudioAiAction =
  | 'write'
  | 'continue'
  | 'rewrite'
  | 'grammar'
  | 'summarize'
  | 'shorten'
  | 'expand'
  | 'formal'
  | 'poem'
  | 'story'
  | 'translate'
  | 'sheet'
  | 'deck'
  | 'custom';

export interface StudioAiRequest {
  action: StudioAiAction;
  kind: StudioKind;
  /** The user's instruction or topic. */
  prompt: string;
  /** Text the action should operate on (selection, document text, CSV…). */
  context?: string;
  /** Persisted item, used for light server-side context only. */
  itemId?: string;
  /** Optional BCP-47-ish target language for translate. */
  language?: string;
}

export interface StudioAiResult {
  text: string;
  provider: string;
  model: string;
}

/** Hard limits shared by the store and the agent tool. */
export const STUDIO_LIMITS = {
  title: 200,
  html: 2_000_000,
  cells: 20_000,
  cellLength: 4_000,
  columns: 64,
  rows: 500,
  slides: 120,
  slideTitle: 300,
  slideBody: 20_000,
  slideNotes: 8_000,
  items: 2_000,
} as const;

export const STUDIO_KIND_LABEL: Record<StudioKind, string> = {
  document: 'Document',
  sheet: 'Spreadsheet',
  slides: 'Deck',
};

export function defaultSheet(): StudioSheet {
  return { columns: 12, rows: 30, cells: {} };
}

export function newSlide(): StudioSlide {
  return {
    id: `slide-${Math.random().toString(36).slice(2, 10)}`,
    title: '',
    body: '',
  };
}

export function defaultDeck(): StudioDeck {
  return { slides: [newSlide()] };
}

/** A1 → { column: 0, row: 0 }. Returns null for addresses outside the model. */
export function parseCellAddress(address: string): { column: number; row: number } | null {
  const match = /^([A-Za-z]{1,2})([1-9]\d{0,2})$/.exec(address.trim());
  if (!match) return null;
  const column = match[1].toUpperCase().split('').reduce((n, ch) => n * 26 + (ch.charCodeAt(0) - 64), 0) - 1;
  const row = Number(match[2]) - 1;
  if (column < 0 || column >= STUDIO_LIMITS.columns || row < 0 || row >= STUDIO_LIMITS.rows) return null;
  return { column, row };
}

/** 0 → "A", 25 → "Z", 26 → "AA". */
export function columnName(index: number): string {
  let n = Math.max(0, Math.floor(index));
  let out = '';
  do {
    out = String.fromCharCode(65 + (n % 26)) + out;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return out;
}
