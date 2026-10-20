/**
 * Teaching mode recorder.
 *
 * Captures what the user demonstrates — focused windows, mouse clicks, typed
 * narration, and periodic screenshots — then compiles it into an editable step
 * list that becomes a Worker. Input capture is a polling PowerShell child
 * process (window + click state), which keeps native-module risk at zero: no
 * uiohook/robotjs dependency to rebuild per Electron ABI.
 *
 * Everything stays on this machine. Recordings live under
 * ~/.infinite-ai/teaching/recordings/<id>/.
 */

import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, readdirSync } from 'node:fs';
import { join, resolve, relative, sep, isAbsolute } from 'node:path';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { nativeImage } from 'electron';
import { infiniteHome } from '../profiles/home.js';
import { getComputerAutomation } from '../automation/computer-automation.js';
import { compileRecording } from './compiler.js';
import {
  teachingView,
  type TeachingEvent,
  type TeachingEventMessage,
  type TeachingFrame,
  type TeachingRecording,
  type TeachingRecordingView,
} from './types.js';

const MAX_EVENTS = 5_000;
const MAX_FRAMES = 120;
const FRAME_INTERVAL_MS = 3_500;
const AUTO_STOP_MS = 30 * 60_000;
const SAVE_INTERVAL_MS = 10_000;
const MAX_NARRATION = 8_000;

const ID_RE = /^[A-Za-z0-9-]{8,64}$/;

const WATCHER_SCRIPT = [
  "$ErrorActionPreference = 'SilentlyContinue'",
  'Add-Type @"',
  'using System;',
  'using System.Runtime.InteropServices;',
  'using System.Text;',
  'public class InfiniteTeachInput {',
  '  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }',
  '  [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT lpPoint);',
  '  [DllImport("user32.dll")] public static extern short GetAsyncKeyState(int vKey);',
  '  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();',
  '  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);',
  '  [DllImport("user32.dll")] public static extern int GetWindowTextLength(IntPtr hWnd);',
  '}',
  '"@',
  "$lastWindow = ''",
  '$leftWasDown = $false',
  '$rightWasDown = $false',
  'while ($true) {',
  '  $p = New-Object InfiniteTeachInput+POINT',
  '  [InfiniteTeachInput]::GetCursorPos([ref]$p) | Out-Null',
  '  $h = [InfiniteTeachInput]::GetForegroundWindow()',
  '  $len = [InfiniteTeachInput]::GetWindowTextLength($h)',
  '  $sb = New-Object System.Text.StringBuilder ($len + 16)',
  '  [InfiniteTeachInput]::GetWindowText($h, $sb, $sb.Capacity) | Out-Null',
  '  $title = $sb.ToString()',
  '  $now = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()',
  "  if ($title -ne $lastWindow) {",
  "    $lastWindow = $title",
  "    $obj = @{ t = $now; type = 'window'; window = $title; x = $p.X; y = $p.Y }",
  '    ConvertTo-Json $obj -Compress',
  '  }',
  '  $leftDown = (([InfiniteTeachInput]::GetAsyncKeyState(1) -band 0x8000) -ne 0)',
  '  $rightDown = (([InfiniteTeachInput]::GetAsyncKeyState(2) -band 0x8000) -ne 0)',
  '  if ($leftDown -ne $leftWasDown) {',
  '    $leftWasDown = $leftDown',
  "    $obj = @{ t = $now; type = 'click'; x = $p.X; y = $p.Y; button = 'left'; down = $leftDown }",
  '    ConvertTo-Json $obj -Compress',
  '  }',
  '  if ($rightDown -ne $rightWasDown) {',
  '    $rightWasDown = $rightDown',
  "    $obj = @{ t = $now; type = 'click'; x = $p.X; y = $p.Y; button = 'right'; down = $rightDown }",
  '    ConvertTo-Json $obj -Compress',
  '  }',
  '  Start-Sleep -Milliseconds 60',
  '}',
].join('\r\n');

interface ActiveSession {
  recording: TeachingRecording;
  dir: string;
  child: ChildProcessWithoutNullStreams | null;
  frameTimer: ReturnType<typeof setInterval> | null;
  saveTimer: ReturnType<typeof setInterval> | null;
  autoStop: ReturnType<typeof setTimeout> | null;
  capturing: boolean;
}

export interface StartTeachingInput {
  name?: string;
}

