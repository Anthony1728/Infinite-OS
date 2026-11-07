import { describe, it, expect } from 'vitest';
import { isMermaidLanguage, normalizeMermaidSource, extractMermaidBlocks } from './mermaid.js';

describe('mermaid helpers', () => {
  it('detects mermaid language case-insensitively', () => {
    expect(isMermaidLanguage('mermaid')).toBe(true);
    expect(isMermaidLanguage('Mermaid')).toBe(true);
    expect(isMermaidLanguage('  MERMAID  ')).toBe(true);
    expect(isMermaidLanguage('python')).toBe(false);
    expect(isMermaidLanguage(undefined)).toBe(false);
    expect(isMermaidLanguage(null)).toBe(false);
  });

  it('normalizes CRLF and trailing newlines', () => {
    expect(normalizeMermaidSource('graph TD\r\n  A-->B\r\n\r\n')).toBe('graph TD\n  A-->B');
  });

  it('extracts mermaid blocks', () => {
    const text = 'intro\n```mermaid\ngraph TD\n  A-->B\n```\n```python\nprint(1)\n```\n```mermaid\nsequenceDiagram\n  A->>B: hi\n```';
    expect(extractMermaidBlocks(text)).toEqual(['graph TD\n  A-->B', 'sequenceDiagram\n  A->>B: hi']);
  });

  it('ignores empty mermaid blocks', () => {
    expect(extractMermaidBlocks('```mermaid\n\n```')).toEqual([]);
  });
});
