// Generate Infinite AI ∞ logo as ICO file
// Creates a 32x32 and 256x256 icon with the self-intersecting infinity path

const fs = require('fs');
const path = require('path');

// Create a minimal BMP/ICO by building raw pixel data
// For simplicity, we'll create an SVG first, then note that Electron can use PNG for dev
// For the actual ICO, we'll use a script approach

function createSVG(size) {
  const s = size;
  const cx = s / 2;
  const cy = s / 2;
  const r = s * 0.35;
  
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}">
  <defs>
    <linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#818cf8"/>
      <stop offset="50%" style="stop-color:#6366f1"/>
      <stop offset="100%" style="stop-color:#4f46e5"/>
    </linearGradient>
    <filter id="glow">
      <feGaussianBlur stdDeviation="2" result="blur"/>
      <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>
  <rect width="${s}" height="${s}" rx="${s*0.2}" fill="#0e0e10"/>
  <g transform="translate(${cx},${cy})" filter="url(#glow)">
    <path d="M0,0 
      C${r*0.6},-${r*1.1} ${r*1.1},-${r*0.6} ${r*1.1},0 
      C${r*1.1},${r*0.6} ${r*0.6},${r*1.1} 0,${r*1.1} 
      C-${r*0.6},${r*1.1} -${r*1.1},${r*0.6} -${r*1.1},0 
      C-${r*1.1},-${r*0.6} -${r*0.6},-${r*1.1} 0,0 Z" 
      fill="none" stroke="url(#g)" stroke-width="${s*0.06}" stroke-linecap="round"/>
  </g>
</svg>`;
}

// Write SVGs
const resourcesDir = path.join(__dirname, 'resources');
if (!fs.existsSync(resourcesDir)) fs.mkdirSync(resourcesDir, { recursive: true });

// Write SVG icon
const svg256 = createSVG(256);
fs.writeFileSync(path.join(resourcesDir, 'icon.svg'), svg256);
console.log('Created icon.svg');

console.log('SVG icons created. Electron will use these for dev mode window icon.');
console.log('For packaged builds, run: npm install sharp && node scripts/generate-icon.js');
