// One-shot wiring: continuation requests get the task ledger injected as the
// model-facing message. The user's bubble stays "continue"; the model sees
// GOAL / DONE / PENDING VERIFICATION. Run: node scripts/wire-ledger.cjs
const fs = require('fs');
const p = 'src/main/ipc/index.ts';
let s = fs.readFileSync(p, 'utf8');
const NL = '\n';

// 1. Import the ledger module.
const impAnchor = "import { writeResumeQueue, consumeResumeQueue, type ResumeEntry } from '../agent/resume-queue.js';";
if (!s.includes(impAnchor)) { console.error('import anchor missing'); process.exit(1); }
s = s.replace(impAnchor, impAnchor + NL +
  "import { isContinuationRequest, buildTaskLedger, renderLedgerContext } from '../agent/task-ledger.js';");

// 2. Replace the userMessage construction with the ledger-aware version.
const oldMsg = "    const userMessage: Message = { id: uuid(), role: 'user', content: message, timestamp: Date.now() };";
const newMsg = [
  "    // Continuation requests ('continue' after an interruption) carry no new",
  "    // instruction — the model would wander. Rebuild the task ledger from the",
  "    // persisted transcript and inject it as the model-facing text, so the",
  "    // agent resumes the TASK (goal, what ran, what still needs verifying).",
  "    let modelFacingContent = message;",
  "    if (isContinuationRequest(messageTextOf(message))) {",
  "      try {",
  "        const priorHistory = await sessionStore.loadMessages(sessionId);",
  "        const ledger = buildTaskLedger(priorHistory);",
  "        if (ledger) {",
  "          modelFacingContent = [{ type: 'text', text: renderLedgerContext(ledger, messageTextOf(message)) }];",
  "        }",
  "      } catch (e) {",
  "        console.warn('[chat] task ledger unavailable:', (e as Error).message);",
  "      }",
  "    }",
  "    const userMessage: Message = { id: uuid(), role: 'user', content: modelFacingContent, timestamp: Date.now() };",
].join(NL);
if (!s.includes(oldMsg)) { console.error('userMessage anchor missing'); process.exit(1); }
s = s.replace(oldMsg, newMsg);

fs.writeFileSync(p, s);
console.log('LEDGER WIRED');
