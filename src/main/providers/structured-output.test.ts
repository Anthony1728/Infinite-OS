// Structured output contract tests: the validator is the guarantee that a
// provider ignoring response_format degrades to an honest error instead of a
// malformed payload entering an agent handshake.

import { describe, expect, it } from 'vitest';
import { validateStructuredOutput } from './base.js';
import { validateJsonSchema } from '../agent/json-schema.js';

const schema = {
  type: 'object',
  required: ['summary', 'files'],
  properties: {
    summary: { type: 'string' },
    files: {
      type: 'array',
      items: { type: 'object', required: ['path', 'action'], properties: { path: { type: 'string' }, action: { type: 'string', enum: ['create', 'modify'] } } },
    },
  },
};

describe('validateStructuredOutput', () => {
  it('accepts a reply that satisfies the schema', () => {
    const reply = JSON.stringify({ summary: 'did the thing', files: [{ path: 'C:/w/a.ts', action: 'create' }] });
    const result = validateStructuredOutput(reply, schema);
    expect(result.ok).toBe(true);
  });

  it('rejects a reply missing a required field', () => {
    const reply = JSON.stringify({ summary: 'no files listed' });
    const result = validateStructuredOutput(reply, schema);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('files');
  });

  it('rejects a value outside an enum', () => {
    const reply = JSON.stringify({ summary: 'x', files: [{ path: 'p', action: 'delete' }] });
    const result = validateStructuredOutput(reply, schema);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('allowed values');
  });

  it('unwraps a fenced JSON block before validating', () => {
    const reply = 'Here you go:\n```json\n{"summary":"s","files":[]}\n```\nDone.';
    const result = validateStructuredOutput(reply, schema);
    expect(result.ok).toBe(true);
  });

  it('honestly fails when the reply is not JSON at all', () => {
    const result = validateStructuredOutput('I did the work, everything is fine.', schema);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('not valid JSON');
  });

  it('rejects a non-object reply when the schema wants an object', () => {
    const result = validateStructuredOutput('[1,2,3]', schema);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('must be object');
  });
});

describe('validateJsonSchema (shared validator)', () => {
  it('validates nested arrays of objects with path-bearing errors', () => {
    const result = validateJsonSchema({ summary: 's', files: [{ action: 'create' }] }, schema);
    expect(result.valid).toBe(false);
    expect(result.error).toBe('$.files[0].path is required.');
  });

  it('reports the first missing required field deterministically', () => {
    const result = validateJsonSchema({ files: [] }, schema);
    expect(result.valid).toBe(false);
    expect(result.error).toBe('$.summary is required.');
  });

  it('accepts an empty object when nothing is required', () => {
    expect(validateJsonSchema({}, { type: 'object' }).valid).toBe(true);
  });
});
