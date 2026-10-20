import type { ContentBlock } from '../../shared/types.js';
import { checkPermission, currentPermissionProfile } from './permissions.js';
import { runHooks } from './hooks.js';
import type { Tool, ToolResult } from '../tools/base.js';
import { actionAuditLog } from '../audit/action-log.js';
import { planModeGuard } from './plan-mode.js';
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

export function getToolTimeout(toolName: string): number {
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

/**
 * How many parallel-safe tools from one model turn may run at the same time.
 *
 * Unlimited fan-out is a liability rather than a feature: a model that emits
 * fifteen WebSearch calls fires fifteen requests into a rate-limited API at
 * once, most get throttled, and the retries cost more wall time than the
 * parallelism saved. Six is comfortably above any realistic single turn while
 * keeping a burst from stampeding a provider.
 */
export const PARALLEL_TOOL_CONCURRENCY = 6;

/**
 * Runs `fn` over `items` with at most `limit` calls in flight.
 *
 * Results come back in input order, so callers do not have to re-sort. Used for
 * the parallel-safe half of a tool batch; the sequential half keeps its own
 * order by construction.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return [];
  const results = new Array<R>(items.length);
  const workerCount = Math.max(1, Math.min(Math.floor(limit) || 1, items.length));
  let nextIndex = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const index = nextIndex++;
      if (index >= items.length) return;
      results[index] = await fn(items[index] as T, index);
    }
  };
  await Promise.all(Array.from({ length: workerCount }, worker));
  return results;
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

/**
 * Map a tool result to an audit outcome. Errors are already converted into
 * results by most tools, so `is_error` is the signal for failure here.
 */
function auditOutcome(result: ToolResult | undefined, error: unknown): { outcome: 'ok' | 'error'; durationNote?: string } {
  if (error) return { outcome: 'error' };
  if (result?.is_error) return { outcome: 'error' };
  return { outcome: 'ok' };
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

  // Audit: capture the authority context once per call. Cheap and purely
  // observational — nothing here can alter execution.
  const profile = currentPermissionProfile();
  const unrestricted = profile === ':full-system-access' || profile === 'full-system-access';
  const started = Date.now();
  const canonicalToolName = tool?.name ?? toolUse.name;

  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  try {
    const operation = async (): Promise<ToolResult> => {
      // Fail fast on structurally invalid input BEFORE prompting for
      // permission. An empty `Bash {}` call is malformed regardless of
      // policy; surfacing the real cause ("requires a non-empty command")
      // lets the model fix itself instead of seeing "Permission denied".
      if (tool.name === 'Bash' && !((toolUse.input as { command?: unknown } | undefined)?.command)) {
        return { content: 'Bash tool requires a non-empty "command" string parameter.', is_error: true };
      }
      // Enforced plan mode (tool-level, like Claude Code's plan gate): the
      // read-only verdict comes before permission checks so even a full-system
      // profile cannot mutate the machine while a plan is pending approval.
      const planBlock = planModeGuard(sessionId, canonicalToolName, toolUse.input);
      if (planBlock) {
        actionAuditLog.record({
          sessionId, tool: canonicalToolName, input: toolUse.input,
          decision: 'denied', outcome: 'denied',
          durationMs: Date.now() - started,
          unrestricted,
        });
        return planBlock;
      }
      // PreToolUse hooks can block deterministically (JSON verdict).
      const pre = await runHooks('PreToolUse', { tool: toolUse.name, input: toolUse.input }, { sessionId, cwd, signal: controller.signal });
      if (pre.blocked) {
        actionAuditLog.record({
          sessionId, tool: canonicalToolName, input: toolUse.input,
          decision: 'denied', outcome: 'denied',
          durationMs: Date.now() - started,
          unrestricted,
        });
        return { content: pre.blockReason || 'Blocked by PreToolUse hook.', is_error: true };
      }
      if (!(await checkPermission(toolUse, { sessionId, cwd, signal: controller.signal }))) {
        actionAuditLog.record({
          sessionId, tool: canonicalToolName, input: toolUse.input,
          decision: 'denied', outcome: 'denied',
          durationMs: Date.now() - started,
          unrestricted,
        });
        return { content: 'Permission denied by user.', is_error: true };
      }
      const result = await tool.execute(toolUse.input, {
        cwd,
        abortSignal: controller.signal,
        sessionId,
        onUpdate,
      });
      // PostToolUse hooks may append governance context to the result.
      const post = await runHooks('PostToolUse', { tool: toolUse.name, input: toolUse.input, result }, { sessionId, cwd, signal: controller.signal });
      if (post.additionalContext) {
        const baseContent = typeof result.content === 'string' ? result.content : JSON.stringify(result.content);
        return { ...result, content: `${baseContent}\n\n[Hook context]: ${post.additionalContext}` };
      }
      return result;
    };

    const timeout = new Promise<never>((_resolve, reject) => {
      const toolTimeout = getToolTimeout(toolUse.name);
      timeoutId = setTimeout(() => {
        timedOut = true;
        controller.abort(new Error('tool timeout'));
        reject(new Error(`Tool "${toolUse.name}" timed out after ${Math.round(toolTimeout / 60_000)} minutes and was cancelled.`));
      }, toolTimeout);
    });

    try {
      const result = await Promise.race([operation(), timeout, cancellation]);
      const { outcome } = auditOutcome(result, undefined);
      actionAuditLog.record({
        sessionId,
        tool: canonicalToolName,
        input: toolUse.input,
        decision: unrestricted ? 'full-system' : 'auto',
        outcome,
        durationMs: Date.now() - started,
        unrestricted,
      });
      return result;
    } catch (err) {
      actionAuditLog.record({
        sessionId,
        tool: canonicalToolName,
        input: toolUse.input,
        decision: unrestricted ? 'full-system' : 'auto',
        outcome: timedOut ? 'timeout' : 'cancelled',
        durationMs: Date.now() - started,
        unrestricted,
      });
      throw err;
    }
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
    parentSignal.removeEventListener('abort', abort);
  }
}
