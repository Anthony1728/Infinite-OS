import type { Tool, ToolContext, ToolResult } from './base.js';

/**
 * Messaging Integrations — Hermes-beating, production-grade unified webhook tool.
 * Covers: Slack (incoming webhook + bot token), Discord (webhook), Telegram (bot token + chat_id),
 * WhatsApp (Meta Cloud API or Twilio, outbound)
 * All network calls respect abortSignal and 15s timeout, never leak tokens in output.
 * Hermes has messaging; Infinite OS supports 4 providers in one tool with typed validation
 * and automatic chunking, plus local simulation when no credentials are configured.
 */
interface MessagingArgs {
  action: 'send_slack' | 'send_discord' | 'send_telegram' | 'send_whatsapp' | 'simulate' | 'status';
  text?: string;
  webhookUrl?: string;
  channel?: string;
  username?: string;
  telegramToken?: string;
  telegramChatId?: string;
  whatsappTo?: string;
  whatsappVia?: 'meta' | 'twilio';
  whatsappPhoneNumberId?: string;
  whatsappToken?: string;
  twilioAccountSid?: string;
  twilioAuthToken?: string;
  twilioFrom?: string;
}

export const messagingTool: Tool = {
  name: 'Messaging',
  description:
    'Unified messaging for Slack, Discord, Telegram, and WhatsApp. Send a message via a webhook URL or bot token. Hermes messaging is per-platform; Infinite OS unifies all four in one tool with validation, chunking (1900 chars for Discord, 4000 elsewhere), and a dry-run simulate mode that reports what would be sent without hitting the network. Prefers per-call credentials when given; falls back to env vars SLACK_WEBHOOK_URL, DISCORD_WEBHOOK_URL, TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID, WHATSAPP_* / TWILIO_*. WhatsApp sends via Meta Cloud API (default) or Twilio.',
  inputSchema: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['send_slack', 'send_discord', 'send_telegram', 'send_whatsapp', 'simulate', 'status'], description: 'Destination' },
      text: { type: 'string', description: 'Message body (markdown supported where provider allows)' },
      webhookUrl: { type: 'string', description: 'Full webhook URL (Slack or Discord). Overrides env var.' },
      channel: { type: 'string', description: 'Slack channel #name (optional when webhook encodes it)' },
      username: { type: 'string', description: 'Display name override (Slack/Discord)' },
      telegramToken: { type: 'string', description: 'Telegram bot token (BotFather). Overrides TELEGRAM_BOT_TOKEN.' },
      telegramChatId: { type: 'string', description: 'Telegram chat_id (numeric or @username). Overrides TELEGRAM_CHAT_ID.' },
      whatsappTo: { type: 'string', description: 'Recipient phone in E.164, e.g. +15551234567. Overrides WHATSAPP_TO.' },
      whatsappVia: { type: 'string', enum: ['meta', 'twilio'], description: 'WhatsApp sender: Meta Cloud API (default) or Twilio. Overrides WHATSAPP_VIA.' },
      whatsappPhoneNumberId: { type: 'string', description: 'Meta Cloud phone_number_id. Overrides WHATSAPP_PHONE_NUMBER_ID.' },
      whatsappToken: { type: 'string', description: 'Meta Cloud access token. Overrides WHATSAPP_TOKEN.' },
      twilioAccountSid: { type: 'string', description: 'Twilio Account SID. Overrides TWILIO_ACCOUNT_SID.' },
      twilioAuthToken: { type: 'string', description: 'Twilio Auth Token. Overrides TWILIO_AUTH_TOKEN.' },
      twilioFrom: { type: 'string', description: 'Twilio WhatsApp sender, e.g. whatsapp:+14155238886. Overrides TWILIO_WHATSAPP_FROM.' },
    },
    required: ['action'],
  },
  permission: 'ask',

  async execute(args: unknown, ctx: ToolContext): Promise<ToolResult> {
    const a = args as MessagingArgs;
    if (a.action === 'status') {
      const hasSlack = Boolean(process.env.SLACK_WEBHOOK_URL);
      const hasDiscord = Boolean(process.env.DISCORD_WEBHOOK_URL);
      const hasTelegram = Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID);
      const hasWhatsappMeta = Boolean(process.env.WHATSAPP_PHONE_NUMBER_ID && process.env.WHATSAPP_TOKEN);
      const hasWhatsappTwilio = Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN);
      return {
        content: JSON.stringify({ slackWebhook: hasSlack, discordWebhook: hasDiscord, telegram: hasTelegram, whatsappMeta: hasWhatsappMeta, whatsappTwilio: hasWhatsappTwilio, note: 'Set per-call credentials or export env vars.' }, null, 2),
      };
    }
    if (a.action === 'simulate') {
      if (!a.text) return need('text');
      const preview = a.text.slice(0, 400);
      return { content: `[simulate] Would send ${a.text.length} chars: "${preview}${a.text.length > 400 ? '…' : ''}" (chunking: ${chunks(a.text, 1900).length} Discord chunk(s) / ${chunks(a.text, 4000).length} Slack/Telegram chunk(s))` };
    }
    if (!a.text || !a.text.trim()) return need('text');
    const text = a.text.trim();

    try {
      if (a.action === 'send_slack') {
        const url = a.webhookUrl || process.env.SLACK_WEBHOOK_URL;
        if (!url) return need('webhookUrl (or set SLACK_WEBHOOK_URL env var)');
        const payload: Record<string, unknown> = { text };
        if (a.username) payload.username = a.username;
        if (a.channel) payload.channel = a.channel;
        // Slack limit 40000? we chunk at 4000 for safety
        for (const chunk of chunks(text, 4000)) {
          const res = await fetchWithTimeout(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...payload, text: chunk }) }, ctx.abortSignal);
          if (!res.ok) return fail(`Slack ${res.status}: ${await safeText(res)}`);
        }
        return { content: `Sent ${text.length} chars to Slack${a.channel ? ` ${a.channel}` : ''} in ${chunks(text, 4000).length} chunk(s).` };
      }
      if (a.action === 'send_discord') {
        const url = a.webhookUrl || process.env.DISCORD_WEBHOOK_URL;
        if (!url) return need('webhookUrl (or set DISCORD_WEBHOOK_URL env var)');
        // Discord limit 2000, chunk at 1900
        for (const chunk of chunks(text, 1900)) {
          const body: Record<string, unknown> = { content: chunk };
          if (a.username) body.username = a.username;
          const res = await fetchWithTimeout(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, ctx.abortSignal);
          if (!res.ok && res.status !== 204) return fail(`Discord ${res.status}: ${await safeText(res)}`);
        }
        return { content: `Sent ${text.length} chars to Discord in ${chunks(text, 1900).length} chunk(s).` };
      }
      if (a.action === 'send_telegram') {
        const token = a.telegramToken || process.env.TELEGRAM_BOT_TOKEN;
        const chatId = a.telegramChatId || process.env.TELEGRAM_CHAT_ID;
        if (!token) return need('telegramToken (or set TELEGRAM_BOT_TOKEN env var)');
        if (!chatId) return need('telegramChatId (or set TELEGRAM_CHAT_ID env var)');
        const url = `https://api.telegram.org/bot${token}/sendMessage`;
        for (const chunk of chunks(text, 4000)) {
          const res = await fetchWithTimeout(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: chatId, text: chunk, parse_mode: 'Markdown' }) }, ctx.abortSignal);
          if (!res.ok) {
            const body = await safeText(res);
            // Try without parse_mode if markdown failed
            if (body.includes('parse')) {
              const retry = await fetchWithTimeout(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: chatId, text: chunk }) }, ctx.abortSignal);
              if (!retry.ok) return fail(`Telegram ${retry.status}: ${await safeText(retry)}`);
            } else return fail(`Telegram ${res.status}: ${body}`);
          }
        }
        return { content: `Sent ${text.length} chars to Telegram chat ${mask(chatId)} in ${chunks(text, 4000).length} chunk(s).` };
      }
      if (a.action === 'send_whatsapp') {
        const to = a.whatsappTo || process.env.WHATSAPP_TO;
        if (!to) return need('whatsappTo (or set WHATSAPP_TO env var)');
        const via = a.whatsappVia || (process.env.WHATSAPP_VIA === 'twilio' ? 'twilio' : 'meta');
        if (via === 'twilio') {
          const sid = a.twilioAccountSid || process.env.TWILIO_ACCOUNT_SID;
          const token = a.twilioAuthToken || process.env.TWILIO_AUTH_TOKEN;
          const from = a.twilioFrom || process.env.TWILIO_WHATSAPP_FROM;
          if (!sid) return need('twilioAccountSid (or set TWILIO_ACCOUNT_SID env var)');
          if (!token) return need('twilioAuthToken (or set TWILIO_AUTH_TOKEN env var)');
          if (!from) return need('twilioFrom like whatsapp:+14155238886 (or set TWILIO_WHATSAPP_FROM env var)');
          const url = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`;
          const auth = Buffer.from(`${sid}:${token}`).toString('base64');
          const dest = to.startsWith('whatsapp:') ? to : `whatsapp:${to}`;
          for (const chunk of chunks(text, 4000)) {
            const form = new URLSearchParams({ To: dest, From: from, Body: chunk });
            const res = await fetchWithTimeout(url, { method: 'POST', headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: form.toString() }, ctx.abortSignal);
            if (!res.ok) return fail(`WhatsApp (Twilio) ${res.status}: ${await safeText(res)}`);
          }
          return { content: `Sent ${text.length} chars via WhatsApp (Twilio) to ${mask(to)} in ${chunks(text, 4000).length} chunk(s).` };
        }
        const phoneNumberId = a.whatsappPhoneNumberId || process.env.WHATSAPP_PHONE_NUMBER_ID;
        const token = a.whatsappToken || process.env.WHATSAPP_TOKEN;
        if (!phoneNumberId) return need('whatsappPhoneNumberId (or set WHATSAPP_PHONE_NUMBER_ID env var)');
        if (!token) return need('whatsappToken (or set WHATSAPP_TOKEN env var)');
        const url = `https://graph.facebook.com/v22.0/${encodeURIComponent(phoneNumberId)}/messages`;
        for (const chunk of chunks(text, 4000)) {
          const res = await fetchWithTimeout(url, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', to, type: 'text', text: { preview_url: false, body: chunk } }) }, ctx.abortSignal);
          if (!res.ok) return fail(`WhatsApp (Meta) ${res.status}: ${await safeText(res)}`);
        }
        return { content: `Sent ${text.length} chars via WhatsApp (Meta) to ${mask(to)} in ${chunks(text, 4000).length} chunk(s).` };
      }
      return { content: `Unknown messaging action: ${a.action}`, is_error: true };
    } catch (e) {
      if ((e as Error).name === 'AbortError') return { content: 'Messaging aborted (timeout or user cancel).', is_error: true };
      return { content: `Messaging failed: ${(e as Error).message}`, is_error: true };
    }
  },
};

function chunks(s: string, n: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < s.length; i += n) out.push(s.slice(i, i + n));
  return out;
}
async function fetchWithTimeout(url: string, init: RequestInit, signal: AbortSignal) {
  const ctrl = new AbortController();
  const onAbort = () => ctrl.abort();
  signal.addEventListener('abort', onAbort, { once: true });
  const t = setTimeout(() => ctrl.abort(), 15_000);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
    signal.removeEventListener('abort', onAbort);
  }
}
async function safeText(res: Response): Promise<string> {
  try { return (await res.text()).slice(0, 800); } catch { return `${res.status} ${res.statusText}`; }
}
function need(field: string): ToolResult { return { content: `Messaging requires ${field}.`, is_error: true }; }
function fail(msg: string): ToolResult { return { content: msg.slice(0, 800), is_error: true }; }
function mask(s: string): string { return s.length <= 4 ? '****' : `${s.slice(0, 2)}****${s.slice(-2)}`; }
