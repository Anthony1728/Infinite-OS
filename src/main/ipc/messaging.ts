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
        action: 'send_slack' | 'send_discord' | 'send_telegram' | 'simulate';
        text: string;
        webhookUrl?: string;
        channel?: string;
        username?: string;
        telegramToken?: string;
        telegramChatId?: string;
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
}
