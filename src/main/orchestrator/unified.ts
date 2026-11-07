// Unified orchestrator facade — ONE place to ask "what is the system working
// on right now?" and ONE entry point to delegate an objective.
//
// The three execution surfaces (crews, workers, automations) already share
// the verified-delegation machinery; what they never had is a common status
// shape or a single delegate call. This facade normalizes:
//
//   crew        → agent/crew.ts runCrew (the canonical path — it degrades to
//                 a single agent internally when the objective is small)
//   worker      → workers/manager.ts (persistent recurring tasks; executes
//                 through automationBuilder, which runs verified agent_run)
//   automation  → automation/builder.ts (scheduled/triggered workflows)
//
// Tests inject the listing functions — no singletons are touched.

import { buildCrewPlan, runCrew, listCrewRuns, type CrewRun, type CrewEvent } from '../agent/crew.js';
import type { AgentId } from '../agents/types.js';
import { getWorkerManager, type WorkerView } from '../workers/manager.js';
import { automationBuilder } from '../automation/builder.js';

export type OrchestrationKind = 'crew' | 'worker' | 'automation';

export type OrchestrationStatus =
  | 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'
  | 'paused' | 'scheduled' | 'needs_input' | 'draft' | 'planning';

export interface Orchestration {
  id: string;
  kind: OrchestrationKind;
  name: string;
  status: OrchestrationStatus;
  startedAt: number;
  completedAt?: number;
  /** One-line progress summary (specialists done, step index, …). */
  progress?: string;
  error?: string;
}

type CrewLister = typeof listCrewRuns;
type WorkerLister = () => Array<{ id: string; name: string; status: WorkerView['status']; updatedAt?: number }>;
type AutomationLister = () => Array<{ id: string; workflowId: string; status: string; startedAt: number; completedAt?: number; error?: string }>;
type WorkflowNamer = (workflowId: string) => string | undefined;

/** Map crew run status to the unified shape. */
function crewStatus(run: CrewRun): OrchestrationStatus {
  switch (run.status) {
    case 'planning': return 'planning';
    case 'running': return 'running';
    case 'completed': return 'completed';
    case 'failed': return 'failed';
    case 'cancelled': return 'cancelled';
    default: return 'queued';
  }
}

function crewProgress(run: CrewRun): string {
  const members = run.plan.members;
  if (members.length === 0) return 'leader only';
  const done = members.filter((m) => m.status === 'completed').length;
  const verified = members.filter((m) => m.verification?.verdict === 'pass').length;
  return `${done}/${members.length} specialists done, ${verified} verified`;
}

function workerStatus(status: WorkerView['status']): OrchestrationStatus {
  // WorkerView statuses already live in the unified vocabulary.
  return status;
}

/** Normalize every surface's active-and-recent work into one list. */
export function listOrchestrations(deps?: {
  listCrew?: CrewLister;
  listWorkers?: WorkerLister;
  listAutomationRuns?: AutomationLister;
  workflowName?: WorkflowNamer;
  /** Keep completed crew/automation runs in the output (tests). Production defaults to running-only. */
  includeCompleted?: boolean;
}): Orchestration[] {
  const out: Orchestration[] = [];

  const crewLister = deps?.listCrew ?? listCrewRuns;
  for (const run of crewLister().slice(0, 20)) {
    const status = crewStatus(run);
    if (!deps?.includeCompleted && (status === 'completed' || status === 'failed' || status === 'cancelled')) continue;
    out.push({
      id: run.id,
      kind: 'crew',
      name: run.originalPrompt.slice(0, 80) || 'Crew run',
      status,
      startedAt: run.startedAt,
      ...(run.completedAt ? { completedAt: run.completedAt } : {}),
      progress: crewProgress(run),
      ...(run.report?.unresolved?.length ? { error: run.report.unresolved[0] } : {}),
    });
  }

  const workerLister: WorkerLister = deps?.listWorkers ?? (() => {
    try {
      const manager = getWorkerManager();
      return manager.list().map((w) => ({ id: w.id, name: w.name, status: w.status }));
    } catch {
      return []; // workers not initialized (headless CLI, tests)
    }
  });
  for (const worker of workerLister().slice(0, 50)) {
    const status = workerStatus(worker.status);
    if (!deps?.includeCompleted && status === 'draft') continue;
    out.push({
      id: worker.id,
      kind: 'worker',
      name: worker.name,
      status,
      startedAt: worker.updatedAt ?? 0,
    });
  }

  const automationLister: AutomationLister = deps?.listAutomationRuns ?? (() => automationBuilder.getRuns());
  const namer: WorkflowNamer = deps?.workflowName ?? ((workflowId) => automationBuilder.getWorkflow(workflowId)?.name);
  for (const run of automationLister().slice(0, 20)) {
    const status = run.status as OrchestrationStatus;
    if (!deps?.includeCompleted && (status === 'completed' || status === 'failed' || status === 'cancelled')) continue;
    out.push({
      id: run.id,
      kind: 'automation',
      name: namer(run.workflowId) ?? 'Automation run',
      status,
      startedAt: run.startedAt,
      ...(run.completedAt ? { completedAt: run.completedAt } : {}),
      ...(run.error ? { error: run.error } : {}),
    });
  }

  return out.sort((a, b) => b.startedAt - a.startedAt);
}

export interface OrchestrateOptions {
  sessionId: string;
  cwd: string;
  provider: string;
  model: string;
  parentHistory: import('../../shared/types.js').Message[];
  onEvent: (e: CrewEvent) => void;
  /** Force the crew plan instead of heuristic sizing (tests, pinned teams). */
  forceMembers?: AgentId[];
}

/**
 * Delegate an objective through the canonical path. buildCrewPlan sizes the
 * crew from the objective (single for small, paired/full-crew for complex)
 * and runCrew handles degradation, verified delegation, and leader
 * integration — the facade's job is to be the one call the rest of the app
// (UI, workers, integrations) makes instead of reaching into crew internals.
 */
export async function orchestrateObjective(
  objective: string,
  opts: OrchestrateOptions,
): Promise<CrewRun> {
  const leader = { provider: opts.provider, model: opts.model, free: false };
  const available = new Map<string, { apiKey?: string; baseUrl?: string }>();
  // The leader's own provider is always in the pool; the crew planner fills
  // the rest from the registry at plan time.
  available.set(opts.provider, {});
  const plan = buildCrewPlan(objective, leader, available, opts.forceMembers);
  return runCrew(plan, {
    prompt: objective,
    sessionId: opts.sessionId,
    cwd: opts.cwd,
    parentHistory: opts.parentHistory,
    sink: opts.onEvent,
  });
}

