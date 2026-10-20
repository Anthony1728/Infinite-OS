import { describe, expect, it, vi } from 'vitest';

// The registry pulls in adapters that touch electron; mock only that surface.
vi.mock('electron', () => {
  const Notify = Object.assign(vi.fn(), { isSupported: (): boolean => false });
  return { Notification: Notify };
});

import { getProvider, listProviders } from './registry.js';
import { PROVIDER_ORDER } from './failover.js';
import { FREE_PROVIDER_PRIORITY } from './model-selector.js';

/**
 * The "finished but unreachable" bug class.
 *
 * `freebuff.ts` was a complete, tested provider adapter. It appeared in the
 * failover order and in the model-selector priority list, and the UI had copy
 * describing it. But it was never added to the provider registry, so
 * `getProvider('freebuff')` returned undefined and no code path could ever
 * select it. Every test that touched it "passed" because the assertions were
 * written against a world where it did not exist.
 *
 * These checks fail the moment a provider is referenced but not registered,
 * which is the whole failure: a provider the app talks about but cannot use.
 */

describe('every provider the app advertises can actually be used', () => {
  it('registers every provider in the failover order', () => {
    // PROVIDER_ORDER is the fallback chain. A name in it that the registry does
    // not know about is a dead entry the app will silently skip past.
    const unknown = PROVIDER_ORDER.filter((id) => !getProvider(id));
    expect(unknown, 'referenced by the failover order but not registered').toEqual([]);
  });

  it('registers every provider in the free-provider priority list', () => {
    const unknown = FREE_PROVIDER_PRIORITY.filter((id) => !getProvider(id));
    expect(unknown, 'referenced by the model selector but not registered').toEqual([]);
  });

  it('registers freebuff', () => {
    // The concrete bug. Named here so a regression names the provider.
    expect(getProvider('freebuff')).toBeDefined();
    expect(getProvider('freebuff')?.id).toBe('freebuff');
  });

  it('gives every registered provider a usable label and a way to get models', () => {
    // Ollama and Custom resolve their models at runtime — Ollama from what is
    // actually installed, Custom from whatever base URL the user configured — so
    // a static list would be a lie. Everything else must name at least one.
    const DYNAMIC_MODELS = new Set(['ollama', 'custom']);
    const broken = listProviders().filter(
      (p) => !p.label || (!p.freeModels?.length && !p.defaultModel && !DYNAMIC_MODELS.has(p.id)),
    );
    expect(broken.map((p) => p.id)).toEqual([]);
  });

  it('reports the same id from getProvider as the registry key', () => {
    // A mismatch means routing looks up 'freebuff' and gets an adapter that
    // identifies as something else, which breaks per-provider state.
    const mismatched = listProviders()
      .filter((p) => getProvider(p.id)?.id !== p.id)
      .map((p) => p.id);
    expect(mismatched).toEqual([]);
  });
});