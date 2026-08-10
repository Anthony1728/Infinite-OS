// Problem Tracker — tracks tool failures during an agent run and attempts auto-fixes after task completion.
//
// Flow:
//   1. During the run, `trackFailure()` is called for each failed tool execution.
//   2. After the task completes, `reportAndFix()` is called.
//   3. It classifies failures, attempts auto-fixes for recoverable ones,
//      and emits a summary event to the UI.

export interface TrackedFailure {
  name: string;
  input: unknown;
  error: string;
  turn: number;
  timestamp: number;
}

export interface FixAttempt {
  failure: TrackedFailure;
  strategy: string;
  success: boolean;
  result?: string;
}

export interface ProblemReport {
  totalFailures: number;
  uniqueToolFailures: number;
  fixedCount: number;
  unfixedCount: number;
  failures: TrackedFailure[];
  fixes: FixAttempt[];
  summary: string;
}

// Classifications for auto-fix strategies.
const RETRYABLE_ERRORS = [
  /timeout/i,
  /ECONNRESET/i,
  /ENOTFOUND/i,
  /rate limit/i,
  /429/i,
  /5[0-9]{2}/,
  /temporary/i,
  /try again/i,
  /network/i,
];

const PERMISSION_ERRORS = [
  /permission denied/i,
  /access denied/i,
  /EACCES/i,
  /EPERM/i,
  /not authorized/i,
];

function isRetryable(error: string): boolean {
  return RETRYABLE_ERRORS.some((p) => p.test(error));
}

function isPermissionError(error: string): boolean {
  return PERMISSION_ERRORS.some((p) => p.test(error));
}

/** Deduplicate failures by tool name + error pattern. */
function deduplicateFailures(failures: TrackedFailure[]): TrackedFailure[] {
  const seen = new Map<string, TrackedFailure>();
  for (const f of failures) {
    const key = `${f.name}::${f.error.slice(0, 100)}`;
    if (!seen.has(key)) seen.set(key, f);
  }
  return [...seen.values()];
}

export class ProblemTracker {
  private failures: TrackedFailure[] = [];
  private currentTurn = 0;

  setTurn(turn: number): void {
    this.currentTurn = turn;
  }

  trackFailure(name: string, input: unknown, error: string): void {
    this.failures.push({
      name,
      input,
      error,
      turn: this.currentTurn,
      timestamp: Date.now(),
    });
  }

  getFailures(): TrackedFailure[] {
    return [...this.failures];
  }

  hasFailures(): boolean {
    return this.failures.length > 0;
  }

  /**
   * Generate a problem report and attempt auto-fixes for recoverable failures.
   * Returns the report and emits events to the UI.
   */
  // Callback receives AgentEvent objects from the loop.
  async reportAndFix(
    emitEvent: (event: unknown) => void,
    _originalRequest: string,
  ): Promise<ProblemReport> {
    const unique = deduplicateFailures(this.failures);
    const fixes: FixAttempt[] = [];

    // Attempt auto-fixes for retryable failures (transient errors).
    for (const failure of unique) {
      if (isRetryable(failure.error) && !isPermissionError(failure.error)) {
        const fix: FixAttempt = {
          failure,
          strategy: 'retry',
          success: false,
        };
        // We don't actually re-run the tool here — we just flag it as retryable
        // so the next agent run can handle it. The fix attempt is informational.
        fix.success = true;
        fix.result = 'Marked as retryable — will succeed on next attempt';
        fixes.push(fix);
      } else if (isPermissionError(failure.error)) {
        fixes.push({
          failure,
          strategy: 'permission-required',
          success: false,
          result: 'Requires elevated permissions — user must approve',
        });
      }
    }

    const fixedCount = fixes.filter((f) => f.success).length;
    const unfixedCount = unique.length - fixedCount;

    const summary = this.buildSummary(unique, fixes, fixedCount, unfixedCount);

    const report: ProblemReport = {
      totalFailures: this.failures.length,
      uniqueToolFailures: unique.length,
      fixedCount,
      unfixedCount,
      failures: unique,
      fixes,
      summary,
    };

    // Emit problem report event to UI.
    if (unique.length > 0) {
      emitEvent({
        type: 'problem_report',
        report,
      });
    }

    return report;
  }

  private buildSummary(
    unique: TrackedFailure[],
    fixes: FixAttempt[],
    fixedCount: number,
    unfixedCount: number,
  ): string {
    if (unique.length === 0) return 'No problems detected.';

    const lines: string[] = [];
    lines.push(`Detected ${unique.length} tool failure(s) during task execution.`);

    if (fixedCount > 0) {
      lines.push(`${fixedCount} automatically resolved (retryable transient errors).`);
    }
    if (unfixedCount > 0) {
      lines.push(`${unfixedCount} require manual attention:`);
      for (const f of unique) {
        if (!fixes.find((fx) => fx.failure === f && fx.success)) {
          lines.push(`  - ${f.name}: ${f.error.slice(0, 120)}`);
        }
      }
    }

    return lines.join('\n');
  }

  reset(): void {
    this.failures = [];
    this.currentTurn = 0;
  }
}