export class TeachingRecorder {
  private readonly dataDir: string;
  private active: ActiveSession | null = null;
  private readonly listeners = new Set<(message: TeachingEventMessage) => void>();

  constructor(dataDir?: string) {
    this.dataDir = dataDir ?? join(infiniteHome(), 'teaching');
  }

  private get recordingsDir(): string {
    return join(this.dataDir, 'recordings');
  }

  onEvent(listener: (message: TeachingEventMessage) => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  isRecording(): boolean {
    return this.active !== null;
  }

  activeId(): string | null {
    return this.active?.recording.id ?? null;
  }

  start(input: StartTeachingInput = {}): TeachingRecordingView {
    if (this.active) throw new Error('A demonstration is already being recorded. Stop it first.');
    const id = randomUUID();
    const dir = join(this.recordingsDir, id);
    mkdirSync(join(dir, 'frames'), { recursive: true });
    const recording: TeachingRecording = {
      id,
      name: (input.name ?? '').trim() || `Demonstration ${new Date().toLocaleString()}`,
      status: 'recording',
      startedAt: Date.now(),
      durationMs: 0,
      narration: '',
      events: [],
      frames: [],
      compiledSteps: [],
    };
    const session: ActiveSession = {
      recording,
      dir,
      child: null,
      frameTimer: null,
      saveTimer: null,
      autoStop: null,
      capturing: false,
    };
    this.active = session;
    this.save(session);

    // Input watcher: a separate PowerShell process polling foreground window +
    // mouse buttons. Its JSON-line stdout is parsed defensively — a torn line
    // must never kill the recording.
    try {
      const encoded = Buffer.from(WATCHER_SCRIPT, 'utf16le').toString('base64');
      const child = spawn(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
        { windowsHide: true },
      );
      let buffer = '';
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => {
        buffer += chunk;
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) this.ingestLine(session, line);
      });
      child.on('error', (error) => {
        recording.captureWarning = `Input capture unavailable: ${error.message}`;
      });
      child.on('exit', () => {
        if (session.child === child) session.child = null;
      });
      session.child = child;
    } catch (error) {
      recording.captureWarning = `Input capture unavailable: ${error instanceof Error ? error.message : String(error)}`;
    }

    session.frameTimer = setInterval(() => { void this.captureFrame(session); }, FRAME_INTERVAL_MS);
    session.saveTimer = setInterval(() => this.save(session), SAVE_INTERVAL_MS);
    session.autoStop = setTimeout(() => {
      try { this.stop(recording.id); } catch { /* already stopped */ }
    }, AUTO_STOP_MS);

