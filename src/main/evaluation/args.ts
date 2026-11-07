/**
 * `npm run eval` argument parsing. Zero-dependency so the parser is testable
 * without Electron or a provider.
 */

export interface EvalArgs {
  suite: string;
  tasks: string[];
  provider: string | null;
  model: string | null;
  json: boolean;
  list: boolean;
  timeoutMin: number | null;
  /** Benchmark matrix: comma-separated provider/model pairs to run the suite against. */
  matrix: string[];
  /** Print the per-task regression trend instead of running anything. */
  trend: boolean;
}

export function parseEvalArgs(argv: string[]): EvalArgs | { error: string } {
  const args: EvalArgs = {
    suite: 'core',
    tasks: [],
    provider: null,
    model: null,
    json: false,
    list: false,
    timeoutMin: null,
    matrix: [],
    trend: false,
  };

  for (let index = 0; index < argv.length; index++) {
    const value = argv[index];
    if (value === '--json') args.json = true;
    else if (value === '--list') args.list = true;
    else if (value === '--trend') args.trend = true;
    else if (value === '--matrix') {
      const next = argv[++index];
      if (!next) return { error: '--matrix needs comma-separated provider/model pairs.' };
      args.matrix.push(...next.split(',').map((entry) => entry.trim()).filter(Boolean));
    } else if (value === '--help' || value === '-h') return { error: 'help' };
    else if (value === '--suite') {
      const next = argv[++index];
      if (!next) return { error: '--suite needs a suite id.' };
      args.suite = next;
    } else if (value === '--task') {
      const next = argv[++index];
      if (!next) return { error: '--task needs a task id.' };
      args.tasks.push(...next.split(',').map((entry) => entry.trim()).filter(Boolean));
    } else if (value === '--provider') {
      const next = argv[++index];
      if (!next) return { error: '--provider needs a provider id.' };
      args.provider = next;
    } else if (value === '--model') {
      const next = argv[++index];
      if (!next) return { error: '--model needs a model id.' };
      args.model = next;
    } else if (value === '--timeout') {
      const next = argv[++index];
      if (!next) return { error: '--timeout needs minutes.' };
      const minutes = Number(next);
      if (!Number.isFinite(minutes) || minutes <= 0 || minutes > 60) {
        return { error: '--timeout must be between 0 and 60 minutes.' };
      }
      args.timeoutMin = minutes;
    } else if (value === '--') {
      // Tolerate the separator npm sometimes forwards.
      continue;
    } else if (value.startsWith('-')) {
      return { error: `Unknown option: ${value}` };
    } else {
      // Positional task ids: npm 11 strips script flags after `--`, but plain
      // positionals survive, so `npm run eval -- create-welcome-note` works.
      args.tasks.push(...value.split(',').map((entry) => entry.trim()).filter(Boolean));
    }
  }

  return args;
}

export function evalUsage(): string {
  return [
    'Usage: npm run eval -- [options]',
    '',
    'Runs real agent tasks in isolated workspaces and scores them with mechanical checks.',
    '',
    'Options:',
    '  --suite <id>       Evaluation suite (default: core)',
    '  --task <id>        Run one task; repeat or comma-separate for several',
    '  --provider <id>    Provider override (defaults to Settings)',
    '  --model <id>       Model override (defaults to Settings)',
    '  --timeout <min>    Per-task wall-clock ceiling in minutes',
    '  --matrix <specs>   Benchmark matrix: run the suite per candidate;',
    '                     comma-separated provider/model pairs, or `auto` to',
    '                     benchmark the current selection + local Ollama models',
    '  --trend            Print per-task pass/fail history and REGRESSIONS',
    '                     across stored reports, then exit',
    '  --list             List suites and tasks without running them',
    '  --json             Print the full report as JSON',
    '  --help             Show this help',
    '',
    'npm shortcuts: `npm run eval` (all tasks), `npm run eval:list`,',
    '  `npm run eval -- <task-id>` (positional task id).',
    'npm 11 swallows flags after `--`, so use `node scripts/eval.mjs --task ...`',
    '  when you need --provider/--model/--timeout/--json.',
    '',
    'Requires a prior `npm run build` (runs the built main process headless).',
    'Exit code 0 means every selected task passed its checks.',
  ].join('\n');
}
