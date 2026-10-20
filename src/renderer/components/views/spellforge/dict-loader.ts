/* SpellForge — dictionary loading.
 *
 * The bundled word list and frequency list ship as plain-text assets that
 * `?raw` hands to us as one string. This module is the single place where
 * that string becomes a clean array of words, so the checker can never
 * disagree with a test about what the dictionary actually contains.
 *
 * Line endings are the whole reason this file exists. The lists are edited on
 * Windows, so they arrive with CRLF endings; splitting naively on "\n" leaves
 * a carriage return on every entry and the dictionary silently stops matching
 * real words. Parsing therefore normalises BOM, CRLF, lone CR and LF, and
 * trims each entry before it is trusted.
 */

import wordsRaw from '../../../assets/dict-words.txt?raw';
import freqRaw from '../../../assets/dict-freq.txt?raw';

export interface DictionaryData {
  words: string[];
  freq: string[];
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

/** Read and clean the dictionary assets that ship with the app. */
export function readBundledDictionary(): DictionaryData {
  return { words: parseWordList(wordsRaw), freq: parseWordList(freqRaw) };
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
 */
export function dictionaryHealth(data: DictionaryData = readBundledDictionary()): DictionaryHealth {
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
