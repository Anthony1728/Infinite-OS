/**
 * Deterministic recording -> task compiler.
 *
 * Warmwind's Teaching mode generates an editable step list from what the user
 * did and said. The rules here are deliberately simple and pure:
 *
 * 1. Narration drives the step list — each sentence becomes one step.
 * 2. Observed clicks/windows in the window between two narrations annotate the
 *    step that covers them, so the generated instruction says what the user
 *    actually touched, not a hallucination.
 * 3. With no narration, actions are grouped into runs separated by >8s gaps.
 * 4. The nearest screenshot inside the step's time window becomes the step's
 *    reference frame for visual verification during the worker's run.
 *
 * No model call is involved: same recording in, same steps out.
 */

import { randomUUID } from 'node:crypto';
import { isAbsolute, join } from 'node:path';
import type { TeachingCompiledStep, TeachingEvent, TeachingRecording } from './types.js';

const GROUP_GAP_MS = 8_000;
const MAX_STEPS = 30;
const MAX_ACTIONS_PER_GROUP = 20;

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((line) => line.trim().replace(/^(um+|uh+|so|okay|ok|right|now)[,:\s]+/i, '').trim())
    .filter((line) => line.length >= 3);
}

function clip(text: string, max: number): string {
  const one = text.replace(/\s+/g, ' ').trim();
  return one.length > max ? `${one.slice(0, max - 3)}...` : one;
}

function titleFrom(text: string, index: number): string {
  const title = clip(text, 90).replace(/[.,;]+$/, '');
  return title || `Step ${index + 1}`;
}

function describeObserved(actions: TeachingEvent[], hasFrame: boolean): string {
  const parts: string[] = [];
  const windows = Array.from(new Set(
    actions
      .filter((event) => event.type === 'window' && event.window)
      .map((event) => event.window!.trim())
      .filter(Boolean),
  ));
  if (windows.length) parts.push(`Focused app: "${clip(windows[0], 60)}".`);
  const clicks = actions.filter((event) => event.type === 'click' && event.down !== false);
  if (clicks.length === 1) {
    const first = clicks[0];
    parts.push(`Clicked once at (${first.x}, ${first.y}).`);
  } else if (clicks.length > 1) {
    parts.push(`Clicked ${clicks.length} times.`);
  }
  if (hasFrame) parts.push('A screenshot from this moment is attached as a reference.');
  return parts.length ? `Observed during the demo: ${parts.join(' ')}` : '';
}

function nearestFrame(
  recording: TeachingRecording,
  start: number,
  end: number,
  used: Set<string>,
): string | undefined {
  let best: { path: string; key: string; distance: number } | null = null;
  for (const frame of recording.frames) {
    const key = `${frame.t}:${frame.path}`;
    if (used.has(key)) continue;
    const point = Math.min(Math.max(frame.t, start), end);
    const distance = Math.abs(frame.t - point);
    if (!best || distance < best.distance) best = { path: frame.path, key, distance };
  }
  if (!best) return undefined;
  used.add(best.key);
  return best.path;
}

function actionsBetween(
  actions: TeachingEvent[],
  start: number,
  end: number,
  used: Set<TeachingEvent>,
): TeachingEvent[] {
  return actions.filter((event) => {
    if (used.has(event)) return false;
    if (event.t < start || event.t > end) return false;
    used.add(event);
    return true;
  });
}

export function compileRecording(recording: TeachingRecording, framesRoot?: string): TeachingCompiledStep[] {
  const actions = recording.events.filter((event) => event.type === 'window' || event.type === 'click');
  const usedActions = new Set<TeachingEvent>();
  const usedFrames = new Set<string>();
  const steps: TeachingCompiledStep[] = [];

  const narrationEvents = recording.events.filter(
    (event) => event.type === 'narration' && typeof event.text === 'string' && event.text.trim(),
  );
  const timedNarrations = narrationEvents.length
    ? narrationEvents
    : recording.narration.trim()
      ? [{ t: recording.startedAt, type: 'narration' as const, text: recording.narration }]
      : [];

  const sentences: Array<{ t: number; text: string }> = [];
  for (const event of timedNarrations) {
    for (const sentence of splitSentences(event.text ?? '')) sentences.push({ t: event.t, text: sentence });
  }

  if (sentences.length) {
    for (let i = 0; i < sentences.length && steps.length < MAX_STEPS; i++) {
      const sentence = sentences[i];
      const windowStart = i > 0 ? sentences[i - 1].t + 400 : recording.startedAt;
      const windowEnd = sentence.t + 1_500;
      const observed = actionsBetween(actions, windowStart, windowEnd, usedActions);
      const frame = nearestFrame(recording, windowStart, windowEnd + 1_000, usedFrames);
      const detail = describeObserved(observed, Boolean(frame));
      const instruction = detail ? `${sentence.text}\n\n${detail}` : sentence.text;
      // Adjacent identical narrations merge instead of producing duplicate rows.
      const previous = steps[steps.length - 1];
      if (previous && previous.title.toLowerCase() === titleFrom(sentence.text, i).toLowerCase()) continue;
      steps.push({
        id: randomUUID(),
        title: titleFrom(sentence.text, i),
        instruction,
        referenceFrame: frame,
      });
    }
  } else if (actions.length) {
    let group: TeachingEvent[] = [];
    const flush = (): void => {
      if (!group.length || steps.length >= MAX_STEPS) return;
      const first = group[0];
      const last = group[group.length - 1];
      const window = group.find((event) => event.type === 'window' && event.window);
      const clicks = group.filter((event) => event.type === 'click' && event.down !== false);
      const frame = nearestFrame(recording, first.t, last.t + 2_000, usedFrames);
      const title = window?.window
        ? titleFrom(window.window, steps.length)
        : clicks.length
          ? titleFrom(`Click at (${clicks[0].x}, ${clicks[0].y})`, steps.length)
          : titleFrom('Interact with the focused app', steps.length);
      const detail = describeObserved(group, Boolean(frame));
      steps.push({
        id: randomUUID(),
        title,
        instruction: detail || 'Repeat the demonstrated interaction in this app.',
        referenceFrame: frame,
      });
      group = [];
    };
    for (const action of actions) {
      if (group.length && action.t - group[group.length - 1].t > GROUP_GAP_MS) flush();
      group.push(action);
      if (group.length >= MAX_ACTIONS_PER_GROUP) flush();
      if (steps.length >= MAX_STEPS) break;
    }
    flush();
  }

  if (!steps.length) {
    const fallbackFrame = nearestFrame(recording, recording.startedAt, recording.stoppedAt ?? Date.now(), usedFrames);
    steps.push({
      id: randomUUID(),
      title: titleFrom(recording.name || 'Perform the demonstrated task', 0),
      instruction: recording.narration.trim() || `Reproduce the task demonstrated in "${recording.name}".`,
      referenceFrame: fallbackFrame,
    });
  }

  // Frames are stored relative to the recording directory so the JSON stays
  // portable; the worker's Read tool needs an absolute path.
  return steps.slice(0, MAX_STEPS).map((step) => ({
    ...step,
    referenceFrame: step.referenceFrame && framesRoot
      ? (isAbsolute(step.referenceFrame) ? step.referenceFrame : join(framesRoot, step.referenceFrame))
      : step.referenceFrame,
  }));
}
