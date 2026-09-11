import { useEffect, useState } from 'react';
import { useNotificationStore } from '../../stores/notifications';

type Channel = 'send_slack' | 'send_discord' | 'send_telegram' | 'send_whatsapp';

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
  {
    id: 'send_whatsapp',
    name: 'WhatsApp',
    hint: 'Meta Cloud (default) or Twilio — per-send creds or WHATSAPP_*/TWILIO_* env',
    credFields: [
      { key: 'whatsappTo', label: 'To (E.164)', placeholder: '+15551234567' },
      { key: 'whatsappVia', label: 'Via (meta/twilio)', placeholder: 'meta' },
      { key: 'whatsappPhoneNumberId', label: 'Meta phone_number_id', placeholder: '123456789…' },
      { key: 'whatsappToken', label: 'Meta access token', placeholder: 'EAAB…', secret: true },
      { key: 'twilioAccountSid', label: 'Twilio SID (twilio only)', placeholder: 'AC…' },
      { key: 'twilioAuthToken', label: 'Twilio token (twilio only)', placeholder: '…', secret: true },
      { key: 'twilioFrom', label: 'Twilio from (twilio only)', placeholder: 'whatsapp:+14155238886' },
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
  const [inbound, setInbound] = useState<{ enabled: boolean; running: boolean; allowedChatIds: string[] } | null>(null);
  const [allowInput, setAllowInput] = useState('');
  const [inboundSaving, setInboundSaving] = useState(false);
  const [waLink, setWaLink] = useState<{ state: string; owner?: string | null; qrDataUrl?: string | null; lastError?: string | null; lastInbound?: { at: number; from: string; reason: string; answered: boolean } | null; lastTurn?: { at: number; ok: boolean; error: string | null } | null } | null>(null);
  const [waBusy, setWaBusy] = useState(false);

  const refreshWaLink = async () => {
    try {
      const res = (await window.api.whatsappLinkStatus()) as {
        ok: boolean;
        state?: string;
        owner?: string | null;
        qrDataUrl?: string | null;
        lastError?: string | null;
        lastInbound?: { at: number; from: string; reason: string; answered: boolean } | null;
        lastTurn?: { at: number; ok: boolean; error: string | null } | null;
      };
      if (res.ok) setWaLink({ state: res.state ?? 'off', owner: res.owner, qrDataUrl: res.qrDataUrl, lastError: res.lastError, lastInbound: res.lastInbound, lastTurn: res.lastTurn });
    } catch {
      /* link panel is advisory */
    }
  };

  const refreshInbound = async () => {
    try {
      const res = (await window.api.messagingInboundGet()) as {
        ok: boolean;
        enabled?: boolean;
        running?: boolean;
        allowedChatIds?: string[];
      };
      if (res.ok) {
        setInbound({ enabled: !!res.enabled, running: !!res.running, allowedChatIds: res.allowedChatIds ?? [] });
        setAllowInput((res.allowedChatIds ?? []).join(', '));
      }
    } catch {
      /* inbound panel is advisory */
    }
  };

  useEffect(() => {
    void (async () => {
      try {
        const res = (await window.api.messagingStatus()) as {
          ok: boolean;
          status?: { slackWebhook?: boolean; discordWebhook?: boolean; telegram?: boolean; whatsappMeta?: boolean; whatsappTwilio?: boolean };
        };
        if (res.ok && res.status) {
          setStatus({
            send_slack: !!res.status.slackWebhook,
            send_discord: !!res.status.discordWebhook,
            send_telegram: !!res.status.telegram,
            send_whatsapp: !!(res.status.whatsappMeta || res.status.whatsappTwilio),
          });
        }
      } catch {
        /* status is advisory only */
      }
      void refreshInbound();
      void refreshWaLink();
    })();
    const waTimer = setInterval(() => void refreshWaLink(), 3000);
    return () => clearInterval(waTimer);
  }, []);

  const active = CHANNELS.find((c) => c.id === channel)!;

  const waAction = async (action: 'start' | 'stop' | 'unpair') => {
    setWaBusy(true);
    try {
      const call = action === 'start'
        ? window.api.whatsappLinkStart()
        : action === 'stop'
          ? window.api.whatsappLinkStop()
          : window.api.whatsappLinkUnpair();
      const res = (await call) as { ok: boolean; error?: string };
      if (!res.ok) {
        addToast({ title: 'WhatsApp link failed', message: res.error ?? 'Unknown error', type: 'error' });
      }
      await refreshWaLink();
    } catch (e) {
      addToast({ title: 'WhatsApp link failed', message: e instanceof Error ? e.message : 'Unknown error', type: 'error' });
    } finally {
      setWaBusy(false);
    }
  };

  const saveInbound = async (enabled: boolean) => {
    setInboundSaving(true);
    try {
      const allowedChatIds = allowInput.split(',').map((c) => c.trim().replace(/^@/, '')).filter(Boolean);
      const res = (await window.api.messagingInboundSet({ enabled, allowedChatIds })) as { ok: boolean; error?: string };
      if (!res.ok) {
        addToast({ title: 'Inbox update failed', message: res.error ?? 'Unknown error', type: 'error' });
      } else {
        addToast({
          title: enabled ? 'Telegram inbox on' : 'Telegram inbox off',
          message: enabled ? 'DMs from allowlisted chats become agent turns.' : 'The bot will ignore incoming DMs.',
          type: 'success',
        });
      }
      await refreshInbound();
    } catch (e) {
      addToast({ title: 'Inbox update failed', message: e instanceof Error ? e.message : 'Unknown error', type: 'error' });
    } finally {
      setInboundSaving(false);
    }
  };

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
        whatsappTo: creds.whatsappTo || undefined,
        whatsappVia: creds.whatsappVia === 'twilio' ? 'twilio' : undefined,
        whatsappPhoneNumberId: creds.whatsappPhoneNumberId || undefined,
        whatsappToken: creds.whatsappToken || undefined,
        twilioAccountSid: creds.twilioAccountSid || undefined,
        twilioAuthToken: creds.twilioAuthToken || undefined,
        twilioFrom: creds.twilioFrom || undefined,
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
    <div className="flex-1 overflow-y-auto p-6 animate-fade-in flex flex-col gap-4 min-h-0">
      <h1 className="text-2xl font-bold text-white leading-tight">Messaging</h1>
      <p className="text-zinc-500 text-sm mb-4">One sender for Slack, Discord, Telegram, and WhatsApp — plus Telegram inbox control.</p>

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

      {/* Telegram inbox (OpenClaw loop) */}
      <div className="rounded-2xl border border-white/10 bg-white/[0.04] backdrop-blur-xl p-4">
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-sm font-semibold text-white">Telegram inbox → agent</h2>
          <span className="text-[11px] text-zinc-500">
            {inbound ? (inbound.running ? 'poller running' : 'poller idle') : 'loading…'}
          </span>
        </div>
        <p className="text-xs text-zinc-500 mb-3">
          DMs to your Telegram bot become agent turns, answered back in that chat. Only allowlisted chats — everyone else is ignored. Needs a bot token (BotFather → saved as the <span className="text-zinc-300">telegram</span> key or TELEGRAM_BOT_TOKEN) and a local model ready.
        </p>
        <div className="flex flex-col sm:flex-row gap-2">
          <input
            value={allowInput}
            onChange={(e) => setAllowInput(e.target.value)}
            placeholder="Allowed chat ids, comma-separated — find yours via @userinfobot"
            className="flex-1 px-3 py-2 text-sm rounded-lg bg-black/30 border border-white/10 text-white placeholder:text-zinc-600 focus:outline-none focus:border-violet-400/60"
          />
          <div className="flex gap-2">
            <button
              onClick={() => void saveInbound(true)}
              disabled={inboundSaving}
              className="inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-semibold bg-gradient-to-r from-violet-600 to-cyan-500 text-white hover:from-violet-500 hover:to-cyan-400 disabled:opacity-50 transition-all"
            >
              {inbound?.enabled ? 'Update & keep on' : 'Turn on'}
            </button>
            {inbound?.enabled && (
              <button
                onClick={() => void saveInbound(false)}
                disabled={inboundSaving}
                className="rounded-lg px-3 py-2 text-xs font-medium bg-white/[0.04] border border-white/[0.08] text-zinc-300 hover:bg-white/[0.07] disabled:opacity-50 transition-colors"
              >
                Turn off
              </button>
            )}
          </div>
        </div>
      </div>
      {/* WhatsApp link (OpenClaw-style: scan QR, message yourself, agent replies) */}
      <div className="rounded-2xl border border-white/10 bg-white/[0.04] backdrop-blur-xl p-4">
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-sm font-semibold text-white">WhatsApp link → agent</h2>
          <span className="text-[11px] text-zinc-500">
            {waLink
              ? waLink.state === 'open'
                ? 'connected'
                : waLink.state === 'qr'
                  ? 'scan the code'
                  : waLink.state === 'connecting'
                    ? 'connecting…'
                    : waLink.state === 'closed'
                      ? 'disconnected'
                      : 'off'
              : 'loading…'}
          </span>
        </div>
        <p className="text-xs text-zinc-500 mb-3">
          Link your number as a companion device. Message yourself to talk to the agent, and anyone who messages you directly gets an answer too — the agent runs the turn on this PC and replies in that chat. Groups are ignored.
        </p>
        {waLink?.state === 'qr' && waLink.qrDataUrl && (
          <div className="mb-3 flex justify-center">
            <img src={waLink.qrDataUrl} alt="Scan with WhatsApp → Linked devices" className="w-56 h-56 rounded-xl border border-white/10 bg-white p-1" />
          </div>
        )}
        {waLink?.state === 'qr' && !waLink.qrDataUrl && (
          <p className="text-xs text-zinc-500 mb-3">Preparing the QR code…</p>
        )}
        {waLink?.owner && (
          <p className="text-xs text-zinc-400 mb-3">Linked number: <span className="text-zinc-200 font-mono">{waLink.owner}</span></p>
        )}
        {waLink?.lastError && (
          <p className="text-xs text-red-400/90 mb-3">{waLink.lastError}</p>
        )}
        {waLink?.state === 'open' && waLink.lastInbound && (
          <p className="text-[11px] text-zinc-500 mb-3">
            Last message {new Date(waLink.lastInbound.at).toLocaleTimeString()} — {waLink.lastInbound.answered ? 'answered' : `not answered (${waLink.lastInbound.reason})`}.
            {waLink.lastTurn && !waLink.lastTurn.ok && waLink.lastTurn.error ? ` Turn failed: ${waLink.lastTurn.error.slice(0, 160)}` : ''}
          </p>
        )}
        {waLink?.state === 'open' && !waLink.lastInbound && (
          <p className="text-[11px] text-zinc-500 mb-3">Connected. Message yourself — nothing received yet.</p>
        )}
        <div className="flex gap-2">
          {(waLink?.state === 'off' || waLink?.state === 'closed') && (
            <button
              onClick={() => void waAction('start')}
              disabled={waBusy}
              className="inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-semibold bg-gradient-to-r from-violet-600 to-cyan-500 text-white hover:from-violet-500 hover:to-cyan-400 disabled:opacity-50 transition-all"
            >
              {waBusy ? 'Starting…' : 'Link WhatsApp'}
            </button>
          )}
          {(waLink?.state === 'qr' || waLink?.state === 'connecting' || waLink?.state === 'open') && (
            <button
              onClick={() => void waAction('stop')}
              disabled={waBusy}
              className="rounded-lg px-3 py-2 text-xs font-medium bg-white/[0.04] border border-white/[0.08] text-zinc-300 hover:bg-white/[0.07] disabled:opacity-50 transition-colors"
            >
              Disconnect
            </button>
          )}
          {waLink && waLink.state !== 'off' && (
            <button
              onClick={() => void waAction('unpair')}
              disabled={waBusy}
              className="rounded-lg px-3 py-2 text-xs font-medium bg-white/[0.04] border border-white/[0.08] text-zinc-300 hover:bg-white/[0.07] disabled:opacity-50 transition-colors"
            >
              Unpair
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
