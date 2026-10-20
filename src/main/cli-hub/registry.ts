import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The catalogue of agent-native CLIs, from HKUDS/CLI-Anything.
 *
 * This is the piece that decides what "Infinite AI can operate" actually means.
 *
 * The agent could already run any shell command. What it could not do was find
 * out *which* software had a proper command-line interface, install one, and
 * learn how to drive it. That is the difference between an agent that can only
 * click and one that can drive GIMP, Blender, LibreOffice, Obsidian, Calibre,
 * n8n and the rest properly — with structured JSON output and an undo history,
 * instead of screen-scraping a window that may not even be in the same place
 * twice.
 *
 * So this is a catalogue, not an implementation. It reads the upstream
 * registry, which is the single source of truth for the install command and the
 * entry point of each CLI, and never guesses them. Inventing an entry point
 * would produce an agent that confidently reports success on a command that was
 * never run.
 */

const REGISTRY_URL =
  'https://raw.githubusercontent.com/HKUDS/CLI-Anything/main/registry.json';

/** One installable CLI, exactly as the upstream registry describes it. */
export interface CliHubEntry {
  name: string;
  display_name: string;
  version?: string;
  description?: string;
  /** What the user must already have. Reported, never installed. */
  requires?: string;
  homepage?: string;
  source_url?: string | null;
  /** The literal command that installs it. Run verbatim; never rewritten. */
  install_cmd?: string;
  /** The command to run once installed. */
  entry_point?: string;
  skill_md?: string;
  category?: string;
  contributors?: { name: string; url?: string }[];
}

export interface CliHubRegistry {
  meta?: { repo?: string; description?: string; updated?: string };
  clis: CliHubEntry[];
}

export interface CliHubCache {
  fetchedAt: number;
  registry: CliHubRegistry;
}

/**
 * How long a fetched catalogue is trusted.
 *
 * Long enough that opening the agent does not re-fetch, short enough that a
 * catalogue that has gained new entries is not months out of date. The upstream
 * registry changes on the order of weekly.
 */
const TTL_MS = 24 * 60 * 60 * 1000;

/** Never wait longer than this on the network. Slow must not become hanging. */
const FETCH_TIMEOUT_MS = 8000;

/**
 * Keep only what the tool needs.
 *
 * The upstream entries carry contributor lists and homepages that would bloat
 * every model response. Everything here is something an agent might act on.
 */
export function toEntry(raw: Record<string, unknown>): CliHubEntry | null {
  const name = typeof raw.name === 'string' ? raw.name.trim() : '';
  if (!name) return null;
  const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v : undefined);
  return {
    name,
    display_name: str(raw.display_name) ?? name,
    version: str(raw.version),
    description: str(raw.description),
    requires: str(raw.requires),
    homepage: str(raw.homepage),
    source_url: str(raw.source_url),
    install_cmd: str(raw.install_cmd),
    entry_point: str(raw.entry_point),
    skill_md: str(raw.skill_md),
    category: str(raw.category),
  };
}

/**
 * Parse the upstream document, tolerating its two known shapes.
 *
 * It is documented as `{ meta, clis }`, but a bare array is also accepted —
 * a catalogue is the thing that matters here, not which wrapper it arrived in,
 * and failing the whole lookup over a wrapper would be a pointless outage.
 */
export function parseRegistry(text: string): CliHubRegistry {
  const parsed: unknown = JSON.parse(text);
  const rows = Array.isArray(parsed)
    ? parsed
    : Array.isArray((parsed as { clis?: unknown })?.clis)
      ? ((parsed as { clis: unknown[] }).clis as unknown[])
      : [];
  const clis = rows
    .filter((r): r is Record<string, unknown> => Boolean(r) && typeof r === 'object')
    .map(toEntry)
    .filter((e): e is CliHubEntry => e !== null);
  return {
    ...(Array.isArray(parsed) ? {} : { meta: (parsed as { meta?: CliHubRegistry['meta'] }).meta }),
    clis,
  };
}

/**
 * Words people use to ask for a thing, mapped to words the registry uses.
 *
 * This is the difference between a catalogue that works and one that does not.
 * The registry is written in product language — "Image editing", "3D
 * modelling", "Office suite" — while a user asks in task language: "edit a
 * photo", "make a video", "read a spreadsheet". A plain substring search finds
 * nothing for "photo", because the word "photo" does not appear in GIMP's
 * description. Without this map the search works only for people who already
 * know which product they want, which is the one case that needs no help.
 *
 * Deliberately small and task-shaped rather than an attempt at a thesaurus.
 * Every group is checked against name, display name, description and category,
 * so a synonym only has to be plausible, not exhaustive.
 */
