import type { ContentBlock } from '../../shared/types.js';

export interface CompletedResponseLearning {
  request: string;
  taskContext: string;
  response: string;
  provider: string;
  model: string;
  durationMs: number;
  successfulTools: string[];
}

export interface ToolResultLearning {
  request: string;
  taskContext: string;
  tool: string;
  input: unknown;
  output: string | ContentBlock[];
}

interface CompactLearningApi {
  ingestResponse?: (record: CompletedResponseLearning) => void | Promise<void>;
  ingestToolResult?: (record: ToolResultLearning) => void | Promise<void>;
}

const SECRET_FIELD = /(?:api[-_]?key|access[-_]?token|refresh[-_]?token|authorization|password|passwd|secret|cookie|session[-_]?token|private[-_]?key)/i;
const SECRET_VALUE = /(?:\bBearer\s+[A-Za-z0-9._~+/=-]{12,}|\bsk-[A-Za-z0-9_-]{12,}|\b(?:api[-_]?key|token|password|secret)\s*[:=]\s*[^\s,;]+)/gi;
const MAX_REQUEST = 4_000;
const MAX_CONTEXT = 3_000;
const MAX_RESPONSE = 8_000;
const MAX_TOOL_IO = 4_000;
let apiPromise: Promise<CompactLearningApi | null> | null = null;

function compactText(value: string, max: number): string {
  const redacted = value.replace(SECRET_VALUE, '[redacted]');
  return redacted.length <= max ? redacted : `${redacted.slice(0, max)}\n[truncated]`;
}

function sanitizeValue(value: unknown, depth = 0): unknown {
  if (depth > 4) return '[nested data omitted]';
  if (typeof value === 'string') return compactText(value, MAX_TOOL_IO);
  if (value == null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.slice(0, 25).map((item) => sanitizeValue(item, depth + 1));
  if (typeof value !== 'object') return String(value);
  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>).slice(0, 40)) {
    output[key] = SECRET_FIELD.test(key) ? '[redacted]' : sanitizeValue(item, depth + 1);
  }
  return output;
}

function summarizeOutput(output: string | ContentBlock[]): string | ContentBlock[] {
  if (typeof output === 'string') return compactText(output, MAX_TOOL_IO);
  return output.slice(0, 20).map((block) => {
    if (block.type === 'text') return { ...block, text: compactText(block.text, MAX_TOOL_IO) };
    if (block.type === 'image') {
      return { type: 'text', text: '[image output omitted from learning memory]' } as ContentBlock;
    }
    if (block.type === 'file') {
      return {
        type: 'text',
        text: `[file payload omitted from learning memory: ${compactText(block.name, 200)} (${compactText(block.mimeType, 100)})]`,
      } as ContentBlock;
    }
    if (block.type === 'tool_use') {
      return { ...block, input: sanitizeValue(block.input) } as ContentBlock;
    }
    if (block.type === 'tool_result') {
      return {
        ...block,
        content: typeof block.content === 'string'
          ? compactText(block.content, MAX_TOOL_IO)
          : summarizeOutput(block.content),
      } as ContentBlock;
    }
    return block;
  });
}

/** Prepare a bounded, redacted provider-response record for durable learning. */
export function prepareCompletedResponse(record: CompletedResponseLearning): CompletedResponseLearning {
  return {
    ...record,
    request: compactText(record.request, MAX_REQUEST),
    taskContext: compactText(record.taskContext, MAX_CONTEXT),
    response: compactText(record.response, MAX_RESPONSE),
    durationMs: Math.max(0, Math.round(record.durationMs)),
    successfulTools: [...new Set(record.successfulTools)].slice(0, 30),
  };
}

/** Prepare a bounded tool record without retaining credentials or image blobs. */
export function prepareToolResult(record: ToolResultLearning): ToolResultLearning {
  return {
    ...record,
    request: compactText(record.request, MAX_REQUEST),
    taskContext: compactText(record.taskContext, MAX_CONTEXT),
    input: sanitizeValue(record.input),
    output: summarizeOutput(record.output),
  };
}

function getLearningApi(): Promise<CompactLearningApi | null> {
  if (!apiPromise) {
    // Use a runtime path so this adapter can ship before the compact learner.
    // Once ../brain/learning exports ingestResponse/ingestToolResult, the hook
    // activates automatically without coupling the agent loop to its storage.
    const modulePath: string = '../brain/learning.js';
    apiPromise = import(modulePath)
      .then((module) => module as CompactLearningApi)
      .catch(() => null);
  }
  return apiPromise;
}

export function learnFromCompletedResponse(record: CompletedResponseLearning): void {
  const safe = prepareCompletedResponse(record);
  void getLearningApi().then((api) => api?.ingestResponse?.(safe)).catch(() => undefined);
}

export function learnFromToolResult(record: ToolResultLearning): void {
  const safe = prepareToolResult(record);
  void getLearningApi().then((api) => api?.ingestToolResult?.(safe)).catch(() => undefined);
}
