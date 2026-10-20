/* SpellForge — persistent store.
 * Everything that survives closing the tab: journal entries, the personal
 * dictionary, spaced-repetition scheduling, and progression.
 *
 * Storage is localStorage, which has a hard limit of a few megabytes. Two
 * decisions follow from it: errors are stored as counts against words rather
 * than as a list of individual mistakes, and every write is guarded so that a
 * full quota degrades to in-memory only instead of losing the page.
 */

export interface WordRecord {
  word: string;
  correct: string | null;
  errors: number;
  fixed: number;
  learned: boolean;
  box: number;
  due: string;
  first: number;
  last: number;
  attempts: number;
}

export interface Entry {
  id: string;
  title: string;
  text: string;
  created: number;
  updated: number;
  words: number;
  findings: unknown[];
  counted?: boolean;
  lastCountedWords?: number;
}

export interface Stats {
  totalWords: number;
  totalEntries: number;
  totalFixed: number;
  xp: number;
  streak: number;
  bestStreak: number;
  lastWriteDay: string | null;
  days: Record<string, number>;
}

export interface LevelInfo {
  index: number;
  name: string;
  xp: number;
  next: number | null;
  into: number;
  span: number;
  fraction: number;
}

export interface SpellForgeState {
  schema: number;
  entries: Entry[];
  activeId: string | null;
  personal: string[];
  words: Record<string, WordRecord>;
  stats: Stats;
  achievements: string[];
  settings: { theme: string; showHints: boolean; wpmWindow: number };
}

/* Leitner-style ladder: intervals in days, indexed by how many times a word
 * has been recalled. A forgotten word comes back tomorrow; that is the point,
 * not an optimal interval. */
const LADDER = [0, 1, 2, 4, 8, 21];

const LEVELS = [
  { at: 0, name: 'Scribbler' },
  { at: 200, name: 'Apprentice' },
  { at: 600, name: 'Wordsmith' },
  { at: 1400, name: 'Scrivener' },
  { at: 3000, name: 'Calligrapher' },
  { at: 6000, name: 'Lexicographer' },
  { at: 11000, name: 'Lorekeeper' },
];

const ACHIEVEMENTS = [
  { id: 'first-word', name: 'First Word', hint: 'Write your first journal entry' },
  { id: 'first-catch', name: 'Eagle Eye', hint: 'Fix your first misspelling' },
  { id: 'fifty-catch', name: 'Sharp Senses', hint: 'Fix 50 misspellings' },
  { id: 'ten-words', name: 'Word Collector', hint: 'Learn 10 words' },
  { id: 'fifty-words', name: 'Lexicon Builder', hint: 'Learn 50 words' },
  { id: 'streak-3', name: 'Consistency', hint: 'Write 3 days in a row' },
  { id: 'streak-7', name: 'Devoted', hint: 'Write 7 days in a row' },
  { id: 'streak-30', name: 'Unbroken', hint: 'Write 30 days in a row' },
  { id: 'thousand-words', name: "It's a Journal", hint: 'Write 1,000 words' },
  { id: 'ten-thousand-words', name: 'Prolific', hint: 'Write 10,000 words' },
  { id: 'clean-entry', name: 'Clean Slate', hint: 'Write 200 words with no errors' },
  { id: 'deck-clear', name: 'Deck Cleared', hint: 'Retire a word from your deck' },
  { id: 'night-owl', name: 'Night Owl', hint: 'Write after midnight' },
  { id: 'early-bird', name: 'Early Bird', hint: 'Write before 6am' },
];

const KEY = 'spellforge.v1';
const SCHEMA = 1;

function blankState(): SpellForgeState {
  return {
    schema: SCHEMA,
    entries: [],
    activeId: null,
    personal: [],
    words: {},
    stats: {
      totalWords: 0,
      totalEntries: 0,
      totalFixed: 0,
      xp: 0,
      streak: 0,
      bestStreak: 0,
      lastWriteDay: null,
      days: {},
    },
    achievements: [],
    settings: { theme: 'auto', showHints: true, wpmWindow: 30 },
  };
}

let state: SpellForgeState = blankState();
let available = true;

/* ------------------------------------------------------------ persistence */

function save(): void {
  if (!available) return;
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    if (available) {
      available = false;
      console.warn('SpellForge: storage not writable. Progress will not be saved.');
    }
  }
}

