/* SpellForge — dictionary integrity and spell-check behaviour.
 *
 * The word list is bundled as a CRLF text asset. These tests exist because a
 * parsing slip there is invisible: the app still runs, still renders, and just
 * quietly reports that every ordinary English word is misspelled.
 */
import { describe, expect, it, beforeAll } from 'vitest';
import { dictionaryHealth, parseWordList, readBundledDictionary } from './dict-loader';
import { applyCorrections, checkTextSync, ensureDictionary, isDictionaryReady } from './check';
import { has } from './engine';

beforeAll(async () => {
  await ensureDictionary();
});

describe('dictionary parsing', () => {
  it('strips carriage returns from CRLF assets', () => {
    expect(parseWordList('the\r\nand\r\nbut\r\n')).toEqual(['the', 'and', 'but']);
  });

  it('accepts lone CR and lone LF endings', () => {
    expect(parseWordList('one\rtwo\nthree')).toEqual(['one', 'two', 'three']);
  });

  it('drops a UTF-8 BOM, blank lines and stray padding', () => {
    expect(parseWordList('\ufeffthe\r\n\r\n  and  \r\n\t\r\n')).toEqual(['the', 'and']);
  });

  it('returns nothing for an empty asset', () => {
    expect(parseWordList('')).toEqual([]);
    expect(parseWordList(undefined as unknown as string)).toEqual([]);
  });
});

describe('bundled dictionary', () => {
  it('parses into a plausible word list with no malformed entries', () => {
    const health = dictionaryHealth();
    expect(health.malformed).toBe(0);
    expect(health.plausible).toBe(true);
    expect(health.words).toBeGreaterThan(100_000);
    expect(health.freq).toBeGreaterThan(10_000);
  });

  it('contains no carriage returns in any entry', () => {
    const { words, freq } = readBundledDictionary();
    expect(words.some((w) => w.includes('\r'))).toBe(false);
    expect(freq.some((w) => w.includes('\r'))).toBe(false);
  });

  it('indexes ordinary English words after the build', () => {
    expect(isDictionaryReady()).toBe(true);
    for (const word of ['the', 'and', 'because', 'spelling', 'necessary', 'rhythm', 'business']) {
      expect(has(word)).toBe(true);
    }
  });

  it('ranks the frequency list in order', () => {
    const { freq } = readBundledDictionary();
    expect(freq[0]).toBe('you');
    expect(freq.indexOf('the')).toBeLessThan(freq.indexOf('zebra') === -1 ? Infinity : freq.indexOf('zebra'));
  });
});

describe('spell checking', () => {
  it('reports nothing for a correctly spelled sentence', () => {
    const result = checkTextSync('The quick brown fox jumps over the lazy dog because it was necessary.', new Set());
    expect(result.spelling).toEqual([]);
  });

  it('reports nothing for ordinary prose with tricky words', () => {
    const text = 'I wrote a rhythm guide for my business because the schedule was tight.';
    expect(checkTextSync(text, new Set()).spelling).toEqual([]);
  });

  it('stays quiet across everyday registers and proper nouns', () => {
    const samples = [
      'The committee agreed to postpone the decision until the following morning, when the revised figures should be available.',
      'Hey, can you pick up milk on the way home? I also need to send you the file before the meeting starts tomorrow.',
      'The renderer caches the parsed dictionary so the main thread is not blocked while the spell engine builds its lookup tables.',
      'Marcus visited Kyoto in March, then flew to Zurich before heading home to Manchester.',
    ];
    for (const text of samples) {
      expect(checkTextSync(text, new Set()).spelling).toEqual([]);
    }
  });

  it('catches a transposed letter and offers the real word', () => {
    const result = checkTextSync('I recieve the package on tuesday.', new Set());
    const finding = result.spelling.find((f) => f.bare === 'recieve');
    expect(finding).toBeDefined();
    expect(finding?.correction).toBe('receive');
  });

  it('catches a doubled missing letter', () => {
    const result = checkTextSync('I beleive the schedule is fine.', new Set());
    expect(result.spelling.map((f) => f.bare)).toContain('beleive');
  });

  it('leaves URLs, emails and versions alone', () => {
    const text = 'See https://example.com/docs or mail a@b.co about v1.2.3.';
    expect(checkTextSync(text, new Set()).spelling).toEqual([]);
  });

  it('treats a personal dictionary word as correct', () => {
    const result = checkTextSync('Zzyzx quux wobble.', new Set(['zzyzx', 'quux', 'wobble']));
    expect(result.spelling).toEqual([]);
  });

  it('returns the unknown-word list it used to drop on the floor', () => {
    const result = checkTextSync('zzzqqq wxvyut qqqzzz.', new Set());
    const words = result.unknownWords.map((u) => u.word);
    expect(words).toEqual(expect.arrayContaining(['zzzqqq', 'wxvyut', 'qqqzzz']));
  });

  it('keeps personal dictionary words out of the unknown list', () => {
    const result = checkTextSync('zzzqqq wxvyut.', new Set(['zzzqqq']));
    expect(result.unknownWords.map((u) => u.word)).toContain('wxvyut');
    expect(result.unknownWords.map((u) => u.word)).not.toContain('zzzqqq');
  });
});

describe('apply corrections', () => {
  it('replaces spans right to left without shifting earlier offsets', () => {
    // 'recieve the recieve' — the two misspellings sit at 0-7 and 12-19.
    const { text, applied } = applyCorrections('recieve the recieve', [
      { start: 0, end: 7, correction: 'receive' },
      { start: 12, end: 19, correction: 'receive' },
    ]);
    expect(text).toBe('receive the receive');
    expect(applied).toBe(2);
  });

  it('skips findings with no correction', () => {
    const { text, applied } = applyCorrections('hello world', [
      { start: 0, end: 5, correction: null },
    ]);
    expect(text).toBe('hello world');
    expect(applied).toBe(0);
  });

  it('ignores spans that fall outside the text', () => {
    const { text, applied } = applyCorrections('hi', [
      { start: 40, end: 45, correction: 'nope' },
    ]);
    expect(text).toBe('hi');
    expect(applied).toBe(0);
  });
});
