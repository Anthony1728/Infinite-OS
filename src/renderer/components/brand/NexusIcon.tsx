// NexusIcon — the "Ethereal Agent Nexus" glyph (gemini-code JSON spec).
// A glassmorphic AI-agent mark: orbital dash arrays around a gradient
// hexagon, crossed cyan filaments, and a glowing white neural spark.
// Renders crisp from 16px to 128px; gradients defined inline so it works
// in windows, popups, and packaged builds without external assets.

interface NexusIconProps {
  className?: string;
  /** Optional fixed pixel size; falls back to className sizing. */
  size?: number;
}

export function NexusIcon({ className = 'w-6 h-6', size }: NexusIconProps) {
  const style = size ? { width: size, height: size } : undefined;
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width="100%"
      height="100%"
      className={className}
      style={style}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="nexusPurple" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#d8b4fe" />
          <stop offset="50%" stopColor="#a855f7" />
          <stop offset="100%" stopColor="#ec4899" />
        </linearGradient>
        <linearGradient id="nexusCyan" x1="100%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#7dd3fc" />
          <stop offset="50%" stopColor="#0ea5e9" />
          <stop offset="100%" stopColor="#8b5cf6" />
        </linearGradient>
        <filter id="nexusGlow" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="1.2" result="blur" />
          <feComposite in="SourceGraphic" in2="blur" operator="over" />
        </filter>
      </defs>
      <circle cx="12" cy="12" r="9.5" stroke="url(#nexusPurple)" strokeWidth="0.5" strokeDasharray="2 3" fill="none" opacity="0.6" />
      <circle cx="12" cy="12" r="7.5" stroke="url(#nexusCyan)" strokeWidth="0.5" strokeDasharray="8 4 2 4" fill="none" opacity="0.8" />
      <path d="M12 4 L18.5 8 V16 L12 20 L5.5 16 V8 Z" stroke="url(#nexusPurple)" strokeWidth="1.2" fill="none" strokeLinejoin="round" />
      <path d="M8 9 L16 15 M16 9 L8 15" stroke="url(#nexusCyan)" strokeWidth="1.5" strokeLinecap="round" opacity="0.8" />
      <path d="M12 4.5 V7 M12 17 V19.5 M6.5 9 L4.5 8 M17.5 9 L19.5 8 M6.5 15 L4.5 16 M17.5 15 L19.5 16" stroke="#ffffff" strokeWidth="1" strokeLinecap="round" opacity="0.4" />
      <path d="M12 9 L12.6 11.4 L15 12 L12.6 12.6 L12 15 L11.4 12.6 L9 12 L11.4 11.4 Z" fill="#ffffff" filter="url(#nexusGlow)" />
      <circle cx="12" cy="4" r="1.5" fill="#c084fc" />
      <circle cx="12" cy="20" r="1.5" fill="#ec4899" />
      <circle cx="5.5" cy="8" r="1" fill="#38bdf8" />
      <circle cx="18.5" cy="16" r="1" fill="#38bdf8" />
    </svg>
  );
}
