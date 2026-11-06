/* SpellForge — dictionary loading.
 *
 * The bundled word list and frequency list ship as plain-text assets that a
 * lazy dynamic `?raw` import hands us as one string — LAZY, so ~4.7MB of word
 * lists stays out of the main bundle and only loads when a spell-checking
 * surface (Journal, Spell Forge) first builds its dictionary. This module is
 * the single place where that string becomes a clean array of words, so the
 * checker can never disagree with a test about what the dictionary contains.
 *
 * Line endings are the whole reason this file exists. The lists are edited on
 * Windows, so they arrive with CRLF endings; splitting naively on "\n" leaves
 * a carriage return on every entry and the dictionary silently stops matching
 * real words. Parsing therefore normalises BOM, CRLF, lone CR and LF, and
 * trims each entry before it is trusted.
 */

export interface DictionaryData {
  words: string[];
  freq: string[];
}

let cached: DictionaryData | null = null;

/**
 * Load and parse the bundled dictionary once per session. The dynamic import
 * is what keeps the asset out of the initial bundle: the lists become their
 * own lazy chunk, fetched from disk the first time a checker asks.
 */
export async function loadBundledDictionary(): Promise<DictionaryData> {
  if (cached) return cached;
  const [{ default: wordsRaw }, { default: freqRaw }] = await Promise.all([
    import('../../../assets/dict-words.txt?raw'),
    import('../../../assets/dict-freq.txt?raw'),
  ]);
  cached = { words: parseWordList(wordsRaw), freq: parseWordList(freqRaw) };
  return cached;
}

/** The loaded dictionary, or null before the first loadBundledDictionary(). */
export function getLoadedDictionary(): DictionaryData | null {
  return cached;
}

/**
 * Turn a raw dictionary asset into a clean word list.
 * Strips a UTF-8 BOM, accepts CRLF / CR / LF endings, trims each entry, and
 * drops blank lines. Order is preserved: the frequency list is ranked.
 */
export function parseWordList(raw: string): string[] {
  const text = String(raw ?? '');
  if (!text) return [];
  const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const out: string[] = [];
  for (const line of body.split(/\r\n|\r|\n/)) {
    const word = line.trim();
    if (word) out.push(word);
  }
  return out;
}

export interface DictionaryHealth {
  words: number;
  freq: number;
  /** Entries that still contain whitespace — always 0 after parsing. */
  malformed: number;
  /** True when the word list is big enough to be a real dictionary. */
  plausible: boolean;
}

/**
 * Cheap integrity report for the bundled dictionary, so a corrupted asset is
 * reported as such instead of showing up as "every word is misspelled".
 * Defaults to the lazily loaded dictionary; call after ensureDictionary().
 */
export function dictionaryHealth(data: DictionaryData | null = getLoadedDictionary()): DictionaryHealth {
  if (!data) return { words: 0, freq: 0, malformed: 0, plausible: false };
  let malformed = 0;
  for (let i = 0; i < data.words.length; i++) {
    if (/\s/.test(data.words[i])) malformed++;
  }
  return {
    words: data.words.length,
    freq: data.freq.length,
    malformed,
    plausible: data.words.length > 1000,
  };
}
