// Trace the eval run's actual tool calls from the session transcript.
// Run: node scripts/trace-eval.cjs
const fs = require('fs');
const path = require('path');
const home = path.join(process.env.USERPROFILE || process.env.HOME, '.infinite-ai', 'profiles', 'darrellanthonytaylor13gmailcom', 'sessions');
for (const f of fs.readdirSync(home).filter((x) => x.endsWith('.jsonl'))) {
  const raw = fs.readFileSync(path.join(home, f), 'utf8').trim();
  if (!raw) continue;
  const lines = raw.split(/\r?\n/).filter(Boolean);
  // Find the task prompt anywhere in the transcript (the eval sessionId is
  // random, so identify the run by its content).
  const joined = raw.slice(0, 4000);
  if (!joined.includes('welcome.md')) continue;
  console.log('=== TRANSCRIPT:', f, '| messages:', lines.length, '===');
  for (const line of lines) {
    let m;
    try { m = JSON.parse(line); } catch { continue; }
    for (const b of (m.content ?? [])) {
      if (b.type === 'tool_use') {
        console.log('  TOOL_USE:', b.name, JSON.stringify(b.input ?? {}).slice(0, 150));
      } else if (b.type === 'tool_result') {
        const text = typeof b.content === 'string' ? b.content : JSON.stringify(b.content);
        console.log('  RESULT:', b.is_error ? 'ERROR' : 'ok  ', text.slice(0, 150));
      } else if (b.type === 'text' && m.role === 'user' && String(b.text).startsWith('[Resumed')) {
        console.log('  NOTE:', String(b.text).slice(0, 100));
      }
    }
  }
}
console.log('=== trace complete ===');
