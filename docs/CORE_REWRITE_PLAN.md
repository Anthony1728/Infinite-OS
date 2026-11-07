# Infinite OS Core Rewrite Plan

Status: proposed architecture and migration plan
Target: 1.x reliability and capability evolution
Baseline: main at 2026-11-07

## Executive decision

Do not replace the Electron/React application or discard the working systems already in the repository. Rewrite the control plane incrementally around one durable task model and one execution lifecycle. Keep the existing provider adapters, tool registry, SQLite memory, browser bridge, PC Live Map, and renderer while moving their orchestration behind explicit contracts.

The current repository already contains substantial capability: provider failover, a real tool loop, delegated acceptance criteria, hybrid memory recall, outcome-derived directives, task continuation, restart resume, automation approvals, and mechanical evaluation. The problem to solve next is integration consistency—not a lack of feature names.

## Target architecture

```text
Renderer / CLI / Phone / Channels
              |
        Application Gateway
              |
      Session + Task Service
              |
      Durable Task State Machine
              |
       Planner / Model Router
              |
       Execution Scheduler
        /       |        \
   Single     Crew     Workflow
   Agent     Agents    Runtime
        \       |        /
       Shared Execution Contract
              |
       Typed Tool Runtime
              |
   Permission + Approval Gate
              |
   Tool Adapters (PC / Browser / Files / Shell / MCP)
              |
       Verification Engine
              |
     Task Result + Event Log
          /           \
  Memory/Learning   UI/Notifications
```

### 1. One task lifecycle

Every user request that requires work becomes a Task, regardless of whether it runs as a single agent, crew, automation, or resumed background run.

Required states:

- `queued`
- `planning`
- `awaiting_approval`
- `ready`
- `running`
- `verifying`
- `completed`
- `failed`
- `cancelled`
- `interrupted`

Transitions must be validated in code. Terminal states are immutable except for an explicit new attempt. A task records its parent, session, workspace, original user intent, current plan revision, timestamps, cancellation state, and verification outcome.

### 2. Durable task event log

Persist state-changing events before publishing them to the renderer. Events should include task creation, plan revision, assignment, tool start/result, approval request/decision, verification, retry, interruption, resume, and terminal outcome.

The event log is the source of truth; in-memory Maps are caches only. On restart, rebuild task projections and resume only tasks whose last durable state permits safe continuation. Do not infer that an external side effect succeeded merely because a tool call was started.

### 3. One execution contract for all agent paths

Crew, orchestrator, automation agent steps, and normal chat tool execution should share a typed execution contract:

- objective and scoped workspace
- acceptance criteria
- allowed capabilities and permission profile
- dependencies and input artifacts
- attempt number and retry budget
- progress events
- output artifacts
- verification evidence
- explicit failure reason

A specialist result is not complete because its text says so. The shared verifier returns `passed`, `failed`, or `not_verifiable`; the leader receives that exact result. Purely subjective work may be not-verifiable by mechanical checks and must not be mislabeled as passed.

### 4. Scheduler instead of polling orchestration

Replace the orchestrator's 100 ms polling loop with event-driven scheduling. The scheduler should:

- start only dependency-ready tasks
- enforce global and per-provider concurrency limits
- prevent conflicting workspace writes
- propagate cancellation to active children
- stop scheduling after cancellation or terminal failure policy
- apply bounded retries with backoff and classified retryability
- detect dependency cycles before execution
- expose deterministic state for tests

The current hard-coded parallel limit of ten should become a validated configuration with conservative defaults and provider-aware limits.

### 5. Verification as a first-class subsystem

Verification should be a typed pipeline, not a final prompt reminder. It should support:

- file/artifact existence and content assertions
- typecheck, lint, unit tests, and build commands
- structured JSON/schema checks
- browser/desktop post-condition checks where supported
- external side-effect confirmation (for example, checking a sent-items view after a send)
- evidence records containing command/action, timestamp, result, and relevant output

No verification evidence means no verified-success label. A tool result can be successful while the overall task remains incomplete.

### 6. Memory and learning boundaries

Keep memory tiers and hybrid retrieval, but distinguish:

- durable user facts/preferences
- project knowledge
- episodic task history
- procedural memories
- agent-specific working context
- learned operating directives

Every memory must have provenance, scope/dataset, confidence, creation/update timestamps, and a deletion/expiry policy where appropriate. Retrieval should be explainable and bounded by the active project/session scope. Contradictory memories should be surfaced for reconciliation rather than silently overwriting each other.

Learning must consume only terminal task outcomes with verification evidence. Benchmark runs and synthetic tests must remain isolated from production memory and provider reliability statistics. A directive should retain the evidence IDs that caused it to be learned and support retirement when later evidence contradicts it.

### 7. Model routing

Separate model capability from model preference. Route based on a capability contract (tool calling, context size, vision, structured output, latency/cost constraints) and task requirements. Provider failover should preserve the requested capability set and report when the fallback is materially weaker. Do not silently substitute a model that cannot execute the required tools.

