import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The catalogue of reusable skills from `alirezarezvani/claude-skills`.
 *
 * Why this is a catalogue and not a bundle: there are 388 skills, and their
 * descriptions alone would dwarf the system prompt. Infinite OS runs a local
 * model on a low-end machine where every token costs real seconds. So the
 * skills are never all loaded. The agent searches here, picks one, and only
 * that one is fetched and written to disk.
 *
 * This is the same progressive-disclosure shape as the CLI catalogue next door:
 * an index that is cheap to hold, and content that is fetched when it is
 * actually wanted.
 *
 * Two upstream documents are used, because neither alone is enough:
 *
 *   - The git tree gives the 388 canonical `SKILL.md` paths. It is ~2 MB and is
 *     the only complete source of truth for what exists. Parsed once and cached.
 *   - The plugin marketplace manifest gives a human description and keywords for
 *     each of the 99 bundles those skills live in. Without it, search would only
 *     match skill *names*, which is useless — a user asking about "quarterly
 *     reporting" does not know the skill is called `finance/quarterly-review`.
 */

/** ~2 MB of JSON; parse it on a slow machine at most once a week. */
const TREE_URL = 'https://api.github.com/repos/alirezarezvani/claude-skills/git/trees/main?recursive=1';

/** 94 KB of plugin descriptions and keywords. */
const MANIFEST_URL =
  'https://raw.githubusercontent.com/alirezarezvani/claude-skills/main/.claude-plugin/marketplace.json';

/** Raw file for one skill. */
const RAW_BASE = 'https://raw.githubusercontent.com/alirezarezvani/claude-skills/main/';

/**
 * Skills change on the order of weekly, and both documents are large. A week is
 * long enough that the index is not re-fetched every session.
 */
const TTL_MS = 7 * 24 * 60 * 60 * 1000;

const FETCH_TIMEOUT_MS = 20_000;

export interface SkillHubEntry {
  /** Directory slug, unique within the catalogue. */
  name: string;
  /** Path within the upstream repository, used to fetch the file. */
  path: string;
  /** Top-level directory: engineering, finance, productivity, and so on. */
  category: string;
  /** The bundle this skill belongs to, if the manifest names one. */
  bundle?: string;
  description?: string;
  keywords?: string[];
}

export interface SkillHubIndex {
  entries: SkillHubEntry[];
  /** A skill can share a name across bundles; the path disambiguates. */
  fetchedAt: number;
}

interface CachedIndex {
  fetchedAt: number;
  index: SkillHubIndex;
}

/** Upstream bundle metadata, from the marketplace manifest. */
interface BundleMeta {
  description?: string;
  keywords?: string[];
  category?: string;
  name?: string;
}

/**
 * The canonical skills, from the repository tree.
 *
 * "Canonical" matters: the repo also ships per-agent copies under `.gemini/`,
 * which is 458 of the 846 `SKILL.md` files. Counting those would give the same
 * skill twice and make the catalogue report 846 skills for a repository that
 * has 388.
 */
export function parseTree(treeText: string): SkillHubEntry[] {
  const parsed = JSON.parse(treeText) as { tree?: { path: string; type: string }[]; truncated?: boolean };
  const blobs = (parsed.tree ?? []).filter((n) => n.type === 'blob' && /(^|\/)SKILL\.md$/.test(n.path));
  return blobs
    .filter((b) => !b.path.split('/').some((seg) => seg.startsWith('.')))
    .map((b) => {
      const parts = b.path.split('/');
      return {
        name: parts[parts.length - 2] ?? '',
        path: b.path,
        category: parts[0] ?? 'general',
      };
    })
    .filter((e) => e.name.length > 0);
}

/**
 * Merge bundle descriptions onto the skills.
 *
 * Matched on the skill path rather than by guessing at directory layout: a
 * bundle declares `source: "./marketing-skill"`, and a skill is inside it when
 * its path starts with that source. Guessing at `skills/` segments would break
 * the moment upstream reorganises a folder.
 */
