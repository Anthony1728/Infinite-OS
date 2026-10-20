// Fullscreen state for the renderer.
//
// Until now the renderer was completely unaware of fullscreen: F11 was handled
// in main, the title bar never changed, and nothing adapted. Main also uses
// fullscreen as a signal on its own — the automation display policy switches to
// background mode when the app is full screen, so the agent stops stealing focus
// and nothing pops over the window. The renderer could see none of that.
//
// One store, subscribed once at the shell, so the title bar, the layouts and any
// surface that cares about "am I filling the screen" all read the same truth.

import { useEffect } from 'react';
import { create } from 'zustand';

interface FullscreenState {
  fullscreen: boolean;
  /** True once main has answered at least once, so we never flash windowed. */
  ready: boolean;
  set: (fullscreen: boolean) => void;
}

export const useFullscreenStore = create<FullscreenState>((set) => ({
  fullscreen: false,
  ready: false,
  set: (fullscreen) => set({ fullscreen, ready: true }),
}));

/**
 * Attach to main's fullscreen events. Returns a disposer.
 *
 * Also reflects the state onto <html data-fullscreen> so CSS can adapt without
 * every component subscribing.
 *
 * Note: main's automation display policy already reads `isFullScreen()` live, so
 * it switches itself to background mode on full screen without being told. This
 * deliberately does NOT push a preference back — doing so would overwrite a
 * deliberate "always visible" / "always background" choice.
 */
export function attachFullscreen(): () => void {
  const api = window.api as unknown as {
    // Returns { fullscreen: boolean }, NOT a bare boolean.
    windowIsFullScreen?: () => Promise<{ fullscreen?: boolean } | boolean>;
    onWindowFullscreenChange?: (cb: (data: { fullscreen: boolean }) => void) => () => void;
  };

  const apply = (value: boolean) => {
    useFullscreenStore.getState().set(value);
    document.documentElement.dataset.fullscreen = value ? 'true' : 'false';
  };

  /** Accept either shape. `Boolean({fullscreen:false})` is `true`, which is how
   *  this silently reported full screen while the window was maximized. */
  const readFullscreen = (value: { fullscreen?: boolean } | boolean | undefined): boolean =>
    typeof value === 'boolean' ? value : Boolean(value?.fullscreen);

  void api.windowIsFullScreen?.()
    .then((value) => apply(readFullscreen(value)))
    .catch(() => undefined);

  const dispose = api.onWindowFullscreenChange?.((data) => apply(Boolean(data?.fullscreen)));

  // Also reconcile against main on a timer.
  //
  // The event is the fast path, but a missed transition leaves the renderer
  // permanently wrong — the title bar stays in flow and no layout adapts, with
  // nothing to correct it. Polling is cheap (one tiny IPC call) and makes the
  // state self-healing: whatever happens, the renderer converges on main's
  // truth within a second.
  const timer = window.setInterval(() => {
    void api.windowIsFullScreen?.()
      .then((value) => {
        const next = readFullscreen(value);
        if (next !== useFullscreenStore.getState().fullscreen) apply(next);
      })
      .catch(() => undefined);
  }, 1000);

  return () => {
    window.clearInterval(timer);
    dispose?.();
  };
}

/** Convenience for components: re-renders when fullscreen changes. */
export function useFullscreen(): boolean {
  const fullscreen = useFullscreenStore((s) => s.fullscreen);
  const ready = useFullscreenStore((s) => s.ready);
  useEffect(() => {
    if (!ready) void attachFullscreen();
  }, [ready]);
  return fullscreen;
}