    this.emit({ type: 'teaching_updated', recordingId: recording.id });
    return teachingView(recording);
  }

  addNarration(id: string, text: string): TeachingRecordingView {
    const session = this.requireActive(id);
    const chunk = typeof text === 'string' ? text.trim() : '';
    if (!chunk) throw new Error('Narration text cannot be empty.');
    session.recording.narration = `${session.recording.narration}\n${chunk}`.trim().slice(0, MAX_NARRATION);
    this.pushEvent(session, { t: Date.now(), type: 'narration', text: chunk.slice(0, 2_000) });
    this.save(session);
    this.emit({ type: 'teaching_updated', recordingId: id });
    return teachingView(session.recording);
  }

  rename(id: string, name: string): TeachingRecordingView {
    const clean = String(name ?? '').trim().slice(0, 120);
    if (!clean) throw new Error('Recording name cannot be empty.');
    if (this.active?.recording.id === id) {
      this.active.recording.name = clean;
      this.save(this.active);
      this.emit({ type: 'teaching_updated', recordingId: id });
      return teachingView(this.active.recording);
    }
    const recording = this.read(id);
    recording.name = clean;
    this.write(recording, join(this.recordingsDir, id));
    this.emit({ type: 'teaching_updated', recordingId: id });
    return teachingView(recording);
  }

  stop(id: string): TeachingRecordingView {
    const session = this.requireActive(id);
    if (session.frameTimer) clearInterval(session.frameTimer);
    if (session.saveTimer) clearInterval(session.saveTimer);
    if (session.autoStop) clearTimeout(session.autoStop);
    if (session.child) {
      try { session.child.kill(); } catch { /* already gone */ }
      session.child = null;
    }
    session.recording.status = 'stopped';
    session.recording.stoppedAt = Date.now();
    session.recording.durationMs = session.recording.stoppedAt - session.recording.startedAt;
    session.recording.compiledSteps = this.compileSteps(session.recording);
    this.save(session);
    this.active = null;
    this.emit({ type: 'teaching_updated', recordingId: id });
    return teachingView(session.recording);
  }

  /** Replace the compiled steps after the user edits them in the review UI. */
  updateSteps(id: string, steps: Array<{ title: string; instruction?: string; referenceFrame?: string }>): TeachingRecordingView {
    if (!Array.isArray(steps) || !steps.length) throw new Error('At least one step is required.');
    const clean = steps.slice(0, 30).map((step) => ({
      id: randomUUID(),
      title: String(step?.title ?? '').trim().slice(0, 120) || 'Untitled step',
      instruction: String(step?.instruction ?? '').trim().slice(0, 4_000) || String(step?.title ?? '').trim(),
      referenceFrame: this.absolutizeFrame(id, step?.referenceFrame),
    }));
    if (this.active?.recording.id === id) {
      this.active.recording.compiledSteps = clean;
      this.save(this.active);
      this.emit({ type: 'teaching_updated', recordingId: id });
      return teachingView(this.active.recording);
    }
    const recording = this.read(id);
    recording.compiledSteps = clean;
    this.write(recording, join(this.recordingsDir, id));
    this.emit({ type: 'teaching_updated', recordingId: id });
    return teachingView(recording);
  }

  compile(id: string): TeachingRecordingView {
    if (this.active?.recording.id === id) {
      this.active.recording.compiledSteps = this.compileSteps(this.active.recording);
      this.save(this.active);
      this.emit({ type: 'teaching_updated', recordingId: id });
      return teachingView(this.active.recording);
    }
    const recording = this.read(id);
    recording.compiledSteps = this.compileSteps(recording);
    this.write(recording, join(this.recordingsDir, id));
    this.emit({ type: 'teaching_updated', recordingId: id });
    return teachingView(recording);
  }

  list(): TeachingRecordingView[] {
    const views: TeachingRecordingView[] = [];
    if (this.active) views.push(teachingView(this.active.recording));
    try {
      if (!existsSync(this.recordingsDir)) return views;
      for (const entry of readdirSync(this.recordingsDir).slice(-50)) {
        try {
          const recording = this.read(entry);
          if (recording.id !== this.active?.recording.id) views.push(teachingView(recording));
        } catch { /* skip unreadable recording */ }
      }
    } catch { /* no recordings yet */ }
    return views.sort((a, b) => b.startedAt - a.startedAt);
  }

  get(id: string): TeachingRecordingView | null {
    try {
      if (this.active?.recording.id === id) return teachingView(this.active.recording);
      return teachingView(this.read(id));
    } catch {
      return null;
    }
  }

  remove(id: string): boolean {
    if (this.active?.recording.id === id) throw new Error('Stop the recording before deleting it.');
    const dir = join(this.recordingsDir, id);
    if (!existsSync(dir)) return false;
    rmSync(dir, { recursive: true, force: true });
    this.emit({ type: 'teaching_updated', recordingId: id });
    return true;
  }

  /** Latest (or a specific) captured frame as a data URL for review thumbnails. */
  frameData(id: string, framePath?: string): string | null {
    const recording = this.active?.recording.id === id ? this.active.recording : this.tryRead(id);
    if (!recording || !recording.frames.length) return null;
    const dir = join(this.recordingsDir, id);
    let rel: string | null;
    if (typeof framePath === 'string' && framePath.trim()) {
      rel = this.relFrame(id, framePath.trim());
      if (!rel || !recording.frames.some((frame) => frame.path === rel)) return null;
    } else {
      rel = recording.frames[recording.frames.length - 1]?.path ?? null;
    }
    if (!rel) return null;
    const path = join(dir, rel);
    if (!existsSync(path)) return null;
    const base64 = readFileSync(path).toString('base64');
    if (base64.length > 6_000_000) return null;
    return `data:image/jpeg;base64,${base64}`;
  }

  /** Relative frames/… path confined to this recording, or null. */
  private relFrame(id: string, framePath: string): string | null {
    const dir = resolve(join(this.recordingsDir, id));
    if (isAbsolute(framePath)) {
      const abs = resolve(framePath);
      if (!abs.startsWith(dir + sep)) return null;
      return relative(dir, abs).split('\\').join('/');
    }
    return /^frames\/[A-Za-z0-9._-]+\.jpg$/.test(framePath) ? framePath : null;
  }

  private absolutizeFrame(id: string, framePath?: string): string | undefined {
    if (!framePath || typeof framePath !== 'string') return undefined;
    const rel = this.relFrame(id, framePath);
    return rel ? join(this.recordingsDir, id, rel) : undefined;
  }

  private compileSteps(recording: TeachingRecording): TeachingRecording['compiledSteps'] {
    return compileRecording(recording, join(this.recordingsDir, recording.id));
  }

  private requireActive(id: string): ActiveSession {
    if (!this.active || this.active.recording.id !== id) {
      throw new Error('That recording is not in progress.');
    }
    return this.active;
  }

  private ingestLine(session: ActiveSession, line: string): void {
    const text = line.trim();
    if (!text || !text.startsWith('{')) return;
    try {
      const parsed = JSON.parse(text) as Partial<TeachingEvent>;
      if (!parsed || typeof parsed.t !== 'number' || typeof parsed.type !== 'string') return;
      this.pushEvent(session, parsed as TeachingEvent);
    } catch { /* torn or unexpected line — recording continues */ }
  }

  private pushEvent(session: ActiveSession, event: TeachingEvent): void {
    if (session.recording.events.length >= MAX_EVENTS) return;
    session.recording.events.push(event);
    this.emit({ type: 'teaching_event', recordingId: session.recording.id, event });
  }

  private async captureFrame(session: ActiveSession): Promise<void> {
    if (session.capturing || session.recording.frames.length >= MAX_FRAMES) return;
    session.capturing = true;
    try {
      const shot = await getComputerAutomation().captureScreen(true);
      const image = nativeImage.createFromBuffer(Buffer.from(shot.base64, 'base64'));
      if (image.isEmpty()) throw new Error('Empty screenshot.');
      const size = image.getSize();
      const scaled = size.width > 1_600 ? image.resize({ width: 1_600 }) : image;
      const jpeg = scaled.toJPEG(58);
      const name = `frame-${String(session.recording.frames.length + 1).padStart(4, '0')}.jpg`;
      writeFileSync(join(session.dir, 'frames', name), jpeg);
      const frame: TeachingFrame = {
        t: Date.now(),
        path: join('frames', name),
        width: scaled.getSize().width,
        height: scaled.getSize().height,
      };
      session.recording.frames.push(frame);
      this.pushEvent(session, { t: frame.t, type: 'frame', frame: frame.path });
      session.recording.durationMs = Date.now() - session.recording.startedAt;
      this.emit({ type: 'teaching_frame', recordingId: session.recording.id, frameCount: session.recording.frames.length });
      if (session.recording.frames.length % 5 === 0) this.save(session);
    } catch (error) {
      session.recording.captureWarning = `Screenshot capture unavailable: ${error instanceof Error ? error.message : String(error)}`;
    } finally {
      session.capturing = false;
    }
  }

  private read(id: string): TeachingRecording {
    const recording = this.tryRead(id);
    if (!recording) throw new Error('Recording not found.');
    return recording;
  }

  private tryRead(id: string): TeachingRecording | null {
    if (!ID_RE.test(id)) return null;
    try {
      const path = join(this.recordingsDir, id, 'recording.json');
      if (!existsSync(path)) return null;
      const recording = JSON.parse(readFileSync(path, 'utf8')) as TeachingRecording;
      if (!recording || !Array.isArray(recording.events)) return null;
      return recording;
    } catch {
      return null;
    }
  }

  private write(recording: TeachingRecording, dir: string): void {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'recording.json'), JSON.stringify(recording, null, 2), 'utf8');
  }

  private save(session: ActiveSession): void {
    try {
      if (session.recording.status === 'recording') {
        session.recording.durationMs = Date.now() - session.recording.startedAt;
      }
      this.write(session.recording, session.dir);
    } catch (error) {
      console.warn('[teaching] failed to save recording:', error);
    }
  }

  private emit(message: TeachingEventMessage): void {
    for (const listener of this.listeners) {
      try { listener(message); } catch { /* UI listeners must never break recording */ }
    }
  }
}

let singleton: TeachingRecorder | null = null;

export function getTeachingRecorder(): TeachingRecorder {
  if (!singleton) singleton = new TeachingRecorder();
  return singleton;
}

export function setTeachingRecorderForTests(recorder: TeachingRecorder | null): void {
  singleton = recorder;
}
