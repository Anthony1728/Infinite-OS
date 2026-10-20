// The transcript write path must stay O(1) in transcript size.
//
// Appending a message used to re-read and re-serialise the entire transcript
// just to recount its messages (measured: ~95 ms per message on a 1 MB thread,
// and ~140 s for 300 messages — it did not finish). These tests pin the shape
// of the fix rather than a stopwatch: they spy on the fs calls and assert that
// the hot paths never read a transcript at all. A timing assertion would go
// red under load; a call-shape assertion only goes red if someone reintroduces
// the quadratic work.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { readCalls } = vi.hoisted(() => ({ readCalls: [] as string[] }));

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    readFile: vi.fn(async (path: Parameters<typeof actual.readFile>[0], ...rest: unknown[]) => {
      readCalls.push(String(path));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (actual.readFile as any)(path, ...rest);
    }),
  };
});

const home = mkdtempSync(join(tmpdir(), 'infinite-store-perf-'));
process.env.INFINITE_TEST_HOME = home;

const store = await import('./store.js');

const text = (value: string) => [{ type: 'text' as const, text: value }];
const transcriptReads = () => readCalls.filter((path) => path.endsWith('.jsonl'));

let session: Awaited<ReturnType<typeof store.createSession>>;

beforeEach(async () => {
  await store.clearAllSessions();
  readCalls.length = 0;
  session = await store.createSession({ cwd: '.', model: 'm', provider: 'p', title: 'perf' });
});

afterEach(() => {
  readCalls.length = 0;
});

