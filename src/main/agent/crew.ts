// CrewForge — multi-agent crew orchestration with automatic multi-model
// assignment.
//
// The user's selected model is the LEADER. For hard projects the leader
// recruits a crew: specialists (coder, designer, researcher, data, seo, ...)
// drawn from the agent roster, each assigned a model picked from every
// provider the user has an API key for (OpenRouter + NVIDIA + Groq + ...) or
// from the same provider's other models. If a member cannot function with
// its assigned model (credential/auth/model errors), the crew degrades
// gracefully: retry with the leader model, then drop the member. If the
// whole crew collapses, it falls back to a single-model run (leader only)
// and keeps going. The leader always integrates and delivers.

import { v4 as uuid } from 'uuid';
import type { AgentId, AgentEvent } from '../agents/types.js';
import { spawnSubagent } from './runtime.js';
import { providerRegistry } from '../providers/registry.js';
import type { Message } from '../../shared/types.js';

export interface CrewAssignment {
  provider: string;
  model: string;
  free: boolean;
}

export interface CrewMember {
  id: string;
  agentType: AgentId;
  role: string;            // human label: "Coding Specialist", "Design Lead"...
  description: string;
  assignment: CrewAssignment;
  alternativeAssignments?: CrewAssignment[]; // degrade ladder
  status: 'standby' | 'running' | 'completed' | 'failed' | 'skipped';
  result?: string;
  error?: string;
  toolCallCount: number;
  startedAt?: number;
  completedAt?: number;
}

export interface CrewPlan {
  leader: CrewAssignment;
  members: CrewMember[];
  strategy: 'full-crew' | 'paired' | 'single';
  reasons: string[];
}

export interface CrewRun {
  id: string;
  originalPrompt: string;
  plan: CrewPlan;
  status: 'planning' | 'running' | 'completed' | 'failed' | 'cancelled';
  startedAt: number;
  completedAt?: number;
  sessionId?: string;
  cwd?: string;
  report?: {
    summary: string;
    leaderResult: string;
    memberReports: Array<{ role: string; agentType: string; provider: string; model: string; result?: string }>;
    fallbacks: string[];
    unresolved: string[];
  };
}

export interface CrewEvent {
  type:
    | 'crew_planned'
    | 'crew_member_started'
    | 'crew_member_progress'
    | 'crew_member_delta'
    | 'crew_member_completed'
    | 'crew_member_failed'
    | 'crew_member_retrying'
    | 'leader_started'
    | 'leader_completed'
    | 'crew_completed'
    | 'crew_failed'
    | 'crew_degraded'
    | 'welcome';
  runId: string;
  data: unknown;
}

type EventSink = (e: CrewEvent) => void;

interface ProviderAvailability {
  apiKey?: string;
  baseUrl?: string;
}

const runs = new Map<string, CrewRun>();

// ── Model inventory ────────────────────────────────────────────────────────
// Which model families are good at what, so we can auto-pick per member.
type TaskKind = 'code' | 'design' | 'research' | 'data' | 'seo' | 'general' | 'writer';

const MODEL_FIT: Record<TaskKind, (model: string, label: string) => boolean> = {
  code: (m, l) => /coder|code|deepseek|r1|qwq|codex|dev|qwen2\.5-coder/i.test(m + ' ' + l),
  design: (m, l) => /design|imagen|sdxl|midjourney|draw|flux|visual/i.test(m + ' ' + l),
  research: (m, l) => /research|r1|deepseek|70b|reason|think|context/i.test(m + ' ' + l),
  data: (m, l) => /data|sql|db|analytics|snowflake|tabular/i.test(m + ' ' + l),
  seo: (m, l) => /seo|marketing|copy|content/i.test(m + ' ' + l),
  writer: (m, l) => /writer|claude|opus|sonnet|gpt-4o|qwen|70b|72b/i.test(m + ' ' + l),
  general: () => true,
};

