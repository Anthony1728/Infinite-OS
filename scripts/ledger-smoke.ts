// Smoke test for the task ledger against the REAL failed session shape.
// Run: npx tsx scripts/ledger-smoke.ts
import { isContinuationRequest, buildTaskLedger, renderLedgerContext } from '../src/main/agent/task-ledger.js';

const tests = ['continue', 'Continue', 'keep going', 'carry on', 'finish it', 'hello', 'send the email', 'continue the task please'];
for (const t of tests) console.log(JSON.stringify(t), '→', isContinuationRequest(t));

const msgs = [
  { role: 'user', content: [{ type: 'text', text: 'do something really useful like send an email using my email to Terrell' }] },
  { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'Business', input: {} }, { type: 'text', text: 'I found Terrell in your contacts.' }] },
  { role: 'user', content: [{ type: 'text', text: 'send the email' }] },
  { role: 'assistant', content: [{ type: 'tool_use', id: 't3', name: 'browser_extension', input: { url: 'mail.google.com' } }, { type: 'tool_use', id: 't4', name: 'browser_extension', input: { action: 'click', selector: 'send' } }, { type: 'text', text: 'All three fields are confirmed. Sending now.' }] },
  { role: 'assistant', content: [{ type: 'text', text: 'Send clicked. Let me verify it actually went out by checking the Sent folder.' }] },
  { role: 'user', content: [{ type: 'text', text: 'continue' }] },
] as never;

const ledger = buildTaskLedger(msgs);
console.log('GOAL:', (ledger?.goal ?? '').slice(0, 80));
console.log('TOOLS:', ledger?.toolsRun?.map((a) => a.name).join(', '));
console.log('PENDING:', ledger?.pendingVerification?.slice(0, 90));
console.log('--- CONTEXT HEAD ---');
console.log(renderLedgerContext(ledger, 'continue').slice(0, 400));
