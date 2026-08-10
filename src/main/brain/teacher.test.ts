import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { BrainTeachingManager, type DistilledLesson } from './teacher.js';

const temporaryDirectories: string[] = [];

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'infinite-brain-teacher-'));
  temporaryDirectories.push(directory);
  return directory;
}

function lesson(overrides: Partial<DistilledLesson> = {}): DistilledLesson {
  return {
    id: 'lesson-1',
    fingerprint: 'fingerprint-1',
    createdAt: 1,
    category: 'coding',
    topic: 'debugging',
    title: 'Debug from evidence',
    question: 'How should an agent diagnose a failing TypeScript test?',
    answer: 'Reproduce the exact failure, inspect the smallest relevant code path, form a testable hypothesis, and rerun the focused test before broad validation.',
    example: 'Run the failing Vitest file, inspect its stack trace, patch the cause, then run typecheck and the full suite.',
    useWhen: 'A repository task reports a code failure or regression.',
    cautions: ['Preserve unrelated changes.'],
    tags: ['typescript', 'debugging', 'tests'],
    source: { provider: 'test', model: 'test-model' },
    ...overrides,
  };
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('BrainTeachingManager', () => {
  it('does not start a teaching session automatically', () => {
    const manager = new BrainTeachingManager({ dataDir: temporaryDirectory() });
    expect(manager.getStatus()).toMatchObject({
      state: 'idle',
      sessionId: null,
      lessonsAdded: 0,
      message: 'Ready to teach when asked.',
    });
  });

  it('loads persisted lessons and retrieves the most relevant knowledge', () => {
    const dataDir = temporaryDirectory();
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(join(dataDir, 'distilled-lessons.json'), JSON.stringify({
      version: 1,
      lessons: [
        lesson(),
        lesson({
          id: 'lesson-2',
          fingerprint: 'fingerprint-2',
          createdAt: 2,
          category: 'general',
          topic: 'conversation',
          title: 'Answer directly',
          question: 'How should an assistant respond clearly?',
          answer: 'Lead with the outcome and use only the detail needed to make the result understandable and actionable.',
          example: 'State the fix first, then mention validation.',
          useWhen: 'Writing a response to the user.',
          cautions: [],
          tags: ['conversation'],
        }),
      ],
    }));

    const manager = new BrainTeachingManager({ dataDir });
    expect(manager.getStatus().totalStoredLessons).toBe(2);
    expect(manager.searchLessons('TypeScript test debugging', 1)[0]?.id).toBe('lesson-1');
    expect(manager.searchLessons('unrelated phrase')).toEqual([]);
  });

  it('accepts only the two safe teaching durations', async () => {
    const manager = new BrainTeachingManager({ dataDir: temporaryDirectory() });
    await expect(manager.start({ durationMinutes: 5 as 10 })).rejects.toThrow('10 or 60 minutes');
    expect(manager.getStatus().state).toBe('idle');
  });
});