// Agent type -> what that specialist needs
const AGENT_KIND: Record<string, TaskKind> = {
  code: 'code', mobile: 'code', aieng: 'code', architect: 'code',
  design: 'design', creator: 'design',
  research: 'research', student: 'research',
  data: 'data', finance: 'data', business: 'data',
  seo: 'seo', marketing: 'seo',
  writer: 'writer',
  tester: 'code',
  security: 'code', devops: 'code',
  automation: 'code',
};

const AGENT_ROLE: Record<string, { role: string; description: string }> = {
  code: { role: 'Coding Specialist', description: 'Implements, edits and verifies code (react, ts, py, files, tests).' },
  design: { role: 'Design Lead', description: 'Produces the visual layer: UI, layouts, styles, branding decisions.' },
  research: { role: 'Research Analyst', description: 'Gathers facts, sources, and evidence for the task.' },
  data: { role: 'Data Analyst', description: 'Crunch numbers, exports, tables, and structured analysis.' },
  seo: { role: 'Growth Specialist', description: 'Copy, content, keywords, and conversion-focused writing.' },
  writer: { role: 'Content Writer', description: 'Drafts quality narrative text and final copy.' },
  tester: { role: 'QA Tester', description: 'Validates the work, runs checks, and reports defects.' },
  security: { role: 'Security Auditor', description: 'Reviews for security and correctness issues.' },
  devops: { role: 'DevOps Engineer', description: 'Build, ship, deploy; environment and tooling.' },
  automation: { role: 'Automation Engineer', description: 'Writes automations, scripts, and pipelines.' },
  architecture: { role: 'Architect', description: 'Designs the system structure and integration plan.' },
  general: { role: 'General Specialist', description: 'Flexible support across any domain.' },
};

// ── Provider/key discovery ────────────────────────────────────────────────

function scoreModel(kind: TaskKind, m: { id: string; label: string; free: boolean; supportsTools: boolean }, wantTools: boolean): number {
  let score = 0;
  const combined = (m.id + ' ' + m.label).toLowerCase();
  // Base fitness: does this model match the task kind?
  if (MODEL_FIT[kind](m.id, m.label)) score += 10;
  // Tool support: critical for code/devops/automation tasks
  if (wantTools && m.supportsTools) score += 4;
  // Free tier bonus: prefer free models when possible
  if (m.free) score += 2;
  // Model size: larger models are generally better
  if (/100b|120b|180b|405b/.test(combined)) score += 4;
  else if (/70b|72b|80b|90b/.test(combined)) score += 3;
  else if (/30b|34b|32b|13b/.test(combined)) score += 1;
  // Model family bonuses: known strong families
  if (/claude|opus|sonnet/.test(combined)) score += 3;
  if (/gpt-4o|o1|o3/.test(combined)) score += 3;
  if (/deepseek|r1|qwq/.test(combined)) score += 2;
  if (/qwen|llama/.test(combined)) score += 1;
  // Penalty for very small models (unlikely to handle complex tasks)
  if (/8b|7b|3b|1b|mini/.test(combined)) score -= 2;
  return score;
}

// Pick one assignment for a member from the provider pool, preferring the
// leader's provider when the fit is equal, then any other provider with the
// best fitting model. Never picks the exact leader model unless nothing else
// fits (that member then becomes "redundant" and is dropped for efficiency).
function pickAssignment(
  kind: TaskKind,
  wantTools: boolean,
  pool: Array<{ provider: string; models: Array<{ id: string; label: string; free: boolean; supportsTools: boolean }> }>,
  leader: CrewAssignment,
  excluded: Set<string>,
): { assignment: CrewAssignment; alternatives: CrewAssignment[] } | null {
  const scored: Array<{ provider: string; model: string; free: boolean; score: number }> = [];
  for (const entry of pool) {
    for (const m of entry.models) {
      const key = `${entry.provider}/${m.id}`;
      if (excluded.has(key)) continue;
      const score = scoreModel(kind, m, wantTools) + (entry.provider === leader.provider ? 1 : 0);
      if (score >= 2) scored.push({ provider: entry.provider, model: m.id, free: m.free, score });
    }
  }
  if (!scored.length) return null;
  scored.sort((a, b) => b.score - a.score);
  const choices = scored.slice(0, 3);
  const [primary, ...alts] = choices;
  return {
    assignment: { provider: primary.provider, model: primary.model, free: primary.free },
    alternatives: alts.map((a) => ({ provider: a.provider, model: a.model, free: a.free })),
  };
}

