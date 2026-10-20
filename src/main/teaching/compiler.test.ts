import { describe, expect, it } from 'vitest';
import { isAbsolute } from 'node:path';
import { compileRecording } from './compiler.js';
import type { TeachingEvent, TeachingRecording } from './types.js';

function recording(overrides: Partial<TeachingRecording> = {}): TeachingRecording {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    name: 'Weekly expense report',
    status: 'stopped',
    startedAt: 0,
    stoppedAt: 10_000,
    durationMs: 10_000,
    narration: '',
    events: [],
    frames: [],
    compiledSteps: [],
    ...overrides,
  };
}

const FRAMES_ROOT = 'C:\\demo\\teaching\\recordings\\11111111-1111-1111-1111-111111111111';

describe('teaching recording → task compiler', () => {
  it('turns narration sentences into one step each, annotated by what was observed', () => {
    const events: TeachingEvent[] = [
      { t: 0, type: 'window', window: 'Edge', x: 10, y: 20 },
      { t: 1_000, type: 'narration', text: 'Open the portal.' },
      { t: 3_000, type: 'click', x: 400, y: 300, button: 'left', down: true },
      { t: 5_000, type: 'narration', text: 'Export the CSV.' },
    ];
    const result = compileRecording(
      recording({
        events,
        frames: [
          { t: 2_000, path: 'frames/frame-0001.jpg', width: 800, height: 600 },
          { t: 6_000, path: 'frames/frame-0002.jpg', width: 800, height: 600 },
        ],
      }),
      FRAMES_ROOT,
    );

    expect(result).toHaveLength(2);
    expect(result[0].title).toBe('Open the portal');
    expect(result[1].title).toBe('Export the CSV');
    // The click happened between the two narrations, so it belongs to step 2.
    expect(result[0].instruction).not.toContain('Clicked');
    expect(result[1].instruction).toContain('Clicked once at (400, 300).');
    expect(result[1].instruction).toContain('Observed during the demo');
    // Frames are absolutized so the worker's Read tool can open them.
    for (const step of result) {
      expect(step.referenceFrame).toBeTruthy();
      expect(isAbsolute(step.referenceFrame!)).toBe(true);
      expect(step.referenceFrame!.startsWith(FRAMES_ROOT)).toBe(true);
    }
    expect(result[0].referenceFrame).toContain('frame-0001');
    expect(result[1].referenceFrame).toContain('frame-0002');
  });

  it('is deterministic: same recording in, same task out', () => {
    const source = recording({
      narration: 'Check the inbox. Reply to anything routine. Leave a summary.',
      events: [
        { t: 500, type: 'click', x: 10, y: 10 },
        { t: 2_000, type: 'window', window: 'Outlook' },
        { t: 3_000, type: 'click', x: 20, y: 20 },
      ],
      frames: [{ t: 1_500, path: 'frames/frame-0001.jpg', width: 640, height: 480 }],
    });
    const first = compileRecording(source, FRAMES_ROOT);
    const second = compileRecording(source, FRAMES_ROOT);
    expect(second.map((step) => [step.title, step.instruction, step.referenceFrame]))
      .toEqual(first.map((step) => [step.title, step.instruction, step.referenceFrame]));
    expect(first.map((step) => step.title)).toEqual(['Check the inbox', 'Reply to anything routine', 'Leave a summary']);
  });

  it('groups actions into runs when nobody narrated', () => {
    const result = compileRecording(recording({
      events: [
        { t: 0, type: 'window', window: 'Notepad' },
        { t: 1_000, type: 'click', x: 5, y: 5 },
        { t: 20_000, type: 'window', window: 'Calculator' },
        { t: 20_500, type: 'click', x: 9, y: 9 },
      ],
    }), FRAMES_ROOT);

    expect(result).toHaveLength(2);
    expect(result[0].title).toBe('Notepad');
    expect(result[1].title).toBe('Calculator');
    expect(result[0].instruction).toContain('Clicked once');
  });

  it('never returns an empty step list', () => {
    const result = compileRecording(recording({ narration: '' }), FRAMES_ROOT);
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe('Weekly expense report');
    expect(result[0].instruction).toContain('Reproduce the task');
  });

  it('uses free-form narration when no timed narration events were captured', () => {
    const result = compileRecording(recording({ narration: 'Restart the build machine. Verify the log is clean.' }), FRAMES_ROOT);
    expect(result.map((step) => step.title)).toEqual(['Restart the build machine', 'Verify the log is clean']);
  });

  it('caps runaway recordings instead of emitting hundreds of steps', () => {
    const events: TeachingEvent[] = [];
    for (let i = 0; i < 200; i++) {
      events.push({ t: i * 100, type: 'narration', text: `Action number ${i}.` });
    }
    expect(compileRecording(recording({ events }), FRAMES_ROOT)).toHaveLength(30);
  });
});