function load(): SpellForgeState {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return state;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return state;
    state = merge(blankState(), parsed);
    if (state.schema !== SCHEMA) state.schema = SCHEMA;
  } catch {
    state = blankState();
  }
  return state;
}

/** Recursive defaults merge. Arrays and scalars from `next` win outright. */
function merge(base: SpellForgeState, next: unknown): SpellForgeState {
  if (next === null || next === undefined) return base;
  if (typeof next !== 'object') return base;
  const from = next as Record<string, unknown>;
  const seed = base as unknown as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key in seed) {
    if (Object.prototype.hasOwnProperty.call(seed, key)) out[key] = seed[key];
  }
  for (const key in from) {
    if (!Object.prototype.hasOwnProperty.call(from, key)) continue;
    const bval = seed[key];
    const nval = from[key];
    if (
      typeof bval === 'object' &&
      bval !== null &&
      !Array.isArray(bval) &&
      typeof nval === 'object' &&
      nval !== null &&
      !Array.isArray(nval)
    ) {
      out[key] = merge(bval as SpellForgeState, nval);
    } else {
      out[key] = nval;
    }
  }
  return out as unknown as SpellForgeState;
}

function exportJSON(): string {
  return JSON.stringify(state, null, 2);
}

/* ----------------------------------------------------------------- day key */

/* Local time, not UTC: a streak is about the reader's own days. */
function dayKey(date?: Date): string {
  const d = date || new Date();
  const m = String(d.getMonth() + 1);
  const day = String(d.getDate());
  return (
    d.getFullYear() + '-' + (m.length < 2 ? '0' + m : m) + '-' + (day.length < 2 ? '0' + day : day)
  );
}

function daysBetween(a: string | null, b: string): number | null {
  if (!a || !b) return null;
  const pa = a.split('-');
  const pb = b.split('-');
  const da = Date.UTC(+pa[0], +pa[1] - 1, +pa[2]);
  const db = Date.UTC(+pb[0], +pb[1] - 1, +pb[2]);
  return Math.round((db - da) / 86400000);
}

function todayPlus(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return dayKey(d);
}

/* ---------------------------------------------------------------- entries */

function findEntry(id: string | null | undefined): Entry | undefined {
  if (!id) return undefined;
  return state.entries.find((e) => e.id === id);
}

function newEntry(title: string): Entry {
  const now = Date.now();
  const entry: Entry = {
    id: 'e' + now.toString(36) + Math.random().toString(36).slice(2, 7),
    title: title || '',
    text: '',
    created: now,
    updated: now,
    words: 0,
    findings: [],
  };
  state.entries.push(entry);
  state.activeId = entry.id;
  save();
  return entry;
}

function activeEntry(): Entry {
  if (state.activeId) {
    const existing = findEntry(state.activeId);
    if (existing) return existing;
  }
  return newEntry('Untitled entry');
}

function setActive(id: string): Entry | undefined {
  const hit = findEntry(id);
  if (!hit) return undefined;
  state.activeId = id;
  save();
  return hit;
}

function saveEntry(
  id: string,
  patch: Partial<Pick<Entry, 'title' | 'text' | 'words' | 'findings'>>,
): void {
  const e = findEntry(id);
  if (!e) return;
  if (patch.text !== undefined) e.text = patch.text;
  if (patch.title !== undefined) e.title = patch.title;
  if (patch.words !== undefined) e.words = patch.words;
  if (patch.findings !== undefined) e.findings = patch.findings;
  e.updated = Date.now();
  save();
}

function deleteEntry(id: string): boolean {
  const before = state.entries.length;
  state.entries = state.entries.filter((e) => e.id !== id);
  if (state.entries.length === before) return false;
  if (state.activeId === id) state.activeId = state.entries.length ? state.entries[0].id : null;
  save();
  return true;
}

function searchEntries(q: string): Entry[] {
  const query = q.toLowerCase().trim();
  const match = query
    ? state.entries.filter(
        (e) =>
          (e.title || '').toLowerCase().indexOf(query) !== -1 ||
          (e.text || '').toLowerCase().indexOf(query) !== -1,
      )
    : state.entries.slice();
  return match.sort((a, b) => b.updated - a.updated);
}

/* ------------------------------------------------------------------ words */