// ── Crew planning ─────────────────────────────────────────────────────────

export function buildCrewPlan(
  prompt: string,
  leader: CrewAssignment,
  available: Map<string, ProviderAvailability>,
  forceMembers?: AgentId[],
  forcePair?: { provider: string; model: string },
): CrewPlan {
  const reasons: string[] = [];
  const taskText = prompt.toLowerCase();
  const pool = collectProviderPoolSync(available, leader);

  // Decide which specialists the job actually needs.
  const wanted = new Map<string, TaskKind>();
  if (forceMembers?.length) {
    for (const a of forceMembers) wanted.set(a, AGENT_KIND[a] ?? 'general');
  } else {
    if (/\b(build|create|make|implement|code|coding|program|app|website|frontend|backend|api|database|script|repo|plugin|extension|electron)\b/.test(taskText)) {
      wanted.set('code', 'code');
      reasons.push('Coding work detected');
    }
    if (/\b(design|ui|ux|theme|aesthetic|look|style|beautiful|layout|mockup|branding|icon|logo)\b/.test(taskText)) {
      wanted.set('design', 'design');
      reasons.push('Design work detected');
    }
    if (/\b(research|sources|facts|evidence|investigate|compare|market|analyze|stocks|deep dive)\b/.test(taskText)) {
      wanted.set('research', 'research');
      reasons.push('Research work detected');
    }
    if (/\b(data|excel|csv|export|table|chart|report|numbers|metric|crm|sales)\b/.test(taskText)) {
      wanted.set('data', 'data');
      reasons.push('Data work detected');
    }
    if (/\b(seo|marketing|copy|content|landing page copy|blog|post|email blast)\b/.test(taskText)) {
      wanted.set('seo', 'seo');
      reasons.push('Marketing/copy work detected');
    }
    if (/\b(write|draft|document|article|essay|story|script for |txt|md)\b/.test(taskText)) {
      wanted.set('writer', 'writer');
      reasons.push('Writing work detected');
    }
    if (/\b(tests?|test this|qa|verify|validate|check quality)\b/.test(taskText)) {
      wanted.set('tester', 'code');
      reasons.push('Verification work detected');
    }
    if (/\b(deploy|ship|release|container|docker|server|host|cicd|pipeline)\b/.test(taskText)) {
      wanted.set('devops', 'code');
      reasons.push('DevOps work detected');
    }
    if (/\b(automate|automation|schedule|script|workflow)\b/.test(taskText)) {
      wanted.set('automation', 'code');
      reasons.push('Automation work detected');
    }
  }

  // Strategy: respect difficulty. Short requests run single (leader only is
  // handled by the caller). Medium → paired with the one best specialist.
  // Heuristic complexity: word count + number of wanted roles.
  const words = prompt.split(/\s+/).length;
  const multiRole = wanted.size;
  let strategy: CrewPlan['strategy'] = 'single';
  if (multiRole >= 3 || words > 300) strategy = 'full-crew';
  else if (multiRole >= 2 || words > 140) strategy = 'paired';
  if (wanted.size === 0) strategy = 'single';
  reasons.push(`Complexity ${words} words × ${multiRole} role(s) → ${strategy}`);

  // Cap crew size for stability; a small focus team beats a mob.
  const MAX_MEMBERS = strategy === 'full-crew' ? 4 : 1;
  const members: CrewMember[] = [];
  const excluded = new Set<string>();

  // User-pinned pair model — ALWAYS joins (their explicit pick), and it
  // occupies the first roster slot as the "collaborator".
  if (forcePair?.provider && forcePair?.model) {
    const isLeaderModel = forcePair.provider === leader.provider && forcePair.model === leader.model;
    if (!isLeaderModel) {
      members.push({
        id: uuid(),
        agentType: 'general',
        role: 'Collaborator',
        description: 'Works alongside the leader on the same project from a second model\'s perspective: cross-checks, extends and refines the work.',
        assignment: { provider: forcePair.provider, model: forcePair.model, free: false },
        alternativeAssignments: [],
        status: 'standby',
        toolCallCount: 0,
      });
      excluded.add(`${forcePair.provider}/${forcePair.model}`);
      reasons.push(`User-paired model: ${forcePair.provider}/${forcePair.model} (Collaborator)`);
    } else {
      reasons.push('Paired model equals the leader model; skipping duplicate.');
    }
  }

  for (const [agentId, kind] of wanted) {
    if (members.length >= MAX_MEMBERS + (forcePair ? 1 : 0)) {
      reasons.push(`Capped crew at ${MAX_MEMBERS} specialists`);
      break;
    }
    const wantTools = agentId !== 'research' && agentId !== 'writer' && agentId !== 'seo';
    const picked = pickAssignment(kind, wantTools, pool, leader, excluded);
    if (!picked) {
      reasons.push(`No distinct model for ${agentId}; skipping (leader will cover)`);
      continue;
    }
    excluded.add(`${picked.assignment.provider}/${picked.assignment.model}`);
    const info = AGENT_ROLE[agentId] ?? AGENT_ROLE.general;
    members.push({
      id: uuid(),
      agentType: agentId,
      role: info.role,
      description: info.description,
      assignment: picked.assignment,
      alternativeAssignments: picked.alternatives,
      status: 'standby',
      toolCallCount: 0,
    });
    reasons.push(`${info.role} → ${picked.assignment.provider}/${picked.assignment.model}`);
  }

  return { leader, members, strategy, reasons };
}

