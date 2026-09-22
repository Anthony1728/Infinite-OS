/**
 * Notification delivery for automation workflows.
 *
 * The `notify` workflow action used to be a no-op string ("Notification: …")
 * — scheduled workflows like the morning brief ran green while silently
 * delivering nothing. Every notify now really delivers: a desktop toast by
 * default, or WhatsApp (owner self-chat), Telegram (default chat), or email
 * when the action requests it. Undeliverable notifications fail loudly with
 * the reason instead of pretending they sent.
 *
 * Channel modules are lazy-imported so this file stays import-light under
 * tests; use setNotificationDeliverer to stub delivery in tests.
 */

export type NotifyChannel = 'desktop' | 'whatsapp' | 'telegram' | 'email';

export interface NotifyRequest {
  message: string;
  title?: string;
  /** Defaults to 'desktop'. Unknown values fail loudly — never silently. */
  channel?: string;
  /** Recipient address (email channel). */
  to?: string;
  /** Subject line (email channel). */
  subject?: string;
}

export interface NotifyResult {
  delivered: boolean;
  channel: string;
  detail: string;
}

type Deliverer = (req: NotifyRequest) => Promise<NotifyResult>;
let overrideDeliverer: Deliverer | null = null;

/** Test hook (also lets embedders reroute delivery). Always reset after use. */
export function setNotificationDeliverer(fn: Deliverer | null): void {
  overrideDeliverer = fn;
}

export const NOTIFY_CHANNELS: NotifyChannel[] = ['desktop', 'whatsapp', 'telegram', 'email'];

async function deliverDesktop(title: string, message: string): Promise<NotifyResult> {
  try {
    const mod = (await import('electron')) as unknown as {
      Notification?: {
        isSupported?: () => boolean;
        new (opts: { title: string; body: string }): {
          once: (event: string, cb: () => void) => void;
          show: () => void;
        };
      };
    };
    const NotificationCtor = mod?.Notification;
    if (!NotificationCtor || typeof NotificationCtor.isSupported !== 'function' || !NotificationCtor.isSupported()) {
      return { delivered: false, channel: 'desktop', detail: 'Desktop notifications are not supported in this environment.' };
    }
    const shown = await new Promise<boolean>((resolve) => {
      try {
        const n = new NotificationCtor({ title, body: message.slice(0, 500) });
        n.once('failed', () => resolve(false));
        n.show();
        resolve(true);
      } catch {
        resolve(false);
      }
    });
    return shown
      ? { delivered: true, channel: 'desktop', detail: `Desktop notification shown: ${title}` }
      : { delivered: false, channel: 'desktop', detail: 'Desktop notification failed to show.' };
  } catch (e) {
    return { delivered: false, channel: 'desktop', detail: `Desktop notification error: ${(e as Error).message}` };
  }
}

async function deliverWhatsApp(message: string): Promise<NotifyResult> {
  try {
    const { whatsAppLink } = await import('../messaging/whatsapp-link.js');
    const res = await whatsAppLink.sendToSelf(message);
    return res.ok
      ? { delivered: true, channel: 'whatsapp', detail: `WhatsApp self-chat message sent (${message.length} chars).` }
      : { delivered: false, channel: 'whatsapp', detail: `WhatsApp delivery failed: ${res.error ?? 'unknown error'}` };
  } catch (e) {
    return { delivered: false, channel: 'whatsapp', detail: `WhatsApp delivery error: ${(e as Error).message}` };
  }
}

async function deliverTelegram(message: string): Promise<NotifyResult> {
  try {
    const { telegramInbound } = await import('../messaging/telegram-inbound.js');
    const res = await telegramInbound.sendToDefault(message);
    return res.ok
      ? { delivered: true, channel: 'telegram', detail: `Telegram message sent (${message.length} chars).` }
      : { delivered: false, channel: 'telegram', detail: `Telegram delivery failed: ${res.error ?? 'unknown error'}` };
  } catch (e) {
    return { delivered: false, channel: 'telegram', detail: `Telegram delivery error: ${(e as Error).message}` };
  }
}

async function deliverEmail(req: NotifyRequest): Promise<NotifyResult> {
  const to = (req.to ?? '').trim();
  if (!to) {
    return { delivered: false, channel: 'email', detail: 'Email delivery needs a recipient: set "to" on the notify action.' };
  }
  try {
    const email = await import('../email/index.js');
    if (!(await email.hasEmailConfig())) {
      return { delivered: false, channel: 'email', detail: 'Email is not configured. Add a mailbox in Settings → Email first.' };
    }
    const subject = (req.subject ?? req.title ?? 'Infinite OS notification').trim() || 'Infinite OS notification';
    const res = await email.sendEmail(to, subject, req.message);
    return res.ok
      ? { delivered: true, channel: 'email', detail: `Email sent to ${to}.` }
      : { delivered: false, channel: 'email', detail: `Email delivery failed: ${res.error ?? 'unknown error'}` };
  } catch (e) {
    return { delivered: false, channel: 'email', detail: `Email delivery error: ${(e as Error).message}` };
  }
}

export async function deliverNotification(req: NotifyRequest): Promise<NotifyResult> {
  if (overrideDeliverer) return overrideDeliverer(req);
  const channel = (req.channel ?? 'desktop').trim().toLowerCase() || 'desktop';
  if (!(NOTIFY_CHANNELS as string[]).includes(channel)) {
    return {
      delivered: false,
      channel,
      detail: `Unknown notify channel "${req.channel}". Use one of: ${NOTIFY_CHANNELS.join(', ')}.`,
    };
  }
  const title = (req.title ?? 'Infinite OS').trim() || 'Infinite OS';
  switch (channel as NotifyChannel) {
    case 'whatsapp':
      return deliverWhatsApp(req.message);
    case 'telegram':
      return deliverTelegram(req.message);
    case 'email':
      return deliverEmail(req);
    case 'desktop':
    default:
      return deliverDesktop(title, req.message);
  }
}
