const fs = require('fs');
const content = fs.readFileSync('spellforge/assets/spell-dict.js', 'utf8');
const wordsMatch = content.match(/SPELL_WORDS="(.+)"/s);
const freqMatch = content.match(/SPELL_FREQ="(.+)"/s);
if (wordsMatch && freqMatch) {
  const words = wordsMatch[1].split('\n');
  const freq = freqMatch[1].split('\n');
  const data = { words, freq };
  fs.writeFileSync('spellforge/assets/spell-dict.json', JSON.stringify(data));
  console.log('Created JSON with ' + words.length + ' words, ' + freq.length + ' freq words');
} else {
  console.log('Could not parse spell-dict.js');
  process.exit(1);
}
