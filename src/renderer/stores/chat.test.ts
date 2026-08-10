import { describe, expect, it } from 'vitest';
import { formatRuntimeIdentity, inferExecutionMode, isModelIdentityQuestion, requiresOrchestration } from './chat';

describe('automatic chat execution mode', () => {
  it('returns to chat mode for ordinary conversation', () => {
    expect(inferExecutionMode('Hey, how are you today?')).toBe('chat');
    expect(inferExecutionMode('Can we chat about motivation?')).toBe('chat');
  });

  it('routes creation requests to creative mode', () => {
    expect(inferExecutionMode('Create a modern dashboard for my business')).toBe('build');
    expect(inferExecutionMode('Build me a portfolio website')).toBe('build');
  });

  it('routes software changes to code mode', () => {
    expect(inferExecutionMode('Fix the bug in the TypeScript component')).toBe('code');
    expect(inferExecutionMode('Add a feature to the sidebar')).toBe('code');
  });

  it('routes research and computer actions to their execution modes', () => {
    expect(inferExecutionMode('Research the latest browser security guidance')).toBe('research');
    expect(inferExecutionMode('Open Chrome and search for local suppliers')).toBe('agent');
  });
});

describe('truthful runtime model identity', () => {
  it('recognizes direct model identity questions', () => {
    expect(isModelIdentityQuestion('What model are you using?')).toBe(true);
    expect(isModelIdentityQuestion('Which AI model is Infinite OS running on')).toBe(true);
    expect(isModelIdentityQuestion('What can this model create?')).toBe(false);
  });

  it('reports the configured provider, friendly name, and exact model id', () => {
    const result = formatRuntimeIdentity('opencode', 'opencode::mimo-v2.5-free', 'MiMo V2.5 Free');
    expect(result).toContain('**MiMo V2.5 Free**');
    expect(result).toContain('`opencode::mimo-v2.5-free`');
    expect(result).toContain('**OpenCode Zen**');
    expect(result).not.toContain('NVIDIA');
  });
});

describe('complex task routing', () => {
  it('routes long build work to orchestration without the single-chat timeout', () => {
    expect(requiresOrchestration('Build a complete dashboard application with authentication, persistence, responsive UI, tests, and deployment configuration.')).toBe(true);
    expect(requiresOrchestration('Fix one typo')).toBe(false);
  });
});
