/**
 * AgentBuddy — Infinite OS's smash-pet (Hermes-pet energy, Infinite glass).
 * Tiny green brute + little red car in the status bar at all times:
 * - working (Infinite OS working): Hulk smashing the car — arm slam,
 *   shockwave rings, impact star, car rumble + cracks.
 * - idle / offline (not working): just stands beside the car, breathing quietly.
 * Pure SVG + CSS, no assets, ~zero cost.
 */
export function AgentBuddy({ working, offline = false }: { working: boolean; offline?: boolean }) {
  const smashing = working && !offline;
  return (
    <span
      className={smashing ? 'os-buddy-work' : 'os-buddy-idle'}
      title={
        offline
          ? 'Infinite OS offline — buddy standing by'
          : smashing
            ? 'Infinite OS working — buddy smashing through it'
            : 'Infinite OS idle — buddy standing by'
      }
      aria-label={offline ? 'Infinite OS offline' : smashing ? 'Infinite OS working' : 'Infinite OS idle'}
      role="img"
    >
      <svg width="36" height="22" viewBox="0 0 38 24" fill="none" aria-hidden="true">
        <defs>
          <linearGradient id="os-hulk-skin" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#4ade80" />
            <stop offset="1" stopColor="#16a34a" />
          </linearGradient>
          <linearGradient id="os-hulk-dark" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#22c55e" />
            <stop offset="1" stopColor="#15803d" />
          </linearGradient>
        </defs>

        {/* impact rings — CSS shows these only while working */}
        <g className="os-buddy-rings" stroke="#fde047" strokeWidth="1">
          <ellipse cx="20" cy="15.5" rx="6" ry="2.4" opacity=".8" />
          <ellipse cx="20" cy="15.5" rx="9" ry="3.6" opacity=".45" />
        </g>

        {/* impact star flash — only while smashing */}
        {smashing && (
          <g>
            <polygon
              points="20,9.5 21,13 24.5,13.5 21.5,15.5 22.5,19 20,16.8 17.5,19 18.5,15.5 15.5,13.5 19,13"
              fill="#fde047"
              stroke="#f97316"
              strokeWidth=".6"
              strokeLinejoin="round"
            />
          </g>
        )}

        {/* little red car — the thing getting smashed */}
        <g className={smashing ? 'os-smash-rumble' : undefined}>
          <g transform={smashing ? 'rotate(-4 27 16)' : undefined}>
            {/* cabin */}
            <rect x="24" y="11.5" width="6.5" height="3.2" rx="1" fill="#ef4444" stroke="#7f1d1d" strokeWidth=".8" />
            <rect x="25" y="12.3" width="2" height="1.6" rx=".4" fill="#bae6fd" />
            <rect x="27.5" y="12.3" width="2" height="1.6" rx=".4" fill="#bae6fd" />
            {/* body */}
            <rect
              x="20.5"
              y={smashing ? '14.8' : '14'}
              width="12.5"
              height="4.4"
              rx="1.4"
              fill={smashing ? '#991b1b' : '#b91c1c'}
              stroke="#450a0a"
              strokeWidth=".8"
            />
            {/* smash cracks */}
            {smashing && (
              <polyline
                points="23,15 24.5,16.5 23.5,18 25.5,18.5"
                stroke="#fde047"
                strokeWidth=".8"
                fill="none"
                strokeLinecap="round"
              />
            )}
            {/* wheels */}
            <circle cx="23.5" cy="18.8" r="1.9" fill="#18181b" stroke="#3f3f46" strokeWidth=".7" />
            <circle cx="23.5" cy="18.8" r=".7" fill="#a1a1aa" />
            <circle cx="30" cy="18.8" r="1.9" fill="#18181b" stroke="#3f3f46" strokeWidth=".7" />
            <circle cx="30" cy="18.8" r=".7" fill="#a1a1aa" />
          </g>
        </g>

        {/* brute legs */}
        <rect x="5" y="17" width="3" height="4" rx="1.2" fill="url(#os-hulk-dark)" />
        <rect x="9" y="17" width="3" height="4" rx="1.2" fill="url(#os-hulk-dark)" />
        {/* torn purple shorts */}
        <path
          d="M4 14.5 h9 v3 l-1.2-1 -1.3 1.2 -1.2-1.1 -1.3 1.1 -1.2-1 -1.3 1 -1.5-1.2 Z"
          fill="#4c2d95"
          stroke="#2e1065"
          strokeWidth=".7"
        />
        {/* torso */}
        <rect x="4.5" y="8.5" width="8" height="6.8" rx="2.5" fill="url(#os-hulk-skin)" stroke="#14532d" strokeWidth=".7" />
        {/* back arm (left, static) */}
        <rect x="2.3" y="10" width="2.8" height="6" rx="1.4" fill="url(#os-hulk-dark)" stroke="#14532d" strokeWidth=".6" />
        <circle cx="3.7" cy="16" r="1.7" fill="url(#os-hulk-skin)" stroke="#14532d" strokeWidth=".6" />

        {/* smash arm — down at side when idle, raised over car when working */}
        {smashing ? (
          <g className="os-buddy-arm">
            <rect x="12.2" y="3.5" width="3.4" height="8.5" rx="1.7" fill="url(#os-hulk-dark)" stroke="#14532d" strokeWidth=".6" />
            <circle cx="13.9" cy="12.5" r="2.4" fill="url(#os-hulk-skin)" stroke="#14532d" strokeWidth=".7" />
          </g>
        ) : (
          <g>
            <rect x="12" y="10" width="2.8" height="6" rx="1.4" fill="url(#os-hulk-dark)" stroke="#14532d" strokeWidth=".6" />
            <circle cx="13.4" cy="16" r="1.7" fill="url(#os-hulk-skin)" stroke="#14532d" strokeWidth=".6" />
          </g>
        )}

        {/* head */}
        <circle cx="8.5" cy="6" r="3.3" fill="url(#os-hulk-skin)" stroke="#14532d" strokeWidth=".7" />
        {/* black hair */}
        <path
          d="M5.3 4.8 L5.8 2.6 7.2 3.6 8.3 2 9.4 3.5 10.9 2.6 11.6 4.6 10.8 5.6 9.3 4.6 8 5.4 6.6 4.5 Z"
          fill="#18181b"
        />
        {/* angry brows */}
        <line x1="6.3" y1="5" x2="8" y2="5.7" stroke="#14532d" strokeWidth=".8" strokeLinecap="round" />
        <line x1="10.7" y1="5" x2="9" y2="5.7" stroke="#14532d" strokeWidth=".8" strokeLinecap="round" />
        {/* eyes */}
        <circle cx="7.2" cy="6.4" r=".75" fill="#fff" />
        <circle cx="9.8" cy="6.4" r=".75" fill="#fff" />
        <circle cx="7.3" cy="6.5" r=".32" fill="#18181b" />
        <circle cx="9.7" cy="6.5" r=".32" fill="#18181b" />
        {/* mouth: grimace while smashing, flat while idle */}
        {smashing ? (
          <g>
            <rect x="6.9" y="8" width="3.2" height="1.6" rx=".5" fill="#fff" stroke="#14532d" strokeWidth=".5" />
            <line x1="7.7" y1="8" x2="7.7" y2="9.6" stroke="#14532d" strokeWidth=".4" />
            <line x1="8.5" y1="8" x2="8.5" y2="9.6" stroke="#14532d" strokeWidth=".4" />
            <line x1="9.3" y1="8" x2="9.3" y2="9.6" stroke="#14532d" strokeWidth=".4" />
          </g>
        ) : (
          <line x1="7.4" y1="8.6" x2="9.6" y2="8.6" stroke="#14532d" strokeWidth=".8" strokeLinecap="round" />
        )}
      </svg>
    </span>
  );
}
