/* SpellForge — spelling engine with analysis, suggestions, and mnemonics.
 * The complete spelling brain: tokenise, detect, suggest, assess.
 */
import {
  tokenize, blankIgnored, editDistance, maxDistFor,
  caseProfile, countWords, isAdjacent,
} from './text';
import { MISSPELLINGS, INFORMAL, TECHNICAL, TRICKY } from './data';

const ALWAYS_OK = new Set<string>();
INFORMAL.forEach((w) => {
  const bare = w.toLowerCase().replace(/['ʼ]/g, '');
  ALWAYS_OK.add(w.toLowerCase());
  ALWAYS_OK.add(bare);
});

const TECH_SET = new Set<string>(TECHNICAL.map((w) => w.toLowerCase()));

const SUGGEST_POOL_RANK = 40000;
let wordIndex = new Map<string, number>();
let poolByLen: string[][] = [];
let maxLen = 0;
let dictReady = false;

const PRONUNCIATION: Record<string, string> = {
  necessary: 'NESS-uh-sair-ee', beautiful: 'BYOO-tih-ful',
  receive: 'rih-SEEV', believe: 'bih-LEEV', achieve: 'uh-CHEEV',
  definitely: 'DEF-uh-nit-lee', separate: 'SEP-uh-rayt',
  dessert: 'di-ZURT', business: 'BIZ-ness', because: 'bee-KUZZ',
  rhythm: 'RITH-um', people: 'PEE-pul', minute: 'MIN-it', wrote: 'ROHT',
  island: 'EYE-lund', colonel: 'KER-nul', choir: 'KWIRE', yacht: 'YOT',
  gauge: 'GAYJ', debt: 'DET', doubt: 'DOWT', subtle: 'SUT-uhl',
  neighbour: 'NAY-bur', laugh: 'LAF', could: 'KUD', great: 'GRATE',
  queue: 'KYOO', sight: 'SYTE', height: 'HYTE', half: 'HAF',
};

function buildDict(words: string[], freq: string[]): void {
  const rankByWord = new Map<string, number>();
  for (let f = 0; f < freq.length; f++) {
    const w = freq[f];
    if (w && !/\s/.test(w) && !rankByWord.has(w)) rankByWord.set(w, f);
  }
  wordIndex = new Map();
  poolByLen = [];
  maxLen = 0;
  const poolRankLimit = SUGGEST_POOL_RANK;
  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    // A dictionary entry must be one bare word. Anything carrying whitespace is
    // a parsing fault (a stray CR from a CRLF asset, a stray space) and is
    // dropped rather than indexed under a key nothing can ever match.
    if (!word || /\s/.test(word)) continue;
    if (wordIndex.has(word)) continue;
    const r = rankByWord.has(word) ? rankByWord.get(word)! : -1;
    wordIndex.set(word, r);
    const len = word.length;
    if (len > maxLen) maxLen = len;
    if (r >= 0 && r < poolRankLimit) {
      if (!poolByLen[len]) poolByLen[len] = [];
      poolByLen[len].push(word);
    }
  }
  dictReady = true;
}

function has(word: string): boolean {
  if (!word) return false;
  return wordIndex.has(word);
}

function hasFlexible(word: string): boolean {
  if (!word) return false;
  const lw = String(word).toLowerCase().replace(/[\u2018\u2019\u02bc\u00b4]/g, "'");
  if (wordIndex.has(lw)) return true;
  if (lw.indexOf("'") !== -1) {
    const stripped = lw.replace(/'/g, '');
    if (wordIndex.has(stripped)) return true;
    if (wordIndex.has(stripped + 's')) return true;
  }
  return false;
}

function freqRank(word: string): number {
  const r = wordIndex.get(word);
  if (r === undefined || r < 0) return Infinity;
  return r;
}

function weight(word: string): number {
  const r = wordIndex.get(word);
  if (r === undefined) return 0;
  if (r < 0) return 0.002;
  return 1 / Math.pow(r + 30, 0.45);
}

function wordsNearLength(len: number, slack: number): string[] {
  const out: string[] = [];
  const lo = Math.max(1, len - slack);
  const hi = Math.min(maxLen, len + slack);
  for (let L = lo; L <= hi; L++) {
    const bucket = poolByLen[L];
    if (bucket) for (let i = 0; i < bucket.length; i++) out.push(bucket[i]);
  }
  return out;
}

function suggest(word: string): Array<{ word: string; dist: number; score: number }> {
  const lw = String(word || '').toLowerCase().replace(/['ʼ]/g, '');
  if (!lw) return [];
  const curated = MISSPELLINGS[lw];
  const curatedHit = curated && curated.split(/\s+/).every((p) => has(p))
    ? { word: curated, dist: 0, score: 1e6 }
    : null;

  const maxDist = maxDistFor(lw.length);
  const candidates = wordsNearLength(lw.length, maxDist);

  let best = 99;
  const out: Array<{ word: string; dist: number; score: number }> = [];
  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    const d = editDistance(lw, c, maxDist);
    if (d < 1) continue;
    if (d < best) best = d;
    out.push(makeCandidate(lw, c, d, weight(c)));
  }

  if (best === 99) return curatedHit ? [curatedHit] : [];

  const filtered = out.filter((c) => c.dist === best);
  filtered.sort((a, b) => b.score - a.score || (a.word < b.word ? -1 : 1));

  const seen = new Set<string>();
  const deduped: Array<{ word: string; dist: number; score: number }> = [];
  if (curatedHit) { seen.add(curatedHit.word); deduped.push(curatedHit); }
  for (let j = 0; j < filtered.length && deduped.length < 5; j++) {
    if (seen.has(filtered[j].word)) continue;
    seen.add(filtered[j].word); deduped.push(filtered[j]);
  }
  return deduped;
}

function makeCandidate(typed: string, cand: string, dist: number, wt: number): { word: string; dist: number; score: number } {
  let score = wt * 1000;
  const lenDiff = Math.abs(typed.length - cand.length);
  score += lenDiff === 0 ? 6 : -(lenDiff - 1) * 12;
  if (typed.charAt(0) !== cand.charAt(0)) score -= 30;
  if (typed.charAt(typed.length - 1) === cand.charAt(cand.length - 1)) score += 14;
  else if (dist === 1) score -= 14;
  score += keyboardBonus(typed, cand, dist);
  score += englishBonus(typed, cand);
  return { word: cand, dist, score };
}

function keyboardBonus(typed: string, cand: string, dist: number): number {
  if (dist === 1) {
    if (typed.length === cand.length) {
      let adjacent = 0;
      for (let i = 0; i < typed.length; i++) {
        if (typed[i] !== cand[i] && isAdjacent(typed[i], cand[i])) adjacent++;
      }
      if (adjacent === 1) return 18;
      return 0;
    }
    if (cand.indexOf(typed) !== -1 || typed.indexOf(cand) !== -1) return 14;
    return 0;
  }
  if (dist === 2 && typed.length === cand.length) {
    let d2 = 0, a2 = 0;
    for (let k = 0; k < typed.length; k++) {
      if (typed[k] !== cand[k]) { d2++; if (isAdjacent(typed[k], cand[k])) a2++; }
    }
    if (d2 === 2 && a2 === 2) return 16;
  }
  return 0;
}

function englishBonus(typed: string, cand: string): number {
  let b = 0;
  if (/ei/.test(typed) && /ie/.test(cand)) b += 22;
  if (cand.length === typed.length + 1 && cand.slice(-1) === 'e' && cand.slice(0, -1) === typed) b += 20;
  if (typed.length === cand.length + 1) {
    const d = typed[cand.length];
    if (d === typed[cand.length - 1] && 'lfsz'.indexOf(d) !== -1) b += 12;
  }
  if (/ible$/.test(cand) && /able$/.test(typed)) b += 18;
  if (/able$/.test(cand) && /ible$/.test(typed)) b += 18;
  return b;
}

function syllabify(word: string): string[] {
  const w = String(word).toLowerCase().replace(/[^a-z]/g, '');
  if (!w) return [];
  const out: string[] = [];
  let i = 0;
  const vowels = 'aeiouy';
  while (i < w.length) {
    const start = i;
    while (i < w.length && vowels.indexOf(w[i]) === -1) i++;
    if (i === w.length) {
      const tail = w.slice(start);
      if (out.length) out[out.length - 1] += tail;
      else out.push(tail);
      break;
    }
    while (i < w.length && vowels.indexOf(w[i]) !== -1) i++;
    if (i === w.length - 1 && w[i] === 'e' && i - start > 1) i--;
    const piece = w.slice(start, i);
    if (piece) out.push(piece);
  }
  return out.length ? out : [w];
}

function mnemonic(word: string): string {
  const w = String(word || '').toLowerCase();
  if (!w) return '';
  const parts: string[] = [];
  const syl = syllabify(w);
  if (syl.length > 1) parts.push(syl.length + ' syllables');
  const dbl = w.match(/(.)\1/g);
  if (dbl) {
    const uniq = new Set<string>();
    dbl.forEach((d) => uniq.add(d));
    parts.push('double ' + [...uniq].join(' and '));
  }
  if (w.length > 3 && w.slice(-1) === 'e' && !/[aeiou]e$/.test(w)) parts.push('silent final e');
  if (w.length > 2 && w.charAt(0) === 'y') parts.push('starts with y');
  if (/[aeiou]{2}/.test(w)) parts.push('double vowel');
  if (!parts.length) parts.push('one syllable');
  return parts.join(' · ');
}

function phonetic(word: string): string {
  const w = String(word || '').toLowerCase();
  if (PRONUNCIATION[w]) return PRONUNCIATION[w];
  return syllabify(w).join('-').toUpperCase();
}

function pluralHint(w: string): string {
  if (/[^aeiou]y$/.test(w)) return 'plural: ' + w.slice(0, -1) + 'ies';
  if (/(s|x|z|ch|sh)$/.test(w)) return 'plural: ' + w + 'es';
  if (/[^f]fe$/.test(w)) return 'plural: ' + w.slice(0, -2) + 'ves';
  if (/[^f]f$/.test(w)) return 'plural: ' + w + 'ves';
  if (/[^aeiou]o$/.test(w)) return 'plural: ' + w + 'es';
  if (/[^s]s$/.test(w)) return 'plural: ' + w + 'es';
  return '';
}

function expectedCase(sourceRaw: string, target: string): string {
  if (caseProfile(sourceRaw) === 'capital') {
    return target.charAt(0).toUpperCase() + target.slice(1);
  }
  return target;
}

/* Full analysis of a document */
export interface Finding {
  raw: string; bare: string; start: number; end: number;
  profile: string; source: string; confidence: number;
  suggestions: Array<{ word: string; dist: number; score: number }>;
  correction: string | null; count: number; occurrences: number[];
}

function isReportable(bare: string, top: { word: string; dist: number; score: number }, sugs: Array<{ word: string; dist: number; score: number }>, profile: string): boolean {
  const rank = freqRank(top.word);
  const len = bare.length;
  if (profile === 'capital' && !(top.dist === 1 && rank <= 2000)) return false;
  if (len >= 12 && rank > 6000) return false;
  if (len >= 8 && rank > 20000) return false;
  if (top.dist === 1) return rank <= 40000;
  if (top.dist === 2) return rank <= 20000;
  if (top.dist >= 3) {
    if (rank > 8000) return false;
    if (top.word.length === bare.length) return false;
    if (sugs.length > 1 && top.score - sugs[1].score < 25) return false;
  }
  return true;
}

function inPersonal(word: string, personal: Set<string> | null | undefined): boolean {
  if (!personal || personal.size === 0) return false;
  return personal.has(word);
}

function assessToken(tok: { raw: string; start: number; end: number }, personal: Set<string>): Finding | null {
  const raw = tok.raw;
  const lw = raw.toLowerCase().replace(/['ʼ]/g, "'");
  const bare = lw.replace(/'/g, '');
  const profile = caseProfile(raw);

  if (bare.length < 3) return null;
  if (profile === 'upper') return null;
  if (/[a-z][A-Z]/.test(raw)) return null;
  /* Words the writer has added to their own dictionary are always correct. */
  if (inPersonal(lw, personal) || inPersonal(bare, personal)) return null;
  if (ALWAYS_OK.has(lw) || ALWAYS_OK.has(bare)) return null;

  const curated = MISSPELLINGS[bare];
  if (curated && curated.split(/\s+/).every((p) => has(p))) {
    return {
      raw, bare, start: tok.start, end: tok.end,
      profile, source: 'curated', confidence: 1,
      suggestions: [{ word: curated, dist: 0, score: 1e6 }],
      correction: curated, count: 1, occurrences: [tok.start],
    };
  }

  if (hasFlexible(lw)) return null;
  if (ALWAYS_OK.has(bare) || TECH_SET.has(bare)) return null;
  if (raw.indexOf('-') !== -1) return null;

  const sugs = suggest(bare);
  if (!sugs.length) return null;
  const top = sugs[0];
  if (!isReportable(bare, top, sugs, profile)) return null;

  const confidence = top.dist === 1 ? 0.92 : top.dist === 2 ? 0.78 : 0.55;
  return {
    raw, bare, start: tok.start, end: tok.end,
    profile, source: 'unknown', confidence,
    suggestions: sugs, correction: top.word,
    count: 1, occurrences: [tok.start],
  };
}

function analyze(text: string, personal: Set<string>): {
  words: number; totalWords: number; findings: Finding[];
  unknownWords: Array<{ word: string; count: number }>; analysisMs: number;
} {
  const t0 = performance.now();
  const toks = tokenize(text);
  const byWord = new Map<string, Finding>();
  const findings: Finding[] = [];
  const unknowns = new Map<string, number>();

  for (let k = 0; k < toks.length; k++) {
    const f = assessToken(toks[k], personal);
    if (f) {
      const key = f.bare;
      const existing = byWord.get(key);
      if (existing) {
        existing.count++;
        if (f.source === 'curated') existing.source = 'curated';
        if (existing.occurrences.length < 200) existing.occurrences.push(f.start);
        continue;
      }
      byWord.set(key, f);
      findings.push(f);
      continue;
    }
    const t = toks[k].raw;
    if (caseProfile(t) !== 'lower') continue;
    if (t.length < 4 || t.length > 24) continue;
    if (t.indexOf('-') !== -1) continue;
    const b = t.toLowerCase().replace(/['ʼ]/g, '').replace(/'/g, '');
    if (ALWAYS_OK.has(b) || TECH_SET.has(b)) continue;
    if (inPersonal(b, personal)) continue;
    if (hasFlexible(b)) continue;
    unknowns.set(b, (unknowns.get(b) || 0) + 1);
  }

  const unknownWords: Array<{ word: string; count: number }> = [];
  unknowns.forEach((count, word) => { unknownWords.push({ word, count }); });
  unknownWords.sort((a, b) => b.count - a.count || (a.word < b.word ? -1 : 1));

  return {
    words: toks.length,
    totalWords: countWords(text),
    findings,
    unknownWords,
    analysisMs: Math.round((performance.now() - t0) * 10) / 10,
  };
}

function clearCache(): void { /* no-op for now */ }

export {
  buildDict, has, hasFlexible, freqRank, weight, wordsNearLength,
  suggest, makeCandidate, editDistance, maxDistFor,
  tokenize, blankIgnored, caseProfile, countWords,
  assessToken, analyze, isReportable,
  mnemonic, phonetic, pluralHint, expectedCase,
  ALWAYS_OK, syllabify,
  clearCache,
  PRONUNCIATION, TRICKY,
  dictReady, getMaxLen as maxLen,
};

function getMaxLen(): number { return maxLen; }
