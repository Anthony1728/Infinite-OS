import { describe, expect, it, beforeEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * The conversation search engine.
 *
 * Every leading AI workspace shipped "the agent can find its own earlier
 * conversations" in 2026 - Claude Code pairs search with rewind, OpenCode
 * filters server-side, Grok Build indexes sessions, OpenClaw turned it into a
 * headline recall feature. They all had to solve the same three problems:
 *
 *   1. a natural question is not a literal substring ("deploy postgres" has to
 *      find "deploy the postgres database"),
 *   2. a title match is still a match, even when the body never repeats it,
 *   3. a conversation filed in the archive must not leak back into the
 *      everyday list.
 *
 * These tests pin all three, plus the ranking that makes the agent's answer
 * useful rather than merely complete.
 */

const home = mkdtempSync(join(tmpdir(), 'session-search-test-'));
process.env.INFINITE_TEST_HOME = home;

const store = await import('./store.js');
const { parseQuery, matchText, buildSnippet, searchConversations } = await import('./search.js');

const text = (value: string) => [{ type: 'text' as const, text: value }];

async function seed(
  title: string,
  turns: Array<{ role: 'user' | 'assistant'; text: string }>,
): Promise<{ id: string; title: string }> {
  const session = await store.createSession({
    cwd: process.cwd(),
    model: 'm',
    provider: 'p',
    title,
  });
  for (const [index, turn] of turns.entries()) {
    await store.appendMessage(session.id, {
      id: `m${index}`,
      role: turn.role,
      content: text(turn.text),
      timestamp: index + 1,
    });
  }
  return session;
}

describe('parseQuery', () => {
  it('drops question words and keeps the words that carry meaning', () => {
    const spec = parseQuery('what did we decide about the billing service');
    expect(spec.terms.map((term) => term.text)).toEqual(['decide', 'billing', 'service']);
  });

  it('keeps a quoted phrase whole so it has to match literally', () => {
    const spec = parseQuery('"deploy script" postgres');
    expect(spec.terms[0]).toEqual({ text: 'deploy script', phrase: true });
    expect(spec.terms[1]).toEqual({ text: 'postgres', phrase: false });
  });

  it('keeps every word when the query is made only of question words', () => {
    const spec = parseQuery('what is it');
    expect(spec.terms.map((term) => term.text)).toEqual(['what', 'is', 'it']);
  });

  it('has no terms for an empty query', () => {
    expect(parseQuery('   ').terms).toEqual([]);
  });
});

describe('matchText', () => {
  it('matches inside a longer word but scores a word boundary higher', () => {
    const spec = parseQuery('deploy');
    const inside = matchText('deployment notes', spec);
    const boundary = matchText('deploy the app', spec);
    expect(inside.matched).toEqual([0]);
    expect(inside.exact).toBe(0);
    expect(boundary.exact).toBe(1);
  });

  it('requires a quoted phrase to appear in that exact order', () => {
    const spec = parseQuery('"deploy script"');
    expect(matchText('we ran the deploy script twice', spec).matched).toEqual([0]);
    expect(matchText('script deploy ran', spec).matched).toEqual([]);
  });
});

describe('buildSnippet', () => {
  it('keeps the match inside the window and marks the cut', () => {
    const haystack = `${'a'.repeat(60)}needle${'b'.repeat(60)}`;
    const snippet = buildSnippet(haystack, parseQuery('needle'), 20);
    expect(snippet).toContain('needle');
    expect(snippet.startsWith('…')).toBe(true);
    expect(snippet.endsWith('…')).toBe(true);
  });

  it('normalises the whitespace of a multi-line message', () => {
    const snippet = buildSnippet('first line\n\nsecond   line needle', parseQuery('needle'), 60);
    expect(snippet).toBe('first line second line needle');
  });
});

describe('searchConversations', () => {
  beforeEach(async () => {
    await store.clearAllSessions();
  });

  it('finds a conversation when the words of the query are not adjacent', async () => {
    await seed('Deploy plan', [{ role: 'user', text: 'we need to deploy the postgres database tonight' }]);

    const hits = await searchConversations({ query: 'deploy postgres' });
    expect(hits).toHaveLength(1);
    expect(hits[0].snippets[0].snippet).toContain('postgres');
  });

  it('requires every word of the query to be present', async () => {
    await seed('Database', [{ role: 'user', text: 'we only mention postgres in passing' }]);

    const hits = await searchConversations({ query: 'deploy postgres' });
    expect(hits).toHaveLength(0);
  });

  it('keeps a title match even when the body never repeats the word', async () => {
    const session = await seed('Postgres migration', [{ role: 'user', text: 'nothing to see here' }]);

    const hits = await searchConversations({ query: 'postgres' });
    expect(hits).toHaveLength(1);
    expect(hits[0].session.id).toBe(session.id);
    expect(hits[0].snippets[0].source).toBe('title');
    expect(hits[0].snippets[0].snippet).toContain('Postgres migration');
  });

  it('ranks a title match above a conversation that only mentions the word', async () => {
    await seed('Postgres notes', [{ role: 'user', text: 'nothing to see here' }]);
    await seed('Small talk', [{ role: 'user', text: 'we talked about postgres at some length' }]);

    const hits = await searchConversations({ query: 'postgres' });
    expect(hits).toHaveLength(2);
    expect(hits[0].session.title).toBe('Postgres notes');
  });

  it('hides conversations filed in the archive unless they are asked for', async () => {
    const session = await seed('Filed away', [{ role: 'user', text: 'a secret unicorn topic' }]);
    await store.setSessionArchived(session.id, true);

    expect(await searchConversations({ query: 'unicorn' })).toHaveLength(0);

    const withArchived = await searchConversations({ query: 'unicorn', includeArchived: true });
    expect(withArchived).toHaveLength(1);
    expect(withArchived[0].archived).toBe(true);
  });

  it('restricts body matches to the requested speaker', async () => {
    await seed('Credentials', [
      { role: 'user', text: 'hello there' },
      { role: 'assistant', text: 'the passphrase is hunter2' },
    ]);

    const asUser = await searchConversations({ query: 'hunter2', role: 'user' });
    expect(asUser).toHaveLength(0);

    const asAssistant = await searchConversations({ query: 'hunter2', role: 'assistant' });
    expect(asAssistant).toHaveLength(1);
    expect(asAssistant[0].snippets[0].role).toBe('assistant');
  });

  it('returns the message id so the caller can pull the exact turn', async () => {
    await seed('Deploy plan', [
      { role: 'user', text: 'we need to deploy the postgres database tonight' },
    ]);

    const hits = await searchConversations({ query: 'postgres' });
    expect(hits[0].snippets[0].messageId).toBe('m0');
  });

  it('returns every live conversation for an empty query', async () => {
    await seed('One', [{ role: 'user', text: 'first' }]);
    await seed('Two', [{ role: 'user', text: 'second' }]);

    const hits = await searchConversations({ query: '' });
    expect(hits).toHaveLength(2);
  });
});

describe('the search the sidebar uses', () => {
  beforeEach(async () => {
    await store.clearAllSessions();
  });

  it('never returns a conversation filed in the archive', async () => {
    const session = await seed('Filed away', [{ role: 'user', text: 'a secret unicorn topic' }]);
    await store.setSessionArchived(session.id, true);

    expect(await store.searchSessions('unicorn')).toHaveLength(0);
  });

  it('matches word by word, the same way the agent does', async () => {
    await seed('Deploy plan', [{ role: 'user', text: 'we need to deploy the postgres database tonight' }]);

    const hits = await store.searchSessions('deploy postgres');
    expect(hits).toHaveLength(1);
    expect(hits[0].title).toBe('Deploy plan');
  });

  it('keeps the archive search inside the archive', async () => {
    const live = await seed('Live chat', [{ role: 'user', text: 'a shared keyword' }]);
    const filed = await seed('Filed chat', [{ role: 'user', text: 'a shared keyword' }]);
    await store.setSessionArchived(filed.id, true);

    const archivedHits = await store.searchArchivedSessions('shared keyword');
    expect(archivedHits.map((hit) => hit.id)).toEqual([filed.id]);
    expect(archivedHits.map((hit) => hit.id)).not.toContain(live.id);
  });
});