### 8. Tool and permission boundary

All tool calls pass through one runtime pipeline:

1. validate schema and arguments
2. resolve workspace and capability scope
3. check permission/approval policy
4. execute with timeout and cancellation
5. capture structured result
6. run post-tool hooks and verification triggers
7. append audit/event records

Read-only and mutating tools must be explicitly classified. Parallel execution is permitted only for tools proven safe to run concurrently. Destructive and external side-effect actions need policy-aware confirmation.

## Immediate findings from the current code

1. `TaskOrchestrator.execute` uses a 100 ms polling loop and an in-memory task Map. This is simple but makes durable recovery and deterministic scheduling harder.
2. The orchestrator allows up to ten child tasks concurrently without an obvious provider-specific or workspace-conflict limit.
3. Crew delegation has acceptance criteria and a verification/revision path, while the broader system still has separate orchestration surfaces. The same contract needs to govern every path.
4. The task ledger reconstructs progress from transcript content. It is a valuable recovery fallback, but transcript heuristics should not replace structured tool/task events as the primary source of truth.
5. Hybrid memory and learned directives are meaningful foundations. The next step is provenance, contradiction handling, scope controls, and evidence-linked retirement—not another memory subsystem.
6. The evaluation harness is an important differentiator. Expand it before large migrations so architecture changes are measured against task outcomes rather than subjective ratings.

## Migration sequence

### Phase 0 — Baseline and guardrails
- Capture current main commit and current evaluation matrix.
- Make DB-backed memory tests mandatory in CI on supported Node/Electron ABIs.
- Add tests for cancellation, dependency cycles, duplicate event delivery, process restart, and external side-effect uncertainty.
- Record baseline latency, tool success, verified task completion, recovery success, and cost.

### Phase 1 — Shared contracts
- Add versioned Task, TaskEvent, ExecutionAttempt, Artifact, VerificationEvidence, and Approval types.
- Add transition validation and pure unit tests.
- Adapt existing orchestrator and crew objects through boundary adapters; do not migrate all callers at once.

### Phase 2 — Durable task service
- Persist task snapshots and append-only events in SQLite.
- Make event append idempotent and transactionally update task projections.
- Add restart reconstruction and safe resume policy.
- Keep transcript ledger as a fallback for legacy sessions.

### Phase 3 — Unified scheduler
- Move orchestration to event-driven scheduling.
- Add dependency graph validation, provider-aware concurrency, workspace locks, cancellation propagation, and bounded retry policy.
- Route crew and workflow agent steps through the shared execution contract.

### Phase 4 — Verification engine
- Move verification logic into reusable typed verifiers.
- Require evidence records for verified completion.
- Add post-condition checks for high-value tool side effects.
- Expose verification status and evidence in the UI.

### Phase 5 — Memory and model intelligence
- Add memory provenance and contradiction workflows.
- Link learned directives to evidence and allow confidence decay/retirement.
- Make routing capability-aware and evaluate task-level model selection.

### Phase 6 — Product integration
- Show a unified task timeline across chat, home, automation, crews, and phone companion.
- Make pause, resume, cancel, approve, and inspect actions consistent.
- Add project-level agent profiles and skill selection based on measured task performance.

## Acceptance gates

A phase is not complete because code merged or a score increased. It must pass:

- typecheck, lint, unit/integration tests, and production build
- DB-backed persistence tests without silent skips
- restart/recovery tests with interrupted work
- deterministic cancellation and dependency tests
- benchmark comparisons against the Phase 0 baseline
- no regression in existing browser, desktop, voice, and automation flows

Track at least these metrics:

| Metric | Definition |
|---|---|
| Verified completion rate | Tasks whose acceptance checks pass / tasks attempted |
| False completion rate | Tasks reported complete without passing required checks |
| Recovery success | Interrupted tasks safely resumed and completed / resumable tasks |
| Retry efficiency | Recovered attempts / retry attempts |
| Tool reliability | Successful tool executions / valid tool executions |
| Median completion time | User request to verified terminal result |
| Cost per verified task | Provider cost divided by verified completed tasks |
| Scope drift | Tasks that modify unrelated files or perform unrelated actions |

## Explicit non-goals

- Do not rewrite the UI framework or replace Electron.
- Do not replace every subsystem with a third-party agent framework.
- Do not add more agent roles as a substitute for better orchestration.
- Do not claim self-awareness. Build observable self-modeling, introspection, and evidence-based adaptation.
- Do not optimize the scorecard by weakening tests or counting unverified outputs as successes.

## First implementation slice

Start with Phase 1 and the scheduler boundary:

1. Introduce the shared task contracts and transition validator.
2. Add exhaustive state-transition and dependency-graph tests.
3. Adapt `TaskOrchestrator` to emit/consume those contracts while preserving existing behavior.
4. Move crew and automation paths onto the same adapter only after the first path is green.

This yields a controlled architectural rewrite with measurable checkpoints and keeps the already-working product usable throughout the migration.
