/**
 * Automation Scheduler
 *
 * The missing heartbeat of the automation engine: a periodic tick that fires
 * enabled workflows whose schedule trigger is due, plus idle-time triggers
 * driven by Electron's powerMonitor and an OS-level keep-awake toggle.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { powerMonitor, powerSaveBlocker } from 'electron';
import { nextCronRuns, parseCron } from '../tools/time.js';
import { automationBuilder } from './builder.js';
import type { AutomationRunProgress, Workflow } from './builder.js';

const TICK_MS = 30_000;
// Ignore cron slots older than this on the first tick after boot — prevents a
// workflow disabled for a week from firing the moment the app opens.
const MAX_CATCH_UP_MS = 6 * 60 * 60 * 1000;

interface SchedulerPersistentState {
  keepAwake: boolean;
}

export interface SchedulerStatus {
  running: boolean;
  tickMs: number;
  scheduledWorkflows: number;
  idleWorkflows: number;
  keepAwake: boolean;
}

class AutomationScheduler {
  private timer: NodeJS.Timeout | null = null;
  private lastTickByWorkflow = new Map<string, number>();
  private idleFiredForEpisode = new Set<string>();
  private keepAwakeBlockerId: number | null = null;
  private keepAwakeEnabled = false;
  private broadcast: ((progress: AutomationRunProgress) => void) | null = null;
  private statePath = join(homedir(), '.infinite-ai', 'automation', 'scheduler.json');

  start(broadcast?: (progress: AutomationRunProgress) => void): void {
    if (this.timer) return;
    this.broadcast = broadcast ?? null;
    this.loadState();
    this.applyKeepAwake();

    this.timer = setInterval(() => this.tick(), TICK_MS);
    // First tick shortly after boot so due tasks start without waiting a full interval.
    setTimeout(() => this.tick(), 8_000);
    console.log('[scheduler] started (tick every 30s)');
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.keepAwakeBlockerId !== null && powerSaveBlocker.isStarted(this.keepAwakeBlockerId)) {
      powerSaveBlocker.stop(this.keepAwakeBlockerId);
    }
    this.keepAwakeBlockerId = null;
    console.log('[scheduler] stopped');
  }

  getStatus(): SchedulerStatus {
    const workflows = automationBuilder.listWorkflows();
    const schedulable = (w: Workflow) =>
      ['schedule', 'cron', 'interval', 'once'].includes(w.trigger?.type ?? '');
    return {
      running: this.timer !== null,
      tickMs: TICK_MS,
      scheduledWorkflows: workflows.filter((w) => w.enabled && schedulable(w)).length,
      idleWorkflows: workflows.filter((w) => w.enabled && w.trigger?.type === 'idle').length,
      keepAwake: this.isKeepAwakeActive(),
    };
  }

  setKeepAwake(enabled: boolean): SchedulerStatus {
    this.keepAwakeEnabled = enabled;
    this.saveState();
    this.applyKeepAwake();
    return this.getStatus();
  }

  /** Next fire time (ISO string) for a schedulable workflow, or null. */
  nextRunFor(workflow: Workflow): string | null {
    if (!workflow.enabled || workflow.status === 'running') return null;
    const type = workflow.trigger?.type;
    if (type === 'schedule' || type === 'cron') {
      const cron = workflow.trigger.config?.cron;
      if (typeof cron !== 'string') return null;
      try {
        const [next] = nextCronRuns(parseCron(cron), new Date(), 1);
        return next ?? null;
      } catch {
        return null;
      }
    }
    if (type === 'interval') {
      const intervalMs = Number(workflow.trigger.config?.intervalMs);
      if (!Number.isFinite(intervalMs) || intervalMs < 60_000) return null;
      const base = Math.max(workflow.lastRun ?? Date.now(), Date.now());
      return new Date(base + intervalMs).toISOString();
    }
    if (type === 'once') {
      const at = Date.parse(String(workflow.trigger.config?.onceAt ?? ''));
      if (!Number.isFinite(at)) return null;
      return workflow.lastRun === undefined && at > Date.now() ? new Date(at).toISOString() : null;
    }
    return null;
  }

  isKeepAwakeActive(): boolean {
    return (
      this.keepAwakeEnabled &&
      this.keepAwakeBlockerId !== null &&
      powerSaveBlocker.isStarted(this.keepAwakeBlockerId)
    );
  }

  private applyKeepAwake(): void {
    const shouldRun = this.keepAwakeEnabled && this.timer !== null;
    if (shouldRun && this.keepAwakeBlockerId === null) {
      this.keepAwakeBlockerId = powerSaveBlocker.start('prevent-display-sleep');
      console.log(`[scheduler] keep-awake ON (blocker ${this.keepAwakeBlockerId})`);
    } else if (!shouldRun && this.keepAwakeBlockerId !== null) {
      if (powerSaveBlocker.isStarted(this.keepAwakeBlockerId)) powerSaveBlocker.stop(this.keepAwakeBlockerId);
      console.log('[scheduler] keep-awake OFF');
      this.keepAwakeBlockerId = null;
    }
  }

  private loadState(): void {
    try {
      if (existsSync(this.statePath)) {
        const state = JSON.parse(readFileSync(this.statePath, 'utf-8')) as SchedulerPersistentState;
        this.keepAwakeEnabled = state.keepAwake === true;
      }
    } catch {
      /* corrupted state falls back to defaults */
    }
  }

  private saveState(): void {
    try {
      mkdirSync(join(homedir(), '.infinite-ai', 'automation'), { recursive: true });
      writeFileSync(
        this.statePath,
        JSON.stringify({ keepAwake: this.keepAwakeEnabled } satisfies SchedulerPersistentState, null, 2),
      );
    } catch {
      /* silent */
    }
  }

  tick(): void {
    const now = Date.now();
    let workflows: Workflow[] = [];
    try {
      workflows = automationBuilder.listWorkflows();
    } catch (err) {
      console.error('[scheduler] tick failed to list workflows:', err);
      return;
    }

    for (const wf of workflows) {
      if (!wf.enabled || wf.status === 'running') continue;
      try {
        switch (wf.trigger?.type) {
          case 'schedule':
          case 'cron':
            this.tickSchedule(wf, now);
            break;
          case 'interval':
            this.tickInterval(wf, now);
            break;
          case 'once':
            this.tickOnce(wf, now);
            break;
          case 'idle':
            this.tickIdle(wf);
            break;
          default:
            break;
        }
      } catch (err) {
        console.error(`[scheduler] error evaluating "${wf.name}":`, err);
      }
      this.lastTickByWorkflow.set(wf.id, now);
    }
  }

  private tickSchedule(wf: Workflow, now: number): void {
    const cron = wf.trigger.config?.cron;
    if (typeof cron !== 'string') return;

    const from = this.lastTickByWorkflow.get(wf.id);
    if (from === undefined) return; // first sighting: establish baseline, don't backfill
    if (now - from > MAX_CATCH_UP_MS) return; // stale window (sleep/disable gap): skip

    const runs = nextCronRuns(parseCron(cron), new Date(from), 1);
    if (runs.length === 0) return;
    if (new Date(runs[0]).getTime() <= now) {
      console.log(`[scheduler] firing scheduled workflow "${wf.name}" (${cron})`);
      this.fire(wf);
    }
  }

  private tickInterval(wf: Workflow, now: number): void {
    const intervalMs = Number(wf.trigger.config?.intervalMs);
    if (!Number.isFinite(intervalMs) || intervalMs < 60_000) return;
    const baseline = wf.lastRun ?? this.lastTickByWorkflow.get(wf.id) ?? now;
    if (now - baseline >= intervalMs) {
      console.log(`[scheduler] firing interval workflow "${wf.name}" (every ${Math.round(intervalMs / 60000)}m)`);
      this.fire(wf);
    }
  }

  private tickOnce(wf: Workflow, now: number): void {
    const onceAt = Date.parse(String(wf.trigger.config?.onceAt ?? ''));
    if (!Number.isFinite(onceAt) || onceAt > now || wf.lastRun !== undefined) return;
    console.log(`[scheduler] firing one-shot workflow "${wf.name}"`);
    // One-shot semantics: run once, then disable so it never repeats.
    automationBuilder.disableWorkflow(wf.id);
    this.fire(wf);
  }

  private tickIdle(wf: Workflow): void {
    const minutes = Number(wf.trigger.config?.idleMinutes);
    const thresholdMs = (Number.isFinite(minutes) && minutes > 0 ? minutes : 10) * 60_000;
    const idleMs = powerMonitor.getSystemIdleTime() * 1000;

    if (idleMs >= thresholdMs) {
      if (!this.idleFiredForEpisode.has(wf.id)) {
        this.idleFiredForEpisode.add(wf.id);
        console.log(`[scheduler] firing idle workflow "${wf.name}" (${Math.round(idleMs / 60000)}m idle)`);
        this.fire(wf);
      }
    } else if (idleMs < thresholdMs / 2) {
      this.idleFiredForEpisode.delete(wf.id); // user returned; re-arm for the next idle episode
    }
  }

  private fire(wf: Workflow): void {
    void automationBuilder
      .runWorkflow(wf.id, (progress) => this.broadcast?.(progress))
      .catch((err) => console.error(`[scheduler] run "${wf.name}" failed:`, err));
  }
}

export const automationScheduler = new AutomationScheduler();
