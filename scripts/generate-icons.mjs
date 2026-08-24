/**
 * Infinite OS Icon Generator
 *
 * Generates cosmic-themed infinity icons matching the Infinite Desktop UI.
 * Produces SVG → PNG (multiple sizes) → ICO (Windows).
 */

import sharp from 'sharp';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const RES_DIR = join(ROOT, 'resources');
const OUT_DIR = join(ROOT, 'scripts', 'icon-out');

if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

// ── Sizes needed ──
const PNG_SIZES = [16, 32, 48, 64, 128, 256];
const ICO_SIZES = [16, 32, 48, 64, 128, 256];

// ── SVG Icon (cosmic infinity) ──
// Designed to match the Infinite Desktop dark-space aesthetic:
//   • Deep navy/black background
//   • Glowing cyan-blue infinity loop
//   • Nebula haze and star particles
//   • Rounded square app icon shape
function generateSVG(size) {
  const s = size;
  const cx = s / 2;
  const cy = s / 2;
  const r = s * 0.38; // infinity loop radius

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}">
  <defs>
    <!-- Background gradient: deep space -->
    <radialGradient id="bg" cx="50%" cy="50%" r="70%">
      <stop offset="0%" stop-color="#0a1628"/>
      <stop offset="60%" stop-color="#060e1a"/>
      <stop offset="100%" stop-color="#020810"/>
    </radialGradient>

    <!-- Nebula glow -->
    <radialGradient id="nebula1" cx="35%" cy="40%" r="50%">
      <stop offset="0%" stop-color="#1a3a6a" stop-opacity="0.5"/>
      <stop offset="50%" stop-color="#0d2240" stop-opacity="0.2"/>
      <stop offset="100%" stop-color="transparent" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="nebula2" cx="65%" cy="60%" r="45%">
      <stop offset="0%" stop-color="#0c2d5e" stop-opacity="0.4"/>
      <stop offset="60%" stop-color="#081e3d" stop-opacity="0.15"/>
      <stop offset="100%" stop-color="transparent" stop-opacity="0"/>
    </radialGradient>

    <!-- Infinity glow (outer) -->
    <filter id="glow-outer" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur in="SourceGraphic" stdDeviation="${s * 0.03}" result="blur"/>
      <feColorMatrix in="blur" type="matrix"
        values="0 0 0 0 0.1  0 0 0 0 0.5  0 0 0 0 1  0 0 0 0.7 0" result="colorBlur"/>
      <feMerge>
        <feMergeNode in="colorBlur"/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>

    <!-- Infinity glow (inner bright) -->
    <filter id="glow-inner" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur in="SourceGraphic" stdDeviation="${s * 0.012}" result="blur"/>
      <feColorMatrix in="blur" type="matrix"
        values="0 0 0 0 0.2  0 0 0 0 0.7  0 0 0 0 1  0 0 0 1 0" result="bright"/>
      <feMerge>
        <feMergeNode in="bright"/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>

    <!-- Star glow -->
    <filter id="star-glow" x="-100%" y="-100%" width="300%" height="300%">
      <feGaussianBlur in="SourceGraphic" stdDeviation="${s * 0.008}"/>
    </filter>

    <!-- Infinity stroke gradient — brand spectrum, violet core to cyan lobes -->
    <linearGradient id="inf-grad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#a78bfa"/>
      <stop offset="30%" stop-color="#818cf8"/>
      <stop offset="55%" stop-color="#38bdf8"/>
      <stop offset="100%" stop-color="#22d3ee"/>
    </linearGradient>

    <!-- Clip for rounded square -->
    <clipPath id="roundedRect">
      <rect x="0" y="0" width="${s}" height="${s}" rx="${s * 0.18}" ry="${s * 0.18}"/>
    </clipPath>
  </defs>

  <g clip-path="url(#roundedRect)">
    <!-- Background -->
    <rect width="${s}" height="${s}" fill="url(#bg)"/>

    <!-- Nebula layers -->
    <rect width="${s}" height="${s}" fill="url(#nebula1)"/>
    <rect width="${s}" height="${s}" fill="url(#nebula2)"/>

    <!-- Subtle cosmic dust band -->
    <ellipse cx="${cx * 0.9}" cy="${cy * 1.1}" rx="${s * 0.45}" ry="${s * 0.12}"
      fill="none" stroke="#1e40af" stroke-width="${s * 0.005}" opacity="0.15"
      transform="rotate(-20 ${cx * 0.9} ${cy * 1.1})"/>

    <!-- Stars (background) -->
    <g filter="url(#star-glow)">
      ${generateStars(s, 35)}
    </g>

    <!-- Infinity symbol - outer glow layer -->
    <g filter="url(#glow-outer)" opacity="0.6">
      ${drawInfinity(s, cx, cy, r, 'url(#inf-grad)', s * 0.055)}
    </g>

    <!-- Infinity symbol - main stroke -->
    <g filter="url(#glow-inner)">
      ${drawInfinity(s, cx, cy, r, 'url(#inf-grad)', s * 0.035)}
    </g>

    <!-- Infinity symbol - bright core -->
    ${drawInfinity(s, cx, cy, r, 'none', s * 0.012, '#e0f2fe', 0.85)}

    <!-- Bright center highlight on the crossing -->
    <circle cx="${cx}" cy="${cy}" r="${s * 0.02}" fill="#93c5fd" opacity="0.4"/>

    <!-- Tiny accent stars near the infinity -->
    <circle cx="${cx - r * 0.7}" cy="${cy - r * 0.5}" r="${s * 0.006}" fill="#e0f2fe" opacity="0.9"/>
    <circle cx="${cx + r * 0.8}" cy="${cy + r * 0.4}" r="${s * 0.005}" fill="#bae6fd" opacity="0.7"/>
    <circle cx="${cx + r * 0.2}" cy="${cy - r * 0.9}" r="${s * 0.004}" fill="#e0f2fe" opacity="0.6"/>

    <!-- Border glow -->
    <rect x="0.5" y="0.5" width="${s - 1}" height="${s - 1}" rx="${s * 0.18}" ry="${s * 0.18}"
      fill="none" stroke="#1e40af" stroke-width="${s * 0.008}" opacity="0.3"/>
    <rect x="1.5" y="1.5" width="${s - 3}" height="${s - 3}" rx="${s * 0.175}" ry="${s * 0.175}"
      fill="none" stroke="#38bdf8" stroke-width="${s * 0.003}" opacity="0.15"/>
  </g>
