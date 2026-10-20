import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Providers always reported token usage per response, and `pricing.ts` knew how
 * to turn that into money. Nothing joined them: the numbers were parsed,
 * priced, tested in isolation, and then dropped on the floor. A user could not
 * find out what a conversation had cost.
 */

let home = '';

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'infinite-usage-'));
  process.env.INFINITE_TEST_HOME = home;
});

afterEach(() => {
  try { rmSync(home, { recursive: true, force: true }); } catch { /* best-effort */ }
  delete process.env.INFINITE_TEST_HOME;
});

/** Fresh module each time so the in-memory cache cannot leak between tests. */
async function freshStore() {
  vi.resetModules();
  return import('./usage-store.js');
}

describe('usage totals', () => {
  it('starts empty', async () => {
    const { getUsageTotals } = await freshStore();
    const totals = getUsageTotals();
    expect(totals.requests).toBe(0);
    expect(totals.costUsd).toBe(0);
    expect(totals.byModel).toEqual([]);
  });

  it('accumulates tokens and requests', async () => {
    const { recordUsage, getUsageTotals } = await freshStore();
    recordUsage({ provider: 'nvidia', model: 'mistralai/mistral-large', input: 100, output: 50 });
    recordUsage({ provider: 'nvidia', model: 'mistralai/mistral-large', input: 200, output: 25 });

    const totals = getUsageTotals();
    expect(totals.input).toBe(300);
    expect(totals.output).toBe(75);
    expect(totals.requests).toBe(2);
  });

  it('ignores a null or empty sample rather than counting phantom requests', async () => {
    // Providers that report nothing must not inflate the request count, or the
    // number stops meaning anything.
    const { recordUsage, getUsageTotals } = await freshStore();
    recordUsage(null);
    recordUsage(undefined);
    recordUsage({ input: 0, output: 0 });
    expect(getUsageTotals().requests).toBe(0);
  });

  it('attributes usage to the model that produced it', async () => {
    const { recordUsage, getUsageTotals } = await freshStore();
    recordUsage({ provider: 'nvidia', model: 'a', input: 10, output: 5 });
    recordUsage({ provider: 'groq', model: 'b', input: 20, output: 5 });

    const totals = getUsageTotals();
    expect(totals.byModel).toHaveLength(2);
    const keys = totals.byModel.map((m) => `${m.provider}/${m.model}`);
    expect(keys).toContain('nvidia/a');
    expect(keys).toContain('groq/b');
  });

  it('survives a restart', async () => {
    const first = await freshStore();
    first.recordUsage({ provider: 'nvidia', model: 'a', input: 500, output: 100 });

    // A fresh load must see the persisted total, not start from zero.
    const second = await freshStore();
    const totals = second.getUsageTotals();
    expect(totals.input).toBe(500);
    expect(totals.requests).toBe(1);
  });

  it('clears on request', async () => {
    const { recordUsage, getUsageTotals, resetUsage } = await freshStore();
    recordUsage({ provider: 'nvidia', model: 'a', input: 10, output: 10 });
    expect(getUsageTotals().requests).toBe(1);

    resetUsage();
    expect(getUsageTotals().requests).toBe(0);

    // And the reset is persisted too, not just cleared in memory.
    const second = await freshStore();
    expect(second.getUsageTotals().requests).toBe(0);
  });

  it('recovers from a corrupt totals file instead of breaking', async () => {
    const { writeFileSync } = await import('node:fs');
    writeFileSync(join(home, 'usage-totals.json'), '{ not json', 'utf8');
    const { getUsageTotals } = await freshStore();
    expect(getUsageTotals().requests).toBe(0);
  });

  it('exposes a formatted cost the UI does not have to reimplement', async () => {
    const { recordUsage, getUsageTotals } = await freshStore();
    recordUsage({ provider: 'nvidia', model: 'mistralai/mistral-large', input: 1000, output: 500 });
    const { formatted } = getUsageTotals();
    expect(formatted.cost.startsWith('$')).toBe(true);
    expect(formatted.input).toBe('1,000');
  });

  it('flags models with no published price instead of presenting them as free', async () => {
    const { recordUsage, getUsageTotals } = await freshStore();
    recordUsage({ provider: 'nvidia', model: 'mystery-model', input: 100, output: 50 });

    const totals = getUsageTotals();
    expect(totals.costUsd).toBe(0);
    expect(totals.unpricedRequests).toBe(1);
    expect(totals.formatted.note).toContain('no published price');
    expect(totals.byModel[0].pricing).toBe('unknown');
  });

  it('does not flag genuinely free models', async () => {
    const { recordUsage, getUsageTotals } = await freshStore();
    recordUsage({ provider: 'ollama', model: 'qwen3:4b', input: 100, output: 50 });
    recordUsage({ provider: 'openrouter', model: 'deepseek/deepseek-chat:free', input: 100, output: 50 });

    const totals = getUsageTotals();
    expect(totals.unpricedRequests).toBe(0);
    expect(totals.formatted.note).toBe('');
    expect(totals.byModel.every((m) => m.pricing === 'free')).toBe(true);
  });

  it('backfills the unpriced count for totals written before the field existed', async () => {
    const { writeFileSync } = await import('node:fs');
    writeFileSync(
      join(home, 'usage-totals.json'),
      JSON.stringify({
        input: 300,
        output: 60,
        cacheRead: 0,
        requests: 3,
        costUsd: 0,
        byModel: {
          'nvidia/mystery-model': {
            provider: 'nvidia',
            model: 'mystery-model',
            input: 200,
            output: 40,
            cacheRead: 0,
            requests: 2,
            costUsd: 0,
          },
          'openai/gpt-4o': {
            provider: 'openai',
            model: 'gpt-4o',
            input: 100,
            output: 20,
            cacheRead: 0,
            requests: 1,
            costUsd: 0,
          },
        },
      }),
      'utf8',
    );

    const { getUsageTotals } = await freshStore();
    const totals = getUsageTotals();
    expect(totals.unpricedRequests).toBe(2);
    expect(totals.formatted.note).toContain('2 replies');
    expect(totals.byModel.find((m) => m.model === 'gpt-4o')?.pricing).toBe('priced');
  });
});