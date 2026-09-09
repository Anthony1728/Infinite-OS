import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { messagingTool } from './messaging.js';
import type { ToolContext } from './base.js';

function ctx(): ToolContext {
  return { cwd: '/tmp', abortSignal: AbortSignal.timeout(10000), sessionId: 'test', onUpdate: () => {} };
}

const ENV_KEYS = ['WHATSAPP_TO', 'WHATSAPP_VIA', 'WHATSAPP_PHONE_NUMBER_ID', 'WHATSAPP_TOKEN', 'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_WHATSAPP_FROM', 'SLACK_WEBHOOK_URL', 'DISCORD_WEBHOOK_URL', 'TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID'];
let savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  savedEnv = {};
  for (const k of ENV_KEYS) {
    savedEnv[k] = process.env[k];
    delete process.env[k];
  }
  vi.unstubAllGlobals();
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  vi.unstubAllGlobals();
});

describe('messaging status', () => {
  it('reports whatsappMeta/whatsappTwilio false with no env', async () => {
    const res = await messagingTool.execute({ action: 'status' }, ctx());
    expect(res.is_error).toBeFalsy();
    const status = JSON.parse(String(res.content));
    expect(status.whatsappMeta).toBe(false);
    expect(status.whatsappTwilio).toBe(false);
  });

  it('reports whatsappMeta true when Meta env is set', async () => {
    process.env.WHATSAPP_PHONE_NUMBER_ID = '123';
    process.env.WHATSAPP_TOKEN = 'tok';
    const res = await messagingTool.execute({ action: 'status' }, ctx());
    expect(JSON.parse(String(res.content)).whatsappMeta).toBe(true);
  });
});

describe('send_whatsapp', () => {
  it('asks for a recipient instead of hitting the network', async () => {
    const fetchSpy = vi.fn(() => { throw new Error('must not be called'); });
    vi.stubGlobal('fetch', fetchSpy);
    const res = await messagingTool.execute({ action: 'send_whatsapp', text: 'hi' }, ctx());
    expect(res.is_error).toBe(true);
    expect(String(res.content)).toMatch(/whatsappTo/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('sends via Meta Cloud API with per-call credentials', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return { ok: true } as Response;
    });
    const res = await messagingTool.execute(
      { action: 'send_whatsapp', text: 'hello', whatsappTo: '+15551234567', whatsappPhoneNumberId: 'PNID', whatsappToken: 'SECRET' },
      ctx(),
    );
    expect(res.is_error).toBeFalsy();
    expect(String(res.content)).toMatch(/WhatsApp \(Meta\)/);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain('graph.facebook.com/v22.0/PNID/messages');
    const body = JSON.parse(String(calls[0].init.body));
    expect(body.to).toBe('+15551234567');
    expect(body.text.body).toBe('hello');
    // Secret must travel in the header, never in the URL or body.
    expect(calls[0].url).not.toContain('SECRET');
    expect(String(calls[0].init.body)).not.toContain('SECRET');
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe('Bearer SECRET');
  });

  it('sends via Twilio with form encoding and whatsapp: prefixing', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return { ok: true } as Response;
    });
    const res = await messagingTool.execute(
      {
        action: 'send_whatsapp', text: 'hi', whatsappVia: 'twilio', whatsappTo: '+15551234567',
        twilioAccountSid: 'AC123', twilioAuthToken: 'AUTH', twilioFrom: 'whatsapp:+14155238886',
      },
      ctx(),
    );
    expect(res.is_error).toBeFalsy();
    expect(String(res.content)).toMatch(/Twilio/);
    expect(calls[0].url).toContain('api.twilio.com/2010-04-01/Accounts/AC123/Messages.json');
    const form = new URLSearchParams(String(calls[0].init.body));
    expect(form.get('To')).toBe('whatsapp:+15551234567');
    expect(form.get('Body')).toBe('hi');
  });

  it('asks for Twilio SID when via=twilio without credentials', async () => {
    const res = await messagingTool.execute(
      { action: 'send_whatsapp', text: 'hi', whatsappVia: 'twilio', whatsappTo: '+1555' },
      ctx(),
    );
    expect(res.is_error).toBe(true);
    expect(String(res.content)).toMatch(/twilioAccountSid/i);
  });
});
