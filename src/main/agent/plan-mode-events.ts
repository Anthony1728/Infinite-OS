// Plan-mode event bridge — pushes plan state to the renderer over the same
// chat stream channel the agent loop uses, so no new listener plumbing is
// needed in the preload layer for events (only for the resolve invoke).

import { IPC } from '../../shared/ipc.js';

type Emit = (channel: string, payload: unknown) => void;

let emit: Emit | null = null;

/** Wire the event sink once from the ipc module (getMainWindow().webContents.send). */
export function setPlanModeEmitter(fn: Emit): void {
  emit = fn;
}

function push(sessionId: string, payload: Record<string, unknown>): void {
  if (!emit) return;
  emit(IPC.CHAT_STREAM_EVENT, { sessionId, type: 'plan_state', ...payload });
}

export function emitPlanActivated(sessionId: string): void {
  push(sessionId, { active: true });
}

export function emitPlanApprovalRequest(sessionId: string, plan: string): void {
  push(sessionId, { active: true, approvalRequest: plan });
}

export function emitPlanApproved(sessionId: string, plan: string): void {
  push(sessionId, { active: false, approvedPlan: plan });
}

export function emitPlanDeclined(sessionId: string): void {
  push(sessionId, { active: true, approvalDeclined: true });
}
