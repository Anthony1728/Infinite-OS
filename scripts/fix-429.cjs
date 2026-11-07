// Rewrite the 429 error card: model-neutral, task-resumable, no hardcoded
// provider advertising. Run: node scripts/fix-429.cjs
const fs = require('fs');
const p = 'src/renderer/stores/chat.ts';
let s = fs.readFileSync(p, 'utf8');
const NL = '\n';

const oldMsg = "        const resetMatch = event.error?.match(/Resets? in (\\d+) days?/i);".replace('\\d', String.fromCharCode(92) + 'd');
// Simpler: anchor on the responseText assignment string.
const anchor = "        responseText = `**Monthly usage limit reached (429).**${resetInfo}";
const idx = s.indexOf(anchor);
if (idx === -1) { console.error('429 message anchor missing'); process.exit(1); }
// Find the end of this template literal assignment (the backtick-semicolon).
const endTick = s.indexOf('`;', idx);
if (endTick === -1) { console.error('template end missing'); process.exit(1); }
const end = endTick + 2;

const replacement = [
  "        responseText = `**Your current model hit its monthly usage limit (429).**${resetInfo}",
  "",
  "**Your task is not lost.** Two ways forward:",
  "• **Switch model** in Settings → AI Provider (any model with available quota), then say **\\\"continue\\\"** in this chat — the OS remembers the task and picks up where it stopped.",
  "• **Top up the balance** for the current model, then **continue** the same way.`",
].join(NL);

s = s.slice(0, idx) + replacement + s.slice(end);
fs.writeFileSync(p, s);
console.log('429 MESSAGE REWRITTEN');
