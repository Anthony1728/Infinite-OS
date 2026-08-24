// Renders a contact sheet of the InfinityIcons set so glyph geometry can be
// reviewed visually. Bundles the TSX with a React stub, then draws every
// icon on dark tiles via sharp. Run: node scripts/icon-preview.mjs
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import sharp from 'sharp';
import { join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');

// esbuild ships nested under vite in the pnpm store, not as a direct dep.
const require = createRequire(join(ROOT, 'package.json'));
let build;
try {
  ({ build } = require('esbuild'));
} catch {
  const viteEsbuild = join(ROOT, 'node_modules/.pnpm/esbuild@0.25.12/node_modules/esbuild');
  ({ build } = require(viteEsbuild));
}
await build({
  entryPoints: [join(ROOT, 'src/renderer/components/brand/InfinityIcons.tsx')],
  bundle: true,
  format: 'esm',
  outfile: join(ROOT, 'scripts/icon-out/icons.bundle.mjs'),
  alias: { react: join(ROOT, 'scripts/react-stub.mjs') },
  logLevel: 'silent',
});

const { INF_ICONS } = await import(pathToFileURL(join(ROOT, 'scripts/icon-out/icons.bundle.mjs')));
const names = Object.keys(INF_ICONS);

const CELL_W = 150;
const CELL_H = 112;
const COLS = 8;
const ROWS = Math.ceil(names.length / COLS);
const ICON = 52;

let body = '';
names.forEach((name, i) => {
  const x = (i % COLS) * CELL_W;
  const y = Math.floor(i / COLS) * CELL_H;
  const def = INF_ICONS[name];
  const paths = def.segs
    .map(
      (seg) =>
        `<path d="${seg.d}" stroke-dasharray="${seg.dash ?? ''}" opacity="${seg.tone ?? 1}" transform="${seg.transform ?? ''}"/>`,
    )
    .join('');
  const circles = (def.circles ?? [])
    .map(([cx, cy, r]) => `<circle cx="${cx}" cy="${cy}" r="${r}"/>`)
    .join('');
  body += `
    <g transform="translate(${x + (CELL_W - ICON) / 2} ${y + 14})">
      <svg width="${ICON}" height="${ICON}" viewBox="0 0 24 24" fill="none" stroke="#e4e4e7" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
        ${paths}${circles}
      </svg>
    </g>
    <text x="${x + CELL_W / 2}" y="${y + CELL_H - 14}" text-anchor="middle" font-family="Segoe UI, sans-serif" font-size="11" fill="#8b93a7">${name}</text>
    <rect x="${x + 8}" y="${y + 6}" width="${CELL_W - 16}" height="${CELL_H - 12}" rx="10" fill="none" stroke="#1c2230"/>
  `;
});

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${COLS * CELL_W}" height="${ROWS * CELL_H}">
  <rect width="100%" height="100%" fill="#0b0d12"/>
  ${body}
</svg>`;

writeFileSync(join(ROOT, 'scripts/icon-out/glyph-sheet.svg'), svg);
await sharp(Buffer.from(svg)).png().toFile(join(ROOT, 'scripts/icon-out/glyph-sheet.png'));
console.log(`✓ ${names.length} glyphs → scripts/icon-out/glyph-sheet.png`);