export function applyManifest(
  entries: SkillHubEntry[],
  manifestText: string,
): SkillHubEntry[] {
  // source path -> plugin metadata, e.g. "marketing-skill" -> its description.
  const bundles = new Map<string, BundleMeta>();
  try {
    const parsed = JSON.parse(manifestText) as {
      plugins?: (BundleMeta & { source?: string })[] | Record<string, BundleMeta & { source?: string }>;
    };
    const raw = parsed.plugins ?? [];
    const list = Array.isArray(raw) ? raw : Object.values(raw);
    for (const plugin of list) {
      // `source` is "./marketing-skill"; compare without the leading ./ or a
      // trailing slash so it lines up with a path prefix from the tree.
      if (!plugin?.source) continue;
      const source = plugin.source.replace(/^\.\//, '').replace(/\/+$/, '');
      bundles.set(source, plugin);
    }
  } catch {
    // The tree alone is still a working catalogue, just a poorer search. A
    // manifest change must not make every skill unfindable.
    return entries;
  }

  return entries.map((entry) => {
    const source = [...bundles.keys()]
      .filter(src => entry.path === src || entry.path.startsWith(`${src}/`))
      // Longest match first, so `engineering/agent-harness` wins over
      // `engineering` when a skill sits in the more specific bundle.
      .sort((a, b) => b.length - a.length)[0];
    if (!source) return entry;
    const meta = bundles.get(source)!;
    return {
      ...entry,
      bundle: meta.name ?? source,
      description: meta.description,
      keywords: meta.keywords,
    };
  });
}

function readCache(path: string, now: number): CachedIndex | null {
  try {
    if (!existsSync(path)) return null;
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as CachedIndex;
    if (typeof parsed?.fetchedAt !== 'number' || !Array.isArray(parsed?.index?.entries)) return null;
    if (parsed.fetchedAt > now + 60_000) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeCache(path: string, index: SkillHubIndex, now: number): void {
  try {
    mkdirSync(join(path, '..'), { recursive: true });
    const tmp = `${path}.tmp-${process.pid}`;
    writeFileSync(tmp, JSON.stringify({ fetchedAt: now, index }), 'utf8');
    renameSync(tmp, path);
  } catch {
    /* a cache that cannot be written is a performance loss, not a failure */
  }
}

/**
 * The catalogue, from cache when it is fresh.
 *
 * Same contract as the CLI catalogue: a stale index beats no index, an offline
 * machine can still install a skill it found last week, and a failure is
 * reported rather than silently producing an empty catalogue.
 */
export async function loadSkillIndex(
  cacheDir: string,
  fetchImpl: typeof fetch = fetch,
  now: number = Date.now(),
): Promise<{ index: SkillHubIndex; fromCache: boolean; error?: string }> {
  const cachePath = join(cacheDir, 'skill-hub-index.json');
  const cached = readCache(cachePath, now);
  if (cached && now - cached.fetchedAt < TTL_MS) {
    return { index: cached.index, fromCache: true };
  }

  const withTimeout = async (url: string): Promise<string> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const response = await fetchImpl(url, {
        signal: controller.signal,
        headers: { 'User-Agent': 'infinite-os' },
      });
      if (!response.ok) throw new Error(`${url} responded ${response.status}`);
      return await response.text();
    } finally {
      clearTimeout(timer);
    }
  };

  try {
    // The tree is the one that must succeed; the manifest only improves search.
    const treeText = await withTimeout(TREE_URL);
    const entries = parseTree(treeText);
    if (entries.length === 0) throw new Error('the repository tree contained no skills');
    let merged = entries;
    try {
      merged = applyManifest(entries, await withTimeout(MANIFEST_URL));
    } catch {
      /* search still works on names alone */
    }
    const index: SkillHubIndex = { entries: merged, fetchedAt: now };
    writeCache(cachePath, index, now);
    return { index, fromCache: false };
  } catch (error) {
    if (cached) {
      return {
        index: cached.index,
        fromCache: true,
        error: `Could not refresh the skill catalogue (${(error as Error).message}). Using the copy from ${new Date(
          cached.fetchedAt,
        ).toISOString().slice(0, 10)}.`,
      };
    }
    return { index: { entries: [], fetchedAt: now }, fromCache: false, error: (error as Error).message };
  }
}

/** Fetch one SKILL.md. Used only when a skill is actually being installed. */
export async function fetchSkillFile(
  path: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  // The path comes from the catalogue, but it is still upstream data and must
  // not be able to escape the repository.
  if (!/^[\w\-./]+\/SKILL\.md$/.test(path) || path.includes('..')) {
    throw new Error(`Unsafe skill path: "${path}"`);
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetchImpl(RAW_BASE + path, {
      signal: controller.signal,
      headers: { 'User-Agent': 'infinite-os' },
    });
    if (!response.ok) throw new Error(`responded ${response.status}`);
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Score one skill against a query.
 *
 * The skill's own name is the strongest signal, then its bundle description,
 * then its keywords. Not a strict AND — see the note in the CLI catalogue for
 * why a partial match should be ranked rather than discarded.
 */
export function scoreSkill(entry: SkillHubEntry, terms: string[]): number {
  const name = entry.name.toLowerCase();
  const category = entry.category.toLowerCase();
  const description = (entry.description ?? '').toLowerCase();
  const keywords = (entry.keywords ?? []).map(k => k.toLowerCase());

  let total = 0;
  let matched = 0;
  for (const term of terms) {
    let best = 0;
    if (name === term) best = 100;
    else if (name.startsWith(term)) best = 70;
    else if (name.includes(term)) best = 55;
    else if (keywords.some(k => k === term)) best = 40;
    else if (keywords.some(k => k.includes(term))) best = 25;
    else if (description.includes(term)) best = 18;
    else if (category.includes(term)) best = 10;
    if (best > 0) { matched++; total += best; }
  }
  if (matched === 0) return 0;
  if (terms.length > 1 && matched * 2 < terms.length && total < 55) return 0;
  return total - (terms.length - matched) * 12;
}

/** Words that describe the request rather than the thing. Kept short on purpose. */
const STOP_WORDS = new Set([
  'a', 'an', 'the', 'my', 'our', 'this', 'that', 'some', 'any',
  'write', 'create', 'make', 'build', 'help', 'please', 'want', 'need',
  'for', 'with', 'in', 'to', 'of', 'on', 'and', 'or', 'at', 'by', 'from',
  'use', 'using', 'get', 'give', 'show', 'find', 'do', 'can', 'you', 'i', 'it',
]);

export function searchSkills(index: SkillHubIndex, query: string, limit = 15): SkillHubEntry[] {
  const raw = query.toLowerCase().split(/\s+/).map(t => t.trim()).filter(Boolean);
  const meaningful = raw.filter(t => !STOP_WORDS.has(t));
  const terms = meaningful.length > 0 ? meaningful : raw;
  if (terms.length === 0) return [];
  return index.entries
    .map(entry => ({ entry, score: scoreSkill(entry, terms) }))
    .filter(r => r.score > 0)
    // Name as the tie-break so the same question always answers the same way.
    .sort((a, b) => b.score - a.score || a.entry.name.localeCompare(b.entry.name))
    .slice(0, Math.max(1, limit))
    .map(r => r.entry);
}