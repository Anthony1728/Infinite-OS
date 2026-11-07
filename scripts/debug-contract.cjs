// Debug the honest-run test: dump the events the loop produced.
const fs = require('fs');
let src = fs.readFileSync('src/main/engine/run-contract.loop.test.ts', 'utf8');
src = src.replace('    const done = events.find((e) => e.type === \'done\');', `    for (const e of events) console.log('EVT', e.type, JSON.stringify(e).slice(0, 120));\n    const done = events.find((e) => e.type === 'done');`);
fs.writeFileSync('src/main/engine/run-contract.loop.test.ts', src);
console.log('DEBUG ADDED');
EOF = 1;
