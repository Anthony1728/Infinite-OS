// Tool-call argument streaming — batches provider `tool_use_delta` JSON chunks
// into time-boxed frames so the UI can render a tool call AS IT FORMS: the
// name appears the moment the provider announces it, and the input preview
// grows live (like watching the model type), instead of a card popping in
// fully-formed seconds later.
//
// Mirrors StreamCoalescer's frame batching, but tracks per-tool-call state:
//   - emits `tool_use_start` as soon as the name is known (even mid-JSON)
//   - emits coalesced `tool_use_delta` with the RUNNING partial JSON
//     (full snapshot, not a fragment — renderers can just JSON.parse it)
//   - a final flush on end() guarantees the last args land before tool_end.

const DEFAULT_FLUSH_MS = 40;
/** Emitted partial JSON is capped so huge args don't spam the event bus. */
const MAX_EMIT_CHARS = 4_000;

export interface ToolCallSnapshot {
  id: string;
  /** Known name, or '' while still unknown. */
  name: string;
  /** Running partial JSON string (snapshot, not fragment). */
  partialJson: string;
}

export interface ToolCallStreamHandlers {
  /** Called with a coalesced snapshot per flush frame. */
  onDelta: (snapshot: ToolCallSnapshot) => void;
}

export class ToolCallArgCoalescer {
  private calls = new Map<string, { name: string; json: string; startedEmitted: boolean }>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly flushMs: number;
  private readonly handlers: ToolCallStreamHandlers;
  private disposed = false;

  constructor(handlers: ToolCallStreamHandlers, flushMs = DEFAULT_FLUSH_MS) {
    this.flushMs = Math.max(1, flushMs);
    this.handlers = handlers;
  }

  /** Provider announced a tool call — name may be empty until deltas arrive. */
  start(id: string, name: string): void {
    const existing = this.calls.get(id);
    if (existing) {
      existing.name = name || existing.name;
    } else {
      this.calls.set(id, { name: name ?? '', json: '', startedEmitted: false });
    }
    // Start is cheap and rare — emit synchronously so the card appears instantly.
    const call = this.calls.get(id)!;
    if (call.name) {
      call.startedEmitted = true;
      this.handlers.onDelta({ id, name: call.name, partialJson: '' });
    } else {
      this.scheduleFlush();
    }
  }

  /** A JSON fragment arrived for the call; batched into the next frame. */
  delta(id: string, partialJson: string, name?: string): void {
    if (this.disposed) return;
    const call = this.calls.get(id) ?? { name: name ?? '', json: '', startedEmitted: false };
    if (name) call.name = name;
    call.json = partialJson; // snapshot semantics: replace, don't append
    this.calls.set(id, call);
    this.scheduleFlush();
  }

  /** A call finished — flush its final snapshot and stop tracking it. */
  end(id: string, name?: string): void {
    const call = this.calls.get(id);
    if (call && (name ? name : call.name)) {
      // Synchronous final flush: the end event must never overtake the args.
      this.handlers.onDelta({ id, name: name || call.name, partialJson: call.json.slice(0, MAX_EMIT_CHARS) });
    }
    this.calls.delete(id);
  }

  /** Stop timers; flushes any pending snapshots exactly once. */
  dispose(): void {
    this.disposed = true;
    this.flushNow();
  }

  private scheduleFlush(): void {
    if (this.timer || this.disposed) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.flushNow();
    }, this.flushMs);
    this.timer.unref?.();
  }

  private flushNow(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.calls.size === 0) return;
    // Snapshot + clear: every pending snapshot is emitted exactly once.
    const calls = new Map(this.calls);
    this.calls.clear();
    for (const [id, call] of calls) {
      if (!call.startedEmitted && call.name) call.startedEmitted = true;
      this.handlers.onDelta({ id, name: call.name, partialJson: call.json.slice(0, MAX_EMIT_CHARS) });
    }
  }
}
