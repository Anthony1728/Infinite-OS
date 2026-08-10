import { describe, expect, it } from 'vitest';
import { buildBrainTeachingContext, formatBrainTeachingResult, parseBrainTeachingCommand } from './brainTeaching';

describe('parseBrainTeachingCommand', () => {
  it('parses short and hour-long teaching sessions', () => {
    expect(parseBrainTeachingCommand('/teach 10m')).toEqual({
      action: 'start', durationMinutes: 10, source: 'curriculum',
    });
    expect(parseBrainTeachingCommand('/teach 1h coding agents')).toEqual({
      action: 'start',
      durationMinutes: 60,
      source: 'topic',
      topic: 'coding agents',
    });
  });

  it('supports conversation, last-task, and natural teaching requests', () => {
    expect(parseBrainTeachingCommand('/teach conversation')).toEqual({
      action: 'start', durationMinutes: 10, source: 'conversation',
    });
    expect(parseBrainTeachingCommand('/teach last')).toEqual({
      action: 'start', durationMinutes: 10, source: 'last-task',
    });
    expect(parseBrainTeachingCommand('teach Infinite Brain what you just did')).toEqual({
      action: 'start', durationMinutes: 10, source: 'last-task',
    });
  });

  it('lets the selected model start a natural timed teaching session', () => {
    expect(parseBrainTeachingCommand('GLM-5, start teaching Infinite Brain for an hour')).toEqual({
      action: 'start', durationMinutes: 60, source: 'curriculum',
    });
    expect(parseBrainTeachingCommand('Tell GLM-5 to teach Infinite AI Brain for 10 minutes based on cars')).toEqual({
      action: 'start', durationMinutes: 10, source: 'topic', topic: 'cars',
    });
  });

  it('turns natural online-learning requests into real background research', () => {
    expect(parseBrainTeachingCommand('Go and start learning things online to get smarter so you can help me and do more things for me.')).toEqual({
      action: 'start', durationMinutes: 10, source: 'online',
    });
  });

  it('parses status and stop without intercepting normal chat', () => {
    expect(parseBrainTeachingCommand('/teach status')).toEqual({ action: 'status' });
    expect(parseBrainTeachingCommand('/teach stop')).toEqual({ action: 'stop' });
    expect(parseBrainTeachingCommand('teach me TypeScript')).toBeNull();
  });

  it('shows help for unsupported or unsafe durations', () => {
    expect(parseBrainTeachingCommand('/teach')).toEqual({ action: 'help' });
    expect(parseBrainTeachingCommand('/teach 5m')).toEqual({ action: 'help' });
    expect(parseBrainTeachingCommand('/teach 2h')).toEqual({ action: 'help' });
  });
});

describe('buildBrainTeachingContext', () => {
  const messages = [
    { role: 'user', content: [{ type: 'text', text: 'Fix the login race.' }] },
    { role: 'assistant', content: [{ type: 'text', text: 'Added a mutex and regression test.' }] },
    { role: 'user', content: [{ type: 'text', text: 'Thanks.' }] },
  ];

  it('extracts the last completed user/assistant task pair', () => {
    const context = buildBrainTeachingContext(messages, 'last-task');
    expect(context).toContain('Fix the login race.');
    expect(context).toContain('Added a mutex and regression test.');
    expect(context).not.toContain('Thanks.');
  });

  it('includes recent turns for conversation teaching', () => {
    expect(buildBrainTeachingContext(messages, 'conversation')).toContain('Thanks.');
  });
});

describe('formatBrainTeachingResult', () => {
  it('shows useful progress without internal failures', () => {
    const result = formatBrainTeachingResult('status', {
      active: true,
      lessonsCompleted: 7,
      durationMinutes: 10,
      currentTopic: 'TypeScript testing',
    });
    expect(result).toContain('7 lessons saved');
    expect(result).toContain('TypeScript testing');
    expect(result).not.toMatch(/error|failed/i);
  });

  it('does not claim teaching started without a configured model', () => {
    expect(formatBrainTeachingResult('start', { active: false })).toContain('not ready yet');
  });
});
