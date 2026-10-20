/**
 * Wallpapers are deliberately cheap: presets are layered CSS gradients, so
 * switching them costs one paint and no decode. A custom photo is decoded
 * once, downscaled, and re-encoded as a compact JPEG before it is stored with
 * the rest of the appearance preferences.
 */

export type WallpaperId =
  | 'none'
  | 'midnight'
  | 'aurora'
  | 'sunset'
  | 'forest'
  | 'ocean'
  | 'bloom'
  | 'graphite'
  | 'dusk'
  | 'custom';

export interface WallpaperPreset {
  id: Exclude<WallpaperId, 'custom'>;
  name: string;
  description: string;
  /** Full-size layered gradient. Also used for the picker thumbnail. */
  background: string;
}

export const WALLPAPER_PRESETS: WallpaperPreset[] = [
  {
    id: 'none',
    name: 'None',
    description: 'The plain Infinite OS surface',
    background: '#07070a',
  },
  {
    id: 'midnight',
    name: 'Midnight',
    description: 'Violet and deep blue',
    background:
      'radial-gradient(1200px 820px at 16% 4%, #2c1f5e 0%, rgba(44,31,94,0) 62%), radial-gradient(900px 720px at 88% 16%, #0d3150 0%, rgba(13,49,80,0) 58%), radial-gradient(1000px 700px at 52% 112%, #24112f 0%, rgba(36,17,47,0) 55%), linear-gradient(158deg, #0b0b14 0%, #07070a 52%, #0b0810 100%)',
  },
  {
    id: 'aurora',
    name: 'Aurora',
    description: 'Cold light over black water',
    background:
      'radial-gradient(900px 640px at 18% -8%, #0d5b63 0%, rgba(13,91,99,0) 64%), radial-gradient(760px 620px at 76% 2%, #3c1a6b 0%, rgba(60,26,107,0) 58%), radial-gradient(1100px 720px at 48% 118%, #062735 0%, rgba(6,39,53,0) 60%), linear-gradient(165deg, #060d12 0%, #05070b 55%, #070b12 100%)',
  },
  {
    id: 'sunset',
    name: 'Sunset',
    description: 'Warm dusk, muted ember',
    background:
      'radial-gradient(980px 680px at 14% 2%, #5a1e37 0%, rgba(90,30,55,0) 62%), radial-gradient(820px 640px at 88% 12%, #6b3418 0%, rgba(107,52,24,0) 56%), radial-gradient(1100px 760px at 55% 116%, #33141c 0%, rgba(51,20,28,0) 58%), linear-gradient(160deg, #140a0f 0%, #08060a 55%, #0d0709 100%)',
  },
  {
    id: 'forest',
    name: 'Forest',
    description: 'Moss, pine, and still air',
    background:
      'radial-gradient(880px 660px at 16% -4%, #124334 0%, rgba(18,67,52,0) 62%), radial-gradient(780px 620px at 84% 8%, #1e3d2a 0%, rgba(30,61,42,0) 56%), radial-gradient(1000px 700px at 50% 114%, #0a1d19 0%, rgba(10,29,25,0) 60%), linear-gradient(162deg, #08120f 0%, #060a09 58%, #070d0b 100%)',
  },
  {
    id: 'ocean',
    name: 'Ocean',
    description: 'Blue depth with a cyan edge',
    background:
      'radial-gradient(980px 700px at 12% 0%, #0b3a5c 0%, rgba(11,58,92,0) 62%), radial-gradient(780px 600px at 86% 10%, #0b4a58 0%, rgba(11,74,88,0) 55%), radial-gradient(1100px 760px at 52% 116%, #071a2b 0%, rgba(7,26,43,0) 60%), linear-gradient(160deg, #06111a 0%, #05090e 55%, #061019 100%)',
  },
  {
    id: 'bloom',
    name: 'Bloom',
    description: 'Rose light in a dark room',
    background:
      'radial-gradient(900px 640px at 18% 4%, #561b47 0%, rgba(86,27,71,0) 60%), radial-gradient(820px 640px at 86% 14%, #3f1448 0%, rgba(63,20,72,0) 58%), radial-gradient(1000px 720px at 50% 114%, #1c0c24 0%, rgba(28,12,36,0) 60%), linear-gradient(162deg, #120a13 0%, #08060a 56%, #0d0710 100%)',
  },
  {
    id: 'graphite',
    name: 'Graphite',
    description: 'Quiet metal, almost monochrome',
    background:
      'radial-gradient(860px 620px at 20% 0%, #23232a 0%, rgba(35,35,42,0) 64%), radial-gradient(760px 600px at 82% 10%, #1b1d24 0%, rgba(27,29,36,0) 58%), radial-gradient(980px 720px at 50% 112%, #101116 0%, rgba(16,17,22,0) 62%), linear-gradient(162deg, #0b0b0e 0%, #07070a 58%, #0a0b0f 100%)',
  },
  {
    id: 'dusk',
    name: 'Dusk',
    description: 'Copper sky fading to blue',
    background:
      'radial-gradient(900px 620px at 18% 2%, #513022 0%, rgba(81,48,34,0) 60%), radial-gradient(820px 660px at 84% 10%, #273452 0%, rgba(39,52,82,0) 56%), radial-gradient(1000px 720px at 50% 114%, #171526 0%, rgba(23,21,38,0) 60%), linear-gradient(160deg, #110d0e 0%, #08080c 55%, #0a0b12 100%)',
  },
];

