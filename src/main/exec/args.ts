/**
 * Exec argument parsing + usage (zero-dependency so tests stay light;
 * the heavy runner lives in run.js).
 */

export interface ExecArgs {
  prompt: string;
  json: boolean;
  yes: boolean;
  review: boolean;
  resume: string | null;
  provider: string | null;
  model: string | null;
  cwd: string;
  timeoutMin: number;
}

export function parseExecArgs(argv: string[]): ExecArgs | { error: string } {
  const args: ExecArgs = {
    prompt: '',
    json: false,
    yes: false,
    review: false,
    resume: null,
    provider: null,
    model: null,
    cwd: process.cwd(),
    timeoutMin: 10,
  };
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') args.json = true;
    else if (a === '--yes' || a === '-y') args.yes = true;
    else if (a === '--review') args.review = true;
    else if (a === '--resume') args.resume = argv[++i] ?? '';
    else if (a === '--provider') args.provider = argv[++i] ?? '';
    else if (a === '--model') args.model = argv[++i] ?? '';
    else if (a === '--cwd') args.cwd = argv[++i] ?? process.cwd();
    else if (a === '--timeout-min') args.timeoutMin = Math.max(1, Math.min(120, Number(argv[++i]) || 10));
    else if (a === '--help' || a === '-h') return { error: 'help' };
    else if (a.startsWith('--')) return { error: `Unknown flag: ${a}` };
    else positional.push(a);
  }
  if (!args.resume && positional.length === 0 && !args.review) {
    return { error: 'Provide a prompt, --review, or --resume <id> with a prompt.' };
  }
  args.prompt = positional.join(' ').trim();
  if (!args.resume && !args.prompt && !args.review) return { error: 'Provide a prompt.' };
  return args;
}

export function execUsage(): string {
  return [
    'infinite-exec — run one Infinite OS agent turn headless (scripts/CI).',
    '',
    '  npm run exec -- "<prompt>" [--yes] [--json] [--provider p] [--model m]',
    '  npm run exec -- --review [--json]            review working tree, no changes',
    '  npm run exec -- --resume <id> "<prompt>" --yes',
    '  echo "<prompt>" | npm run exec -- - --yes    read prompt from stdin',
    '',
    'Flags: --json (JSONL events on stdout), --yes (bypass approvals THIS RUN ONLY),',
    '  --review (read-only review), --resume, --provider/--model/--cwd, --timeout-min (1-120).',
    'Exit codes: 0 done, 1 agent failed/aborted, 2 usage/config error. Requires npm run build first.',
  ].join('\n');
}
