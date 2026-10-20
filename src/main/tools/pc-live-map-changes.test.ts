import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';

/**
 * The change timeline.
 *
 * A snapshot tells the AI what the screen looks like now. This tells it what
 * HAPPENED since it last looked — the difference between a photo and a video.
 *
 * Without it the agent re-reads every element each turn to work out whether
 * anything moved: slow, expensive, and unreliable, because in a snapshot
 * "nothing changed" and "changed and changed back" are indistinguishable.
 *
 * Only the network is stubbed. The tool's own routing, formatting and error
 * handling all run for real, because those are exactly the parts that decide
 * whether the agent is told the truth.
 */

const realFetch = globalThis.fetch;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

function reply(json: unknown, ok = true, status = 200) {
  // `text()` must be a method: the tool re-parses the body itself rather than
  // using res.json(). Getting this wrong makes every request look like a
  // connection failure, which would make the dead-bridge test pass for the
  // wrong reason.
  fetchMock.mockResolvedValue({
    ok,
    status,
    text: async () => (ok ? JSON.stringify(json) : 'tracker down'),
    json: async () => json,
  });
}

async function run(args: Record<string, unknown>) {
  const { pcLiveMapTool } = await import('./pc-live-map.js');
  return pcLiveMapTool.execute(args, {
    cwd: process.cwd(),
    abortSignal: new AbortController().signal,
    sessionId: 'test',
    onUpdate: () => {},
  });
}

describe('asking what changed', () => {
  it('reports nothing changed when nothing did', async () => {
    // This is the cheap common case and it is the whole point: the agent gets
    // a one-line answer instead of re-reading the screen.
    reply({ since: 12, newest: 12, gap: false, count: 0, changes: [] });
    const result = await run({ action: 'changes', since: 12 });
    const text = String(result.content);
    expect(text).toContain('Nothing changed');
    expect(text).toContain('next_since=12');
    expect(result.is_error).toBeFalsy();
  });

  it('lists what happened, and hands back the id to use next time', async () => {
    reply({
      since: 3, newest: 5, gap: false, count: 2,
      changes: [
        { id: 4, t: '2026-10-10T10:00:00Z', where: 'chrome :: Acme', changes: ['focus: chrome -> chrome', 'click_left at 400,220 in chrome'] },
        { id: 5, t: '2026-10-10T10:00:02Z', where: 'chrome :: Acme', changes: ['windows_changed: 12 open'] },
      ],
    });
    const result = await run({ action: 'changes', since: 3 });
    const text = String(result.content);
    expect(text).toContain('click_left at 400,220');
    expect(text).toContain('windows_changed: 12 open');
    // Without this the agent cannot advance its cursor and would re-read
    // everything on the next call.
    expect(text).toContain('next_since=5');
  });

  it('warns when the buffer rolled past what was asked for', async () => {
    // Reporting a partial history as if it were complete would let the agent
    // believe it had seen everything while silently missing events.
    reply({ since: 1, newest: 900, gap: true, count: 1, changes: [{ id: 900, t: 'x', where: 'w', changes: ['focus: a -> b'] }] });
    const result = await run({ action: 'changes', since: 1 });
    expect(String(result.content)).toContain('rolled past');
  });

  it('surfaces a broken bridge rather than pretending nothing changed', async () => {
    reply({}, false, 503);
    const result = await run({ action: 'changes', since: 0 });
    // "Nothing changed" would be a lie here, and a dangerous one: the agent
    // would conclude the desktop is idle when the sensor is simply not running.
    expect(result.is_error).toBe(true);
    expect(String(result.content)).toContain('503');
  });

  it('surfaces a dead bridge rather than pretending nothing changed', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));
    const result = await run({ action: 'changes', since: 0 });
    expect(result.is_error).toBe(true);
    expect(String(result.content)).toMatch(/unreachable/i);
  });

  it('treats a junk `since` as 0 rather than failing', async () => {
    reply({ since: 0, newest: 0, gap: false, count: 0, changes: [] });
    const result = await run({ action: 'changes', since: 'abc' });
    expect(result.is_error).toBeFalsy();
    expect(fetchMock.mock.calls[0][0]).toContain('since=0');
  });

  it('never sends a negative id', async () => {
    reply({ since: 0, newest: 0, gap: false, count: 0, changes: [] });
    await run({ action: 'changes', since: -99 });
    expect(fetchMock.mock.calls[0][0]).toContain('since=0');
  });
});

describe('the schema tells the agent this exists', () => {
  it('advertises the changes action and the since parameter', async () => {
    const { pcLiveMapTool } = await import('./pc-live-map.js');
    const props = pcLiveMapTool.inputSchema.properties as Record<string, unknown>;
    expect((props.action as { enum: string[] }).enum).toContain('changes');
    expect(props.since).toBeTruthy();
  });

  it('tells the model to call changes first, so the timeline is not dead code', async () => {
    const { pcLiveMapTool } = await import('./pc-live-map.js');
    // Without an instruction to prefer changes, the agent keeps calling live
    // every turn and re-reads the whole element list. The wording is terse
    // because the core-tool schema budget is tight.
    expect(pcLiveMapTool.description).toMatch(/action=changes/);
    expect(pcLiveMapTool.description).toMatch(/Cheapest loop/i);
  });
});