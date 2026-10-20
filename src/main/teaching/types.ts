/**
 * Teaching mode shared types.
 *
 * A recording is an ordered event stream (window focus, clicks, narration,
 * screenshots) plus a deterministic compiled step list. Compilation happens
 * here — never in the model — so re-recording the same demo twice produces the
 * same editable task.
 */

export type TeachingEventType = 'window' | 'click' | 'narration' | 'frame';

export interface TeachingEvent {
  /** Unix ms. */
  t: number;
  type: TeachingEventType;
  /** Focused window title (window events). */
  window?: string;
  /** Screen coordinates (click events). */
  x?: number;
  y?: number;
  button?: 'left' | 'right';
  /** true on press, false on release. */
  down?: boolean;
  /** Narration text (narration events). */
  text?: string;
  /** JPEG path relative to the recording directory (frame events). */
  frame?: string;
}

export interface TeachingFrame {
  t: number;
  path: string;
  width: number;
  height: number;
}

export interface TeachingCompiledStep {
  id: string;
  title: string;
  instruction: string;
  /** Absolute path to a screenshot captured near this step. */
  referenceFrame?: string;
}

export interface TeachingRecording {
  id: string;
  name: string;
  status: 'recording' | 'stopped';
  startedAt: number;
  stoppedAt?: number;
  durationMs: number;
  /** Free-form narration typed or dictated by the user while demonstrating. */
  narration: string;
  events: TeachingEvent[];
  frames: TeachingFrame[];
  compiledSteps: TeachingCompiledStep[];
  captureWarning?: string;
}

export interface TeachingRecordingView {
  id: string;
  name: string;
  status: TeachingRecording['status'];
  startedAt: number;
  stoppedAt?: number;
  durationMs: number;
  narration: string;
  eventCount: number;
  frameCount: number;
  stepCount: number;
  compiledSteps: TeachingCompiledStep[];
  captureWarning?: string;
}

export type TeachingEventMessage =
  | { type: 'teaching_updated'; recordingId: string }
  | { type: 'teaching_event'; recordingId: string; event: TeachingEvent }
  | { type: 'teaching_frame'; recordingId: string; frameCount: number };

export function teachingView(recording: TeachingRecording): TeachingRecordingView {
  return {
    id: recording.id,
    name: recording.name,
    status: recording.status,
    startedAt: recording.startedAt,
    stoppedAt: recording.stoppedAt,
    durationMs: recording.durationMs,
    narration: recording.narration,
    eventCount: recording.events.length,
    frameCount: recording.frames.length,
    stepCount: recording.compiledSteps.length,
    compiledSteps: recording.compiledSteps,
    captureWarning: recording.captureWarning,
  };
}