const PRESET_BY_ID = new Map(WALLPAPER_PRESETS.map((preset) => [preset.id, preset]));

export function wallpaperPreset(id: WallpaperId): WallpaperPreset | null {
  return PRESET_BY_ID.get(id as Exclude<WallpaperId, 'custom'>) ?? null;
}

/**
 * Decode, crop, downscale, and compress a user photo. Returns a data URL small
 * enough to live in appearance preferences (and therefore localStorage)
 * without making settings writes expensive.
 */
export async function prepareWallpaperImage(file: File): Promise<{ dataUrl: string; name: string }> {
  if (!file.type.startsWith('image/')) {
    throw new Error('Choose a JPG, PNG, or WebP image.');
  }
  if (file.size > 25_000_000) {
    throw new Error('Choose an image under 25 MB.');
  }

  const source = await decodeImage(file);
  const sourceWidth = source instanceof HTMLImageElement ? source.naturalWidth : source.width;
  const sourceHeight = source instanceof HTMLImageElement ? source.naturalHeight : source.height;
  if (!sourceWidth || !sourceHeight) throw new Error('That image could not be read.');

  let maxEdge = 1920;
  let quality = 0.82;
  let dataUrl = '';

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const scale = Math.min(1, maxEdge / Math.max(sourceWidth, sourceHeight));
    const width = Math.max(1, Math.round(sourceWidth * scale));
    const height = Math.max(1, Math.round(sourceHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not prepare that image.');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    // Flatten transparency onto the shell's base color rather than storing a
    // much larger PNG.
    ctx.fillStyle = '#07070a';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(source, 0, 0, width, height);
    dataUrl = canvas.toDataURL('image/jpeg', quality);

    if (dataUrl.length <= 2_200_000) break;
    maxEdge = Math.round(maxEdge * 0.8);
    quality = Math.max(0.6, quality - 0.06);
  }

  closeImage(source);

  if (dataUrl.length > 2_800_000) {
    throw new Error('That image is too detailed to store. Try a smaller one.');
  }
  return { dataUrl, name: file.name };
}

type DecodedImage = ImageBitmap | HTMLImageElement;

async function decodeImage(file: File): Promise<DecodedImage> {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file);
    } catch {
      // Fall through to the <img> decoder for formats Chromium cannot
      // bitmap-decode directly.
    }
  }
  const url = URL.createObjectURL(file);
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('That image could not be read.'));
      image.src = url;
    });
  } finally {
    // The image has decoded into memory; the blob URL is no longer needed.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

function closeImage(image: DecodedImage): void {
  if (typeof ImageBitmap !== 'undefined' && image instanceof ImageBitmap) image.close();
}
