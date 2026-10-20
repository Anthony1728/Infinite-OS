/**
 * "Keep working until done" — the quality-over-speed chat toggle for huge
 * prompts. The renderer wraps the outgoing request with a completion contract
 * (the transcript keeps showing the user's original words), and main raises
 * this run's turn/wall-clock budget via the untilDone flag. See
 * src/main/agent/run-budget.ts for the budget side.
 */

export const UNTIL_DONE_STORAGE_KEY = 'infinite:untilDone';

export function wrapUntilDone(text: string): string {
  const request = text.trim();
  return [
    'WORK-UNTIL-DONE MODE is active. Quality beats speed: keep going until everything below is fully finished — a partial answer is a failure.',
    '',
    'How to run this request:',
    '1. Break it into every distinct item, requirement, and acceptance condition (multi-part prompts: every clause is a requirement).',
    '2. Work through ALL of them with real tools — no suggestions-only reply, no "you could then…", no stopping after the first item.',
    '3. Verify each finished item with real evidence (build/typecheck/tests, a live run, or reading the result back). Fix failures yourself, then re-verify.',
    '4. Re-read the original request before replying: if any item is unfinished, keep working instead of answering.',
    '5. Only when everything is done, reply with a concise per-item completion report (what changed, how each item was verified). If something is genuinely impossible, finish everything else first, then name the exact blocker.',
    '',
    'User request:',
    request,
  ].join('\n');
}
