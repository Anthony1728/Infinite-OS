/**
 * AgentBuddy — Infinite OS's smash-pet (Hermes-pet energy, Infinite glass).
 * A hulking little brute stands in the status bar at all times: breathing
 * quietly when idle, slamming the task-crate with shockwave rings while the
 * agent works. Pure SVG + CSS, no assets, ~zero cost.
 */
export function AgentBuddy({ working }: { working: boolean }) {
  return (
    <span
      className={working ? 'os-buddy-work' : 'os-buddy-idle'}
      title={working ? 'Agent smashing through work' : 'Agent standing by'}
      aria-label={working ? 'Agent working' : 'Agent idle'}
      role="img"
    >
      <svg width="26" height="22" viewBox="0 0 28 24" fill="none" aria-hidden="true">
        <defs>
          <linearGradient id="os-buddy-body" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#8b5cf6" />
            <stop offset="1" stopColor="#4c1d95" />
          </linearGradient>
          <linearGradient id="os-buddy-arm" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#a78bfa" />
            <stop offset="1" stopColor="#6d28d9" />
          </linearGradient>
        </defs>
        {/* impact rings — only visible while smashing */}
        <g className="os-buddy-rings" stroke="#67e8f9" strokeWidth="1">
          <ellipse cx="20" cy="18" rx="6" ry="2.4" opacity=".7" />
          <ellipse cx="20" cy="18" rx="9" ry="3.6" opacity=".4" />
        </g>
        {/* task crate — the thing getting smashed */}
        <g className={working ? 'os-smash-rumble' : undefined}>
          <rect x="16.5" y="14" width="8" height="7" rx="1.5" fill="#27272a" stroke="#52525b" strokeWidth="1" />
          <line x1="18.5" y1="14" x2="18.5" y2="21" stroke="#52525b" strokeWidth="1" />
          {working && <polyline points="21,15.5 22.5,17.5 21.5,19.5" stroke="#f472b6" strokeWidth="1" fill="none" strokeLinecap="round" />}
        </g>
        {/* brute body */}
        <g>
          <rect x="6" y="17" width="3" height="5" rx="1.2" fill="#4c1d95" />
          <rect x="10" y="17" width="3" height="5" rx="1.2" fill="#4c1d95" />
          <rect x="4.5" y="8" width="10" height="10" rx="3.5" fill="url(#os-buddy-body)" />
          {/* back arm */}
          <rect x="2.5" y="10" width="3" height="7" rx="1.5" fill="url(#os-buddy-arm)" />
          {/* smash arm */}
          <g className="os-buddy-arm">
            <rect x="12" y="4" width="3.4" height="9" rx="1.7" fill="url(#os-buddy-arm)" />
            <circle cx="13.7" cy="13.5" r="2.2" fill="#a78bfa" />
          </g>
          {/* head */}
          <circle cx="9.5" cy="6" r="3.4" fill="url(#os-buddy-body)" />
          <circle cx="8.4" cy="5.8" r=".8" fill="#67e8f9" className="animate-pulse" />
          <circle cx="10.7" cy="5.8" r=".8" fill="#67e8f9" className="animate-pulse" />
        </g>
      </svg>
    </span>
  );
}
