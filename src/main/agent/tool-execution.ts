import type { ContentBlock } from '../../shared/types.js';
import { checkPermission } from './permissions.js';
import { runHooks } from './hooks.js';
import type { Tool, ToolResult } from '../tools/base.js';

export const TOOL_EXECUTION_TIMEOUT_MS = 5 * 60_000;

const PARALLEL_SAFE_TOOLS = new Set([
  'Read', 'Glob', 'Grep', 'WebFetch', 'WebSearch', 'Browser', 'Skills',
  'Json', 'Text', 'Crypto', 'Math', 'Time', 'Timer', 'GitStatus', 'GitLog', 'GitDiff',
  'TodoRead', 'Knowledge', 'System', 'FileOps',
]);

/** Read-only/compute-only tools can safely fan out in one model turn. */
export function isParallelSafeTool(name: string): boolean {
  return PARALLEL_SAFE_TOOLS.has(name);
}

type ToolUse = Extract<ContentBlock, { type: 'tool_use' }>;

interface ToolExecutionOptions {
  tool: Tool;
  toolUse: ToolUse;
  sessionId: string;
  cwd: string;
  parentSignal: AbortSignal;
  onUpdate: (partial: ToolResult) => void;
}

/** Bounds the complete tool lifecycle and cancels the underlying operation. */
export async function executeToolCall(options: ToolExecutionOptions): Promise<ToolResult> {
  const { tool, toolUse, sessionId, cwd, parentSignal, onUpdate } = options;
  const controller = new AbortController();
  let rejectParent: ((reason: Error) => void) | undefined;
  const abort = () => {
    controller.abort(parentSignal.reason);
    rejectParent?.(new Error(`Tool "${toolUse.name}" was cancelled.`));
  };
  const cancellation = new Promise<never>((_resolve, reject) => { rejectParent = reject; });
  if (parentSignal.aborted) abort();
  else parentSignal.addEventListener('abort', abort, { once: true });

  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    const operation = async (): Promise<ToolResult> => {
      // Fail fast on structurally invalid input BEFORE prompting for
      // permission. An empty `Bash {}` call is malformed regardless of
      // policy; surfacing the real cause ("requires a non-empty command")
      // lets the model fix itself instead of seeing "Permission denied".
      if (tool.name === 'Bash' && !((toolUse.input as { command?: unknown } | undefined)?.command)) {
        return { content: 'Bash tool requires a non-empty "command" string parameter.', is_error: true };
      }
      await runHooks('PreToolUse', { tool: toolUse.name, input: toolUse.input }, { sessionId, cwd, signal: controller.signal });
      if (!(await checkPermission(toolUse, { sessionId, cwd, signal: controller.signal }))) {
        return { content: 'Permission denied by user.', is_error: true };
      }
      const result = await tool.execute(toolUse.input, {
        cwd,
        abortSignal: controller.signal,
        sessionId,
        onUpdate,
      });
      await runHooks('PostToolUse', { tool: toolUse.name, input: toolUse.input, result }, { sessionId, cwd, signal: controller.signal });
      return result;
    };

    const timeout = new Promise<never>((_resolve, reject) => {
      timeoutId = setTimeout(() => {
        controller.abort(new Error('tool timeout'));
        reject(new Error(`Tool "${toolUse.name}" timed out after ${Math.round(TOOL_EXECUTION_TIMEOUT_MS / 60_000)} minutes and was cancelled.`));
      }, TOOL_EXECUTION_TIMEOUT_MS);
    });
    return await Promise.race([operation(), timeout, cancellation]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
    parentSignal.removeEventListener('abort', abort);
  }
}
