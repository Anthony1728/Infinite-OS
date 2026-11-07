// One-shot: wire the run contract (file-claim verification) into loop.ts.
// Run: node scripts/wire-contract.cjs
const fs = require('fs');
const p = 'src/main/agent/loop.ts';
const raw = fs.readFileSync(p, 'utf8');
const NL = raw.includes('\r\n') ? '\r\n' : '\n';
let s = raw;

// 1. Import the contract module.
const impAnchor = "import { resolveRunBudget } from './run-budget.js';";
if (!s.includes(impAnchor)) { console.error('import anchor missing'); process.exit(1); }
s = s.replace(impAnchor, impAnchor + NL +
  "import { evaluateFileClaims, renderClaimRevisionDirective } from '../engine/run-contract.js';");

// 2. Counter next to the other retry counters.
const counterAnchor = '  let verifyGuardPrompts = 0;';
if (!s.includes(counterAnchor)) { console.error('counter anchor missing'); process.exit(1); }
s = s.replace(counterAnchor, counterAnchor + NL + '  let claimRevisionRounds = 0;');

// 3. The gate: after the unverified-edits hard block, before interjections.
const gateAnchor = [
  '      if (editsSinceVerify) {',
  "        opts.onEvent({ type: 'error', error: 'Run ended with UNVERIFIED file edits — the model never ran the Verify tool after its last Edit/Write despite two reminders. The changes are on disk but unvalidated; review or re-run.' });",
  "        opts.onEvent({ type: 'fallback_required', error: 'Unverified file edits: Verify was not run after the last edit.' });",
  '        return messages;',
  '      }',
].join(NL);
if (!s.includes(gateAnchor)) { console.error('gate anchor missing'); process.exit(1); }
const gate = gateAnchor + NL + NL +
  '      // Run contract: file-claim verification. The final answer must not' + NL +
  '      // claim writes that never happened — the real eval failure (a model' + NL +
  '      // saying "Created ... verified" with zero writes) is caught HERE, in' + NL +
  '      // the engine, before verified completion. One revision round carries' + NL +
  '      // the exact missing paths; a repeat offender fails the run honestly.' + NL +
  '      const assistantTextForClaims = assistant.content' + NL +
  "        .filter((block): block is Extract<ContentBlock, { type: 'text' }> => block.type === 'text')" + NL +
  '        .map((block) => block.text)' + NL +
  "        .join(' ');" + NL +
  '      if (assistantTextForClaims.trim()) {' + NL +
  '        const claims = evaluateFileClaims(assistantTextForClaims, opts.cwd);' + NL +
  '        if (claims.missing.length > 0) {' + NL +
  '          if (claimRevisionRounds < 1) {' + NL +
  '            claimRevisionRounds++;' + NL +
  '            performanceMetrics.retries++;' + NL +
  '            messages.push({' + NL +
  '              id: crypto.randomUUID(),' + NL +
  "              role: 'user'," + NL +
  '              content: [{ type: \'text\', text: renderClaimRevisionDirective(claims.missing) }],' + NL +
  '              timestamp: Date.now(),' + NL +
  '            });' + NL +
  "            opts.onEvent({ type: 'provider_status', status: 'working', detail: \`File-claim check failed (\${claims.missing.length} phantom path(s)) — revision requested\` });" + NL +
  '            continue;' + NL +
  '          }' + NL +
  '          // Revision budget exhausted with phantom claims intact: honest failure.' + NL +
  "          opts.onEvent({ type: 'error', error: \`Run claimed \${claims.missing.length} file(s) that do not exist on disk after a revision round: \${claims.missing.join('; ').slice(0, 300)}. Refusing verified completion.\` });" + NL +
  "          opts.onEvent({ type: 'fallback_required', error: 'File-claim verification failed: the delivery includes files that do not exist.' });" + NL +
  '          return messages;' + NL +
  '        }' + NL +
  '      }';
s = s.replace(gateAnchor, gate);

fs.writeFileSync(p, s);
console.log('CONTRACT WIRED INTO LOOP');