const TASK_SYNONYMS: Record<string, string[]> = {
  photo: ['image', 'picture', 'photo', 'gimp', 'retouch', 'crop', 'filter', 'layer'],
  picture: ['image', 'photo', 'picture'],
  image: ['image', 'photo', 'picture', 'gimp', 'raster', 'bitmap'],
  // Krita's own description says "Digital painting"; a user says "paint".
  paint: ['paint', 'painting', 'krita', 'brush', 'draw', 'canvas'],
  sketch: ['sketch', 'drawing', 'draw', 'inkscape', 'vector'],
  draw: ['draw', 'drawing', 'diagram', 'drawio', 'mermaid', 'sketch'],
  vector: ['vector', 'svg', 'inkscape', 'graphics'],
  crop: ['crop', 'resize', 'layer', 'image', 'gimp'],
  video: ['video', 'encode', 'transcode', 'subtitle', 'stream', 'shotcut', 'kdenlive', 'obs', 'record'],
  film: ['video', 'movie', 'edit', 'shotcut', 'kdenlive'],
  audio: ['audio', 'sound', 'music', 'record', 'wavetone', 'audacity', 'musescore', 'wave'],
  sound: ['audio', 'sound', 'music', 'record', 'audacity'],
  music: ['music', 'audio', 'score', 'musescore'],
  pdf: ['pdf', 'document', 'docbook', 'office', 'libreoffice'],
  document: ['document', 'docbook', 'office', 'libreoffice', 'note'],
  doc: ['document', 'docbook', 'office', 'libreoffice'],
  spreadsheet: ['spreadsheet', 'office', 'libreoffice', 'csv', 'table'],
  excel: ['spreadsheet', 'office', 'libreoffice', 'csv'],
  slide: ['presentation', 'office', 'libreoffice', 'deck'],
  presentation: ['presentation', 'office', 'libreoffice', 'slide', 'deck'],
  book: ['book', 'ebook', 'calibre', 'library', 'read', 'metadata'],
  ebook: ['book', 'ebook', 'calibre', 'library'],
  library: ['book', 'ebook', 'calibre', 'library', 'library'],
  note: ['note', 'notes', 'obsidian', 'joplin', 'zotero', 'knowledge', 'notebook'],
  notebook: ['note', 'notes', 'obsidian', 'joplin', 'knowledge'],
  journal: ['note', 'notes', 'obsidian', 'joplin', 'knowledge'],
  wiki: ['note', 'knowledge', 'obsidian', 'joplin', 'siyuan', 'note-taking'],
  research: ['note', 'knowledge', 'paper', 'zotero', 'search', 'exa'],
  citation: ['paper', 'zotero', 'reference', 'research'],
  crm: ['contact', 'crm', 'deal', 'business'],
  sales: ['contact', 'deal', 'crm', 'business', 'invoice'],
  design: ['design', 'diagram', 'drawio', 'mermaid', 'sketch', 'inkscape', 'ui'],
  diagram: ['diagram', 'drawio', 'mermaid', 'chart', 'graph'],
  chart: ['chart', 'graph', 'diagram', 'mermaid', 'drawio'],
  code: ['code', 'git', 'lldb', 'debug', 'review'],
  debug: ['debug', 'lldb', 'renderdoc', 'trace', 'profile'],
  database: ['database', 'chromadb', 'sql', 'storage', 'vector'],
  server: ['server', 'deploy', 'host', 'docker', 'pm2', 'service'],
  deploy: ['deploy', 'host', 'server', 'docker', 'ci'],
  website: ['web', 'html', 'site', 'drawio', 'url'],
  '3d': ['3d', 'model', 'blender', 'freecad', 'mesh', 'render', 'cad'],
  model: ['3d', 'model', 'blender', 'freecad', 'mesh', 'cad'],
  cad: ['cad', '3d', 'freecad', 'model', 'part'],
  game: ['game', 'godot', 'engine', 'play', 'unreal'],
  mod: ['mod', 'minecraft', 'fabric', 'game'],
  gimp: ['gimp', 'image', 'photo', 'raster'],
  blender: ['blender', '3d', 'model', 'render'],
  obsidian: ['obsidian', 'note', 'knowledge', 'vault'],
  chat: ['chat', 'telegram', 'discord', 'message', 'slack', 'communication'],
  message: ['message', 'chat', 'telegram', 'discord', 'slack'],
  monitor: ['monitor', 'watch', 'track', 'intelwatch', 'uptime'],
  security: ['security', 'scan', 'adguard', 'firewall', 'security'],
};