describe('session write path stays O(1)', () => {
  it('appends without ever reading the transcript back', async () => {
    for (let i = 0; i < 25; i++) {
      await store.appendMessage(session.id, { id: `m${i}`, role: 'user', content: text(`message ${i}`), timestamp: i });
    }

    // The old implementation read the transcript on every single append.
    expect(transcriptReads()).toEqual([]);
    // Positive control: the spy really does see reads (the meta sidecar), so
    // the empty transcript list above means "never read", not "never recorded".
    expect(readCalls.some((path) => path.endsWith('.meta.json'))).toBe(true);
    await expect(store.loadSessionMeta(session.id)).resolves.toMatchObject({ message_count: 25 });
  });

  it('keeps the count exact when appends to one conversation are concurrent', async () => {
    // The count now comes from the meta sidecar, so two appends must not read
    // the same value and write the same increment.
    await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        store.appendMessage(session.id, { id: `c${i}`, role: 'assistant', content: text(`concurrent ${i}`), timestamp: i })),
    );

    await expect(store.loadSessionMeta(session.id)).resolves.toMatchObject({ message_count: 12 });
    await expect(store.loadMessages(session.id)).resolves.toHaveLength(12);
  });

  it('lists sessions from meta files instead of opening every transcript', async () => {
    for (let s = 0; s < 4; s++) {
      const other = await store.createSession({ cwd: '.', model: 'm', provider: 'p', title: `chat ${s}` });
      await store.appendMessage(other.id, { id: `s${s}`, role: 'user', content: text('hello'), timestamp: 1 });
    }
    readCalls.length = 0;

    const sessions = await store.listSessions();

    expect(sessions).toHaveLength(5);
    expect(sessions.every((s) => (s.message_count ?? 0) >= 0)).toBe(true);
    expect(transcriptReads()).toEqual([]);
  });

  it('survives a rename and an archive without touching the transcript', async () => {
    await store.appendMessage(session.id, { id: 'u1', role: 'user', content: text('keep me'), timestamp: 1 });
    readCalls.length = 0;

    await store.renameSession(session.id, 'Renamed chat');
    await store.setSessionArchived(session.id, true);

    expect(transcriptReads()).toEqual([]);
    const meta = await store.loadSessionMeta(session.id);
    expect(meta).toMatchObject({ title: 'Renamed chat', archived: true, message_count: 1 });
    // The transcript itself still carries the original header line and message.
    await expect(store.loadMessages(session.id)).resolves.toHaveLength(1);
  });

  it('removes the sidecar when a conversation is deleted', async () => {
    await store.appendMessage(session.id, { id: 'u1', role: 'user', content: text('bye'), timestamp: 1 });
    const sidecar = join(home, 'sessions', `${session.id}.meta.json`);
    await expect(store.loadSessionMeta(session.id)).resolves.not.toBeNull();

    await store.deleteSession(session.id);

    await expect(store.loadSessionMeta(session.id)).resolves.toBeNull();
    await expect(import('node:fs/promises').then((fs) => fs.access(sidecar))).rejects.toThrow();
  });

  it('falls back to the creation header for transcripts written before sidecars existed', async () => {
    // Simulate a legacy conversation: header line only, no sidecar.
    const { writeFile, unlink } = await import('node:fs/promises');
    const { metaPathFor } = await import('./meta.js');
    const legacyId = 'legacy-session';
    const transcript = join(home, 'sessions', `${legacyId}.jsonl`);
    await writeFile(
      transcript,
      `${JSON.stringify({ type: 'meta', id: legacyId, title: 'Legacy chat', created_at: 1, updated_at: 2, cwd: '.', model: 'm', provider: 'p', message_count: 1 })}\n` +
        `${JSON.stringify({ type: 'message', id: 'l1', role: 'user', content: text('old question'), timestamp: 2 })}\n`,
      'utf8',
    );
    await unlink(metaPathFor(transcript)).catch(() => undefined);

    const meta = await store.loadSessionMeta(legacyId);
    expect(meta).toMatchObject({ id: legacyId, title: 'Legacy chat' });
    await expect(store.loadMessages(legacyId)).resolves.toHaveLength(1);

    // Appending to it mints a sidecar and the count continues from the header.
    await store.appendMessage(legacyId, { id: 'l2', role: 'assistant', content: text('new answer'), timestamp: 3 });
    await expect(store.loadSessionMeta(legacyId)).resolves.toMatchObject({ message_count: 2 });
  });

  it('mints meta when a caller appends to a conversation that was never created', async () => {
    // The phone remote appends straight to a fixed id with no create step.
    await store.appendMessage('phone-remote', { id: 'p1', role: 'user', content: text('turn on the office lights'), timestamp: 1 });

    await expect(store.loadSessionMeta('phone-remote')).resolves.toMatchObject({ id: 'phone-remote', message_count: 1 });
    await expect(store.loadMessages('phone-remote')).resolves.toHaveLength(1);

    await store.appendMessage('phone-remote', { id: 'p2', role: 'assistant', content: text('the lights are on'), timestamp: 2 });
    await expect(store.loadSessionMeta('phone-remote')).resolves.toMatchObject({ message_count: 2 });
    await expect(store.searchSessions('office lights')).resolves.toHaveLength(1);
  });

  it('keeps a transcript whose first line is a message readable and searchable', async () => {
    // A file written by the old code without a usable header: line 0 is a
    // message, so there is no meta to read at all.
    const { writeFile } = await import('node:fs/promises');
    const orphanId = 'headerless-session';
    await writeFile(
      join(home, 'sessions', `${orphanId}.jsonl`),
      `${JSON.stringify({ type: 'message', id: 'o1', role: 'user', content: text('quarterly revenue numbers'), timestamp: 1 })}\n`,
      'utf8',
    );
    await expect(store.loadSessionMeta(orphanId)).resolves.toBeNull();

    await store.appendMessage(orphanId, { id: 'o2', role: 'assistant', content: text('revenue was flat year over year'), timestamp: 2 });

    // The header is not rewritten (that would destroy the messages); the
    // sidecar supplies the meta instead, seeded from the transcript.
    await expect(store.loadSessionMeta(orphanId)).resolves.toMatchObject({ message_count: 2 });
    await expect(store.loadMessages(orphanId)).resolves.toHaveLength(2);
    await expect(store.searchSessions('quarterly revenue')).resolves.toHaveLength(1);
  });
});
