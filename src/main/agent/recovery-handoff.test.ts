import { describe, expect, it } from 'vitest';
import type { Message } from '../../shared/types.js';
import { buildRecoveryHandoff } from './recovery-handoff.js';

describe('model recovery handoff', () => {
  it('gives the replacement model the original request, failure stage, and verified execution state', () => {
    const messages: Message[] = [
      {
        id: 'assistant-1',
        role: 'assistant',
        content: [{ type: 'tool_use', id: 'tool-1', name: 'file_write', input: { path: 'app.ts' } }],
        timestamp: 1,
      },
      {
        id: 'result-1',
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'tool-1', content: 'Created app.ts', is_error: false }],
        timestamp: 2,
      },
      {
        id: 'result-2',
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'tool-2', content: 'Tests did not pass', is_error: true }],
        timestamp: 3,
      },
    ];

    const handoff = buildRecoveryHandoff({
      originalRequest: 'Build the app, test it, and finish every requested feature.',
      failedProvider: 'nvidia',
      failedModel: 'model-a',
      stage: 'tool-result recovery',
      failure: 'Request failed with Bearer secret-token-value',
      successfulToolExecutions: 1,
      messages,
    });
    const text = handoff.content[0].type === 'text' ? handoff.content[0].text : '';

    expect(text).toContain('Build the app, test it, and finish every requested feature.');
    expect(text).toContain('Stopped at stage: tool-result recovery');
    expect(text).toContain('file_write [SUCCESS/VERIFIED]: Created app.ts');
    expect(text).toContain('tool [FAILED/UNVERIFIED]: Tests did not pass');
    expect(text).toContain('complete every remaining requirement');
    expect(text).not.toContain('secret-token-value');
  });
});
