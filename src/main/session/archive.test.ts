import { describe, expect, it, beforeEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * The archive is a flag, not a move.
 *
 * That distinction is the whole contract: an archive you cannot resume from is
 * just a bin. These tests pin that the transcript is never rewritten, that
 * restoring gives back the exact thread, and that search cannot leak live
 * conversations into the archive results.
 */

const home = mkdtempSync(join(tmpdir(), 'archive-test-'));
process.env.INFINITE_TEST_HOME = home;

const store = await import('./store.js');

const text = (value: string) => [{ type: 'text' as const, text: value }];

describe('archiving a conversation', () => {
  beforeEach(async () => {
    await store.clearAllSessions();
  });

  it('marks the session archived without touching the transcript', async () => {
    const session = await store.createSession({ cwd: process.cwd(), model: 'm', provider: 'p' });
    await store.appendMessage(session.id, { id: 'u1', role: 'user', content: text('a real question'), timestamp: 1 });
    await store.appendMessage(session.id, { id: 'a1', role: 'assistant', content: text('a real answer'), timestamp: 2 });

    await store.setSessionArchived(session.id, true);

    // The messages must still be there, unchanged and in order.
    const messages = await store.loadMessages(session.id);
    expect(messages).toHaveLength(2);
    expect(messages[0].content[0]).toMatchObject({ text: 'a real question' });
    expect(messages[1].content[0]).toMatchObject({ text: 'a real answer' });
  });

  it('hides it from the archive before it is filed, and shows it after', async () => {
    const session = await store.createSession({ cwd: process.cwd(), model: 'm', provider: 'p' });
    expect(await store.listArchivedSessions()).toHaveLength(0);

    await store.setSessionArchived(session.id, true);
    const archived = await store.listArchivedSessions();
    expect(archived).toHaveLength(1);
    expect(archived[0].id).toBe(session.id);
  });

  it('restores the exact conversation, not a summary of it', async () => {
    const session = await store.createSession({ cwd: process.cwd(), model: 'm', provider: 'p' });
    await store.appendMessage(session.id, { id: 'u1', role: 'user', content: text('question'), timestamp: 1 });
    await store.setSessionArchived(session.id, true);
    await store.setSessionArchived(session.id, false);

    expect(await store.listArchivedSessions()).toHaveLength(0);
    const messages = await store.loadMessages(session.id);
    expect(messages).toHaveLength(1);
    expect(messages[0].content[0]).toMatchObject({ text: 'question' });
  });

  it('stamps when it was filed, so the list can be ordered by that', async () => {
    const session = await store.createSession({ cwd: process.cwd(), model: 'm', provider: 'p' });
    const archived = await store.setSessionArchived(session.id, true);
    expect(typeof archived.archived_at).toBe('number');
    expect(archived.archived_at).toBeGreaterThan(0);
  });

  it('orders the archive by when each conversation was filed, newest first', async () => {
    const first = await store.createSession({ cwd: process.cwd(), model: 'm', provider: 'p' });
    await store.setSessionArchived(first.id, true);
    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = await store.createSession({ cwd: process.cwd(), model: 'm', provider: 'p' });
    await store.setSessionArchived(second.id, true);

    const archived = await store.listArchivedSessions();
    expect(archived.map((s) => s.id)).toEqual([second.id, first.id]);
  });

  it('refuses to archive a conversation that does not exist', async () => {
    await expect(store.setSessionArchived('nope', true)).rejects.toThrow();
  });
});

describe('searching the archive', () => {
  beforeEach(async () => {
    await store.clearAllSessions();
  });

  it('finds an archived conversation by what was said inside it', async () => {
    const session = await store.createSession({ cwd: process.cwd(), model: 'm', provider: 'p' });
    await store.appendMessage(session.id, { id: 'u1', role: 'user', content: text('the invoice totals are wrong'), timestamp: 1 });
    await store.setSessionArchived(session.id, true);

    const found = await store.searchArchivedSessions('invoice totals');
    expect(found.map((s) => s.id)).toContain(session.id);
  });

  it('never returns a live conversation the user has not filed', async () => {
    const live = await store.createSession({ cwd: process.cwd(), model: 'm', provider: 'p' });
    await store.appendMessage(live.id, { id: 'u1', role: 'user', content: text('secret live topic'), timestamp: 1 });

    // The live chat contains the phrase, but it is not archived, so an archive
    // search must not turn it up. This is the one thing an archive must never do.
    const found = await store.searchArchivedSessions('secret live topic');
    expect(found).toHaveLength(0);
  });

  it('returns everything when the query is empty', async () => {
    const a = await store.createSession({ cwd: process.cwd(), model: 'm', provider: 'p' });
    const b = await store.createSession({ cwd: process.cwd(), model: 'm', provider: 'p' });
    await store.setSessionArchived(a.id, true);
    await store.setSessionArchived(b.id, true);
    expect(await store.searchArchivedSessions('   ')).toHaveLength(2);
  });

  it('matches on the title as well as the body', async () => {
    const session = await store.createSession({ cwd: process.cwd(), model: 'm', provider: 'p', title: 'Quarterly review' });
    await store.setSessionArchived(session.id, true);
    const found = await store.searchArchivedSessions('quarterly');
    expect(found.map((s) => s.id)).toContain(session.id);
  });

  it('matches case-insensitively, as a search should', async () => {
    const session = await store.createSession({ cwd: process.cwd(), model: 'm', provider: 'p' });
    await store.appendMessage(session.id, { id: 'u1', role: 'user', content: text('Deploy Failed'), timestamp: 1 });
    await store.setSessionArchived(session.id, true);
    expect(await store.searchArchivedSessions('deploy failed')).toHaveLength(1);
  });
});