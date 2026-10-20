import { describe, expect, it, beforeEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const home = mkdtempSync(join(tmpdir(), 'convsearch-test-'));
process.env.INFINITE_TEST_HOME = home;

const store = await import('../session/store.js');
const { conversationSearchTool, collectSnippets } = await import('./conversation-search.js');

const text = (value: string) => [{ type: 'text' as const, text: value }];

function ctx() {
  return { cwd: process.cwd(), abortSignal: new AbortController().signal, sessionId: 'test', onUpdate: () => {} };
}

describe('collectSnippets', () => {
  it('extracts a snippet around the match', () => {
    const snippets = collectSnippets(
      { id: 's1', title: 'T', updated_at: 5 },
      [{ id: 'm1', role: 'user', content: text('before the needle here after') }],
      'needle',
      10,
    );
    expect(snippets).toHaveLength(1);
    expect(snippets[0].snippet).toContain('needle');
    expect(snippets[0].sessionId).toBe('s1');
  });

  it('returns nothing when there is no match', () => {
    const snippets = collectSnippets(
      { id: 's1', title: 'T', updated_at: 5 },
      [{ id: 'm1', role: 'assistant', content: text('nothing relevant') }],
      'needle',
      10,
    );
    expect(snippets).toHaveLength(0);
  });

  it('caps snippets per session', () => {
    const messages = Array.from({ length: 10 }, (_, i) => ({
      id: `m${i}`,
      role: 'user',
      content: text(`needle match ${i}`),
    }));
    const snippets = collectSnippets({ id: 's1', title: 'T', updated_at: 5 }, messages, 'needle', 5);
    expect(snippets.length).toBeLessThanOrEqual(3);
  });
});

describe('ConversationSearch tool', () => {
  beforeEach(async () => {
    await store.clearAllSessions();
  });

  it('returns no matches for an empty corpus', async () => {
    const result = await conversationSearchTool.execute({ query: 'anything' }, ctx());
    expect(result.is_error).toBeFalsy();
    const textOut = typeof result.content === 'string' ? result.content : JSON.stringify(result.content);
    expect(textOut).toMatch(/No conversations matched/);
  });

  it('finds a conversation by message content', async () => {
    const session = await store.createSession({ cwd: process.cwd(), model: 'm', provider: 'p', title: 'Planning' });
    await store.appendMessage(session.id, { id: 'u1', role: 'user', content: text('we need to deploy the billing service'), timestamp: 1 });
    await store.appendMessage(session.id, { id: 'a1', role: 'assistant', content: text('deploying now'), timestamp: 2 });

    const result = await conversationSearchTool.execute({ query: 'billing service' }, ctx());
    const textOut = typeof result.content === 'string' ? result.content : JSON.stringify(result.content);
    expect(textOut).toContain('Planning');
    expect(textOut).toContain(session.id);
    expect(textOut).toContain('billing service');
  });

  it('requires a query', async () => {
    const result = await conversationSearchTool.execute({ query: '   ' }, ctx());
    expect(result.is_error).toBe(true);
  });

  it('searches archived conversations when requested', async () => {
    const session = await store.createSession({ cwd: process.cwd(), model: 'm', provider: 'p', title: 'Archived chat' });
    await store.appendMessage(session.id, { id: 'u1', role: 'user', content: text('secret archived topic'), timestamp: 1 });
    await store.setSessionArchived(session.id, true);

    const liveOnly = await conversationSearchTool.execute({ query: 'secret archived topic' }, ctx());
    const liveText = typeof liveOnly.content === 'string' ? liveOnly.content : JSON.stringify(liveOnly.content);
    expect(liveText).toMatch(/No conversations matched/);

    const withArchived = await conversationSearchTool.execute({ query: 'secret archived topic', includeArchived: true }, ctx());
    const archivedText = typeof withArchived.content === 'string' ? withArchived.content : JSON.stringify(withArchived.content);
    expect(archivedText).toContain('Archived chat');
  });

  it('matches a natural question whose words are not adjacent', async () => {
    const session = await store.createSession({ cwd: process.cwd(), model: 'm', provider: 'p', title: 'Deploy plan' });
    await store.appendMessage(session.id, {
      id: 'u1',
      role: 'user',
      content: text('we need to deploy the postgres database tonight'),
      timestamp: 1,
    });

    const result = await conversationSearchTool.execute({ query: 'deploy postgres' }, ctx());
    const out = typeof result.content === 'string' ? result.content : JSON.stringify(result.content);
    expect(out).toContain('Deploy plan');
    expect(out).toContain(session.id);
    expect(out).toContain('postgres');
  });

  it('requires every word of the query to be present', async () => {
    await store.createSession({ cwd: process.cwd(), model: 'm', provider: 'p', title: 'Database' });
    const session = await store.createSession({ cwd: process.cwd(), model: 'm', provider: 'p', title: 'Passing' });
    await store.appendMessage(session.id, {
      id: 'u1',
      role: 'user',
      content: text('we only mention postgres in passing'),
      timestamp: 1,
    });

    const result = await conversationSearchTool.execute({ query: 'deploy postgres' }, ctx());
    const out = typeof result.content === 'string' ? result.content : JSON.stringify(result.content);
    expect(out).toMatch(/No conversations matched/);
  });

  it('keeps a title match even when the body never repeats the word', async () => {
    const session = await store.createSession({ cwd: process.cwd(), model: 'm', provider: 'p', title: 'Postgres migration' });
    await store.appendMessage(session.id, { id: 'u1', role: 'user', content: text('nothing to see here'), timestamp: 1 });

    const result = await conversationSearchTool.execute({ query: 'postgres' }, ctx());
    const out = typeof result.content === 'string' ? result.content : JSON.stringify(result.content);
    expect(out).toContain('Postgres migration');
    expect(out).toContain(session.id);
  });

  it('reports the message id of each match', async () => {
    const session = await store.createSession({ cwd: process.cwd(), model: 'm', provider: 'p', title: 'Deploy plan' });
    await store.appendMessage(session.id, {
      id: 'u1',
      role: 'user',
      content: text('we need to deploy the postgres database tonight'),
      timestamp: 1,
    });

    const result = await conversationSearchTool.execute({ query: 'postgres' }, ctx());
    const out = typeof result.content === 'string' ? result.content : JSON.stringify(result.content);
    expect(out).toContain('u1');
  });

  it('restricts matches to one speaker when asked', async () => {
    const session = await store.createSession({ cwd: process.cwd(), model: 'm', provider: 'p', title: 'Credentials' });
    await store.appendMessage(session.id, { id: 'u1', role: 'user', content: text('hello there'), timestamp: 1 });
    await store.appendMessage(session.id, {
      id: 'a1',
      role: 'assistant',
      content: text('the passphrase is hunter2'),
      timestamp: 2,
    });

    const asUser = await conversationSearchTool.execute({ query: 'hunter2', role: 'user' }, ctx());
    const userText = typeof asUser.content === 'string' ? asUser.content : JSON.stringify(asUser.content);
    expect(userText).toMatch(/No conversations matched/);

    const asAssistant = await conversationSearchTool.execute({ query: 'hunter2', role: 'assistant' }, ctx());
    const assistantText =
      typeof asAssistant.content === 'string' ? asAssistant.content : JSON.stringify(asAssistant.content);
    expect(assistantText).toContain('hunter2');
    expect(assistantText).toContain('assistant');
    expect(assistantText).toContain(session.id);
  });

  it('caps the number of snippets it returns', async () => {
    const session = await store.createSession({ cwd: process.cwd(), model: 'm', provider: 'p', title: 'Long chat' });
    for (let i = 0; i < 10; i++) {
      await store.appendMessage(session.id, {
        id: `u${i}`,
        role: 'user',
        content: text(`mention of kubernetes number ${i}`),
        timestamp: i + 1,
      });
    }

    const result = await conversationSearchTool.execute({ query: 'kubernetes', limit: 2 }, ctx());
    const out = typeof result.content === 'string' ? result.content : JSON.stringify(result.content);
    const snippetLines = out.split('\n').filter((line) => line.trim().startsWith('user ('));
    expect(snippetLines).toHaveLength(2);
  });

  it('ranks the strongest conversation first', async () => {
    const titled = await store.createSession({ cwd: process.cwd(), model: 'm', provider: 'p', title: 'Kubernetes notes' });
    await store.appendMessage(titled.id, { id: 'u1', role: 'user', content: text('nothing here'), timestamp: 1 });
    const mentioned = await store.createSession({ cwd: process.cwd(), model: 'm', provider: 'p', title: 'Small talk' });
    await store.appendMessage(mentioned.id, {
      id: 'u2',
      role: 'user',
      content: text('we talked about kubernetes for a while'),
      timestamp: 2,
    });

    const result = await conversationSearchTool.execute({ query: 'kubernetes' }, ctx());
    const out = typeof result.content === 'string' ? result.content : JSON.stringify(result.content);
    expect(out.indexOf('Kubernetes notes')).toBeLessThan(out.indexOf('Small talk'));
  });
});
