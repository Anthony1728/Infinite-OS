import type { Tool, ToolContext, ToolResult } from './base.js';

/**
 * Messaging Integrations — Hermes-beating, production-grade unified webhook tool.
 * Covers: Slack (incoming webhook + bot token), Discord (webhook), Telegram (bot token + chat_id)
 * All network calls respect abortSignal and 15s timeout, never leak tokens in output.
 * Hermes has messaging; Infinite OS supports 3 providers in one tool with typed validation
 * and automatic chunking, plus local simulation when no credentials are configured.
 */
interface MessagingArgs {
  action: 'send_slack' | 'send_discord' | 'send_telegram' | 'simulate' | 'status';
  text?: string;
  webhookUrl?: string;
  channel?: string;
  username?: string;
  telegramToken?: string;
  telegramChatId?: string;
}

export const messagingTool: Tool = {
  name: 'Messaging',
  description:
    'Unified messaging for Slack, Discord, and Telegram. Send a message via a webhook URL or bot token. Hermes messaging is per-platform; Infinite OS unifies all three in one tool with validation, chunking (1900 chars for Discord, 4000 for Slack/Telegram), and a dry-run simulate mode that reports what would be sent without hitting the network. Prefers webhookUrl when given; falls back to env vars SLACK_WEBHOOK_URL, DISCORD_WEBHOOK_URL, TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID.',
  inputSchema: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['send_slack', 'send_discord', 'send_telegram', 'simulate', 'status'], description: 'Destination' },
      text: { type: 'string', description: 'Message body (markdown supported where provider allows)' },
      webhookUrl: { type: 'string', description: 'Full webhook URL (Slack or Discord). Overrides env var.' },
      channel: { type: 'string', description: 'Slack channel #name (optional when webhook encodes it)' },
      username: { type: 'string', description: 'Display name override (Slack/Discord)' },
      telegramToken: { type: 'string', description: 'Telegram bot token (BotFather). Overrides TELEGRAM_BOT_TOKEN.' },
      telegramChatId: { type: 'string', description: 'Telegram chat_id (numeric or @username). Overrides TELEGRAM_CHAT_ID.' },
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
      return {
        content: JSON.stringify({ slackWebhook: hasSlack, discordWebhook: hasDiscord, telegram: hasTelegram, note: 'Set webhookUrl/telegramToken/chatId per call or export env vars.' }, null, 2),
      };
    }
    if (a.action === 'simulate') {
      if (!a.text) return need('text');
      const preview = a.text.slice(0, 400);
      return { content: `[simulate] Would send ${a.text.length} chars: "${preview}${a.text.length > 400 ? '…' : ''}" (chunking: ${chunks(a.text, 1900).length} Discord chunk(s) / ${chunks(a.text, 4000).length} Slack chunk(s))` };
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
        for (const chunk of chunks(text, 3500)) {
          const res = await fetchWithTimeout(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...payload, text: chunk }) }, ctx.abortSignal);
          if (!res.ok) return fail(`Slack ${res.status}: ${await safeText(res)}`);
        }
        return { content: `Sent ${text.length} chars to Slack${a.channel ? ` ${a.channel}` : ''} in ${chunks(text, 3500).length} chunk(s).` };
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
