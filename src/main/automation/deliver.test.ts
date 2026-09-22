import { afterEach, describe, expect, it } from 'vitest';
import { deliverNotification, setNotificationDeliverer, NOTIFY_CHANNELS } from './deliver.js';

afterEach(() => {
  setNotificationDeliverer(null);
});

describe('automation notification delivery', () => {
  it('routes through the override hook when set', async () => {
    const seen: string[] = [];
    setNotificationDeliverer(async (req) => {
      seen.push(`${req.channel ?? 'default'}:${req.message}`);
      return { delivered: true, channel: 'desktop', detail: 'stubbed' };
    });
    const res = await deliverNotification({ message: 'hi', channel: 'whatsapp' });
    expect(res).toEqual({ delivered: true, channel: 'desktop', detail: 'stubbed' });
    expect(seen).toEqual(['whatsapp:hi']);
  });

  it('fails loudly on unknown channels instead of pretending to send', async () => {
    const res = await deliverNotification({ message: 'hi', channel: 'carrier-pigeon' });
    expect(res.delivered).toBe(false);
    for (const c of NOTIFY_CHANNELS) expect(res.detail).toContain(c);
  });

  it('requires a recipient for email before touching any mailbox', async () => {
    const res = await deliverNotification({ message: 'hi', channel: 'email' });
    expect(res.delivered).toBe(false);
    expect(res.detail).toMatch(/recipient/i);
  });

  it('degrades gracefully when desktop toasts are unavailable', async () => {
    // Under vitest there is no Electron shell — delivery must report failure,
    // never throw, so scheduler runs fail loudly instead of crashing.
    const res = await deliverNotification({ message: 'hi', title: 'Test' });
    expect(res.delivered).toBe(false);
    expect(res.channel).toBe('desktop');
    expect(res.detail.length).toBeGreaterThan(0);
  });

  it('reports whatsapp as unlinked when no phone is connected', async () => {
    const res = await deliverNotification({ message: 'hi', channel: 'whatsapp' });
    expect(res.delivered).toBe(false);
    expect(res.detail).toMatch(/whatsapp/i);
  });
});
