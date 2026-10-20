import { describe, expect, it, beforeAll } from 'vitest';
import { searchRegistry, parseRegistry, type CliHubRegistry } from './registry.js';

/**
 * The catalogue as it actually is.
 *
 * The unit tests use a three-entry sample so the scoring rules can be checked
 * precisely. This one fetches the real registry and asks the questions a user
 * would actually ask — in their words, not in product names — because a
 * synonym map that only works against a fixture is not a synonym map.
 *
 * Skipped when offline, so it never turns a network outage into a red suite.
 */

let registry: CliHubRegistry | null = null;
let skipped = false;

beforeAll(async () => {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    const response = await fetch(
      'https://raw.githubusercontent.com/HKUDS/CLI-Anything/main/registry.json',
      { signal: controller.signal },
    );
    clearTimeout(timer);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    registry = parseRegistry(await response.text());
    if (registry.clis.length === 0) throw new Error('no entries');
  } catch {
    skipped = true;
  }
}, 20_000);

describe('the real catalogue', () => {
  it('parses into a usable registry', () => {
    if (skipped) return;
    expect(registry!.clis.length).toBeGreaterThan(50);
    // Every entry must be addressable, or the agent has no way to refer to it.
    expect(registry!.clis.every(c => c.name.length > 0)).toBe(true);
    expect(registry!.clis.every(c => Boolean(c.entry_point))).toBe(true);
  });

  it('answers the questions people actually ask', () => {
    if (skipped) return;
    const cases: [string, string][] = [
      ['edit a photo', 'gimp'],
      ['crop an image', 'gimp'],
      ['make a video', 'shotcut'],
      ['record audio', 'audacity'],
      ['spreadsheet', 'libreoffice'],
      ['take notes', 'obsidian'],
      ['read books', 'calibre'],
      ['model in 3d', 'blender'],
      ['draw a diagram', 'drawio'],
      ['edit my documents', 'libreoffice'],
      ['vector graphics', 'inkscape'],
      ['paint', 'krita'],
    ];
    const misses: string[] = [];
    for (const [query, expected] of cases) {
      const found = searchRegistry(registry!, query, 10).map(c => c.name);
      if (!found.includes(expected)) misses.push(`"${query}" -> [${found.join(', ')}] (wanted ${expected})`);
    }
    expect(misses).toEqual([]);
  });

  it('finds a CLI by its exact name', () => {
    if (skipped) return;
    expect(searchRegistry(registry!, 'gimp')[0]?.name).toBe('gimp');
    expect(searchRegistry(registry!, 'blender')[0]?.name).toBe('blender');
  });

  it('does not answer a nonsense query with a confident wrong answer', () => {
    if (skipped) return;
    // Better to say nothing than to offer Blender for "bookkeeping".
    const found = searchRegistry(registry!, 'zzzznotathing', 10);
    expect(found).toEqual([]);
  });

  it('is stable: the same question gets the same answer', () => {
    if (skipped) return;
    const once = searchRegistry(registry!, 'image', 5).map(c => c.name);
    const twice = searchRegistry(registry!, 'image', 5).map(c => c.name);
    expect(once).toEqual(twice);
    expect(once.length).toBeGreaterThan(0);
  });
});