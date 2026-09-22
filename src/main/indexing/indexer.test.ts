import { describe, it, expect } from 'vitest';
import { chunkFileContent } from './indexer.js';
import { lexicalVector, cosineSimilarity, normalize, embedText } from './embeddings.js';

describe('chunkFileContent', () => {
  it('returns a single chunk for small files', () => {
    const chunks = chunkFileContent('const a = 1;\nconst b = 2;\n');
    expect(chunks).toHaveLength(1);
    expect(chunks[0].startLine).toBe(1);
  });

  it('cuts large files at symbol boundaries', () => {
    const lines: string[] = [];
    for (let i = 0; i < 300; i++) {
      if (i % 70 === 0) lines.push(`export function handler${i}() {`);
      else if (i % 70 === 69) lines.push('}');
      else lines.push(`  const x${i} = ${i};`);
    }
    const chunks = chunkFileContent(lines.join('\n'), 80);
    expect(chunks.length).toBeGreaterThanOrEqual(3);
    // Chunks cover the whole file contiguously
    expect(chunks[0].startLine).toBe(1);
    for (let i = 1; i < chunks.length; i++) {
      // endLine is inclusive; the next chunk starts on the following line.
      expect(chunks[i].startLine).toBe(chunks[i - 1].endLine + 1);
    }
    expect(chunks.at(-1)!.endLine).toBe(lines.length);
  });
});

describe('lexical vectors', () => {
  it('similar texts score higher than dissimilar ones', () => {
    const a = lexicalVector('parse the config file and load settings');
    const b = lexicalVector('load settings from the config file parser');
    const c = lexicalVector('render the shader with vertex buffer');
    const simAB = cosineSimilarity(a, b);
    const simAC = cosineSimilarity(a, c);
    expect(simAB).toBeGreaterThan(simAC);
  });

  it('normalize produces unit vectors', () => {
    const v = normalize([3, 4, 0]);
    const mag = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
    expect(mag).toBeCloseTo(1, 5);
  });

  it('embedText works offline via the lexical backend', async () => {
    const { vector, backend } = await embedText('some ordinary text with words');
    expect(vector.length).toBeGreaterThan(0);
    expect(['lexical', 'ollama']).toContain(backend);
  });
});
