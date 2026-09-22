// Streaming coalescer — batches provider text deltas into time-boxed frames.
//
// The agent loop forwards every `text_delta` straight over IPC; fast models
// emit hundreds of tiny chunks per second and each one re-renders React.
// Coalescing into ~50ms frames keeps tokens appearing instantly (the first
// token still flushes immediately) while cutting event volume by 5-20x.
//
// Used by both the main loop (loop.ts) and subagent streaming (runtime.ts) so
// every surface streams identically.

const DEFAULT_FLUSH_MS = 50;
/** Never hold more than this much text — a huge delta flushes at once. */
const MAX_PENDING_CHARS = 2_000;

export interface CoalescerOptions {
  /** Frame interval in ms (default 50). */
  flushMs?: number;
  /** Called with the batched text for one frame. */
  onFlush: (text: string) => void;
}

export class StreamCoalescer {
  private buffer = '';
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly flushMs: number;
  private readonly onFlush: (text: string) => void;
  private pendingFlush: Promise<void> = Promise.resolve();

  constructor(options: CoalescerOptions) {
    this.flushMs = Math.max(1, options.flushMs ?? DEFAULT_FLUSH_MS);
    this.onFlush = options.onFlush;
  }

  /** Add a delta; flushes immediately when the pending text is large. */
  push(text: string): void {
    if (!text) return;
    this.buffer += text;
    if (this.buffer.length >= MAX_PENDING_CHARS) {
      this.flushNow();
      return;
    }
    if (!this.timer) {
      this.timer = setTimeout(() => this.flushNow(), this.flushMs);
      this.timer.unref?.();
    }
  }

  /** Synchronously emit whatever is buffered right now. */
  flushNow(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (!this.buffer) return;
    const text = this.buffer;
    this.buffer = '';
    this.onFlush(text);
  }

  /** Flush and wait for the in-flight onFlush callback to finish. */
  async flush(): Promise<void> {
    this.flushNow();
    await this.pendingFlush;
  }

  /** Test seam: override the flush awaitable (defaults to resolved). */
  setPendingFlush(p: Promise<void>): void {
    this.pendingFlush = p;
  }

  /** Stop timers and emit any remaining text. */
  dispose(): void {
    this.flushNow();
  }
}
