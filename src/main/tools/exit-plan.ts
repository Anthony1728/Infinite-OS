import type { Tool, ToolResult } from './base.js';
import { awaitPlanApproval, isPlanMode } from '../agent/plan-mode.js';
import { PLAN_APPROVAL_TIMEOUT_MS } from '../../shared/ipc.js';

export const exitPlanTool: Tool = {
  name: 'ExitPlan',
  description:
    'Submit your completed plan for user approval in plan mode; on approval the read-only phase ends and you execute the plan.',
  inputSchema: {
    type: 'object',
    properties: {
      plan: { type: 'string', description: 'Full step-by-step plan to present' },
    },
    required: ['plan'],
  },
  permission: 'none',

  async execute(args, ctx): Promise<ToolResult> {
    const plan = String((args as { plan?: unknown }).plan ?? '').trim();
    if (!plan) {
      return { content: 'ExitPlan requires a non-empty "plan" string describing exactly what you will do.', is_error: true };
    }
    if (!isPlanMode(ctx.sessionId)) {
      return { content: 'Plan mode is not active — submit your work directly instead.' };
    }
    // Hand the plan to the renderer (Approve / Decline) and wait. On approve,
    // resolveExitPlan clears the read-only gate so this same run continues.
    const { emitPlanApprovalRequest } = await import('../agent/plan-mode-events.js');
    emitPlanApprovalRequest(ctx.sessionId, plan);
    const approved = await awaitPlanApproval(ctx.sessionId, plan, PLAN_APPROVAL_TIMEOUT_MS);
    if (!approved) {
      return {
        content:
          'The user declined or did not respond to the plan. Refine it based on any feedback, keep researching if needed, and call ExitPlan again with an improved plan. Do not attempt modifications while plan mode is active.',
        is_error: true,
      };
    }
    return {
      content:
        'Plan approved — plan mode is OFF. Execute the approved plan now with the real tools, verifying each step (typecheck/tests/build) before reporting completion.',
    };
  },
};
