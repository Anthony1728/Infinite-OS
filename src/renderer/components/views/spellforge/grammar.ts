/* SpellForge — grammar rules.
 * A deliberately conservative set: every rule here is either a mechanical
 * mistake (double word, missing space) or a homophone swap with a short
 * allowlist of exceptions. Anything that needs real parsing is left out
 * rather than guessed at, because a wrong correction teaches the wrong thing.
 *
 * Each finding carries the lesson that explains WHY it is wrong, so the
 * journal can turn any correction into a future teaching moment.
 */
import { caseProfile, tokenize } from './text';

export type Severity = 'high' | 'medium' | 'low';

export interface GrammarFinding {
  ruleId: string;
  title: string;
  category: string;
  why: string;
  severity: Severity;
  start: number;
  end: number;
  found: string;
  correction: string;
  count: number;
  occurrences: number[];
}

/* ------------------------------------------------------------------ rules */

interface Rule {
  id: string;
  title: string;
  category: string;
  why: string;
  severity: Severity;
  re: RegExp;
  replace: (m: RegExpExecArray) => string;
  skip?: (m: RegExpExecArray, text: string) => boolean;
}

/* Words that make "had had" / "that that" legal, so a blanket repeated-word
 * rule would nag correct writing. */
const REPEAT_OK = new Set(['had', 'that', 'no', 'so', 'very', 'only', 'ha', 'blah']);

/* Abbreviations that legitimately end a fragment before a lowercase word. */
const ABBREV_OK = new Set([
  'etc', 'e.g', 'eg', 'i.e', 'ie', 'vs', 'cf', 'approx', 'inc', 'ltd',
  'dept', 'dr', 'mr', 'mrs', 'ms', 'st', 'no', 'jr', 'sr', 'ca', 'al',
]);

/**
 * Lower-cased, apostrophe-stripped token -> the form the writer meant.
 * The canonical text is what should appear in the note, so it carries its own
 * capitalisation ("I'm", not "im").
 */
export const CONTRACTIONS: Record<string, string> = {
  im: "I'm", ive: "I've",
  youre: "you're", youve: "you've",
  theyre: "they're", theyve: "they've",
  weve: "we've",
  dont: "don't", doesnt: "doesn't", didnt: "didn't",
  isnt: "isn't", wasnt: "wasn't", arent: "aren't", werent: "weren't",
  hasnt: "hasn't", havent: "haven't", hadnt: "hadn't",
  wouldnt: "wouldn't", couldnt: "couldn't", shouldnt: "shouldn't",
  mustnt: "mustn't", neednt: "needn't",
  thats: "that's", whats: "what's", wheres: "where's", heres: "here's",
  theres: "there's",
};

function applyCase(raw: string, canonical: string): string {
  const profile = caseProfile(raw);
  if (profile === 'upper') return canonical.toUpperCase();
  if (profile === 'capital') return canonical.charAt(0).toUpperCase() + canonical.slice(1);
  return canonical;
}

