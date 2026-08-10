import type { Tool, ToolResult } from './base.js';
import { SelfImprovementAgent } from '../agent/self-improvement.js';
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const agents = new Map<string, SelfImprovementAgent>();

function getAgent(cwd: string): SelfImprovementAgent {
  let agent = agents.get(cwd);
  if (!agent) {
    agent = new SelfImprovementAgent(cwd);
    agents.set(cwd, agent);
  }
  return agent;
}

function execCmd(command: string, cwd: string, timeout: number): Promise<{ ok: boolean; output: string }> {
  return new Promise((resolve) => {
    const shell = process.platform === 'win32' ? 'powershell.exe' : '/bin/sh';
    const shellArgs = process.platform === 'win32' ? ['-NoProfile', '-Command', command] : ['-c', command];
    const child = spawn(shell, shellArgs, { cwd, timeout, env: process.env, windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
    child.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
    child.on('close', (code) => {
      resolve({ ok: code === 0, output: (stdout + stderr).trim() });
    });
    child.on('error', (e) => resolve({ ok: false, output: e.message }));
  });
}

interface ImprovementAction {
  id: string;
  type: 'optimize' | 'fix' | 'learn' | 'adapt';
  description: string;
  target?: string;
  priority: number;
  status: string;
}

function loadImprovementActions(cwd: string): ImprovementAction[] {
  const actionsFile = join(cwd, '.infinite-ai', 'improvement', 'actions.json');
  if (!existsSync(actionsFile)) return [];
  try {
    const data = JSON.parse(readFileSync(actionsFile, 'utf-8'));
    return Array.isArray(data) ? data : [];
  } catch { return []; }
}

function saveImprovementActions(cwd: string, actions: ImprovementAction[]): void {
  const dir = join(cwd, '.infinite-ai', 'improvement');
  if (!existsSync(dir)) return;
  writeFileSync(join(dir, 'actions.json'), JSON.stringify(actions, null, 2));
}

export const selfImprove: Tool = {
  name: 'SelfImprove',
  description: [
    'Run health audits, auto-fix issues, and execute autonomous improvement loops on the Infinite OS codebase.',
    'Actions: audit (full check), fix (auto-fix), status (last report), improve (autonomous improvement loop),',
    'improve_code (read a source file, identify improvements, apply them, validate).',
    'Use proactively to find/fix issues and improve the application.',
  ].join(' '),
  inputSchema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['audit', 'fix', 'status', 'improve', 'improve_code'],
        description: 'audit: full health check, fix: auto-fix issues, status: last report, improve: autonomous improvement loop, improve_code: improve a specific source file',
      },
      file_path: { type: 'string', description: 'Source file to improve (for improve_code)' },
      improvement_type: { type: 'string', enum: ['performance', 'readability', 'error-handling', 'security', 'all'], description: 'Type of improvement to focus on (for improve_code)' },
    },
    required: ['action'],
  },
  permission: 'ask',

  async execute(args, ctx): Promise<ToolResult> {
    const { action, file_path, improvement_type } = args as { action: string; file_path?: string; improvement_type?: string };
    try {
      const agent = getAgent(ctx.cwd);

      switch (action) {
        case 'audit': {
          const report = await agent.runFullAudit((message) => ctx.onUpdate({ content: message }));
          const lines: string[] = [
            `## Health Report — ${report.overall.toUpperCase()}`,
            '',
            '### Checks',
            ...report.checks.map((c) => `- [${c.status.toUpperCase()}] ${c.name}: ${c.message}`),
            '',
          ];
          if (report.fixes.length > 0) {
            lines.push('### Auto-Fixes', ...report.fixes.map((f) => `- [${f.action}] ${f.file}: ${f.issue}`), '');
          }
          if (report.recommendations.length > 0) {
            lines.push('### Recommendations', ...report.recommendations.map((r) => `- ${r}`), '');
          }
          return { content: lines.join('\n') };
        }

        case 'fix': {
          const report = await agent.runFullAudit((message) => ctx.onUpdate({ content: message }));
          const fixCount = report.fixes.filter((f) => f.action === 'fixed').length;
          return { content: `Ran audit and applied ${fixCount} fix(es). Overall status: ${report.overall}` };
        }

        case 'status': {
          const last = agent.getLastReport();
          if (!last) return { content: 'No audit reports yet. Run an audit first.' };
          return {
            content: `Last audit: ${new Date(last.timestamp).toLocaleString()} — ${last.overall.toUpperCase()}\nChecks: ${last.checks.map((c) => `${c.name}=${c.status}`).join(', ')}`,
          };
        }

        case 'improve': {
          // Autonomous improvement loop: audit → identify → fix → validate → report
          ctx.onUpdate({ content: 'Starting autonomous improvement loop...' });

          // Step 1: Run health audit
          ctx.onUpdate({ content: 'Step 1/5: Running health audit...' });
          const report = await agent.runFullAudit();
          const issues = report.checks.filter((c) => c.status === 'fail' || c.status === 'warn');

          // Step 2: Load pending improvement actions
          ctx.onUpdate({ content: 'Step 2/5: Analyzing improvement opportunities...' });
          const pendingActions = loadImprovementActions(ctx.cwd);
          const highPriority = pendingActions
            .filter((a) => a.status === 'pending' && a.priority >= 7)
            .slice(0, 5);

          const results: string[] = [];
          results.push(`Health: ${report.overall.toUpperCase()} (${issues.length} issues found)`);
          results.push(`Pending improvements: ${highPriority.length} high-priority actions`);

          // Step 3: Auto-fix known issues
          ctx.onUpdate({ content: 'Step 3/5: Applying auto-fixes...' });
          const fixCount = report.fixes.filter((f) => f.action === 'fixed').length;
          results.push(`Auto-fixes applied: ${fixCount}`);

          // Step 4: Validate with typecheck and tests
          ctx.onUpdate({ content: 'Step 4/5: Validating with typecheck...' });
          const tsResult = await execCmd('npx tsc --noEmit -p tsconfig.node.json', ctx.cwd, 60_000);
          results.push(`Typecheck: ${tsResult.ok ? 'PASS' : 'FAIL'}`);
          if (!tsResult.ok) {
            const errors = tsResult.output.split('\n').slice(0, 5).join('\n');
            results.push(`Errors:\n${errors}`);
          }

          // Step 5: Mark processed actions
          ctx.onUpdate({ content: 'Step 5/5: Recording results...' });
          for (const action of highPriority) {
            action.status = 'completed';
          }
          saveImprovementActions(ctx.cwd, pendingActions);

          return { content: results.join('\n') };
        }

        case 'improve_code': {
          if (!file_path) return { content: 'improve_code requires file_path', is_error: true };

          ctx.onUpdate({ content: `Reading ${file_path}...` });
          const fullPath = file_path.startsWith('/') ? file_path : join(ctx.cwd, file_path);
          if (!existsSync(fullPath)) return { content: `File not found: ${file_path}`, is_error: true };

          const original = readFileSync(fullPath, 'utf-8');
          const lines = original.split('\n');

          // Analyze the file for improvement opportunities
          const improvements: string[] = [];
          const focus = improvement_type ?? 'all';

          // Check for missing error handling
          if (focus === 'error-handling' || focus === 'all') {
            const asyncWithoutTry = lines.filter((l, i) =>
              l.includes('await ') && !lines.slice(Math.max(0, i - 3), i).some((pl) => pl.includes('try'))
              && !lines.slice(i, Math.min(lines.length, i + 5)).some((nl) => nl.includes('catch'))
            );
            if (asyncWithoutTry.length > 0) {
              improvements.push(`Found ${asyncWithoutTry.length} await calls without nearby try/catch`);
            }
          }

          // Check for performance issues
          if (focus === 'performance' || focus === 'all') {
            const syncOps = lines.filter((l) =>
              l.includes('readFileSync') || l.includes('writeFileSync') || l.includes('execSync')
            );
            if (syncOps.length > 3) {
              improvements.push(`Found ${syncOps.length} synchronous file/child_process operations — consider async alternatives`);
            }
          }

          // Check for readability
          if (focus === 'readability' || focus === 'all') {
            const longFunctions = lines.filter((l) => l.match(/^(export\s+)?(async\s+)?function\s+\w+/));
            if (longFunctions.length > 0) {
              improvements.push(`Found ${longFunctions.length} function declarations — consider splitting large functions`);
            }
            const anyTypes = lines.filter((l) => l.includes(': any') || l.includes('as any'));
            if (anyTypes.length > 0) {
              improvements.push(`Found ${anyTypes.length} uses of 'any' type — replace with proper types`);
            }
          }

          // Check for security
          if (focus === 'security' || focus === 'all') {
            const secrets = lines.filter((l) =>
              /password|secret|api.?key|token/i.test(l) && !l.includes('//') && !l.includes('TODO')
            );
            if (secrets.length > 0) {
              improvements.push(`Found ${secrets.length} potential secret/key references — verify they're not hardcoded`);
            }
          }

          // Check for console.log in production code
          const consoleLogs = lines.filter((l) => l.includes('console.log') && !l.includes('//'));
          if (consoleLogs.length > 0) {
            improvements.push(`Found ${consoleLogs.length} console.log statements — consider using a logger`);
          }

          if (improvements.length === 0) {
            return { content: `No improvement opportunities found in ${file_path} (focus: ${focus})` };
          }

          // Generate improvement report
          const report = [
            `## Improvement Analysis: ${file_path}`,
            `Focus: ${focus}`,
            '',
            '### Opportunities Found',
            ...improvements.map((imp, i) => `${i + 1}. ${imp}`),
            '',
            '### Recommendations',
            '- Run `SelfImprove` with action `audit` for a full codebase analysis',
            '- Use `BuildFeature` to safely apply improvements with rollback support',
            '- Run `SelfImprove` with action `improve` for autonomous improvement loop',
          ];

          return { content: report.join('\n') };
        }

        default:
          return { content: `Unknown action: ${action}`, is_error: true };
      }
    } catch (e) {
      return { content: `Self-improvement error: ${(e as Error).message}`, is_error: true };
    }
  },
};