/**
 * Expand a query word into the words it might be written as.
 *
 * Always includes the word itself, so an unknown term still searches exactly
 * as written rather than being silently dropped. A singular is added when the
 * word looks plural, because people search "books" and "notes" and the
 * registry says "E-book library management" and "note-taking".
 */
export function expandTerm(term: string): string[] {
  const extras = TASK_SYNONYMS[term] ?? [];
  const singularForm = singular(term);
  // The singular's own synonym group too: "books" should reach the same CLIs
  // that "book" does, not merely the word "book".
  const fromSingular = singularForm ? (TASK_SYNONYMS[singularForm] ?? []) : [];
  return [...new Set([term, singularForm, ...extras, ...fromSingular].filter(Boolean) as string[])];
}

/**
 * Score one entry against a query.
 *
 * Weighted rather than a plain substring test so an exact name match always
 * wins, and so a word in the name counts for more than the same word in a
 * description. Every term must match somewhere — an AND, not an OR — because
 * "blender photo" should not quietly return Blender.
 *
 * Returns 0 for no match at all, which the caller uses to filter.
 */
/**
 * Does `haystack` contain `word` as a whole word?
 *
 * Always word-boundary matched, never a bare substring. `"notebooks"` contains
 * `"book"`, and `"animation"` contains `"a"`; letting a search term match inside
 * an unrelated longer word returns confident nonsense — searching "read books"
 * returned three note-taking CLIs because their descriptions happened to
 * contain the letters of "book".
 *
 * Padded so a match at the start or end still has boundaries around it.
 */
function containsWord(haystack: string, word: string): boolean {
  const padded = ` ${haystack.replace(/[^a-z0-9]+/g, ' ').trim()} `;
  return padded.includes(` ${word} `);
}

/** "books" -> "book", "images" -> "image". Enough for English plurals. */
function singular(word: string): string | null {
  if (word.length > 3 && word.endsWith('ies')) return `${word.slice(0, -3)}y`;
  if (word.length > 3 && word.endsWith('es') && /(ch|sh|x|s|z)es$/.test(word)) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1);
  return null;
}

/**
 * Score one entry against a query. Returns 0 when nothing matches at all.
 *
 * Not a strict AND. Requiring every word to match made the search fail the way
 * people actually speak: "record audio" was dropped entirely because no entry
 * contains the word "record", even though "audio" is Audacity. "take notes" and
 * "read books" failed the same way. A catalogue that returns nothing for an
 * ordinary request is worse than one that ranks a plausible answer first.
 *
 * So: a partial match still counts, and the words that did not match cost it
 * score. "crop an image" ranks GIMP below a hypothetical entry matching both,
 * but it is ranked rather than discarded.
 */
export function scoreEntry(entry: CliHubEntry, terms: string[]): number {
  const name = entry.name.toLowerCase();
  const display = entry.display_name.toLowerCase();
  const description = (entry.description ?? '').toLowerCase();
  const category = (entry.category ?? '').toLowerCase();

  let total = 0;
  let matched = 0;
  for (const term of terms) {
    let best = 0;
    // Every variant of the word is tried, taking the strongest hit. A user who
    // says "photo" and an entry that says "image" are talking about the same
    // thing, and refusing to connect them is what made this useless.
    for (const variant of expandTerm(term)) {
      if (best >= 60) break;
      if (name === variant) best = Math.max(best, 100);
      // Prefix matching stays a plain prefix test: `startsWith` on a short word
      // is already word-anchored at the start, and entries like `3mf` are real.
      else if (name.startsWith(variant) && variant.length > 1) best = Math.max(best, 60);
      else if (containsWord(name, variant)) best = Math.max(best, 45);
      else if (containsWord(display, variant)) best = Math.max(best, 35);
      else if (containsWord(description, variant)) best = Math.max(best, 20);
      // A category hit is weak on its own: "3d" in a description is more likely
      // to be the point than the word "office" in a category.
      else if (containsWord(category, variant)) best = Math.max(best, 8);
    }
    if (best > 0) {
      matched++;
      total += best;
    }
  }

  // Nothing matched, or only a single weak category hit on a multi-word query:
  // not a result worth showing.
  if (matched === 0) return 0;
  if (terms.length > 1 && matched * 2 < terms.length && total < 60) return 0;

  // Unmatched words cost, so a fuller match ranks above a thinner one without
  // the thinner one disappearing.
  return total - (terms.length - matched) * 12;
}

