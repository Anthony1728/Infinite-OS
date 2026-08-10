import { useId } from 'react';
import { type LogoStyle, useUIStore } from '../../stores/ui';

const ORBIT_PATH =
  'M18 50C18 29 32 16 50 16c21 0 34 18 50 34s29 34 50 34c18 0 32-13 32-34s-14-34-32-34c-21 0-34 18-50 34S71 84 50 84C32 84 18 71 18 50Z';

interface InfiniteLogoProps {
  className?: string;
  animated?: boolean;
  loading?: boolean;
  labelled?: boolean;
  variant?: LogoStyle;
}

function standardLogoStyle(requested: LogoStyle): LogoStyle {
  return requested;
}

export function InfiniteLogo({ className = '', animated = false, loading = false, labelled = false, variant }: InfiniteLogoProps) {
  const preferredStyle = useUIStore((state) => state.logoStyle);
  // The optional loader variant is intentionally retired until it can render
  // identically in packaged desktop and development launches.
  const logoStyle = standardLogoStyle(variant ?? preferredStyle);
  const id = useId().replace(/:/g, '');
  const spectrumGradient = `infinite-spectrum-${id}`;
  const iceGradient = `infinite-ice-${id}`;
  return (
    <svg
      className={`infinite-logo infinite-logo--${logoStyle} ${animated || loading ? 'infinite-logo--active' : ''} ${loading ? 'infinite-logo--loading' : ''} ${className}`}
      viewBox="0 0 200 100"
      fill="none"
      role={labelled ? 'img' : undefined}
      aria-label={labelled ? 'Infinite OS' : undefined}
      aria-hidden={labelled ? undefined : true}
    >
      {logoStyle === 'luminous' ? (
        <>
          {/* A crisp, proper infinity loop with electric light moving around it.
              Every stroke remains inline so packaged launches cannot lose it. */}
          <path className="infinite-logo__luminous-aura" d={ORBIT_PATH} stroke="#fff" strokeWidth="15" />
          <path className="infinite-logo__fallback infinite-logo__luminous-track" d={ORBIT_PATH} stroke="#fff" strokeWidth="4.5" />
          <path className="infinite-logo__luminous-line" d={ORBIT_PATH} stroke="#fff" strokeWidth="2.2" />
          <path className="infinite-logo__luminous-runner infinite-logo__luminous-runner--violet" d={ORBIT_PATH} stroke="#fff" strokeWidth="6" pathLength="100" />
          <path className="infinite-logo__luminous-runner infinite-logo__luminous-runner--cyan" d={ORBIT_PATH} stroke="#fff" strokeWidth="6" pathLength="100" />
          <path className="infinite-logo__luminous-runner infinite-logo__luminous-runner--pink" d={ORBIT_PATH} stroke="#fff" strokeWidth="6" pathLength="100" />
          <path className="infinite-logo__luminous-head" d={ORBIT_PATH} stroke="#fff" strokeWidth="3.2" pathLength="100" />
        </>
      ) : logoStyle === 'ice' ? (
        <>
          <defs>
            <linearGradient id={iceGradient} x1="18" y1="18" x2="182" y2="82" gradientUnits="userSpaceOnUse">
              <stop stopColor="#bae6fd" />
              <stop offset=".28" stopColor="#38bdf8" />
              <stop offset=".52" stopColor="#e0f2fe" />
              <stop offset=".76" stopColor="#0ea5e9" />
              <stop offset="1" stopColor="#7dd3fc" />
            </linearGradient>
          </defs>
          <path className="infinite-logo__ice-aura" d={ORBIT_PATH} stroke={`url(#${iceGradient})`} strokeWidth="15" />
          <path className="infinite-logo__fallback infinite-logo__ice-track" d={ORBIT_PATH} stroke={`url(#${iceGradient})`} strokeWidth="6" />
          {(animated || loading) && (
            <>
              <path className="infinite-logo__ice-runner infinite-logo__ice-runner--blue" d={ORBIT_PATH} stroke="#38bdf8" strokeWidth="7" pathLength="100" />
              <path className="infinite-logo__ice-runner infinite-logo__ice-runner--white" d={ORBIT_PATH} stroke="#e0f2fe" strokeWidth="7" pathLength="100" />
              <path className="infinite-logo__ice-runner infinite-logo__ice-runner--cyan" d={ORBIT_PATH} stroke="#0ea5e9" strokeWidth="7" pathLength="100" />
            </>
          )}
        </>
      ) : (
        <>
          <defs>
            <linearGradient id={spectrumGradient} x1="18" y1="16" x2="182" y2="84" gradientUnits="userSpaceOnUse">
              <stop stopColor="#8b5cf6" />
              <stop offset=".5" stopColor="#22d3ee" />
              <stop offset="1" stopColor="#ec4899" />
            </linearGradient>
          </defs>
          {/* A solid path always remains underneath the original smooth
              spectrum, so even a failed paint reference cannot hide the logo. */}
          <path className="infinite-logo__fallback" d={ORBIT_PATH} stroke="#38bdf8" strokeWidth="7" opacity=".34" />
          <path className="infinite-logo__spectrum-glow" d={ORBIT_PATH} stroke={`url(#${spectrumGradient})`} strokeWidth="12" />
          <path className="infinite-logo__spectrum-base" d={ORBIT_PATH} stroke={`url(#${spectrumGradient})`} strokeWidth="7" />
          {(animated || loading) && (
            <>
              <path className="infinite-logo__spectrum-runner infinite-logo__spectrum-runner--violet" d={ORBIT_PATH} stroke="#8b5cf6" strokeWidth="6" pathLength="100" />
              <path className="infinite-logo__spectrum-runner infinite-logo__spectrum-runner--cyan" d={ORBIT_PATH} stroke="#22d3ee" strokeWidth="6" pathLength="100" />
              <path className="infinite-logo__spectrum-runner infinite-logo__spectrum-runner--pink" d={ORBIT_PATH} stroke="#ec4899" strokeWidth="6" pathLength="100" />
            </>
          )}
        </>
      )}
    </svg>
  );
}
