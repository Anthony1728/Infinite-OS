import { describe, expect, it } from 'vitest';
import { prepareCompletedResponse, prepareToolResult } from './learning-adapter.js';

describe('agent learning adapter', () => {
  it('redacts credentials and bounds tool payloads', () => {
    const record = prepareToolResult({
      request: 'Check the API',
      taskContext: 'Use token=super-sensitive-token-value',
      tool: 'WebFetch',
      input: { url: 'https://example.com', apiKey: 'secret-key', nested: { password: 'hidden' } },
      output: `Authorization: Bearer abcdefghijklmnopqrstuvwxyz\n${'x'.repeat(5_000)}`,
    });

    expect(record.input).toEqual({
      url: 'https://example.com',
      apiKey: '[redacted]',
      nested: { password: '[redacted]' },
    });
    expect(record.taskContext).not.toContain('super-sensitive-token-value');
    expect(record.output).not.toContain('abcdefghijklmnopqrstuvwxyz');
    expect(String(record.output).length).toBeLessThan(4_100);
  });

  it('deduplicates successful tools and truncates large responses', () => {
    const record = prepareCompletedResponse({
      request: 'Build it',
      taskContext: 'coding task',
      response: 'a'.repeat(10_000),
      provider: 'test',
      model: 'test-model',
      durationMs: 12.7,
      successfulTools: ['Read', 'Edit', 'Read'],
    });

    expect(record.successfulTools).toEqual(['Read', 'Edit']);
    expect(record.response.length).toBeLessThan(8_100);
    expect(record.durationMs).toBe(13);
  });

  it('omits binary image and file payloads', () => {
    const record = prepareToolResult({
      request: 'Inspect these',
      taskContext: '',
      tool: 'Read',
      input: {},
      output: [
        { type: 'image', source: { type: 'base64', mediaType: 'image/png', data: 'raw-image-secret' } },
        { type: 'file', name: 'report.pdf', mimeType: 'application/pdf', data: 'raw-file-secret' },
      ],
    });
    const serialized = JSON.stringify(record.output);
    expect(serialized).not.toContain('raw-image-secret');
    expect(serialized).not.toContain('raw-file-secret');
    expect(serialized).toContain('payload omitted');
  });
});