function wordRecord(word: string): WordRecord {
  const w = String(word || '').toLowerCase();
  if (!state.words[w]) {
    state.words[w] = {
      word: w,
      correct: null,
      errors: 0,
      fixed: 0,
      learned: false,
      box: 0,
      due: dayKey(),
      first: Date.now(),
      last: 0,
      attempts: 0,
    };
  }
  return state.words[w];
}

function recordMisspelling(bare: string, correction: string | null): void {
  if (!bare) return;
  const rec = wordRecord(bare);
  rec.correct = correction || rec.correct;
  rec.errors++;
  rec.last = Date.now();
  if (rec.learned) {
    rec.learned = false;
    rec.box = 0;
    rec.due = dayKey();
  }
  save();
}

function advance(rec: WordRecord, wasCorrect: boolean): void {
  rec.attempts++;
  if (wasCorrect) {
    rec.box = Math.min(rec.box + 1, LADDER.length - 1);
    if (rec.box >= LADDER.length - 1) {
      rec.learned = true;
      rec.due = '';
    } else {
      rec.due = todayPlus(LADDER[rec.box]);
    }
  } else {
    rec.box = Math.max(rec.box - 2, 0);
    rec.learned = false;
    rec.due = todayPlus(LADDER[Math.max(rec.box, 1)]);
  }
}

/**
 * The reader accepted a correction, so the word climbs the ladder. `wasCorrect`
 * lets the Deck and Drill say no: a word guessed wrong that still advances
 * teaches the opposite of the lesson, and the damage shows up weeks later.
 */
function recordFix(bare: string, correction: string | null, wasCorrect: boolean): void {
  if (!bare) return;
  const rec = wordRecord(bare);
  rec.correct = correction || rec.correct;
  rec.last = Date.now();
  if (wasCorrect) rec.fixed++;
  advance(rec, wasCorrect);
  save();
  checkAchievements();
}

function dueWords(): WordRecord[] {
  const today = dayKey();
  const out: WordRecord[] = [];
  for (const k of Object.keys(state.words)) {
    const rec = state.words[k];
    if (rec.learned || !rec.correct) continue;
    if (!rec.due || rec.due <= today) out.push(rec);
  }
  out.sort((a, b) => {
    if (b.errors !== a.errors) return b.errors - a.errors;
    return (a.last || 0) - (b.last || 0);
  });
  return out;
}

function topProblemWords(n: number): WordRecord[] {
  const out: WordRecord[] = [];
  for (const k of Object.keys(state.words)) {
    if (state.words[k].errors > 0) out.push(state.words[k]);
  }
  out.sort((a, b) => b.errors - a.errors || (a.word < b.word ? -1 : 1));
  return out.slice(0, n || 10);
}

function learnedWords(): WordRecord[] {
  const out: WordRecord[] = [];
  for (const k of Object.keys(state.words)) {
    if (state.words[k].learned) out.push(state.words[k]);
  }
  out.sort((a, b) => (b.last || 0) - (a.last || 0));
  return out;
}

function wordRecords(): WordRecord[] {
  return Object.keys(state.words).map((k) => state.words[k]);
}

function forgetWord(word: string): boolean {
  const w = String(word || '').toLowerCase();
  if (!state.words[w]) return false;
  delete state.words[w];
  save();
  return true;
}

/* ----------------------------------------------------- personal dictionary */

function personalList(): string[] {
  return state.personal.slice();
}

function addPersonal(word: string): boolean {
  const w = String(word || '')
    .toLowerCase()
    .trim();
  if (!w || state.personal.indexOf(w) !== -1) return false;
  state.personal.push(w);
  save();
  return true;
}

function removePersonal(word: string): boolean {
  const w = String(word || '').toLowerCase();
  const before = state.personal.length;
  state.personal = state.personal.filter((x) => x !== w);
  if (state.personal.length === before) return false;
  save();
  return true;
}

/* ------------------------------------------------------------------ stats */

function fixedTotal(): number {
  let n = 0;
  for (const k of Object.keys(state.words)) {
    if (state.words[k].fixed) n += state.words[k].fixed;
  }
  return n;
}

function xpFor(wordCount: number, findingCount: number): number {
  let xp = (wordCount || 0) * 0.4;
  xp += (findingCount || 0) * 8;
  if (wordCount >= 200 && !findingCount) xp += 25;
  return Math.round(xp);
}

