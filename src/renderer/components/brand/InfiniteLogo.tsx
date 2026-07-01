import { useId } from 'react';

const PATH =
  'M18 50C18 29 32 16 50 16c21 0 34 18 50 34s29 34 50 34c18 0 32-13 32-34s-14-34-32-34c-21 0-34 18-50 34S71 84 50 84C32 84 18 71 18 50Z';

interface InfiniteLogoProps {
  className?: string;
  animated?: boolean;
  labelled?: boolean;
}

export function InfiniteLogo({ className = '', animated = false, labelled = false }: InfiniteLogoProps) {
  const id = useId().replace(/:/g, '');
  const gradient = `infinite-gradient-${id}`;
  const glow = `infinite-glow-${id}`;
  return (
    <svg
      className={`infinite-logo ${className}`}
      viewBox="0 0 200 100"
      fill="none"
      role={labelled ? 'img' : undefined}
      aria-label={labelled ? 'InfiniteAI' : undefined}
      aria-hidden={labelled ? undefined : true}
    >
      <defs>
        <linearGradient id={gradient} x1="18" y1="16" x2="182" y2="84" gradientUnits="userSpaceOnUse">
          <stop stopColor="#8b5cf6" />
          <stop offset=".5" stopColor="#22d3ee" />
          <stop offset="1" stopColor="#ec4899" />
        </linearGradient>
        <filter id={glow} x="-30%" y="-55%" width="160%" height="210%">
          <feGaussianBlur stdDeviation="5" />
        </filter>
      </defs>
      <path
        className="infinite-logo__glow"
        d={PATH}
        stroke={`url(#${gradient})`}
        strokeWidth="12"
        filter={`url(#${glow})`}
      />
      <path d={PATH} stroke="rgba(255,255,255,.08)" strokeWidth="9" />
      <path className="infinite-logo__core" d={PATH} stroke={`url(#${gradient})`} strokeWidth="7" />
      {animated && (
        <path className="infinite-logo__runner" d={PATH} stroke="white" strokeWidth="2.5" pathLength="100" />
      )}
    </svg>
  );
}