function collectProviderPoolSync(
  available: Map<string, ProviderAvailability>,
  leader: CrewAssignment,
): Array<{ provider: string; models: Array<{ id: string; label: string; free: boolean; supportsTools: boolean }> }> {
  const out: Array<{ provider: string; models: Array<{ id: string; label: string; free: boolean; supportsTools: boolean }> }> = [];
  for (const [pid] of available) {
    const adapter = providerRegistry[pid];
    if (!adapter) continue;
    const models: Array<{ id: string; label: string; free: boolean; supportsTools: boolean }> = [];
    for (const m of adapter.freeModels ?? []) {
      models.push({ id: m.id, label: m.label ?? m.id, free: true, supportsTools: m.supports_tools !== false });
    }
    if (adapter.defaultModel) {
      models.push({ id: adapter.defaultModel, label: adapter.defaultModel, free: false, supportsTools: true });
    }
    if (models.length) out.push({ provider: pid, models });
  }
  out.sort((a, b) => (a.provider === leader.provider ? -1 : 0) - (b.provider === leader.provider ? -1 : 0));
  return out;
}

// ── Crew execution ────────────────────────────────────────────────────────

export async function runCrew(
  plan: CrewPlan,
  opts: {
    prompt: string;
    sessionId: string;
    cwd: string;
    parentHistory: Message[];
    sink: EventSink;
  },
): Promise<CrewRun> {
  const run: CrewRun = {
    id: uuid(),
    originalPrompt: opts.prompt,
    plan,
    status: 'running',
    startedAt: Date.now(),
    sessionId: opts.sessionId,
    cwd: opts.cwd,
  };

  const event = (e: CrewEvent) => opts.sink(e);
  const strategy = plan.strategy;
  const fallbacks: string[] = [];
  const unresolved: string[] = [];

  if (plan.members.length > 0) {
    event({ type: 'crew_planned', runId: run.id, data: plan });

    // Crew welcome — introduces the team
    const leaderModel = plan.leader?.model || 'default model';
    const memberList = plan.members.map(m => `${m.role} (${m.assignment.model})`).join(', ');
    event({
      type: 'welcome',
      runId: run.id,
      data: {
        agentName: 'Crew',
        role: `Team of ${plan.members.length} specialists`,
        model: leaderModel,
        message: `Your crew is assembled: ${leaderModel} leads, with ${memberList}. Beginning work.`,
      },
    });
  } else {
    fallbacks.push('No specialists assigned — leader handles everything directly.');
  }

  // Phase 1 — members run (sequentially: stable, single-provider friendly).
  const results: Array<{ role: string; agentType: string; provider: string; model: string; result?: string }> = [];

  async function runOne(member: CrewMember): Promise<void> {
    member.status = 'running';
    member.startedAt = Date.now();
    event({ type: 'crew_member_started', runId: run.id, data: member });

    const baseTask = `Work independently on your part of the project. You are one member of a crew led by the user's chosen model.\n\nPROJECT:\n${opts.prompt}\n\nYOUR ROLE: ${member.role} — ${member.description}\n\nProduce a complete, production-grade artifact for your role. You may read files, write files, create designs, or return text — whatever your role requires. When done, reply with a concise summary of exactly what you produced (file paths, key decisions). The leader will integrate your work.`;
    const retryChain = [member.assignment, ...(member.alternativeAssignments ?? [])];
    let lastError = '';

    for (let i = 0; i < retryChain.length; i++) {
      const ass = retryChain[i];
      if (i > 0) {
        fallbacks.push(`${member.role}: retrying with ${ass.provider}/${ass.model} after "${lastError.slice(0, 120)}"`);
        event({ type: 'crew_member_retrying', runId: run.id, data: { memberId: member.id, reason: lastError, assignment: ass } });
      }
      try {
        const spawned = spawnSubagent({
          agentId: member.agentType,
          task: baseTask,
          sessionId: opts.sessionId,
          cwd: opts.cwd,
          provider: ass.provider,
          model: ass.model,
          parentHistory: opts.parentHistory,
          background: false,
          retry: { maxAttempts: 2, backoff: true },
          sink: (ev: AgentEvent) => {
            // Stream the member's text live so the pair panel shows BOTH
            // models working — one coherent narrative, not a silent handoff.
            if (ev.type === 'text_delta' && (ev as { text?: unknown }).text) {
              event({
                type: 'crew_member_delta',
                runId: run.id,
                data: { memberId: member.id, text: (ev as { text: string }).text },
              });
            }
            event({
              type: 'crew_member_progress',
              runId: run.id,
              data: { memberId: member.id, agentEvent: ev.type, detail: ev.type === 'fail' ? (ev as { error: string }).error : '' },
            });
          },
        });
        const result = await spawned.done;
        member.result = result;
        member.status = 'completed';
        member.completedAt = Date.now();
        member.assignment = ass;
        event({ type: 'crew_member_completed', runId: run.id, data: member });
        return;
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        if (i === retryChain.length - 1) {
          member.status = 'failed';
          member.error = lastError;
          member.completedAt = Date.now();
          unresolved.push(`${member.role}: ${lastError}`);
          event({ type: 'crew_member_failed', runId: run.id, data: member });
          return;
        }
      }
    }
  }

  try {
    // Always run every recruited member, and run them CONCURRENTLY (cap 2
    // in flight) so the crew finishes fast — sequential execution was the
    // "one after the other, took long" bug. Members are independent by
    // design; the leader integrates at the end.
    const memberQueue = plan.members.map((m) => ({ member: m, started: false }));
    let active = 0;
    let cursor = 0;
    // Simple worker loop: fire up to CONCURRENCY members in parallel.
    const CONCURRENCY = 2;
    await new Promise<void>((resolveAll) => {
      const pump = () => {
        while (active < CONCURRENCY && cursor < memberQueue.length) {
          const item = memberQueue[cursor++];
          active++;
          runOne(item.member)
            .then(() => {
              results.push({
                role: item.member.role,
                agentType: item.member.agentType,
                provider: item.member.assignment.provider,
                model: item.member.assignment.model,
                result: item.member.result,
              });
            })
            .catch((err) => {
              unresolved.push(`${item.member.role}: ${err instanceof Error ? err.message : String(err)}`);
              results.push({
                role: item.member.role,
                agentType: item.member.agentType,
                provider: item.member.assignment.provider,
                model: item.member.assignment.model,
                result: item.member.result,
              });
            })
            .finally(() => {
              active--;
              pump();
            });
        }
        if (active === 0 && cursor >= memberQueue.length) resolveAll();
      };
      pump();
    });
  } catch (err) {
    unresolved.push(String(err));
  }

  // Phase 2 — leader integration (always runs; the leader is the user's model).
  event({ type: 'leader_started', runId: run.id, data: {} });
  const memberReport = results
    .filter((r) => r.result)
    .map((r) => `## ${r.role} (${r.provider}/${r.model})\n${(r.result ?? '').slice(0, 6000)}`)
    .join('\n\n');

  const leaderPrompt = [
    `You are the LEADER of an Infinite OS crew that just finished specialist work.`,
    ``,
    `ORIGINAL REQUEST:`,
    opts.prompt,
    ``,
    memberReport ? `SPECIALIST OUTPUTS:\n${memberReport}` : 'No specialist output was produced — proceed on your own.',
    ``,
    `Your job: review everything the crew produced, integrate it into one coherent, production-grade result that fully satisfies the original request. Fix gaps the specialists missed. Deliver the final answer — the complete implementation, artifact, or report — exactly as the user requested. If specialist output has errors, correct them. Never apologize for using the crew; just deliver.`,
    ``,
    `IMPORTANT: If the crew entirely failed and you are working alone, still complete the request from scratch to the best of your ability.`,
  ].join('\n');

  try {
    const leaderSpawned = spawnSubagent({
      agentId: 'general',
      task: leaderPrompt,
      sessionId: opts.sessionId,
      cwd: opts.cwd,
      provider: plan.leader.provider,
      model: plan.leader.model,
      parentHistory: opts.parentHistory,
      background: false,
      retry: { maxAttempts: 3, backoff: true },
      sink: (ev) => {
        event({
          type: 'crew_member_progress',
          runId: run.id,
          data: { memberId: 'leader', agentEvent: ev.type, detail: (ev as { preview?: string }).preview ?? '' },
        });
      },
    });
    const leaderResult = await leaderSpawned.done;
    event({ type: 'leader_completed', runId: run.id, data: {} });
    run.report = {
      summary: `Crew complete (${strategy}): leader integrated ${results.filter((r) => r.result).length}/${plan.members.length} specialists.`,
      leaderResult,
      memberReports: results,
      fallbacks,
      unresolved,
    };
    run.status = 'completed';
    event({ type: 'crew_completed', runId: run.id, data: run.report });
  } catch (err) {
    run.status = 'failed';
    run.report = {
      summary: `Crew failed: ${err instanceof Error ? err.message : String(err)}`,
      leaderResult: '',
      memberReports: results,
      fallbacks,
      unresolved,
    };
    event({ type: 'crew_failed', runId: run.id, data: run.report });
  }

  run.completedAt = Date.now();
  runs.set(run.id, run);
  return run;
}

export function cancelCrewSession(sessionId: string): number {
  let n = 0;
  for (const run of runs.values()) {
    if (run.sessionId === sessionId && run.status === 'running') {
      run.status = 'failed';
      run.report = { summary: 'Cancelled by user — crew run aborted.', leaderResult: '', memberReports: [], fallbacks: [], unresolved: [] };
      run.completedAt = Date.now();
      n++;
    }
  }
  return n;
}

export function getCrewRun(id: string): CrewRun | undefined {
  return runs.get(id);
}

export function listCrewRuns(): CrewRun[] {
  return Array.from(runs.values()).sort((a, b) => b.startedAt - a.startedAt);
}
