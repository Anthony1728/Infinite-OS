// Always-on voice HUD — the one thing you can see from anywhere.
//
// Before this, hearing you required being on the Voice page: the microphone was
// owned by that view, so navigating away ended the conversation. The loop now
// lives in the main process, and this floating capsule is the proof of it — a
// small always-present readout of what the mic is doing, in any view.
//
// It is deliberately a HUD, not a panel: it reports, it never covers work, and
// it disappears entirely when always-on voice is off.

import { useEffect, useRef, useState } from 'react';
import { Mic, MicOff, Square, Volume2 } from 'lucide-react';
import { useVoiceSessionStore } from '../../stores/voice-session';
import { InfiniteLogo } from '../brand/InfiniteLogo';

const VOICE_HUD_STYLES = `
@keyframes voice-hud-breathe {
  0%,100% { box-shadow: 0 0 0 0 rgba(52,211,153,0.32), 0 12px 40px rgba(0,0,0,0.55); }
  50% { box-shadow: 0 0 0 10px rgba(52,211,153,0), 0 12px 40px rgba(0,0,0,0.55); }
}
.voice-hud {
  animation: voice-hud-breathe 2.6s ease-in-out infinite;
  border-radius: 9999px;
  border: 1px solid rgba(255,255,255,0.09);
  background: rgba(14,14,20,0.86);
  backdrop-filter: blur(14px);
  box-shadow: 0 12px 40px rgba(0,0,0,0.55);
}
.voice-hud--thinking { animation: none; border-color: rgba(251,191,36,0.35); }
.voice-hud--speaking { animation: none; border-color: rgba(167,139,250,0.4); }
.voice-hud--error { animation: none; border-color: rgba(248,113,113,0.45); }
.voice-hud__bars { display: flex; align-items: flex-end; gap: 2px; height: 14px; }
.voice-hud__bar {
  width: 2px; border-radius: 9999px; background: currentColor;
  height: calc(3px + var(--h) * 11px); transform-origin: center;
  animation: voice-hud-bar 0.9s ease-in-out infinite alternate;
}
@keyframes voice-hud-bar { from { transform: scaleY(0.3); } to { transform: scaleY(1); } }
@media (prefers-reduced-motion: reduce) {
  .voice-hud { animation: none; }
  .voice-hud__bar { animation: none; }
}
`;

const BARS = [0.35, 0.7, 0.5, 0.9, 0.6, 0.4, 0.8, 0.55, 0.75, 0.45];

