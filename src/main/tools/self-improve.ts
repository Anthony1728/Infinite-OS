import type { Tool, ToolResult } from './base.js';
import { SelfImprovementAgent } from '../agent/self-improvement.js';

let agent: SelfImprovementAgent | null = null;

function getAgent(cwd: string): SelfImprovementAgent {
  if (!agent) agent = new SelfImprovementAgent(cwd);
  return agent;
}

export const selfImprove: Tool = {
  name: 'SelfImprove',
  description: [
    'Run a health audit on the InfiniteAI OS codebase.',
    'Checks TypeScript compilation, file integrity, tool registry, IPC handlers.',
    'Auto-fixes common issues. Returns a detailed health report.',
    'Use this proactively to find and fix issues in the application.',
  ].join(' '),
  inputSchema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['audit', 'fix', 'status'],
        description: 'audit: full check, fix: auto-fix issues, status: last report',
      },
    },
    required: ['action'],
  },
  permission: 'ask',

  async execute(args, ctx): Promise<ToolResult> {
    const { action } = args as { action: string };
    try {
      const agent = getAgent(ctx.cwd);

      switch (action) {
        case 'audit': {
          const report = await agent.runFullAudit();
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
          const report = await agent.runFullAudit();
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
        default:
          return { content: `Unknown action: ${action}`, is_error: true };
      }
    } catch (e) {
      return { content: `Self-improvement error: ${(e as Error).message}`, is_error: true };
    }
  },
};
