import { useChatStore } from '../../stores/chat';

export function PermissionDialog() {
  const pending = useChatStore((s) => s.pendingPermission);
  const respond = useChatStore((s) => s.respondPermission);
  if (!pending) return null;

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/80 p-4 backdrop-blur-md"
      role="dialog"
      aria-modal="true"
      aria-labelledby="permission-dialog-title"
      aria-describedby="permission-dialog-description"
    >
      <div className="pointer-events-none absolute h-80 w-80 rounded-full bg-indigo-500/20 blur-[100px]" aria-hidden="true" />
      <div className="relative w-full max-w-lg overflow-hidden rounded-2xl border border-indigo-300/40 bg-[#111827] shadow-[0_0_0_1px_rgba(129,140,248,.16),0_24px_80px_rgba(0,0,0,.65),0_0_70px_rgba(99,102,241,.22)]">
        <div className="flex items-start gap-3 border-b border-white/[0.09] bg-gradient-to-r from-indigo-500/[0.18] via-[#162033] to-cyan-500/[0.12] px-5 py-4">
          <div className="mt-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl border border-indigo-300/35 bg-indigo-400/15 text-indigo-200 shadow-[0_0_24px_rgba(129,140,248,.28)]" aria-hidden="true">
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 3 4.5 6v5.25c0 4.65 3.18 7.98 7.5 9.75 4.32-1.77 7.5-5.1 7.5-9.75V6L12 3Z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 3h.01" />
            </svg>
          </div>
          <div className="min-w-0">
            <div id="permission-dialog-title" className="text-[15px] font-semibold tracking-tight text-white">Permission required</div>
            <div id="permission-dialog-description" className="mt-1 text-xs leading-5 text-indigo-100/70">
              Infinite AI is ready to use an authorized capability. Review the request before it runs.
            </div>
          </div>
          <span className="ml-auto rounded-full border border-amber-300/25 bg-amber-300/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-amber-200">Approval needed</span>
        </div>

        <div className="space-y-3 bg-[#0d1421] px-5 py-4">
          <div className="flex items-center justify-between gap-3 rounded-xl border border-white/[0.08] bg-[#101c2d] px-3.5 py-3">
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">Requested capability</div>
              <code className="mt-1 block text-sm font-semibold text-cyan-200">{pending.tool}</code>
            </div>
            <div className="h-2 w-2 rounded-full bg-cyan-300 shadow-[0_0_14px_rgba(103,232,249,.9)]" aria-hidden="true" />
          </div>
          <div>
            <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">Request details</div>
            <pre className="max-h-52 overflow-y-auto rounded-xl border border-white/[0.08] bg-[#080d16] p-3 text-[11px] leading-5 text-slate-200 shadow-inner custom-scrollbar">
              {JSON.stringify(pending.input, null, 2)}
            </pre>
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-white/[0.09] bg-[#111827] px-5 py-4">
          <span className="text-[11px] leading-4 text-slate-400">Allowing grants this request once. You can deny it safely.</span>
          <div className="flex flex-shrink-0 gap-2">
            <button
              onClick={() => respond(false)}
              className="rounded-xl border border-white/[0.12] bg-[#0b111c] px-4 py-2 text-xs font-semibold text-slate-300 transition hover:border-red-300/35 hover:bg-red-400/10 hover:text-red-100 focus:outline-none focus:ring-2 focus:ring-red-300/50"
            >
              Deny
            </button>
            <button
              onClick={() => respond(true)}
              className="rounded-xl border border-indigo-300/45 bg-gradient-to-r from-indigo-500 to-cyan-500 px-4 py-2 text-xs font-semibold text-white shadow-[0_0_24px_rgba(99,102,241,.35)] transition hover:from-indigo-400 hover:to-cyan-400 focus:outline-none focus:ring-2 focus:ring-cyan-200/70"
            >
              Allow once
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

