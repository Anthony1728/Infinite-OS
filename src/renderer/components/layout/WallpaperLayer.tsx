import { useUIStore } from '../../stores/ui';
import { wallpaperPreset } from '../../lib/wallpapers';

/**
 * The desktop backdrop. Sits at z-0 under a z-10 shell wrapper, so every
 * panel above it can stay in its own stacking context. Only the media layer
 * is transformed/filtered; the scrim and vignette remain cheap static paints.
 */
export function WallpaperLayer() {
  const wallpaper = useUIStore((state) => state.wallpaper);
  const image = useUIStore((state) => state.wallpaperImage);
  const dim = useUIStore((state) => state.wallpaperDim);
  const blur = useUIStore((state) => state.wallpaperBlur);

  if (wallpaper === 'none') return null;

  const preset = wallpaperPreset(wallpaper);
  const backgroundImage = wallpaper === 'custom' && image
    ? `url("${image}")`
    : preset?.background;
  if (!backgroundImage) return null;

  const blurPx = Math.max(0, Math.min(28, blur));

  return (
    <div className="os-wallpaper" aria-hidden="true">
      <div
        className="os-wallpaper-media"
        style={{
          backgroundImage,
          filter: blurPx > 0 ? `blur(${blurPx}px) saturate(1.06)` : 'saturate(1.04)',
          inset: `${-blurPx * 2 - 8}px`,
        }}
      />
      <div className="os-wallpaper-dim" style={{ opacity: Math.max(0, Math.min(85, dim)) / 100 }} />
      <div className="os-wallpaper-vignette" />
      <div className="os-wallpaper-noise" />
    </div>
  );
}
