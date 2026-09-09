/**
 * Messaging IPC — unified Slack / Discord / Telegram via the Messaging tool.
 * Credentials stay main-side (env vars) or per-call (webhook/token args);
 * tokens are never written to disk by this handler.
 */

import { ipcMain } from 'electron';
import { IPC } from '../../shared/ipc.js';
import { messagingTool } from '../tools/messaging.js';

function stubContext() {
  return {
    cwd: process.cwd(),
    abortSignal: AbortSignal.timeout(20000),
    sessionId: 'messaging-view',
    onUpdate: () => {},
  };
}

export function registerMessagingIpc(): void {
  ipcMain.handle(IPC.MESSAGING_STATUS, async () => {
    try {
      const result = await messagingTool.execute({ action: 'status' }, stubContext());
      return { ok: !result.is_error, status: JSON.parse(String(result.content)) };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  });

  ipcMain.handle(
    IPC.MESSAGING_SEND,
    async (
      _e,
      args: {
        action: 'send_slack' | 'send_discord' | 'send_telegram' | 'send_whatsapp' | 'simulate';
        text: string;
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
      },
    ) => {
      try {
        if (!args?.text?.trim()) return { ok: false, error: 'Message text is required' };
        if (args.text.length > 4000) return { ok: false, error: 'Message too long (max 4000 chars)' };
        const result = await messagingTool.execute(
          {
            action: args.action,
            text: args.text,
            webhookUrl: args.webhookUrl || undefined,
            channel: args.channel || undefined,
            username: args.username || undefined,
            telegramToken: args.telegramToken || undefined,
            telegramChatId: args.telegramChatId || undefined,
            whatsappTo: args.whatsappTo || undefined,
            whatsappVia: args.whatsappVia || undefined,
            whatsappPhoneNumberId: args.whatsappPhoneNumberId || undefined,
            whatsappToken: args.whatsappToken || undefined,
            twilioAccountSid: args.twilioAccountSid || undefined,
            twilioAuthToken: args.twilioAuthToken || undefined,
            twilioFrom: args.twilioFrom || undefined,
          },
          stubContext(),
        );
        if (result.is_error) return { ok: false, error: String(result.content).slice(0, 500) };
        return { ok: true, result: String(result.content).slice(0, 2000) };
      } catch (e) {
        return { ok: false, error: (e as Error).message };
      }
    },
  );

  ipcMain.handle(IPC.MESSAGING_INBOUND_GET, async () => {
    try {
      const { isInboundEnabled, telegramInbound, parseAllowedChats } = await import('../messaging/telegram-inbound.js');
      const { settings } = await import('../settings/store.js');
      const raw = settings.get<unknown>('telegramAllowedChatIds');
      return {
        ok: true,
        enabled: isInboundEnabled(),
        running: telegramInbound.isRunning(),
        allowedChatIds: [...parseAllowedChats(raw)],
      };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  });

  ipcMain.handle(
    IPC.MESSAGING_INBOUND_SET,
    async (_e, args: { enabled?: boolean; allowedChatIds?: string[] }) => {
      try {
        const { settings } = await import('../settings/store.js');
        const cwd = process.cwd();
        if (typeof args?.enabled === 'boolean') await settings.set('user', 'telegramInboundEnabled', args.enabled, cwd);
        if (Array.isArray(args?.allowedChatIds)) {
          const clean = args.allowedChatIds.map((c) => String(c).trim().replace(/^@/, '')).filter(Boolean).slice(0, 20);
          await settings.set('user', 'telegramAllowedChatIds', clean, cwd);
        }
        const { isInboundEnabled, telegramInbound } = await import('../messaging/telegram-inbound.js');
        return { ok: true, enabled: isInboundEnabled(), running: telegramInbound.isRunning() };
      } catch (e) {
        return { ok: false, error: (e as Error).message };
      }
    },
  );
}
