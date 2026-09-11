import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { whatsAppLink } from './whatsapp-link.js';

// Live proof (NOT part of CI): opens a real WhatsApp companion-device
// handshake and waits for an actual pairing QR from WhatsApp's servers.
// Run with INFINITE_LIVE_WHATSAPP=1. Creds go to a temp home — the real
// profile is never touched, and nothing is scanned (QR just proves the
// pipe is live up to the phone-scan step).
const LIVE = process.env.INFINITE_LIVE_WHATSAPP === '1';

describe.skipIf(!LIVE)('WhatsApp link live handshake', () => {
  const savedHome = process.env.INFINITE_TEST_HOME;
  let home = '';

  afterEach(async () => {
    whatsAppLink.stop();
    await whatsAppLink.unpair().catch(() => undefined);
    if (savedHome === undefined) delete process.env.INFINITE_TEST_HOME;
    else process.env.INFINITE_TEST_HOME = savedHome;
    if (home) rmSync(home, { recursive: true, force: true });
    home = '';
  });

  it('receives a scannable pairing QR from WhatsApp servers', async () => {
    home = mkdtempSync(join(tmpdir(), 'wa-live-'));
    process.env.INFINITE_TEST_HOME = home;
    await whatsAppLink.start();
    const deadline = Date.now() + 90_000;
    let qr: string | null = null;
    let lastState = '';
    while (Date.now() < deadline) {
      const st = whatsAppLink.status();
      lastState = st.state;
      if (st.qrDataUrl) {
        qr = st.qrDataUrl;
        break;
      }
      if (st.state === 'open') break; // already paired (unexpected on temp home)
      if (st.lastError) throw new Error(`link errored: ${st.lastError}`);
      await new Promise((r) => setTimeout(r, 1000));
    }
    if (!qr) throw new Error(`no QR within 90s (last state: ${lastState})`);
    expect(qr.startsWith('data:image/png;base64,')).toBe(true);
    expect(qr.length).toBeGreaterThan(1000);
  }, 120_000);
});
