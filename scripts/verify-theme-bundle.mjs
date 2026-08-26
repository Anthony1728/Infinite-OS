import fs from 'node:fs';

const classicText = fs.readFileSync('src/renderer/styles/globals-classic.css', 'utf8');
const modernText = fs.readFileSync('src/renderer/styles/globals.css', 'utf8');
const asar = fs.readFileSync('dist/win-unpacked/resources/app.asar').toString('latin1');

const clean = (text) =>
  text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 25 && !l.startsWith('/*') && !l.startsWith('*'));

const classicLines = clean(classicText);
const modernLines = clean(modernText);

const onlyClassic = classicLines.find((l) => !modernText.includes(l));
const onlyModern = modernLines.find((l) => !classicText.includes(l));

console.log('classic-only line :', JSON.stringify(onlyClassic));
console.log('  packaged in asar:', onlyClassic ? asar.includes(onlyClassic) : false);
console.log('modern-only line  :', JSON.stringify(onlyModern));
console.log('  packaged in asar:', onlyModern ? asar.includes(onlyModern) : false);
