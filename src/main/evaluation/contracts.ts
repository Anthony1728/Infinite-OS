/**
 * Task-completion evaluation contracts.
 *
 * An evaluation is only meaningful if "done" is defined before the agent runs
 * and checked by something other than the agent's own summary. Every check here
 * reads the real workspace (file bytes, JSON values, command exit codes).
 */

export interface EvalSeedFile {
  /** Workspace-relative path. Absolute paths and `..` escapes are rejected. */
  path: string;
  content: string;
}

export type EvalCheck =
  | { id: string; type: 'file_exists'; path: string; description?: string }
  | { id: string; type: 'file_absent'; path: string; description?: string }
  | { id: string; type: 'file_contains'; path: string; text: string; caseSensitive?: boolean; description?: string }
  | { id: string; type: 'file_not_contains'; path: string; text: string; caseSensitive?: boolean; description?: string }
  | { id: string; type: 'file_matches'; path: string; pattern: string; flags?: string; description?: string }
  | { id: string; type: 'json_path_equals'; path: string; jsonPath: string; equals: unknown; description?: string }
  | {
      id: string;
      type: 'command';
      command: string;
      expectExitCode?: number;
      stdoutContains?: string;
      timeoutMs?: number;
      description?: string;
    };

export interface EvalTask {
  id: string;
  name: string;
  description: string;
  prompt: string;
  seedFiles: EvalSeedFile[];
  checks: EvalCheck[];
  /** Wall-clock ceiling for the agent run. Default 5 minutes. */
  timeoutMs?: number;
  /** Turn ceiling for the agent run. Default 12. */
  maxTurns?: number;
}

export interface EvalRunnerContext {
  workspace: string;
  provider: string;
  model: string;
  signal: AbortSignal;
  /** Progress line for the CLI/UI. Never used for scoring. */
  onProgress?: (message: string) => void;
}

export interface EvalRunnerResult {
  /** The agent loop reported a clean terminal `done`. Advisory only — task
   *  status is decided by checks, not by this flag. */
  success: boolean;
  output: string;
  error?: string;
}

export type EvalRunner = (task: EvalTask, context: EvalRunnerContext) => Promise<EvalRunnerResult>

export type EvalTaskStatus = 'passed' | 'failed' | 'error' | 'skipped';

export interface EvalCheckResult {
  checkId: string;
  type: EvalCheck['type'];
  ok: boolean;
  detail: string;
  durationMs: number;
}

export interface EvalTaskResult {
  taskId: string;
  taskName: string;
  status: EvalTaskStatus;
  runnerSuccess: boolean;
  runnerError?: string;
  output: string;
  checks: EvalCheckResult[];
  startedAt: number;
  finishedAt: number;
  durationMs: number;
  workspace: string;
}

export interface EvalReportCounts {
  passed: number;
  failed: number;
  errored: number;
  skipped: number;
}

export interface EvalReport {
  version: 1;
  id: string;
  suiteId: string;
  provider: string;
  model: string;
  startedAt: number;
  finishedAt: number;
  durationMs: number;
  overall: 'passed' | 'failed';
  counts: EvalReportCounts;
  tasks: EvalTaskResult[];
}

export interface EvalReportSummary {
  id: string;
  suiteId: string;
  provider: string;
  model: string;
  startedAt: number;
  durationMs: number;
  overall: 'passed' | 'failed';
  counts: EvalReportCounts;
}

export function summarizeReport(report: EvalReport): EvalReportSummary {
  return {
    id: report.id,
    suiteId: report.suiteId,
    provider: report.provider,
    model: report.model,
    startedAt: report.startedAt,
    durationMs: report.durationMs,
    overall: report.overall,
    counts: report.counts,
  };
}

export function countTasks(tasks: EvalTaskResult[]): EvalReportCounts {
  return {
    passed: tasks.filter((task) => task.status === 'passed').length,
    failed: tasks.filter((task) => task.status === 'failed').length,
    errored: tasks.filter((task) => task.status === 'error').length,
    skipped: tasks.filter((task) => task.status === 'skipped').length,
  };
}
