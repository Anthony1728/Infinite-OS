import { describe, expect, it } from 'vitest';
import { opencode } from './opencode.js';
import type { ChatRequest } from './base.js';
import type { Message } from '../../shared/types.js';

// Live-server proof (NOT part of CI): requires the real `opencode serve`
// on 127.0.0.1:4096. Run with INFINITE_LIVE_OPENCODE=1. Proves text streams
// as text_delta chunks and tool telemetry arrives — the exact path that was
// dark before the flat part.text fix.
const LIVE = process.env.INFINITE_LIVE_OPENCODE === '1';

describe.skipIf(!LIVE)('OpenCode live streaming', () => {
  it('streams text deltas and tool telemetry from the real runtime', async () => {
    const message: Message = {
      id: 'm-live',
      role: 'user',
      timestamp: Date.now(),
      content: [{ type: 'text', text: 'Use a tool to list the files in the current directory, then reply with one short sentence.' }],
    };
    const request: ChatRequest = { model: 'opencode::big-pickle', messages: [message], stream: true, cwd: process.cwd() };
    const seen: Array<{ at: number; type: string }> = [];
    let text = '';
    let progress = 0;
    for await (const chunk of opencode.streamChat(request, '')) {
      seen.push({ at: Date.now(), type: chunk.type });
      if (chunk.type === 'text_delta') text += chunk.text;
      if (chunk.type === 'provider_progress') progress++;
    }
    expect(progress).toBeGreaterThan(0);
    expect(text.trim().length).toBeGreaterThan(0);
    expect(seen.some((s) => s.type === 'message_end')).toBe(true);
    // Live proof: the first text arrived strictly before the turn ended.
    const firstText = seen.find((s) => s.type === 'text_delta')!.at;
    const end = seen.filter((s) => s.type === 'message_end').at(-1)!.at;
    expect(firstText).toBeLessThan(end);
  }, 180_000);
});
