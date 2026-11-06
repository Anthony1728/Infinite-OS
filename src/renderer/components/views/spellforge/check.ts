/* SpellForge — the checking facade.
 * One call gives you spelling findings and grammar findings for a piece of
 * text, after making sure the bundled dictionary is built. Both the journal
 * and Spell Forge go through here so they never disagree about a word.
 */
import { loadBundledDictionary } from './dict-loader';
import { analyze, buildDict, type Finding } from './engine';
import { checkGrammar, type GrammarFinding } from './grammar';

export type { Finding, GrammarFinding };

let dictPromise: Promise<boolean> | null = null;
let dictReady = false;

/**
 * Split the bundled lists once and build the lookup structures.
 * The word list is ~370k entries, so this happens exactly once per session
 * and every later call is a resolved promise. The lists themselves arrive
 * via a lazy dynamic import — the first call pays one asset load.
 */
async function build(): Promise<void> {
  if (dictReady) return;
  const { words, freq } = await loadBundledDictionary();
  buildDict(words, freq);
  dictReady = true;
}

export function ensureDictionary(): Promise<boolean> {
  if (!dictPromise) {
    dictPromise = build().then(
      () => true,
      (e) => {
        console.error('Dictionary build failed:', e);
        return false;
      },
    );
  }
  return dictPromise;
}

export function isDictionaryReady(): boolean {
  return dictReady;
}

export interface CheckResult {
  spelling: Finding[];
  grammar: GrammarFinding[];
  unknownWords: Array<{ word: string; count: number }>;
  totalWords: number;
  analysisMs: number;
}

/** Analyse `text`. Must be preceded by ensureDictionary() for spelling. */
export function checkTextSync(text: string, personal: Set<string>): CheckResult {
  const t0 = performance.now();
  const analysis = dictReady ? analyze(text, personal) : null;
  const grammar = checkGrammar(text);
  const total = text.trim() ? text.trim().split(/\s+/).length : 0;
  return {
    spelling: analysis ? analysis.findings : [],
    grammar,
    unknownWords: analysis ? analysis.unknownWords : [],
    totalWords: total,
    analysisMs: Math.round((performance.now() - t0) * 10) / 10,
  };
}

export async function checkText(text: string, personal: Set<string>): Promise<CheckResult> {
  await ensureDictionary();
  return checkTextSync(text, personal);
}

/**
 * Replace every finding that carries a correction, right to left so earlier
 * offsets stay valid. Returns the corrected text and how many spans changed.
 */
export function applyCorrections(
  text: string,
  spans: Array<{ start: number; end: number; correction: string | null }>,
): { text: string; applied: number } {
  const usable = spans
    .filter((s) => s.correction && s.start >= 0 && s.end > s.start)
    .slice()
    .sort((a, b) => b.start - a.start);
  let out = text;
  let applied = 0;
  for (const s of usable) {
    if (s.start > out.length || s.end > out.length) continue;
    if (out.slice(s.start, s.end) === s.correction) continue;
    out = out.slice(0, s.start) + (s.correction as string) + out.slice(s.end);
    applied++;
  }
  return { text: out, applied };
}
