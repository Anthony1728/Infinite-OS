import sharp from 'sharp';
import pngToIco from 'png-to-ico';
import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';

const resourcesDir = join(import.meta.dirname, '..', 'resources');
const path =
  'M18 50C18 29 32 16 50 16c21 0 34 18 50 34s29 34 50 34c18 0 32-13 32-34s-14-34-32-34c-21 0-34 18-50 34S71 84 50 84C32 84 18 71 18 50Z';

async function generateIcon() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">
    <defs><linearGradient id="g" x1="20" y1="50" x2="180" y2="50" gradientUnits="userSpaceOnUse"><stop stop-color="#8b5cf6"/><stop offset=".5" stop-color="#22d3ee"/><stop offset="1" stop-color="#ec4899"/></linearGradient></defs>
    <rect x="8" y="8" width="240" height="240" rx="54" fill="#0b0d13"/>
    <rect x="8.5" y="8.5" width="239" height="239" rx="53.5" fill="none" stroke="#fff" stroke-opacity=".08"/>
    <g transform="matrix(1.268 0 0 1.6 1.2 48)">
      <path d="${path}" fill="none" stroke="#fff" stroke-opacity=".08" stroke-width="12" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="${path}" fill="none" stroke="url(#g)" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>
    </g>
  </svg>`;

  const sizes = [16, 32, 48, 64, 128, 256];
  const buffers = new Map();
  for (const size of sizes) {
    const buffer = await sharp(Buffer.from(svg)).resize(size, size).png().toBuffer();
    buffers.set(size, buffer);
    await writeFile(join(resourcesDir, size === 256 ? 'icon.png' : `icon_${size}x${size}.png`), buffer);
  }
  await writeFile(join(resourcesDir, 'icon_256x256.png'), buffers.get(256));
  await writeFile(
    join(resourcesDir, 'icon.ico'),
    await pngToIco([buffers.get(16), buffers.get(32), buffers.get(48), buffers.get(256)]),
  );
  console.log('Generated canonical InfiniteAI icon assets.');
}

generateIcon().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
