import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// question-prompt.ts dynamically imports electron for the BrowserWindow lookup.
// Mock it so tests run in plain Node without an Electron runtime.
vi.mock('electron', () => ({
  BrowserWindow: {
    getFocusedWindow: vi.fn(() => null),
    getAllWindows: vi.fn(() => []),
  },
}));

import { askUserQuestions, clearPendingQuestions, resolveUserQuestions, setQuestionEventEmitter } from './question-prompt.js';
import type { QuestionSpec } from './question-prompt.js';

const questions = [
  {
    header: 'Stack',
    question: 'Which framework should I use?',
    multiple: false,
    options: [
      { label: 'React', description: 'Fast to iterate' },
      { label: 'Svelte', description: 'Smaller bundles' },
    ],
    allowCustom: true,
  },
  {
    header: 'Styling',
    question: 'Which styling approach?',
    multiple: false,
    options: [
      { label: 'Tailwind', description: 'Utility-first' },
      { label: 'CSS modules', description: 'Scoped styles' },
    ],
    allowCustom: true,
  },
];

/** Ask and capture the emitted request + generated question ids. */
async function askAndCapture(sessionId: string, qs: typeof questions) {
  let captured: { request_id: string; questions: QuestionSpec[] } | null = null;
  setQuestionEventEmitter((ev) => {
    captured = ev;
  });
  const pending = askUserQuestions(qs, { sessionId });
  await Promise.resolve();
  await Promise.resolve();
  expect(captured).not.toBeNull();
  return { pending, captured: captured as unknown as { request_id: string; questions: QuestionSpec[] } };
}

beforeEach(() => {
  clearPendingQuestions();
});

afterEach(() => {
  clearPendingQuestions();
  setQuestionEventEmitter(null);
});

describe('askUserQuestions', () => {
  it('blocks until EVERY question has an answer, then resolves with all of them', async () => {
    const { pending, captured } = await askAndCapture('s1', questions);
    expect(captured.questions).toHaveLength(2);
    expect(captured.questions[0].id).not.toBe(captured.questions[1].id);

    // Partial answer must NOT settle the promise.
    expect(resolveUserQuestions(captured.request_id, { answers: { [captured.questions[0].id]: 'React' } })).toBe(false);

    resolveUserQuestions(captured.request_id, {
      answers: { [captured.questions[0].id]: 'React', [captured.questions[1].id]: 'Tailwind' },
    });
    await expect(pending).resolves.toEqual({
      answers: { [captured.questions[0].id]: 'React', [captured.questions[1].id]: 'Tailwind' },
      skipped: {},
    });
  });

  it('resolves when every question is either answered or explicitly skipped', async () => {
    const { pending, captured } = await askAndCapture('s2', questions);
    resolveUserQuestions(captured.request_id, {
      answers: { [captured.questions[0].id]: 'Svelte' },
      skipped: { [captured.questions[1].id]: true },
    });
    await expect(pending).resolves.toEqual({
      answers: { [captured.questions[0].id]: 'Svelte' },
      skipped: { [captured.questions[1].id]: true },
    });
  });

  it('rejects unknown request ids', async () => {
    expect(resolveUserQuestions('no-such-id', { answers: {} })).toBe(false);
  });

  it('times out when nobody answers', async () => {
    const pending = askUserQuestions(questions.slice(0, 1), { sessionId: 's4', timeoutMs: 20 });
    await expect(pending).resolves.toEqual({ answers: {}, skipped: {}, timedOut: true });
  });

  it('rejects empty question sets immediately', async () => {
    await expect(askUserQuestions([], { sessionId: 's5' })).resolves.toMatchObject({ timedOut: true });
  });

  it('resolves via timeout after a later resolveUserQuestions race', async () => {
    const { pending, captured } = await askAndCapture('s6', questions.slice(0, 1));
    resolveUserQuestions(captured.request_id, { answers: { [captured.questions[0].id]: 'React' } });
    await expect(pending).resolves.toMatchObject({ answers: { [captured.questions[0].id]: 'React' } });
    // Double resolution is a no-op.
    expect(resolveUserQuestions(captured.request_id, { answers: {} })).toBe(false);
  });
});
