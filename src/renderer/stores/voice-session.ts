// Always-on voice — the renderer's view of the main-process listening loop.
//
// One store, mounted once at the app root, so every surface sees the same state:
// the floating HUD, the Voice Assistant page, the status bar. Nothing here
// touches a microphone; the loop lives in main and this only mirrors it.

import { create } from 'zustand';

export interface VoiceSessionSnapshot {
  enabled: boolean;
  listening: boolean;
  phase: 'idle' | 'starting' | 'listening' | 'thinking' | 'speaking' | 'error';
  interim: string;
  engine: 'local-whisper' | 'windows-local' | null;
  wakeWord: string;
  error: string | null;
  sessionId: string;
  speaking: boolean;
  muted: boolean;
  /** The fast model chosen to speak, when the two-model split is in use. */
  communicationModel: { provider: string; model: string } | null;
}

interface VoiceSessionStore {
  state: VoiceSessionSnapshot;
  /** True once the first snapshot has arrived, so the HUD can avoid a flash. */
  ready: boolean;
  /** Last accepted utterance, for a brief "heard you" flash in the HUD. */
  lastHeard: { text: string; at: number } | null;
  muted: boolean;
  setSnapshot: (state: VoiceSessionSnapshot, utterance?: { text: string; at: number } | null) => void;
  setMuted: (muted: boolean) => void;
  /** Attach to the main-process loop. Returns a disposer. */
  attach: () => () => void;
}

const INITIAL: VoiceSessionSnapshot = {
  enabled: false,
  listening: false,
  phase: 'idle',
  interim: '',
  engine: null,
  wakeWord: 'hey infinite',
  error: null,
  sessionId: 'voice',
  speaking: false,
  muted: false,
  communicationModel: null,
};

export const useVoiceSessionStore = create<VoiceSessionStore>((set) => ({
  state: INITIAL,
  ready: false,
  lastHeard: null,
  muted: false,
  setSnapshot: (state, utterance) =>
    set((prev) => ({
      state,
      ready: true,
      muted: state.muted,
      lastHeard: utterance ?? (utterance === null ? null : prev.lastHeard),
    })),
  setMuted: (muted) => set((prev) => ({ muted, state: { ...prev.state, muted } })),

  attach: () => {
    const api = window.api as unknown as {
      voiceSessionState?: () => Promise<VoiceSessionSnapshot>;
      onVoiceSession?: (
        cb: (state: VoiceSessionSnapshot, utterance?: { text: string; at: number }) => void,
      ) => () => void;
    };
    // Ask for the current state immediately so a reload lands on the truth
    // rather than waiting for the next change to broadcast.
    void api.voiceSessionState?.()
      .then((snapshot) => { if (snapshot) set({ state: snapshot, ready: true, muted: snapshot.muted }); })
      .catch(() => undefined);
    const dispose = api.onVoiceSession?.((state, utterance) => {
      if (!state) return;
      set((prev) => ({
        state,
        ready: true,
        muted: state.muted,
        lastHeard: utterance ?? prev.lastHeard,
      }));
    });
    return () => dispose?.();
  },
}));

/** True when the agent should be answering in the background right now. */
export function voiceIsActive(state: VoiceSessionSnapshot): boolean {
  return state.enabled && (state.listening || state.phase === 'thinking' || state.phase === 'speaking');
}