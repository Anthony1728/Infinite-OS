import type { ContentBlock } from '../../shared/types.js';
import {
  getLearningMemoryStore,
  type ActionTraceMemoryInput,
  type MemoryRecord,
  type MemorySearchOptions,
  type MemorySearchResult,
} from './memory.js';

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

export interface SuccessfulActionLearning {
  goal: string;
  steps: string[];
  outcome: string;
  tools?: string[];
  tags?: string[];
}

function contentBlocksToText(blocks: ContentBlock[], depth = 0): string {
  if (depth > 3) return '[nested content omitted]';
  return blocks.map((block) => {
    if (block.type === 'text') return block.text;
    if (block.type === 'tool_result') {
      return typeof block.content === 'string' ? block.content : contentBlocksToText(block.content, depth + 1);
    }
    if (block.type === 'tool_use') return `${block.name}: ${safeStringify(block.input)}`;
    if (block.type === 'file') return `[file: ${block.name}]`;
    if (block.type === 'image') return '[image result]';
    return '';
  }).filter(Boolean).join('\n');
}

function safeStringify(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function firstUrl(...values: string[]): string | undefined {
  for (const value of values) {
    const url = value.match(/https?:\/\/[^\s"'<>\])}]+/i)?.[0];
    if (url) return url;
  }
  return undefined;
}

const PREFERENCE_PATTERNS = [
  /\b(?:i prefer|i like|i always|i never|please always|please never|remember that|my preference is|from now on)\b/i,
];

/** Extract durable, first-person preference statements from a user request. */
function extractPreferenceStatements(request: string): string[] {
  const statements = request
    .split(/[\n.!?;]+/)
    .map((part) => part.trim())
    .filter((part) => part.length >= 12 && PREFERENCE_PATTERNS.some((pattern) => pattern.test(part)));
  return [...new Set(statements)].slice(0, 5);
}

/** Adapter target for completed provider turns. */
export function ingestResponse(record: CompletedResponseLearning): MemoryRecord | null {
  const context = record.taskContext.trim();
  const store = getLearningMemoryStore();
  const conversation = store.ingest({
    type: 'api_conversation',
    user: context ? `${record.request}\n\nTask context: ${context}` : record.request,
    assistant: record.response,
    provider: record.provider,
    model: record.model,
    success: true,
    tags: ['api-response', ...record.successfulTools.map((tool) => `tool:${tool}`)],
    confidence: record.successfulTools.length ? 0.8 : 0.7,
  });

  // Durable preferences make Infinite AI feel personal and useful across
  // sessions: "I prefer pnpm", "never open Chrome", "remember I work on X".
  for (const statement of extractPreferenceStatements(record.request)) {
    store.ingest({
      type: 'api_conversation',
      user: statement,
      assistant: 'Recorded as a durable user preference.',
      provider: record.provider,
      model: record.model,
      success: true,
      kind: 'preference',
      tags: ['preference', 'user-stated'],
      confidence: 0.92,
    });
  }
  if (record.successfulTools.length) {
    store.ingest({
      type: 'action_trace',
      goal: record.request,
      steps: record.successfulTools.map((tool) => `Used ${tool} and observed a successful result.`),
      outcome: record.response,
      success: true,
      tools: record.successfulTools,
      tags: ['verified-action', 'agent-run'],
    });
  }
  return conversation;
}

/** Adapter target for successful agent tool executions. */
export function ingestToolResult(record: ToolResultLearning): MemoryRecord | null {
  const output = typeof record.output === 'string' ? record.output : contentBlocksToText(record.output);
  const serializedInput = safeStringify(record.input);
  const webFetch = /^WebFetch$/i.test(record.tool);
  const webSearch = /^WebSearch$/i.test(record.tool);
  const url = firstUrl(serializedInput, output);
  // A fetched page is direct evidence. Search snippets are useful experience,
  // but remain an episode until a page or final answer verifies them.
  if (webFetch && url) {
    return getLearningMemoryStore().ingest({
      type: 'web',
      query: record.request,
      result: output,
      url,
      tags: ['web', record.tool.toLowerCase()],
    });
  }
  return getLearningMemoryStore().ingest({
    type: 'tool',
    ...(webSearch ? { kind: 'episode' as const, confidence: 0.62 } : {}),
    toolName: record.tool,
    input: `${record.request}\n${record.taskContext}\n${serializedInput}`,
    result: output,
    success: true,
    url,
    tags: ['tool-result', record.tool.toLowerCase(), ...(webSearch ? ['search-evidence'] : [])],
  });
}

/** Store an explicitly successful multi-step action outcome. */
export function ingestActionTrace(record: SuccessfulActionLearning): MemoryRecord | null {
  const input: ActionTraceMemoryInput = {
    type: 'action_trace',
    goal: record.goal,
    steps: record.steps,
    outcome: record.outcome,
    success: true,
    tools: record.tools,
    tags: record.tags,
  };
  return getLearningMemoryStore().ingest(input);
}

export function searchLearningMemory(query: string, options?: MemorySearchOptions): MemorySearchResult[] {
  return getLearningMemoryStore().search(query, options);
}

/** Compact, provenance-labelled memory text suitable for system context. */
export function retrieveLearningContext(query: string, options?: MemorySearchOptions): string {
  return getLearningMemoryStore().formatForContext(query, options);
}

export function getLearningMemoryStats(): ReturnType<ReturnType<typeof getLearningMemoryStore>['getStats']> {
  return getLearningMemoryStore().getStats();
}
