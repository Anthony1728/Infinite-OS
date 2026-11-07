# Evaluation Harness — measuring what the agent actually completes

Every claim Infinite OS makes about task completion is checked against the
real workspace — file bytes, JSON values, command exit codes — never against
the agent's own summary. "Done" is defined before the agent runs.

## Quick start

```bash
npm run build                     # the CLI runs the built main process
npm run eval                      # run all core tasks
npm run eval --list               # show suites and tasks
npm run eval -- --trend           # per-task history + REGRESSIONS
npm run eval -- --matrix auto     # benchmark across your models
```

> npm 11 swallows flags after `--` — use `node scripts/eval.mjs --flags`
> when you need `--provider/--model/--timeout/--json`.

## Commands

| Command | What it does |
|---|---|
| `npm run eval` | Runs every core task; exit 0 = all passed their checks |
| `npm run eval -- --task <id>` | Run specific tasks (repeatable/comma-separated) |
| `npm run eval -- --provider <id> --model <id>` | Override the model for this run |
| `npm run eval -- --timeout <min>` | Per-task wall-clock ceiling (max 60) |
| `npm run eval -- --trend` | Print per-(task, model) history; REGRESSION lines mark passed→failed transitions; exit 1 when regressions exist |
| `npm run eval -- --matrix 'p/m1,p/m2'` | Run the suite once per candidate; prints a task×model grid + ranked pass rates |
| `npm run eval -- --matrix auto` | Matrix over your current selection + up to 3 local Ollama models (the headless CLI cannot read DPAPI-wrapped cloud keys) |
| `npm run eval -- --json` | Full report (or matrix) as JSON |

## What makes a run trustworthy

- **Isolated workspaces** — every task runs in its own seeded directory;
  absolute paths, `..` escapes, and escaping symlinks are rejected.
- **Mechanical checks** — file existence/content/regex, JSON path equality,
  and real shell commands with exit-code/stdout assertions. Hard timeouts
  with process-tree kill.
- **Independent of self-report** — a run can PASS the checks while the agent
  reported failure; status is decided by checks only.
- **Learning isolation** — benchmark traffic never changes your active
  provider/model, model-reliability memory, or learned experience rules.
- **Honest failure** — an unreachable provider records 0/N with real missing
  evidence, never a fabricated pass.

## Reports

- Per-run: `~/.infinite-ai/profiles/<profile>/evaluations/reports/<id>.json`
- History index: `…/evaluations/index.json`
- Matrices: `…/evaluations/reports/<id>.matrix.json`
- Read-only history UI: **Evaluation** in the sidebar.

## Regression workflow

1. Baseline: `node scripts/eval.mjs --matrix auto --json > baseline.json`
2. Make changes.
3. `node scripts/eval.mjs --trend` — any `REGRESSION` line names the exact
   reports that went passed → failed for a (task, model) pair.
4. Exit code 1 from `--trend` = at least one regression; wire into CI or a
   pre-merge habit.

## Adding tasks

Suites live in `src/main/evaluation/fixtures.ts`. A task is a prompt, seed
files, and checks — see `contracts.ts` for the check vocabulary. Every new
task must fail its checks on the untouched seed (there is a test enforcing
this for the built-in suite).