</svg>`;
}

// ── Draw infinity curve as SVG path ──
function drawInfinity(s, cx, cy, r, stroke, sw, color, opacity) {
  // True lemniscate: wide figure-8 with a shallow diagonal crossing — the
  // same geometry as the in-app InfiniteLogo, so brand surfaces match.
  // (A circle-pair approximation pinches the center into a heart cusp.)
  const h = r * 0.52;
  const d = [
    `M ${cx} ${cy}`,
    `C ${cx - r * 0.62} ${cy - h} ${cx - r} ${cy - h * 0.7} ${cx - r} ${cy}`,
    `C ${cx - r} ${cy + h * 0.7} ${cx - r * 0.62} ${cy + h} ${cx} ${cy}`,
    `C ${cx + r * 0.62} ${cy - h} ${cx + r} ${cy - h * 0.7} ${cx + r} ${cy}`,
    `C ${cx + r} ${cy + h * 0.7} ${cx + r * 0.62} ${cy + h} ${cx} ${cy}`,
    'Z',
  ].join(' ');

  const strokeAttr = color
    ? `stroke="${color}" fill="none" stroke-width="${sw}" opacity="${opacity}"`
    : `stroke="${stroke}" fill="none" stroke-width="${sw}"`;

  return `<path d="${d}" ${strokeAttr}/>`;
}

// ── Generate random star positions (deterministic) ──
function generateStars(s, count) {
  const stars = [];
  // Seed-based for consistency
  let seed = 42;
  const rand = () => { seed = (seed * 16807 + 0) % 2147483647; return seed / 2147483647; };

  for (let i = 0; i < count; i++) {
    const x = rand() * s;
    const y = rand() * s;
    const r = s * (0.001 + rand() * 0.004);
    const opacity = 0.3 + rand() * 0.7;
    stars.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r.toFixed(2)}" fill="#e0f2fe" opacity="${opacity.toFixed(2)}"/>`);
  }
  return stars.join('\n      ');
}

