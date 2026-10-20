/* Journal — persistent store.
 * The notes themselves, plus the personal mistake log that turns every
 * correction into a lesson. Spelling mistakes are mirrored into Spell Forge
 * so the spaced-repetition deck drills them too.
 */

export interface Note {
  id: string;
  title: string;
  body: string;
  created: number;
  updated: number;
}

export type MistakeKind = 'spelling' | 'grammar';

export interface Mistake {
  key: string;
  kind: MistakeKind;
  wrong: string;
  correct: string;
  why: string;
  count: number;
  learned: boolean;
  first: number;
  last: number;
}

interface JournalState {
  schema: number;
  notes: Note[];
  activeId: string | null;
  mistakes: Record<string, Mistake>;
  autoFix: boolean;
}

const KEY = 'infinite.journal.v1';
const SCHEMA = 1;
/* Two analyses of the same sentence seconds apart must not double-count, or
 * a typo held for a minute looks like a hundred mistakes. */
const RECORD_COOLDOWN_MS = 30000;

let state: JournalState = blankState();
let available = true;

function blankState(): JournalState {
  return {
    schema: SCHEMA,
    notes: [],
    activeId: null,
    mistakes: {},
    autoFix: true,
  };
}

function save(): void {
  if (!available) return;
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    available = false;
    console.warn('Journal: storage not writable. Notes will not be saved.');
  }
}

function load(): JournalState {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return state;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      state = { ...blankState(), ...parsed } as JournalState;
      state.schema = SCHEMA;
      if (!Array.isArray(state.notes)) state.notes = [];
      if (!state.mistakes || typeof state.mistakes !== 'object') state.mistakes = {};
    }
  } catch {
    state = blankState();
  }
  return state;
}

/* ------------------------------------------------------------------ notes */

function notes(): Note[] {
  return state.notes.slice().sort((a, b) => b.updated - a.updated);
}

function findNote(id: string): Note | undefined {
  return state.notes.find((n) => n.id === id);
}

function activeNote(): Note {
  if (state.activeId) {
    const hit = findNote(state.activeId);
    if (hit) return hit;
  }
  if (state.notes.length) {
    const first = state.notes.slice().sort((a, b) => b.updated - a.updated)[0];
    state.activeId = first.id;
    return first;
  }
  return createNote('Untitled note', '');
}

function createNote(title: string, body: string): Note {
  const now = Date.now();
  const note: Note = {
    id: 'n' + now.toString(36) + Math.random().toString(36).slice(2, 7),
    title: title || 'Untitled note',
    body: body || '',
    created: now,
    updated: now,
  };
  state.notes.push(note);
  state.activeId = note.id;
  save();
  return note;
}

function updateNote(id: string, patch: Partial<Pick<Note, 'title' | 'body'>>): void {
  const note = findNote(id);
  if (!note) return;
  if (patch.title !== undefined) note.title = patch.title;
  if (patch.body !== undefined) note.body = patch.body;
  note.updated = Date.now();
  save();
}

function deleteNote(id: string): void {
  state.notes = state.notes.filter((n) => n.id !== id);
  if (state.activeId === id) state.activeId = state.notes.length ? state.notes[0].id : null;
  save();
}

function setActiveNote(id: string): void {
  state.activeId = id;
  save();
}

function searchNotes(q: string): Note[] {
  const query = q.trim().toLowerCase();
  const list = notes();
  if (!query) return list;
  return list.filter(
    (n) => n.title.toLowerCase().indexOf(query) !== -1 || n.body.toLowerCase().indexOf(query) !== -1,
  );
}

function setAutoFix(on: boolean): void {
  state.autoFix = !!on;
  save();
}

function autoFixEnabled(): boolean {
  return state.autoFix !== false;
}

/* --------------------------------------------------------------- mistakes */

export interface RecordMistakeInput {
  kind: MistakeKind;
  wrong: string;
  correct: string;
  why: string;
}

function mistakeKey(kind: MistakeKind, wrong: string): string {
  return kind + ':' + wrong.trim().toLowerCase();
}

/**
 * Remember a mistake. Returns true when the log actually changed, so the
 * caller knows whether to mirror it into Spell Forge.
 */
function recordMistake(input: RecordMistakeInput, force = false): boolean {
  const wrong = (input.wrong || '').trim();
  const correct = (input.correct || '').trim();
  if (!wrong || !correct || wrong.toLowerCase() === correct.toLowerCase()) return false;
  const key = mistakeKey(input.kind, wrong);
  const now = Date.now();
  const existing = state.mistakes[key];
  if (existing) {
    if (!force && now - existing.last < RECORD_COOLDOWN_MS) return false;
    existing.count++;
    existing.last = now;
    if (correct && !existing.correct) existing.correct = correct;
    if (input.why && !existing.why) existing.why = input.why;
    save();
    return true;
  }
  state.mistakes[key] = {
    key,
    kind: input.kind,
    wrong,
    correct,
    why: input.why || '',
    count: 1,
    learned: false,
    first: now,
    last: now,
  };
  save();
  return true;
}

function mistakeList(): Mistake[] {
  return Object.keys(state.mistakes)
    .map((k) => state.mistakes[k])
    .sort((a, b) => Number(a.learned) - Number(b.learned) || b.count - a.count || b.last - a.last);
}

function pendingMistakes(): Mistake[] {
  return mistakeList().filter((m) => !m.learned);
}

function learnedMistakes(): Mistake[] {
  return mistakeList().filter((m) => m.learned);
}

function markLearned(key: string, learned: boolean): void {
  const m = state.mistakes[key];
  if (!m) return;
  m.learned = learned;
  save();
}

function forgetMistake(key: string): void {
  delete state.mistakes[key];
  save();
}

function mistakeStats(): { total: number; spelling: number; grammar: number; learned: number } {
  const all = mistakeList();
  return {
    total: all.length,
    spelling: all.filter((m) => m.kind === 'spelling').length,
    grammar: all.filter((m) => m.kind === 'grammar').length,
    learned: all.filter((m) => m.learned).length,
  };
}

function reset(): void {
  state = blankState();
  available = true;
  save();
}

export {
  load, save, reset,
  notes, findNote, activeNote, createNote, updateNote, deleteNote, setActiveNote, searchNotes,
  setAutoFix, autoFixEnabled,
  recordMistake, mistakeList, pendingMistakes, learnedMistakes, markLearned, forgetMistake,
  mistakeStats, mistakeKey,
};
