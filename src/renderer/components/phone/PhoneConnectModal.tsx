import { useEffect, useState } from 'react';

interface PhoneInfo {
  running: boolean;
  url: string;
  qrDataUrl: string;
  lanIp: string;
  port: number;
  connections: number;
  busy: boolean;
}

interface PhoneConnectModalProps {
  open: boolean;
  onClose: () => void;
}

export function PhoneConnectModal({ open, onClose }: PhoneConnectModalProps) {
  const [info, setInfo] = useState<PhoneInfo | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    let alive = true;
    const load = async () => {
      try {
        const result = await window.api.remotePhoneInfo() as PhoneInfo;
        if (alive) setInfo(result);
      } catch (err) {
        if (alive) setError(err instanceof Error ? err.message : 'Could not reach the phone server');
      }
    };
    void load();
    const timer = setInterval(load, 3000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const handleCopy = async () => {
    if (!info?.url) return;
    try {
      await navigator.clipboard.writeText(info.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard unavailable */
    }
  };

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fade-in"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Connect your phone"
    >
      <div
        className="w-[380px] max-w-[92vw] rounded-2xl border border-white/[0.09] bg-[#101013] shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-white/[0.06]">
          <div className="flex items-center gap-2.5">
            <span className="w-7 h-7 rounded-lg bg-white/[0.05] border border-white/[0.08] flex items-center justify-center">
              <svg className="w-3.5 h-3.5 text-zinc-300" fill="none" stroke="currentColor" strokeWidth="1.7" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.4 3h5.2a2.2 2.2 0 0 1 2.2 2.2v13.6a2.2 2.2 0 0 1-2.2 2.2H9.4a2.2 2.2 0 0 1-2.2-2.2V5.2A2.2 2.2 0 0 1 9.4 3Z" />
                <path strokeLinecap="round" d="M10.8 5.3h2.4M12 17.9v.01" opacity=".6" />
              </svg>
            </span>
            <div>
              <div className="text-sm font-medium text-zinc-100">Connect your phone</div>
              <div className="text-[10px] text-zinc-500">Chat with your AI from anywhere on your network</div>
            </div>
          </div>
          <button onClick={onClose} className="icon-button w-7 h-7" aria-label="Close">
            <svg className="w-3.5 h-3.5 mx-auto" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
              <path strokeLinecap="round" d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-5 flex flex-col items-center">
          {error && <p className="text-xs text-red-400">{error}</p>}
          {!error && !info && <div className="text-xs text-zinc-600 py-8">Starting phone server…</div>}
          {!error && info && (
            <>
              <div className="rounded-xl bg-[#fafafa] p-3 border border-white/10">
                {info.qrDataUrl ? (
                  <img src={info.qrDataUrl} alt="Scan to connect your phone" className="w-48 h-48 block" />
                ) : (
                  <div className="w-48 h-48 grid place-items-center text-xs text-zinc-500">QR unavailable</div>
                )}
              </div>

              <ol className="mt-4 space-y-1.5 text-[11px] leading-relaxed text-zinc-400 list-decimal list-inside self-start">
                <li>Open the Camera app on your phone</li>
                <li>Point it at the code and tap the link</li>
                <li>Chat with Infinite AI — live progress included</li>
              </ol>

              <button
                onClick={() => void handleCopy()}
                className="mt-4 w-full h-8 rounded-lg border border-white/[0.08] bg-white/[0.03] hover:bg-white/[0.06] transition-colors text-[11px] text-zinc-300 font-mono truncate px-3"
                title={info.url}
              >
                {copied ? 'Copied to clipboard' : info.url}
              </button>

              <div className="mt-4 w-full flex items-center justify-between text-[10px] text-zinc-500">
                <span className="flex items-center gap-1.5">
                  <span className={`w-1.5 h-1.5 rounded-full ${info.running ? 'bg-emerald-400' : 'bg-zinc-600'}`} />
                  Server {info.running ? `running · ${info.lanIp}:${info.port}` : 'offline'}
                </span>
                <span>{info.connections} device{info.connections !== 1 ? 's' : ''} connected</span>
              </div>

              <p className="mt-3 text-[9.5px] leading-relaxed text-zinc-600 self-start">
                Your phone and this computer must share the same Wi-Fi network. The link contains a private key — only share it with your own devices.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