// ── Generate PNGs ──
async function generatePNGs() {
  console.log('Generating PNG icons...');
  for (const size of PNG_SIZES) {
    const svg = generateSVG(size);
    const outPath = join(OUT_DIR, `icon_${size}x${size}.png`);
    await sharp(Buffer.from(svg)).png().toFile(outPath);
    console.log(`  ✓ ${size}x${size} → ${outPath}`);
  }
}

// ── Generate ICO ──
async function generateICO() {
  console.log('Generating Windows ICO...');

  // Build ICO manually: header + directory entries + PNG data
  const images = [];
  for (const size of ICO_SIZES) {
    const svg = generateSVG(size);
    const pngBuf = await sharp(Buffer.from(svg)).png().toBuffer();
    images.push({ size, data: pngBuf });
  }

  // ICO header: 6 bytes
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);     // reserved
  header.writeUInt16LE(1, 2);     // type: 1 = icon
  header.writeUInt16LE(images.length, 4); // image count

  // Directory entries: 16 bytes each
  const dirEntries = [];
  let dataOffset = 6 + images.length * 16;

  for (const img of images) {
    const entry = Buffer.alloc(16);
    const w = img.size >= 256 ? 0 : img.size; // 0 means 256
    const h = img.size >= 256 ? 0 : img.size;
    entry.writeUInt8(w, 0);       // width
    entry.writeUInt8(h, 1);       // height
    entry.writeUInt8(0, 2);       // color palette
    entry.writeUInt8(0, 3);       // reserved
    entry.writeUInt16LE(1, 4);    // color planes
    entry.writeUInt16LE(32, 6);   // bits per pixel
    entry.writeUInt32LE(img.data.length, 8);  // data size
    entry.writeUInt32LE(dataOffset, 12);      // data offset
    dirEntries.push(entry);
    dataOffset += img.data.length;
  }

  const icoBuffer = Buffer.concat([header, ...dirEntries, ...images.map(i => i.data)]);
  const icoPath = join(RES_DIR, 'icon.ico');
  writeFileSync(icoPath, icoBuffer);
  console.log(`  ✓ ICO → ${icoPath} (${(icoBuffer.length / 1024).toFixed(1)} KB)`);

  // Also save the 256x256 as the main icon.png
  const mainPngPath = join(RES_DIR, 'icon.png');
  const svg256 = generateSVG(256);
  await sharp(Buffer.from(svg256)).png().toFile(mainPngPath);
  console.log(`  ✓ Main PNG → ${mainPngPath}`);

  // Generate all size variants in resources/
  for (const size of PNG_SIZES) {
    const svg = generateSVG(size);
    const outPath = join(RES_DIR, `icon_${size}x${size}.png`);
    await sharp(Buffer.from(svg)).png().toFile(outPath);
    console.log(`  ✓ ${size}x${size} → ${outPath}`);
  }
}

// ── Save preview SVG ──
function savePreview() {
  const svg = generateSVG(512);
  const previewPath = join(OUT_DIR, 'icon-preview.svg');
  writeFileSync(previewPath, svg);
  console.log(`  ✓ Preview SVG → ${previewPath}`);
}

// ── Main ──
async function main() {
  console.log('🌌 Infinite OS Icon Generator\n');
  savePreview();
  await generatePNGs();
  await generateICO();
  console.log('\n✅ All icons generated!');
}

main().catch(console.error);