const RULES: Rule[] = [
  {
    id: 'double-word',
    title: 'Repeated word',
    category: 'Word choice',
    why: 'The same word appears twice in a row — almost always a typing slip. Reading the sentence aloud usually exposes it.',
    severity: 'high',
    re: /\b([A-Za-z]{3,})[ \t]+\1\b/g,
    replace: (m) => m[1],
    skip: (m) => REPEAT_OK.has(m[1].toLowerCase()) || caseProfile(m[1]) !== 'lower',
  },
  {
    id: 'of-instead-of-have',
    title: '"of" instead of "have"',
    category: 'Grammar',
    why: '"Could of" is what "could’ve" sounds like out loud. The verb is "have", never "of" — "of" only works as a preposition.',
    severity: 'high',
    re: /\b(could|should|would|must|may|might)([ \t]+)of\b/gi,
    replace: (m) => m[1] + m[2] + 'have',
  },
  {
    id: 'then-instead-of-than',
    title: '"then" instead of "than"',
    category: 'Word choice',
    why: '"Than" compares things (bigger than, rather than). "Then" places things in time (first this, then that).',
    severity: 'high',
    re: /\b(more|less|other|rather|better|worse|greater|smaller|bigger)([ \t]+)then\b/gi,
    replace: (m) => m[1] + m[2] + 'than',
  },
  {
    id: 'their-is',
    title: '"their" instead of "there"',
    category: 'Word choice',
    why: '"Their" shows possession (their car). "There" points at a place or fills the "there is" slot.',
    severity: 'high',
    re: /\btheir([ \t]+)(is|are|was|were|have|has|had|will|would|can|could|should|must)\b/gi,
    replace: (m) => 'there' + m[1] + m[2],
  },
  {
    id: 'there-possessive',
    title: '"there" instead of "their"',
    category: 'Word choice',
    why: '"There" is a place. When something belongs to people, it is "their".',
    severity: 'high',
    re: /\bthere([ \t]+)(own|house|car|name|parents|friends|mom|mum|dad|team|turn|job|idea|phone|houses|cars)\b/gi,
    replace: (m) => 'their' + m[1] + m[2],
  },
  {
    id: 'theyre-possessive',
    title: '"they\'re" instead of "their"',
    category: 'Word choice',
    why: '"They\'re" always means "they are". A possessive needs "their".',
    severity: 'high',
    re: /\bthey're([ \t]+)(own|house|car|name|parents|friends|mom|mum|dad|team|turn|job|idea|phone)\b/gi,
    replace: (m) => 'their' + m[1] + m[2],
  },
  {
    id: 'your-welcome',
    title: '"your" instead of "you\'re"',
    category: 'Word choice',
    why: 'The reply to "thank you" is "you\'re welcome" — you are welcome. "Your" always owns something that comes after it.',
    severity: 'high',
    re: /\byour([ \t]+)welcome\b/gi,
    replace: (m) => "you're" + m[1] + 'welcome',
  },
  {
    id: 'space-before-punctuation',
    title: 'Space before punctuation',
    category: 'Punctuation',
    why: 'A comma, full stop or question mark belongs to the word in front of it — no space goes before it in English.',
    severity: 'medium',
    re: /[ \t]+([,.;:!?])/g,
    replace: (m) => m[1],
  },
  {
    id: 'missing-space-after-comma',
    title: 'Missing space after punctuation',
    category: 'Punctuation',
    why: 'English puts one space after a comma, colon, semicolon or exclamation mark before the next word starts.',
    severity: 'medium',
    re: /([,;:!?])([A-Za-z])/g,
    replace: (m) => m[1] + ' ' + m[2],
  },
  {
    id: 'missing-space-after-period',
    title: 'Missing space after a full stop',
    category: 'Punctuation',
    why: 'A full stop ends the sentence, so the next sentence starts after a space — and usually a capital letter.',
    severity: 'medium',
    re: /([a-z])\.([A-Z])/g,
    replace: (m) => m[1] + '. ' + m[2],
  },
  {
    id: 'double-space',
    title: 'Double space',
    category: 'Punctuation',
    why: 'Two spaces between words are left over from typewriter habit. One space keeps the line even.',
    severity: 'low',
    re: /([^\s])[ \t]{2,}(?=[^\s])/g,
    replace: (m) => m[1] + ' ',
  },
  {
    id: 'lowercase-i',
    title: 'Lowercase "i"',
    category: 'Grammar',
    why: 'The English pronoun "I" is always a capital letter — it is the only word in English that is.',
    severity: 'high',
    re: /(^|[\s("'])i([\s.,!?'’]|$)/g,
    replace: (m) => m[1] + 'I' + m[2],
  },
];

/* ------------------------------------------------------------------ check */

function pushMatch(out: GrammarFinding[], rule: Rule, m: RegExpExecArray): void {
  const correction = rule.replace(m);
  const found = m[0];
  if (correction === found) return;
  const start = m.index;
  const end = start + found.length;
  const existing = out.find(
    (f) => f.ruleId === rule.id && f.found.toLowerCase() === found.toLowerCase(),
  );
  if (existing) {
    existing.count++;
    if (existing.occurrences.length < 200) existing.occurrences.push(start);
    return;
  }
  out.push({
    ruleId: rule.id,
    title: rule.title,
    category: rule.category,
    why: rule.why,
    severity: rule.severity,
    start,
    end,
    found,
    correction,
    count: 1,
    occurrences: [start],
  });
}

/**
 * Run every rule over `text` and return the findings, sorted by position.
 * Spans never overlap: once a region is claimed by a rule, later rules skip it.
 */
export function checkGrammar(text: string): GrammarFinding[] {
  const src = String(text || '');
  if (!src) return [];
  const raw: GrammarFinding[] = [];

  for (const rule of RULES) {
    rule.re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = rule.re.exec(src)) !== null) {
      if (rule.skip && rule.skip(m, src)) continue;
      pushMatch(raw, rule, m);
      if (m[0].length === 0) rule.re.lastIndex++;
    }
  }

  /* Missing apostrophes: only flag a token when the corrected form differs
   * from what was typed once capitalisation is respected. */
  for (const tok of tokenize(src)) {
    const bare = tok.raw.toLowerCase().replace(/['’]/g, '');
    const canonical = CONTRACTIONS[bare];
    if (!canonical) continue;
    const expected = applyCase(tok.raw, canonical);
    if (expected === tok.raw) continue;
    const found = tok.raw;
    const existing = raw.find(
      (f) => f.ruleId === 'contraction' && f.found.toLowerCase() === found.toLowerCase(),
    );
    if (existing) {
      existing.count++;
      if (existing.occurrences.length < 200) existing.occurrences.push(tok.start);
      continue;
    }
    raw.push({
      ruleId: 'contraction',
      title: 'Missing apostrophe',
      category: 'Punctuation',
      why: 'Contractions are short for two words ("do not" → "don\'t"), and that missing letter is marked with an apostrophe.',
      severity: 'high',
      start: tok.start,
      end: tok.end,
      found,
      correction: expected,
      count: 1,
      occurrences: [tok.start],
    });
  }

  /* Sentence capitalisation: after . ! ? + space, a lowercase word begins
   * the next sentence. Skipped when what follows a full stop is a known
   * abbreviation or a single letter (initials, "U.S."). */
  const sentenceRe = /([.!?][\s"'])([a-z])[^\s]*/g;
  let sm: RegExpExecArray | null;
  while ((sm = sentenceRe.exec(src)) !== null) {
    const after = sm[0].slice(sm[1].length);
    const word = after.split(/[^A-Za-z']/)[0] || '';
    const before = src.slice(Math.max(0, sm.index - 12), sm.index).split(/[\s.!?]+/).filter(Boolean).pop() || '';
    if (ABBREV_OK.has(before.toLowerCase())) continue;
    if (word.length < 2) continue;
    const start = sm.index + sm[1].length;
    const end = start + after.length;
    if (raw.some((f) => f.start < end && start < f.end)) continue;
    raw.push({
      ruleId: 'sentence-case',
      title: 'Start the sentence with a capital',
      category: 'Capitalisation',
      why: 'Every sentence starts with a capital letter. It tells the reader where one thought ends and the next begins.',
      severity: 'medium',
      start,
      end,
      found: after,
      correction: after.charAt(0).toUpperCase() + after.slice(1),
      count: 1,
      occurrences: [start],
    });
  }

  /* Drop any span that overlaps an earlier, higher-priority span. */
  raw.sort((a, b) => a.start - b.start || b.severity.length - a.severity.length);
  const kept: GrammarFinding[] = [];
  for (const f of raw) {
    if (kept.some((k) => k.start < f.end && f.start < k.end)) continue;
    kept.push(f);
  }
  return kept;
}

/** Categories shown as chips in the journal's issue panel. */
export const GRAMMAR_CATEGORIES = ['Word choice', 'Grammar', 'Punctuation', 'Capitalisation'];
