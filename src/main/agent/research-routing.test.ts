import { describe, expect, it } from 'vitest';
import { routeForcedResearchTool } from './research-routing.js';

describe('routeForcedResearchTool', () => {
  it.each([
    'Search the web for TypeScript 6 release notes',
    'look up the NVIDIA API docs online',
    'Google the best current source for this',
    'research Electron security guidance',
    'What is the latest Node.js release?',
    'Who is the current CEO of NVIDIA?',
    "today's weather forecast in Johannesburg",
    'Go and start learning things online to get smarter',
  ])('forces WebSearch for explicit or time-sensitive research: %s', (request) => {
    expect(routeForcedResearchTool(request)).toEqual({
      name: 'WebSearch',
      input: { query: request },
    });
  });

  it.each([
    'Read the current file and fix the bug',
    'Show the current directory',
    'Use the newest component in this codebase',
    'Explain this research paper',
    'Find the function in src/main',
    'Check the tests',
  ])('does not force internet research for local or non-explicit work: %s', (request) => {
    expect(routeForcedResearchTool(request)).toBeNull();
  });
});
