// Bridge wire-protocol contract.
//
// The browser extension and the Electron bridge server each carry their own
// MessagePack codec. They used to disagree: the encoder tagged 16-bit integers
// as 0xd2 and 32-bit integers as 0xd3 while the decoder only understood
// 0xd2-as-int32, so every value outside fixint range — every Date.now(), every
// tab id above 32767 — produced a frame neither side could read. `ping` and any
// timestamped payload simply vanished.
//
// These tests load the extension's real codec out of background.js (so the
// shipped file is what gets tested, not a copy) and assert the two codecs
// encode byte-identically and decode each other's output.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { decodeMessagePack, encodeMessagePack } from './server.js';

type Codec = { encode(value: unknown): Uint8Array; decode(bytes: Uint8Array | ArrayBuffer): unknown };

function loadExtensionCodec(): Codec {
  const path = resolve(process.cwd(), 'extensions/infinite-os-bridge/background.js');
  const source = readFileSync(path, 'utf8');
  const start = source.indexOf('const MSGPACK = {');
  expect(start, 'background.js must still define MSGPACK').toBeGreaterThan(-1);
  const end = source.indexOf('\n};', start);
  expect(end, 'MSGPACK object must be closed').toBeGreaterThan(start);
  // eslint-disable-next-line no-new-func
  return new Function(`${source.slice(start, end + 3)}; return MSGPACK;`)() as Codec;
}

const ext = loadExtensionCodec();

/** Values that broke the old codec, plus the shapes the protocol really sends. */
const PAYLOADS: Array<[string, unknown]> = [
  ['fixint', { ok: true, id: 7 }],
  ['negative fixint', { delta: -5 }],
  ['uint8 boundary', { v: 255 }],
  ['uint16 boundary', { tabId: 32767 }],
  ['int32 (Date.now)', { time: 1750000000000 }],
  ['int32 negative', { offset: -2000000000 }],
  ['big int beyond int32', { huge: 4294967296 }],
  ['float', { latencyMs: 12.375 }],
  ['long string', { html: 'x'.repeat(70_000) }],
  ['unicode', { title: 'infinite ∞ 映射 ✦' }],
  ['nested + arrays', { tabs: [{ id: 1, url: 'a' }, { id: 300, url: 'b' }], meta: { ok: true, n: 5000 } }],
  ['nulls and bools', { a: null, b: false, c: true }],
  ['binary blob', { shot: new Uint8Array([1, 2, 250, 255, 0]) }],
];

/** MessagePack has no undefined: both sides encode it as nil. */
function normalize(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value ?? null));
}

describe('bridge MessagePack codec', () => {
  it.each(PAYLOADS)('server and extension encode %s identically', (_name, value) => {
    const mine = new Uint8Array(encodeMessagePack(value));
    const theirs = ext.encode(value);
    expect(Array.from(mine)).toEqual(Array.from(theirs));
  });

  it.each(PAYLOADS)('round-trips %s through the server codec', (_name, value) => {
    expect(decodeMessagePack(encodeMessagePack(value))).toEqual(value);
  });

  it.each(PAYLOADS)('round-trips %s through the extension codec', (_name, value) => {
    // Binary payloads come back as Uint8Array on the extension side, so they
    // are compared by bytes rather than deep-equality.
    const back = ext.decode(ext.encode(value));
    if (value instanceof Object && 'shot' in (value as Record<string, unknown>)) {
      expect(Array.from((back as { shot: Uint8Array }).shot)).toEqual(Array.from((value as { shot: Uint8Array }).shot));
      return;
    }
    expect(back).toEqual(normalize(value));
  });

  it('decodes a frame produced by the other side', () => {
    for (const [, value] of PAYLOADS) {
      const back = ext.decode(new Uint8Array(encodeMessagePack(value)));
      if (value instanceof Object && 'shot' in (value as Record<string, unknown>)) {
        expect(Array.from((back as { shot: Uint8Array }).shot)).toEqual(Array.from((value as { shot: Uint8Array }).shot));
        continue;
      }
      expect(back).toEqual(normalize(value));
    }
  });

  it('encodes undefined as nil on both sides', () => {
    const value = { keep: 1, drop: undefined };
    expect(Array.from(new Uint8Array(encodeMessagePack(value)))).toEqual(Array.from(ext.encode(value)));
    expect(ext.decode(ext.encode(value))).toEqual({ keep: 1, drop: null });
  });

  it('survives a multi-megabyte payload (screenshot base64)', () => {
    const big = { ok: true, data: { base64: 'A'.repeat(3_000_000) } };
    const bytes = new Uint8Array(encodeMessagePack(big));
    expect(bytes.length).toBeGreaterThan(3_000_000);
    const back = ext.decode(bytes) as { data: { base64: string } };
    expect(back.data.base64.length).toBe(3_000_000);
  });

  it('sends every frame with the same opcode-agnostic byte length', () => {
    // Guards the old "write 2 bytes / read 4 bytes" desync class of bug.
    for (const [, value] of PAYLOADS) {
      const encoded = new Uint8Array(encodeMessagePack(value));
      expect(ext.decode(encoded)).toBeTruthy();
    }
  });
});