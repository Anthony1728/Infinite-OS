// Task ledger — the OS's memory of WHAT IT WAS DOING.
//
// REAL FAILURE THIS FIXES (user session, 2026-11-07): the agent navigated
// Gmail, found the contact, filled the compose, clicked Send, said "Let me
// verify it actually went out by checking the Sent folder" — then hit a 429
// and died. The user typed "continue". The agent received the word
// "continue" with NO context of the task, wandered into the Infinite OS
// repo, and started reading random files. An OS must remember what it was
// doing across interruptions.
//
// This module rebuilds that memory from the persisted transcript: the goal,
// what tool work actually ran, and — critically — any PENDING VERIFICATION
// (the agent said "let me verify X" and never got to it). When the user says
// "continue", this ledger is injected as the model-facing message so the
// agent resumes the TASK, not the word.

import type { Message, ContentBlock } from '../../shared/types.js';

/** "continue"-class messages: no new instruction, just "carry on". */
export function isContinuationRequest(text: string): boolean {
  const t = text.trim().toLowerCase();
  if (t.length > 60) return false;
  return /^(continue|keep going|go on|carry on|resume|finish( it| the task)?|carry ?on|keep working|next)\b[!. ]*$/i.test(t)
    || /^(continue|keep going|resume)\b[^a-z0-9]*$/i.test(t);
}

interface ToolAction {
  name: string;
  target: string;
  ok: boolean;
}

function describe(block: Extract<ContentBlock, { type: 'tool_use' }>): string {
  const input = (block.input ?? {}) as Record<string, unknown>;
  const target =
    (typeof input.file_path === 'string' && input.file_path) ||
    (typeof input.path === 'string' && input.path) ||
    (typeof input.command === 'string' && input.command) ||
    (typeof input.url === 'string' && input.url) ||
    (typeof input.query === 'string' && input.query) ||
    (typeof input.to === 'string' && input.to) ||
    '';
  const short = target.length > 80 ? `${target.slice(0, 80)}…` : target;
  return short ? `${block.name} → ${short}` : block.name;
}

/** Verification-intent phrases: the agent SAID it would check something. */
const VERIFY_INTENT =
  /\b(let me verify|verify (it|that|the)|check (the|if|that|whether)|confirm (the|that|whether)|make sure (it|the|that)|verify it actually|went out|actually (went|sent|arrived))\b/i;

/** Side-effect actions whose success must be verified, never assumed. */
const SIDE_EFFECT =
  /\b(send|sent|submit|click|deploy|publish|push|delete|remove|purchase|pay|email|mail)\b/i;

export interface TaskLedger {
  goal: string;
  toolsRun: ToolAction[];
  lastAssistantIntent: string;
  pendingVerification: string | null;
}

/** Rebuild the ledger from the persisted transcript (newest-decided truth). */
export function buildTaskLedger(messages: Message[]): TaskLedger | null {
  const toolNames = new Map<string, string>();
  const actions: ToolAction[] = [];
  let goal = '';
  const assistantTexts: Array<{ text: string; index: number }> = [];

  for (let index = 0; index < messages.length; index++) {
    const message = messages[index];
    for (const block of (message.content ?? []) as ContentBlock[]) {
      if (block.type === 'tool_use') {
        toolNames.set(block.id, block.name);
        if (actions.length < 30) actions.push({ name: block.name, target: describe(block), ok: true });
      } else if (block.type === 'tool_result' && toolNames.has((block as { tool_use_id?: string }).tool_use_id ?? '')) {
        const last = actions[actions.length - 1];
        if (last && (block as { is_error?: boolean }).is_error) last.ok = false;
      } else if (block.type === 'text' && message.role === 'user') {
        const text = (block as { text?: string }).text ?? '';
        // The goal is the last SUBSTANTIVE user request (not "continue", not
        // system-injected notes or guards).
        if (
          text.trim().length > 8 &&
          !isContinuationRequest(text) &&
          !text.startsWith('[Resumed') &&
          !text.startsWith('[Execution guard') &&
          !text.startsWith('[Verification guard') &&
          !text.startsWith('[User update') &&
          !text.startsWith('[Harness auto-Verify')
        ) {
          goal = text.trim().slice(0, 600);
        }
      } else if (block.type === 'text' && message.role === 'assistant') {
        const text = (block as { text?: string }).text ?? '';
        if (text.trim()) assistantTexts.push({ text, index });
      }
    }
  }

  if (!goal && actions.length === 0) return null;

  // Pending verification: the LAST assistant text before any trailing user
  // "continue" that announced an unverified side effect.
  let pendingVerification: string | null = null;
  for (let i = assistantTexts.length - 1; i >= 0 && i >= assistantTexts.length - 4; i--) {
    const text = assistantTexts[i].text;
    if (VERIFY_INTENT.test(text) && SIDE_EFFECT.test(text)) {
      const sentence = text.split(/(?<=[.!?])\s+/).find((s) => VERIFY_INTENT.test(s)) ?? text;
      pendingVerification = sentence.trim().slice(0, 300);
      break;
    }
  }

  const lastAssistantIntent = assistantTexts.length
    ? assistantTexts[assistantTexts.length - 1].text.trim().slice(0, 400)
    : '';

  return { goal, toolsRun: actions, lastAssistantIntent, pendingVerification };
}

/** Render the ledger as the model-facing continuation context. */
export function renderLedgerContext(ledger: TaskLedger, userText: string): string {
  const doneLines = ledger.toolsRun
    .slice(-10)
    .map((a) => `- ${a.name}${a.target ? ` (${a.target})` : ''}${a.ok ? '' : ' — FAILED'}`)
    .join('\n');
  return [
    '[TASK CONTEXT — you are resuming a task you were already working on. This is not a new request.]',
    '',
    `GOAL (the user's original request):`,
    ledger.goal,
    '',
    doneLines ? `WORK ALREADY DONE (real tool calls from the transcript):\n${doneLines}` : 'WORK DONE: none recorded yet.',
    '',
    ledger.pendingVerification
      ? `⚠ PENDING VERIFICATION — you said "${ledger.pendingVerification}" and were interrupted BEFORE verifying. Your FIRST action must be to re-verify that result (e.g. check the Sent folder, re-read the file, re-run the check). Do not redo the action blindly: verify first, then proceed.`
      : '',
    `The user said: "${userText.slice(0, 120)}" — meaning: continue THIS task from where it stands. Do not start unrelated work. Do not explore the repository. Do not re-plan from scratch.`,
    '',
    '[End of task context — continue now.]',
  ].filter(Boolean).join('\n\n');
}
