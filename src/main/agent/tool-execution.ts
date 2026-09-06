import type { ContentBlock } from '../../shared/types.js';
import { checkPermission } from './permissions.js';
import { runHooks } from './hooks.js';
import type { Tool, ToolResult } from '../tools/base.js';

export const TOOL_EXECUTION_TIMEOUT_MS = 5 * 60_000;

// Tool-specific timeouts: some tools need more time
const TOOL_TIMEOUTS: Record<string, number> = {
  'Bash': 10 * 60_000,        // Shell commands can take longer
  'Computer': 5 * 60_000,     // Desktop automation
  'Operator': 5 * 60_000,     // Browser automation
  'browser_extension': 5 * 60_000,
  'Deploy': 15 * 60_000,      // Deployment can be slow
  'AppBuilder': 10 * 60_000,  // Building apps
  'WebsiteBuilder': 10 * 60_000,
  'Git': 5 * 60_000,          // Git operations
  'GitPush': 5 * 60_000,
  'GitPull': 5 * 60_000,
};

function getToolTimeout(toolName: string): number {
  return TOOL_TIMEOUTS[toolName] ?? TOOL_EXECUTION_TIMEOUT_MS;
}

const PARALLEL_SAFE_TOOLS = new Set([
  // Read-only file operations
  'Read', 'Glob', 'Grep', 'FileOps',
  // Web operations (read-only)
  'WebFetch', 'WebSearch', 'Browser', 'browser_extension',
  // Knowledge & skills (read-only)
  'Skills', 'Knowledge', 'TodoRead',
  // Compute-only (no side effects)
  'Json', 'Text', 'Crypto', 'Math', 'Time', 'Timer', 'Regex', 'Color',
  // Git read-only operations
  'GitStatus', 'GitLog', 'GitDiff',
  // System info (read-only)
  'System', 'Network', 'Device',
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
      const toolTimeout = getToolTimeout(toolUse.name);
      timeoutId = setTimeout(() => {
        controller.abort(new Error('tool timeout'));
        reject(new Error(`Tool "${toolUse.name}" timed out after ${Math.round(toolTimeout / 60_000)} minutes and was cancelled.`));
      }, toolTimeout);
    });
    return await Promise.race([operation(), timeout, cancellation]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
    parentSignal.removeEventListener('abort', abort);
  }
}
