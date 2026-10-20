import { useEffect, useState } from 'react';
import { InfiniteLogo } from '../brand/InfiniteLogo';

/**
 * The window chrome.
 *
 * In full screen this bar gets out of the way entirely: it slides away so the
 * app fills the screen, and returns when the pointer moves to the top edge. The
 * window controls stay reachable in both states on purpose — a full-screen app
 * that hides its only way out is a trap, and "everything happens inside Infinite
 * OS" has to include the user being able to leave.
 */
export function TitleBar({ fullscreen = false }: { fullscreen?: boolean }) {
  const [revealed, setRevealed] = useState(false);

  // Full screen: reveal on a hot strip along the very top of the screen.
  useEffect(() => {
    if (!fullscreen) {
      setRevealed(false);
      return;
    }
    const onMove = (event: PointerEvent) => setRevealed(event.clientY <= 6);
    const onLeave = () => setRevealed(false);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerleave', onLeave);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerleave', onLeave);
    };
  }, [fullscreen]);

  const hidden = fullscreen && !revealed;
  // `WebkitAppRegion` is how a frameless window's draggable area is declared.
  const drag = { WebkitAppRegion: 'drag' } as unknown as React.CSSProperties;
  const noDrag = { WebkitAppRegion: 'no-drag' } as unknown as React.CSSProperties;

  if (fullscreen) {
    // A hairline that catches the pointer, so the bar can come back.
    return (
      <>
        <div
          className="h-1.5"
          style={{ position: 'fixed', left: 0, right: 0, top: 0, height: 6, zIndex: 80, ...noDrag }}
          aria-hidden="true"
        />
        <header
          className="os-window-titlebar transition-transform duration-200"
          style={{
            ...drag,
            // Inline, not a Tailwind `fixed` class: the global .os-window-titlebar
            // rule sets `position: relative`, and while in full screen the bar
            // MUST leave the flow or it keeps eating layout height.
            position: 'fixed',
            left: 0,
            right: 0,
            top: 0,
            zIndex: 81,
            background: 'rgba(11,11,16,0.92)',
            backdropFilter: 'blur(14px)',
            borderBottom: '1px solid rgba(255,255,255,0.07)',
            transform: hidden ? 'translateY(-100%)' : 'translateY(0)',
          }}
        >
          <div className="os-window-title">
            <InfiniteLogo className="h-3.5 w-6" animated />
            <span>Infinite OS</span>
            <span className="ml-1.5 rounded-full border border-white/[0.08] px-1.5 py-px text-[9px] uppercase tracking-[0.14em] text-zinc-500">
              Full screen
            </span>
          </div>
          <div className="os-traffic-lights" style={noDrag}>
            <button
              className="os-window-control os-window-maximize"
              onClick={(event) => {
                event.stopPropagation();
                void window.api.windowExitFullscreen();
              }}
              aria-label="Exit full screen"
              title="Exit full screen (F11)"
            >
              <svg className="os-window-icon" viewBox="0 0 10 10" aria-hidden="true">
                <path
                  d="M3.4 1.6v1.8H1.6M6.6 8.4V6.6h1.8M1.6 6.6h1.8v1.8M8.4 3.4H6.6V1.6"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.1"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
            <button
              className="os-window-control os-window-close"
              onClick={(event) => {
                event.stopPropagation();
                void window.api.windowClose();
              }}
              aria-label="Close window"
            >
              <svg className="os-window-icon" viewBox="0 0 10 10" aria-hidden="true">
                <path d="M3 3l4 4M7 3l-4 4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        </header>
      </>
    );
  }

  return (
    <header
      className="os-window-titlebar"
      style={drag}
      onDoubleClick={() => void window.api.windowMaximize()}
    >
      <div className="os-window-drag-end" />
      <div className="os-window-title">
        <InfiniteLogo className="h-3.5 w-6" animated />
        <span>Infinite OS</span>
      </div>
      <div className="os-traffic-lights" style={noDrag}>
        <button
          className="os-window-control os-window-minimize"
          onClick={(event) => {
            event.stopPropagation();
            void window.api.windowMinimize();
          }}
          aria-label="Minimize window"
        >
          <svg className="os-window-icon" viewBox="0 0 10 10" aria-hidden="true">
            <rect x="1.5" y="4.5" width="7" height="1" fill="currentColor" />
          </svg>
        </button>
        <button
          className="os-window-control os-window-maximize"
          onClick={(event) => {
            event.stopPropagation();
            void window.api.windowToggleFullscreen();
          }}
          aria-label="Enter full screen"
          title="Full screen (F11)"
        >
          <svg className="os-window-icon" viewBox="0 0 10 10" aria-hidden="true">
            <path
              d="M2.2 4.1V2.2h1.9M7.8 5.9v1.9H5.9M4.1 7.8H2.2V5.9M5.9 2.2h1.9v1.9"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.1"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
        <button
          className="os-window-control os-window-close"
          onClick={(event) => {
            event.stopPropagation();
            void window.api.windowClose();
          }}
          aria-label="Close window"
        >
          <svg className="os-window-icon" viewBox="0 0 10 10" aria-hidden="true">
            <path d="M3 3l4 4M7 3l-4 4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          </svg>
        </button>
      </div>
    </header>
  );
}