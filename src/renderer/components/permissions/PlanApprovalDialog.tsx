import { useChatStore } from '../../stores/chat';

// Plan approval dialog — rendered when the agent calls ExitPlan in plan mode.
// Approve lifts the read-only gate and the same run executes the plan; Decline
// sends the decision back so the model refines it. Mirrors the PermissionDialog
// visual language so the two approval surfaces feel like one system.
export function PlanApprovalDialog() {
  const approval = useChatStore((s) => s.planApproval);
  const resolvePlan = useChatStore((s) => s.resolvePlan);
  if (!approval) return null;

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/80 p-4 backdrop-blur-md"
      role="dialog"
      aria-modal="true"
      aria-labelledby="plan-approval-title"
      aria-describedby="plan-approval-description"
    >
      <div className="pointer-events-none absolute h-80 w-80 rounded-full bg-cyan-500/20 blur-[100px]" aria-hidden="true" />
      <div className="relative flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-cyan-300/40 bg-[#111827] shadow-[0_0_0_1px_rgba(103,232,249,.16),0_24px_80px_rgba(0,0,0,.65),0_0_70px_rgba(34,211,238,.22)]">
        <div className="flex items-start gap-3 border-b border-white/[0.09] bg-gradient-to-r from-cyan-500/[0.18] via-[#162033] to-indigo-500/[0.12] px-5 py-4">
          <div className="mt-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl border border-cyan-300/35 bg-cyan-400/15 text-cyan-200 shadow-[0_0_24px_rgba(103,232,249,.28)]" aria-hidden="true">
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5.6L19 9.4V19a2 2 0 0 1-2 2Z" />
            </svg>
          </div>
          <div className="min-w-0">
            <div id="plan-approval-title" className="text-[15px] font-semibold tracking-tight text-white">Plan ready for approval</div>
            <div id="plan-approval-description" className="mt-1 text-xs leading-5 text-cyan-100/70">
              Infinite AI finished researching in read-only plan mode. Approving ends the read-only phase and executes this plan with full tools.
            </div>
          </div>
          <span className="ml-auto rounded-full border border-cyan-300/25 bg-cyan-300/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-cyan-200">Plan mode</span>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto bg-[#0d1421] px-5 py-4">
          <pre className="whitespace-pre-wrap break-words rounded-xl border border-white/[0.08] bg-[#101c2d] px-4 py-3 font-mono text-[13px] leading-6 text-slate-200">{approval.plan}</pre>
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-white/[0.09] bg-[#101828] px-5 py-3.5">
          <button
            type="button"
            onClick={() => resolvePlan(false)}
            className="rounded-xl border border-white/[0.12] bg-white/[0.04] px-4 py-2 text-sm font-medium text-slate-300 transition hover:bg-white/[0.08]"
          >
            Decline — refine the plan
          </button>
          <button
            type="button"
            onClick={() => resolvePlan(true)}
            className="rounded-xl border border-cyan-300/40 bg-cyan-500/20 px-4 py-2 text-sm font-semibold text-cyan-100 shadow-[0_0_18px_rgba(103,232,249,.25)] transition hover:bg-cyan-500/30"
          >
            Approve plan &amp; execute
          </button>
        </div>
      </div>
    </div>
  );
}
