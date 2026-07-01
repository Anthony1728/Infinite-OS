import sharp from 'sharp';
import pngToIco from 'png-to-ico';
import { join } from 'path';

const resourcesDir = join(import.meta.dirname, '..', 'resources');

async function generateIcon() {
  // Create the ∞ logo as SVG
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">
  <defs>
    <linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#818cf8"/>
      <stop offset="50%" style="stop-color:#6366f1"/>
      <stop offset="100%" style="stop-color:#4f46e5"/>
    </linearGradient>
    <filter id="glow">
      <feGaussianBlur stdDeviation="4" result="blur"/>
      <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>
  <rect width="256" height="256" rx="48" fill="#0e0e10"/>
  <g transform="translate(128,128)" filter="url(#glow)">
    <path d="M0,0 
      C55,-95 95,-55 95,0 
      C95,55 55,95 0,95 
      C-55,95 -95,55 -95,0 
      C-95,-55 -55,-95 0,0 Z" 
      fill="none" stroke="url(#g)" stroke-width="14" stroke-linecap="round"/>
  </g>
</svg>`;

  // Generate PNGs at different sizes
  const png16 = await sharp(Buffer.from(svg)).resize(16, 16).png().toBuffer();
  const png32 = await sharp(Buffer.from(svg)).resize(32, 32).png().toBuffer();
  const png48 = await sharp(Buffer.from(svg)).resize(48, 48).png().toBuffer();
  const png64 = await sharp(Buffer.from(svg)).resize(64, 64).png().toBuffer();
  const png128 = await sharp(Buffer.from(svg)).resize(128, 128).png().toBuffer();
  const png256 = await sharp(Buffer.from(svg)).resize(256, 256).png().toBuffer();

  // Save individual PNGs
  const { writeFileSync } = await import('fs');
  writeFileSync(join(resourcesDir, 'icon.png'), png256);
  writeFileSync(join(resourcesDir, 'icon_256x256.png'), png256);
  writeFileSync(join(resourcesDir, 'icon_128x128.png'), png128);
  writeFileSync(join(resourcesDir, 'icon_64x64.png'), png64);
  writeFileSync(join(resourcesDir, 'icon_48x48.png'), png48);
  writeFileSync(join(resourcesDir, 'icon_32x32.png'), png32);
  writeFileSync(join(resourcesDir, 'icon_16x16.png'), png16);

  // Generate ICO file (contains 16, 32, 48, 256)
  const icoBuffer = await pngToIco([png16, png32, png48, png256]);
  writeFileSync(join(resourcesDir, 'icon.ico'), icoBuffer);

  console.log('Generated: icon.ico, icon.png, and all size variants');
}

generateIcon().catch(console.error);
