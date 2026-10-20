/* SpellForge — text primitives.
 * Tokenising, offsets, capitalisation profiles, and Damerau-Levenshtein.
 * Shared by the spelling engine and the journal's corrector.
 */

/* Letters, plus internal apostrophes and hyphens: "don't", "y'all",
 * "well-written", "anthony's". */
export const TOKEN_RE = /[A-Za-z]+(?:['’ʼ-][A-Za-z]+)*/g;

/* Regions that must not be spell-checked at all: URLs, emails, @handles,
 * #tags, version strings, ordinals. Blanked BEFORE tokenising so every
 * surviving token still carries its offset in the original text. */
const IGNORED_SOURCES = [
  '(?:https?|ftp|ftps|ws|wss|file):\\/\\/[^\\s<>"’”]+',
  '\\b[\\w.+-]+@[\\w-]+(?:\\.[\\w-]+)+\\b',
  '(?:^|(?<=[\\s(]))[@#][\\w./-]+',
  '\\bv?\\d+\\.\\d+(?:\\.\\d+)*\\b',
  '\\b\\d+(?:st|nd|rd|th)\\b',
  '\\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\b',
];
export const IGNORED_RE = new RegExp(IGNORED_SOURCES.join('|'), 'gi');

/* QWERTY adjacency. A substitution to a neighbouring key is almost always
 * what the writer meant; used to break ties between equally-close candidates. */
const KEY_NEIGHBOURS: Record<string, string> = {
  a: 'qwsz', b: 'vghn', c: 'xdfv', d: 'serfcx', e: 'wsdr', f: 'drtgvc',
  g: 'ftyhbv', h: 'gyujnb', i: 'ujko', j: 'huikmn', k: 'jiolm', l: 'kop',
  m: 'njk', n: 'bhjm', o: 'iklp', p: 'ol', q: 'wa', r: 'edft',
  s: 'awedxz', t: 'rfgy', u: 'yhji', v: 'cfgb', w: 'qase', x: 'zsdc',
  y: 'tghu', z: 'asx',
};

export function isAdjacent(a: string, b: string): boolean {
  const row = KEY_NEIGHBOURS[String(a).toLowerCase()];
  return !!row && row.indexOf(String(b).toLowerCase()) !== -1;
}

/** Replace every non-word region with spaces, preserving length. */
export function blankIgnored(text: string): string {
  const str = String(text || '');
  if (!str) return '';
  return str.replace(IGNORED_RE, (m) => m.replace(/[^\n]/g, ' '));
}

export interface Token {
  raw: string;
  start: number;
  end: number;
}

/** Split text into word tokens with their offsets in the original string. */
export function tokenize(text: string): Token[] {
  const out: Token[] = [];
  const str = blankIgnored(text);
  TOKEN_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TOKEN_RE.exec(str)) !== null) {
    out.push({ raw: m[0], start: m.index, end: m.index + m[0].length });
    if (m.index === TOKEN_RE.lastIndex) TOKEN_RE.lastIndex++;
  }
  return out;
}

/** Capitalisation profile, used to decide whether something is a name. */
export function caseProfile(raw: string): 'upper' | 'capital' | 'lower' {
  if (raw.length > 1 && raw === raw.toUpperCase()) return 'upper';
  if (raw.charAt(0) === raw.charAt(0).toUpperCase()) return 'capital';
  return 'lower';
}

export function countWords(text: string): number {
  const blanked = blankIgnored(text);
  const m = blanked.match(/\S+/g);
  return m ? m.length : 0;
}

/**
 * Damerau-Levenshtein (optimal string alignment) with an early exit as soon
 * as a whole row exceeds the budget. Returns -1 when the true distance is
 * greater than maxDist. The transposition term is what makes "teh" cost 1.
 */
export function editDistance(a: string, b: string, maxDist: number): number {
  const la = a.length;
  const lb = b.length;
  if (la === 0) return lb <= maxDist ? lb : -1;
  if (lb === 0) return la <= maxDist ? la : -1;
  if (Math.abs(la - lb) > maxDist) return -1;

  let prev2: number[] | null = null;
  let prev = new Array<number>(lb + 1);
  let cur = new Array<number>(lb + 1);
  for (let j = 0; j <= lb; j++) prev[j] = j;

  for (let i = 1; i <= la; i++) {
    cur[0] = i;
    let rowMin = cur[0];
    const ca = a.charCodeAt(i - 1);
    for (let k = 1; k <= lb; k++) {
      const cb = b.charCodeAt(k - 1);
      const cost = ca === cb ? 0 : 1;
      let v = cur[k - 1] + 1;
      if (prev[k] + 1 < v) v = prev[k] + 1;
      if (prev[k - 1] + cost < v) v = prev[k - 1] + cost;
      if (i > 1 && k > 1 && ca === b.charCodeAt(k - 2) && a.charCodeAt(i - 2) === cb) {
        const t = (prev2 as number[])[k - 2] + 1;
        if (t < v) v = t;
      }
      cur[k] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > maxDist) return -1;
    const spare = prev2;
    prev2 = prev;
    prev = cur;
    cur = spare || new Array<number>(lb + 1);
  }
  const d = prev[lb];
  return d <= maxDist ? d : -1;
}

/** How wrong a word of this length is plausibly meant to be. */
export function maxDistFor(len: number): number {
  if (len <= 3) return 1;
  if (len <= 7) return 2;
  return 3;
}
