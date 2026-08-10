import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../agent/computer-singleton.js', () => ({
  getComputerControl: () => ({
    clickMouse: vi.fn(),
    moveMouse: vi.fn(),
    typeText: vi.fn(),
    pressKey: vi.fn(),
    scroll: vi.fn(),
    captureScreen: vi.fn(),
    openApplication: vi.fn(),
  }),
}));

import { TaskReplayEngine } from './index.js';

afterEach(() => {
  vi.useRealTimers();
});

describe('TaskReplay pause and resume', () => {
  it('resumes the existing run without restarting completed steps', async () => {
    vi.useFakeTimers();
    const replay = new TaskReplayEngine();
    const executionStarted = vi.fn();
    replay.on('executionStarted', executionStarted);

    const execution = await replay.executeTask('safe timer replay', [
      { type: 'wait', params: { duration: 100 }, description: 'first wait' },
      { type: 'wait', params: { duration: 100 }, description: 'second wait' },
    ]);

    expect(executionStarted).toHaveBeenCalledTimes(1);
    expect(replay.pauseExecution(execution.id)).toBe(true);

    await vi.advanceTimersByTimeAsync(300);
    expect(execution.status).toBe('paused');
    expect(execution.steps[0].status).toBe('completed');
    expect(execution.steps[1].status).toBe('pending');

    expect(replay.resumeExecution(execution.id)).toBe(true);
    await vi.runAllTimersAsync();

    expect(executionStarted).toHaveBeenCalledTimes(1);
    expect(execution.status).toBe('completed');
    expect(execution.steps.map((step) => step.status)).toEqual(['completed', 'completed']);
  });
});
