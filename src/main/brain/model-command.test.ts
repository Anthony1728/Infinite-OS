import { describe, expect, it } from 'vitest';
import { parseModelCommand } from './model-command.js';

describe('parseModelCommand', () => {
  it('recognizes status requests', () => {
    expect(parseModelCommand('model status')).toEqual({ kind: 'status' });
    expect(parseModelCommand('which model are you using?')).toEqual({ kind: 'status' });
    expect(parseModelCommand('What model are you on')).toEqual({ kind: 'status' });
    expect(parseModelCommand('check the current model')).toEqual({ kind: 'status' });
    expect(parseModelCommand('provider health')).toEqual({ kind: 'status' });
  });

  it('recognizes "give me a working model" requests', () => {
    expect(parseModelCommand('switch to a working model')).toEqual({ kind: 'switch_working' });
    expect(parseModelCommand('switch model')).toEqual({ kind: 'switch_working' });
    expect(parseModelCommand('my model is broken')).toEqual({ kind: 'switch_working' });
    expect(parseModelCommand('the model is not working')).toEqual({ kind: 'switch_working' });
    expect(parseModelCommand('model failed')).toEqual({ kind: 'switch_working' });
    expect(parseModelCommand('fix the model')).toEqual({ kind: 'switch_working' });
    expect(parseModelCommand('use a free model')).toEqual({ kind: 'switch_working' });
    expect(parseModelCommand('fall back to another provider')).toEqual({ kind: 'switch_working' });
    expect(parseModelCommand('switch to the brain')).toEqual({ kind: 'switch_working' });
    expect(parseModelCommand('Please switch to a different model')).toEqual({ kind: 'switch_working' });
  });

  it('captures an explicit target', () => {
    expect(parseModelCommand('switch to groq')).toEqual({ kind: 'switch_target', target: 'groq' });
    expect(parseModelCommand('use nvidia')).toEqual({ kind: 'switch_target', target: 'nvidia' });
    expect(parseModelCommand('change model to gpt-4o')).toEqual({ kind: 'switch_target', target: 'gpt-4o' });
    expect(parseModelCommand('switch to llama 3.3')).toEqual({ kind: 'switch_target', target: 'llama 3.3' });
  });

  it('leaves ordinary requests for the agent', () => {
    expect(parseModelCommand('build a dashboard with a model picker component')).toBeNull();
    expect(parseModelCommand('switch to building the app and then deploy it to production')).toBeNull();
    expect(parseModelCommand('write a function that switches to the correct provider on error')).toBeNull();
    expect(parseModelCommand('hello')).toBeNull();
    expect(parseModelCommand('')).toBeNull();
    expect(parseModelCommand(undefined as unknown as string)).toBeNull();
  });

  it('ignores long, multi-sentence conversation', () => {
    expect(parseModelCommand('switch to groq. then rerun the tests. finally push the branch.')).toBeNull();
    expect(
      parseModelCommand(
        'Can you switch the model after you finish refactoring the auth module, since I need the tests green before lunch?',
      ),
    ).toBeNull();
  });
});
