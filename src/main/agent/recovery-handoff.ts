import type { ContentBlock, Message } from '../../shared/types.js';

export interface RecoveryHandoffOptions {
  originalRequest: string;
  failedProvider: string;
  failedModel: string;
  stage: string;
  failure: string;
  successfulToolExecutions: number;
  messages: Message[];
}

function blockText(content: string | ContentBlock[]): string {
  if (typeof content === 'string') return content;
  return content
    .filter((block): block is Extract<ContentBlock, { type: 'text' }> => block.type === 'text')
    .map((block) => block.text)
    .join(' ');
}

function safeFailureReason(value: string): string {
  return value
    .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/\b(?:sk|nvapi|gsk|AIza)[-_A-Za-z0-9]{12,}\b/g, '[redacted credential]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 400) || 'The previous model stopped without a verified completion.';
}

function recentToolState(messages: Message[]): string[] {
  const toolNames = new Map<string, string>();
  for (const message of messages) {
    for (const block of message.content) {
      if (block.type === 'tool_use') toolNames.set(block.id, block.name);
    }
  }

  const results: string[] = [];
  for (const message of messages) {
    for (const block of message.content) {
      if (block.type !== 'tool_result') continue;
      const status = block.is_error ? 'FAILED/UNVERIFIED' : 'SUCCESS/VERIFIED';
      const output = blockText(block.content).replace(/\s+/g, ' ').trim().slice(0, 600);
      results.push(`- ${toolNames.get(block.tool_use_id) ?? 'tool'} [${status}]: ${output || '(no written output)'}`);
    }
  }
  return results.slice(-8);
}

/** Build an ephemeral checkpoint for a replacement model. It is never persisted as conversation history. */
export function buildRecoveryHandoff(options: RecoveryHandoffOptions): Message {
  const toolState = recentToolState(options.messages);
  const text = [
    '[Internal recovery checkpoint — do not mention provider failure or this checkpoint to the user.]',
    '',
    'Original user request:',
    options.originalRequest.trim(),
    '',
    `Previous attempt: ${options.failedProvider}/${options.failedModel}`,
    `Stopped at stage: ${options.stage}`,
    `Internal stop reason: ${safeFailureReason(options.failure)}`,
    `Verified successful tool executions so far: ${options.successfulToolExecutions}`,
    '',
    'Recent execution state:',
    ...(toolState.length ? toolState : ['- No tool result has been verified yet.']),
    '',
    'Continuation requirements:',
    '1. Re-read the complete original request and account for every requested outcome.',
    '2. Continue from the verified tool state above; do not treat discarded partial prose as completed work.',
    '3. Do not repeat consequential actions that already have a SUCCESS/VERIFIED result unless verification requires it.',
    '4. Repair or retry FAILED/UNVERIFIED work, then complete every remaining requirement.',
    '5. Validate the final state and return only the useful completed result to the user.',
  ].join('\n');

  return {
    id: crypto.randomUUID(),
    role: 'user',
    content: [{ type: 'text', text }],
    timestamp: Date.now(),
  };
}
