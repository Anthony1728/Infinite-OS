import { describe, expect, it } from 'vitest';
import { selectLocalModelTools } from './local-tool-routing.js';

const tools = [
  'WebSearch', 'WebFetch', 'Computer', 'System', 'Operator', 'Browser',
  'browser_extension',
  'Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep', 'TodoWrite', 'Git',
  'Email', 'Automation', 'Deploy', 'Security', 'Knowledge', 'Project',
].map((name) => ({ name }));

describe('small local model tool routing', () => {
  it('keeps research available for an uncertain factual answer', () => {
    expect(selectLocalModelTools('What is the latest Node release?', tools).map((tool) => tool.name))
      .toEqual(['WebSearch', 'WebFetch']);
  });

  it('attaches PC and browser tools for a visible Chrome task', () => {
    const names = selectLocalModelTools('Open Chrome and search Amazon for laptops', tools).map((tool) => tool.name);
    expect(names).toEqual(expect.arrayContaining(['WebSearch', 'WebFetch', 'Computer', 'System', 'Operator', 'Browser', 'browser_extension']));
    expect(names).not.toContain('Email');
  });

  it('attaches the coding toolchain without unrelated schemas', () => {
    const names = selectLocalModelTools('Fix this TypeScript repository and run tests', tools).map((tool) => tool.name);
    expect(names).toEqual(expect.arrayContaining(['Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep', 'TodoWrite', 'Git']));
    expect(names).not.toContain('Computer');
    expect(names).not.toContain('Email');
  });
});