/* Word counts arrive as the size of a page, and the page grows as it is
 * written, so only the growth since this entry's last commit is new writing.
 * Without that, every autosave would re-charge the opening paragraph. */
function recordWrite(wordCount: number, findings: readonly unknown[]): void {
  const s = state.stats;
  const today = dayKey();
  const words = Math.max(0, wordCount || 0);
  const entry = findEntry(state.activeId);
  const already = entry ? entry.lastCountedWords || 0 : 0;
  const added = Math.max(0, words - already);
  if (entry) entry.lastCountedWords = Math.max(already, words);

  s.totalWords += added;
  s.days[today] = (s.days[today] || 0) + added;

  /* An entry is counted once, on its first commit; later saves only add the
   * words they actually added. */
  if (entry && !entry.counted) {
    s.totalEntries += 1;
    entry.counted = true;
  }

  s.totalFixed = fixedTotal();

  const gap = daysBetween(s.lastWriteDay, today);
  if (gap === 1) s.streak++;
  else if (gap !== 0) s.streak = 1;
  if (s.streak > s.bestStreak) s.bestStreak = s.streak;
  s.lastWriteDay = today;

  s.xp += xpFor(words, findings.length);
  save();
  checkAchievements();
}

function level(): LevelInfo {
  const xp = state.stats.xp;
  let i = 0;
  for (let n = 0; n < LEVELS.length; n++) if (xp >= LEVELS[n].at) i = n;
  const cur = LEVELS[i];
  const next = LEVELS[i + 1] || null;
  const span = next ? next.at - cur.at : 1;
  const into = xp - cur.at;
  return {
    index: i,
    name: cur.name,
    xp,
    next: next ? next.at : null,
    into,
    span,
    fraction: next ? Math.max(0, Math.min(1, into / span)) : 1,
  };
}

function stats(): Stats {
  return { ...state.stats };
}

function achievementIds(): string[] {
  return state.achievements.slice();
}

function award(id: string): boolean {
  if (state.achievements.indexOf(id) !== -1) return false;
  state.achievements.push(id);
  return true;
}

/** Achievement ids earned by the current state, committed as a side effect. */
function checkAchievements(): string[] {
  const s = state.stats;
  s.totalFixed = fixedTotal();
  const learned = learnedWords().length;
  const gained: string[] = [];
  const maybe = (id: string) => {
    if (award(id)) gained.push(id);
  };

  if (s.totalEntries >= 1) maybe('first-word');
  if (s.totalFixed >= 1) maybe('first-catch');
  if (s.totalFixed >= 50) maybe('fifty-catch');
  if (learned >= 10) maybe('ten-words');
  if (learned >= 50) maybe('fifty-words');
  if (s.bestStreak >= 3) maybe('streak-3');
  if (s.bestStreak >= 7) maybe('streak-7');
  if (s.bestStreak >= 30) maybe('streak-30');
  if (s.totalWords >= 1000) maybe('thousand-words');
  if (s.totalWords >= 10000) maybe('ten-thousand-words');
  if (learned >= 1) maybe('deck-clear');

  if (gained.length) save();
  return gained;
}

/* ---------------------------------------------------------- writing days */

function recentActivity(n: number): Array<{ day: string; words: number; weekday: number }> {
  const out: Array<{ day: string; words: number; weekday: number }> = [];
  const d = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const day = new Date(d.getFullYear(), d.getMonth(), d.getDate() - i);
    const key = dayKey(day);
    out.push({ day: key, words: state.stats.days[key] || 0, weekday: day.getDay() });
  }
  return out;
}

function resetAll(): void {
  state = blankState();
  available = true;
  save();
}

export {
  load,
  save,
  resetAll,
  exportJSON,
  level,
  checkAchievements,
  LEVELS as levelNames,
  ACHIEVEMENTS as achievementList,
  recordMisspelling,
  recordFix,
  recordWrite,
  dueWords,
  learnedWords,
  topProblemWords,
  wordRecords,
  forgetWord,
  stats,
  achievementIds,
  addPersonal,
  removePersonal,
  personalList,
  newEntry,
  activeEntry,
  saveEntry,
  searchEntries,
  deleteEntry,
  setActive,
  recentActivity,
  dayKey,
  state,
  available,
  LADDER,
};