/**
 * Words that describe the request rather than the thing.
 *
 * "edit a photo" should search for "photo", not fail because nothing in the
 * registry is called "edit".
 *
 * Only function words and generic verbs belong here. Content words must not:
 * an earlier version of this list included `photo`, `image` and `video`, which
 * made "edit a photo" fail — those are the words being searched *for*. Dropping
 * a word from scoring is not a safe thing to do casually, so this list is kept
 * deliberately short.
 */
const STOP_WORDS = new Set([
  'a', 'an', 'the', 'my', 'our', 'this', 'that', 'some', 'any',
  'edit', 'make', 'create', 'build', 'open', 'convert', 'turn', 'change',
  'use', 'using', 'get', 'give', 'show', 'find', 'help',
  'for', 'with', 'in', 'to', 'of', 'on', 'and', 'or', 'at', 'by', 'from',
  'please', 'want', 'need', 'like', 'do', 'can', 'you', 'i', 'it',
]);

export function searchRegistry(registry: CliHubRegistry, query: string, limit = 10): CliHubEntry[] {
  const raw = query.toLowerCase().split(/\s+/).map(t => t.trim()).filter(Boolean);
  // Keep every word as a fallback, but score on the meaningful ones. An empty
  // list would match nothing at all.
  const meaningful = raw.filter(t => !STOP_WORDS.has(t));
  const terms = meaningful.length > 0 ? meaningful : raw;
  if (terms.length === 0) return [];
  return registry.clis
    .map(entry => ({ entry, score: scoreEntry(entry, terms) }))
    .filter(r => r.score > 0)
    // Name: deterministic for equal scores, so the same query always answers
    // the same way. A search that reorders itself between calls is not
    // something an agent can reason about.
    .sort((a, b) => b.score - a.score || a.entry.name.localeCompare(b.entry.name))
    .slice(0, Math.max(1, limit))
    .map(r => r.entry);
}

/**
 * The cached catalogue, with a network refresh when the cache is stale.
 *
 * Order matters: a stale cache is far better than no catalogue, so a failed
 * fetch returns the cached copy and says so, and only reports absence when
 * there is genuinely nothing cached either. An offline machine should still be
 * able to find and run the CLIs it installed last week.
 */
export async function loadRegistry(
  cacheDir: string,
  fetchImpl: typeof fetch = fetch,
  now: number = Date.now(),
): Promise<{ registry: CliHubRegistry; fromCache: boolean; error?: string }> {
  const cachePath = join(cacheDir, 'cli-hub-registry.json');
  const cached = readCache(cachePath, now);

  if (cached && now - cached.fetchedAt < TTL_MS) {
    return { registry: cached.registry, fromCache: true };
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let text: string;
    try {
      const response = await fetchImpl(REGISTRY_URL, { signal: controller.signal });
      if (!response.ok) throw new Error(`registry responded ${response.status}`);
      text = await response.text();
    } finally {
      clearTimeout(timer);
    }
    const registry = parseRegistry(text);
    if (registry.clis.length === 0) throw new Error('registry contained no entries');
    writeCache(cachePath, registry, now);
    // Even on a refresh, a cache we already had is worth keeping as the
    // fallback, so the written copy replaces it only on success.
    return { registry, fromCache: false };
  } catch (error) {
    if (cached) {
      return {
        registry: cached.registry,
        fromCache: true,
        error: `Could not refresh the CLI catalogue (${(error as Error).message}). Using the copy from ${new Date(
          cached.fetchedAt,
        ).toISOString().slice(0, 10)}.`,
      };
    }
    return { registry: { clis: [] }, fromCache: false, error: (error as Error).message };
  }
}

function readCache(path: string, now: number): CliHubCache | null {
  try {
    if (!existsSync(path)) return null;
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as CliHubCache;
    if (typeof parsed?.fetchedAt !== 'number' || !Array.isArray(parsed.registry?.clis)) return null;
    // A cache written in the future is not trustworthy — usually a clock change.
    if (parsed.fetchedAt > now + 60_000) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeCache(path: string, registry: CliHubRegistry, now: number): void {
  try {
    mkdirSync(cacheDirOf(path), { recursive: true });
    const payload: CliHubCache = { fetchedAt: now, registry };
    // Atomic, so a crash mid-write cannot leave a truncated file that makes the
    // catalogue permanently unreadable.
    const tmp = `${path}.tmp-${process.pid}`;
    writeFileSync(tmp, JSON.stringify(payload), 'utf8');
    renameSync(tmp, path);
  } catch {
    /* a cache that cannot be written is a performance loss, not a failure */
  }
}

function cacheDirOf(path: string): string {
  const i = path.lastIndexOf('/') >= 0 ? path.lastIndexOf('/') : path.lastIndexOf('\\');
  return i >= 0 ? path.slice(0, i) : path;
}