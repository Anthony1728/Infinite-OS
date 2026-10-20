import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { useUiTheme } from './theme/uiTheme';
import { initThemeStyles } from './theme/styles';

// Mount the active UI theme's stylesheet (classic or modern) before render.
initThemeStyles(useUiTheme.getState().theme);

// Hand off from the pre-React boot splash to the React startup surface.
//
// The splash and BriefLoading are pixel twins (same 112×64 mark, same status
// line, same bar), so the hand-off is a pure cross-fade: the still mark is
// replaced by the same mark with light running around it, in the same spot.
//
// Two conditions must BOTH be met before the splash starts fading:
//
//   1. React has actually painted that surface. Fading on the first frame would
//      hard-swap the two and lose the cross-fade entirely.
//   2. The splash has been on screen for at least MIN_SPLASH_MS. This is the
//      one that matters for feel: on a warm start the bundle is ready in ~60ms,
//      so gating on readiness alone made the whole hand-off a blink and the
//      logo animation was never actually seen. The splash is the first thing
//      the user looks at — it has to be allowed to be looked at.
//
// The mark gets ~450ms on screen here and then hands over to the React startup
// surface, which holds for its own MIN_VISIBLE_MS. Together that reads as an
// arrival without stacking two full-length intros: the previous 900ms here
// plus 1400ms there cost 2.3 seconds of every launch, most of it spent
// watching a progress bar that had already finished.
//
// A safety timer keeps a crash from stranding the splash on screen forever.
const MIN_SPLASH_MS = 450;
const SPLASH_FADE_MS = 550;
const SPLASH_REMOVED_MS = SPLASH_FADE_MS + 120;
const SPLASH_FAILSAFE_MS = 8000;

const splashShownAt = Date.now();
let splashDismissed = false;

function dismissBootSplash() {
  if (splashDismissed) return;
  // If the minimum has not elapsed yet, come back for the rest of it. This must
  // happen BEFORE the guard is set, or the deferred call would return
  // immediately and the splash would sit on screen forever.
  const remaining = MIN_SPLASH_MS - (Date.now() - splashShownAt);
  if (remaining > 0) {
    window.setTimeout(dismissBootSplash, remaining);
    return;
  }
  splashDismissed = true;
  const splash = document.getElementById('boot-splash');
  if (!splash || splash.classList.contains('done')) return;
  splash.classList.add('done');
  window.setTimeout(() => splash.remove(), SPLASH_REMOVED_MS);
}

window.addEventListener('infinite:startup-painted', () => {
  // Two frames so the React surface is composited underneath before the splash
  // starts to fade — otherwise the fade reveals an unpainted frame.
  requestAnimationFrame(() => requestAnimationFrame(dismissBootSplash));
}, { once: true });
window.setTimeout(dismissBootSplash, SPLASH_FAILSAFE_MS);

window.addEventListener('error', (e) => {
  console.error('[renderer] Uncaught error:', e.error);
});

window.addEventListener('unhandledrejection', (e) => {
  console.error('[renderer] Unhandled promise rejection:', e.reason);
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