export function VoiceHud({ onOpenVoice }: { onOpenVoice?: () => void }) {
  const state = useVoiceSessionStore((s) => s.state);
  const ready = useVoiceSessionStore((s) => s.ready);
  const [flash, setFlash] = useState<string | null>(null);
  const flashTimer = useRef<number | null>(null);

  // Flash the phrase right after it is accepted, so you get confirmation even
  // when the HUD is collapsed to its orb.
  const lastHeard = useVoiceSessionStore((s) => s.lastHeard);
  useEffect(() => {
    if (!lastHeard?.text) return;
    setFlash(lastHeard.text);
    if (flashTimer.current) window.clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => setFlash(null), 4200);
    return () => { if (flashTimer.current) window.clearTimeout(flashTimer.current); };
  }, [lastHeard]);

  // Off and never armed → render nothing at all.
  if (!ready || !state.enabled) return null;

  const tone =
    state.phase === 'error'
      ? 'voice-hud--error text-rose-300'
      : state.phase === 'thinking'
        ? 'voice-hud--thinking text-amber-300'
        : state.phase === 'speaking'
          ? 'voice-hud--speaking text-violet-300'
          : 'text-emerald-300';

  const label =
    state.phase === 'starting' ? 'Waking the mic…'
      : state.phase === 'thinking' ? 'Working on it…'
        : state.phase === 'speaking' ? 'Speaking…'
          : state.phase === 'error' ? (state.error ?? 'Mic trouble')
            : state.listening ? 'Listening'
              : 'Paused';

  const api = window.api as unknown as {
    voiceSessionInterrupt?: () => Promise<unknown>;
    voiceSessionPause?: () => Promise<unknown>;
    voiceSessionResume?: () => Promise<unknown>;
  };

  return (
    <>
      <style>{VOICE_HUD_STYLES}</style>
      <div className="pointer-events-none fixed bottom-5 left-1/2 z-[60] -translate-x-1/2">
        <div
          className={`voice-hud pointer-events-auto flex items-center gap-2.5 px-3 py-2 ${tone}`}
          role="status"
          aria-live="polite"
          aria-label={`Always-on voice: ${label}`}
        >
          <button
            type="button"
            onClick={onOpenVoice}
            title="Open Voice Assistant"
            className="flex items-center gap-2 rounded-full pr-1 text-left"
          >
            <span className="relative grid h-7 w-7 place-items-center rounded-full bg-white/[0.06]">
              <InfiniteLogo className="h-2.5 w-5" variant="spectrum" />
              {state.listening && (
                <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.9)]" />
              )}
            </span>
            <span className="flex flex-col leading-tight">
              <span className="text-[11px] font-semibold text-zinc-100">{label}</span>
              <span className="max-w-[190px] truncate text-[10px] text-zinc-500">
                {state.interim || `“${state.wakeWord}” · always on`}
              </span>
            </span>
          </button>

          <span className="voice-hud__bars" aria-hidden="true">
            {BARS.map((weight, i) => (
              <span
                key={i}
                className="voice-hud__bar"
                style={{ ['--h' as string]: weight, animationDelay: `${i * 60}ms`, animationDuration: `${520 + (i % 4) * 150}ms` }}
              />
            ))}
          </span>

          {state.phase === 'thinking' || state.phase === 'speaking' ? (
            <button
              type="button"
              onClick={() => void api.voiceSessionInterrupt?.()}
              title="Stop the reply"
              className="grid h-7 w-7 place-items-center rounded-full border border-white/[0.09] bg-white/[0.04] text-zinc-300 transition-colors hover:border-white/[0.2] hover:text-white"
            >
              <Square size={10} fill="currentColor" strokeWidth={0} />
            </button>
          ) : state.listening ? (
            <button
              type="button"
              onClick={() => void api.voiceSessionPause?.()}
              title="Pause listening"
              className="grid h-7 w-7 place-items-center rounded-full border border-white/[0.09] bg-white/[0.04] text-zinc-300 transition-colors hover:border-white/[0.2] hover:text-white"
            >
              <MicOff size={11} />
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void api.voiceSessionResume?.()}
              title="Resume listening"
              className="grid h-7 w-7 place-items-center rounded-full border border-white/[0.09] bg-white/[0.04] text-zinc-300 transition-colors hover:border-white/[0.2] hover:text-white"
            >
              <Mic size={11} />
            </button>
          )}
        </div>

        {/* Just-heard confirmation, so a spoken turn is never a guess. */}
        {flash && (
          <div className="pointer-events-none mt-2 flex justify-center">
            <div className="max-w-[520px] truncate rounded-full border border-white/[0.08] bg-[#12131a]/90 px-3.5 py-1.5 text-[11px] text-zinc-300 shadow-[0_10px_30px_rgba(0,0,0,0.5)] backdrop-blur">
              <span className="mr-1.5 inline-flex items-center gap-1 text-[9px] uppercase tracking-[0.16em] text-zinc-500">
                <Volume2 size={9} /> heard
              </span>
              {flash}
            </div>
          </div>
        )}

        {state.error && (
          <div className="pointer-events-none mt-2 flex justify-center">
            <div className="max-w-[520px] truncate rounded-full border border-rose-400/25 bg-rose-500/10 px-3.5 py-1.5 text-[11px] text-rose-200">
              {state.error}
            </div>
          </div>
        )}
      </div>
      </>
  );
}