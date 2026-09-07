import { useEffect, useState } from 'react';
import { useNotificationStore } from '../../stores/notifications';

type Channel = 'send_slack' | 'send_discord' | 'send_telegram';

const CHANNELS: Array<{ id: Channel; name: string; hint: string; credFields: Array<{ key: string; label: string; placeholder: string; secret?: boolean }> }> = [
  {
    id: 'send_slack',
    name: 'Slack',
    hint: 'Webhook URL or SLACK_WEBHOOK_URL env',
    credFields: [
      { key: 'webhookUrl', label: 'Webhook URL', placeholder: 'https://hooks.slack.com/…' },
      { key: 'channel', label: 'Channel (optional)', placeholder: '#general' },
    ],
  },
  {
    id: 'send_discord',
    name: 'Discord',
    hint: 'Webhook URL or DISCORD_WEBHOOK_URL env',
    credFields: [{ key: 'webhookUrl', label: 'Webhook URL', placeholder: 'https://discord.com/api/webhooks/…' }],
  },
  {
    id: 'send_telegram',
    name: 'Telegram',
    hint: 'Bot token + chat id, or TELEGRAM_* env',
    credFields: [
      { key: 'telegramToken', label: 'Bot token', placeholder: '123456:ABC-…', secret: true },
      { key: 'telegramChatId', label: 'Chat id', placeholder: '@channel or 123456789' },
    ],
  },
];

// Messaging — Slack / Discord / Telegram through one unified sender.
// Credentials are per-send (never stored); env vars work as fallback.
export function MessagingView() {
  const addToast = useNotificationStore((s) => s.addToast);
  const [channel, setChannel] = useState<Channel>('send_slack');
  const [text, setText] = useState('');
  const [creds, setCreds] = useState<Record<string, string>>({});
  const [sending, setSending] = useState(false);
  const [status, setStatus] = useState<Record<string, boolean> | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const res = (await window.api.messagingStatus()) as {
          ok: boolean;
          status?: { slackWebhook?: boolean; discordWebhook?: boolean; telegram?: boolean };
        };
        if (res.ok && res.status) {
          setStatus({
            send_slack: !!res.status.slackWebhook,
            send_discord: !!res.status.discordWebhook,
            send_telegram: !!res.status.telegram,
          });
        }
      } catch {
        /* status is advisory only */
      }
    })();
  }, []);

  const active = CHANNELS.find((c) => c.id === channel)!;

  const send = async (simulate: boolean) => {
    if (!text.trim()) {
      addToast({ title: 'Empty message', message: 'Write something first.', type: 'error' });
      return;
    }
    setSending(true);
    try {
      const res = (await window.api.messagingSend({
        action: simulate ? 'simulate' : channel,
        text: text.trim(),
        webhookUrl: creds.webhookUrl || undefined,
        channel: creds.channel || undefined,
        username: undefined,
        telegramToken: creds.telegramToken || undefined,
        telegramChatId: creds.telegramChatId || undefined,
      })) as { ok: boolean; error?: string; result?: string };
      if (!res.ok) {
        addToast({ title: 'Send failed', message: res.error ?? 'Unknown error', type: 'error' });
      } else {
        addToast({ title: simulate ? 'Dry run' : 'Sent', message: simulate ? 'Payload validated — nothing left the machine.' : `${active.name} accepted the message.`, type: 'success' });
        if (!simulate) setText('');
      }
    } catch (e) {
      addToast({ title: 'Send failed', message: e instanceof Error ? e.message : 'Unknown error', type: 'error' });
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex-1 overflow-hidden p-6 animate-fade-in flex flex-col min-h-0">
      <h1 className="text-2xl font-bold text-white leading-tight">Messaging</h1>
      <p className="text-zinc-500 text-sm mb-4">One sender for Slack, Discord, and Telegram.</p>

      <div className="flex items-center gap-1.5 mb-4">
        {CHANNELS.map((c) => {
          const on = status?.[c.id];
          const isActive = c.id === channel;
          return (
            <button
              key={c.id}
              onClick={() => setChannel(c.id)}
              className={`inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-medium transition-all ${
                isActive
                  ? 'bg-gradient-to-r from-violet-500/20 via-cyan-500/10 to-transparent border-violet-500/40 text-violet-100'
                  : 'bg-white/[0.03] border-white/[0.06] text-zinc-400 hover:bg-white/[0.05] hover:text-zinc-200'
              }`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${on ? 'bg-emerald-400' : on === false ? 'bg-zinc-600' : 'bg-zinc-700'}`} />
              {c.name}
            </button>
          );
        })}
        <span className="ml-2 text-[11px] text-zinc-600">{active.hint}</span>
      </div>

      <div className="rounded-xl bg-[#0c1018] border border-white/[0.06] p-4 space-y-3 max-w-2xl">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={`Message to ${active.name}… (Slack/Discord markdown supported)`}
          rows={4}
          className="w-full rounded-xl bg-black/20 border border-white/[0.07] px-3 py-2.5 text-sm text-zinc-100 placeholder:text-zinc-600 outline-none focus:border-violet-500/30 transition-colors resize-y"
        />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {active.credFields.map((f) => (
            <input
              key={f.key}
              type={f.secret ? 'password' : 'text'}
              value={creds[f.key] ?? ''}
              onChange={(e) => setCreds((c) => ({ ...c, [f.key]: e.target.value }))}
              placeholder={`${f.label} (optional — env fallback)`}
              aria-label={f.label}
              className="rounded-xl bg-black/20 border border-white/[0.07] px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 outline-none focus:border-violet-500/30 transition-colors"
            />
          ))}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => void send(false)}
            disabled={sending || !text.trim()}
            className="inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-semibold bg-gradient-to-r from-violet-600 to-cyan-500 text-white shadow-[0_6px_16px_rgba(124,58,237,.3)] hover:from-violet-500 hover:to-cyan-400 active:scale-[0.98] disabled:opacity-50 transition-all"
          >
            {sending ? 'Sending…' : `Send via ${active.name}`}
          </button>
          <button
            onClick={() => void send(true)}
            disabled={sending || !text.trim()}
            className="rounded-lg px-3 py-2 text-xs font-medium bg-white/[0.04] border border-white/[0.08] text-zinc-300 hover:bg-white/[0.07] disabled:opacity-50 transition-colors"
          >
            Dry run
          </button>
        </div>
      </div>
    </div>
  );
}
