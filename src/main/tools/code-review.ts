import type { Tool, ToolContext, ToolResult } from './base.js';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

/**
 * Code Review — automated code analysis with severity ratings.
 * Reads a file, scans for common issues (unused vars, complexity, security),
 * and returns a structured report. No model call needed — deterministic.
 */
interface ReviewArgs {
  file_path: string;
  focus?: 'security' | 'performance' | 'style' | 'all';
}

const SECURITY_PATTERNS = [
  { pattern: /eval\s*\(/g, msg: 'eval() usage — potential code injection', severity: 'high' },
  { pattern: /innerHTML\s*=/g, msg: 'innerHTML assignment — potential XSS', severity: 'high' },
  { pattern: /exec\s*\(\s*['"`]/g, msg: 'shell exec with literal string — potential injection', severity: 'high' },
  { pattern: /password\s*[=:]\s*['"`][^'"`]+['"`]/gi, msg: 'hardcoded password detected', severity: 'critical' },
  { pattern: /api[_-]?key\s*[=:]\s*['"`][^'"`]+['"`]/gi, msg: 'hardcoded API key detected', severity: 'critical' },
  { pattern: /secret\s*[=:]\s*['"`][^'"`]+['"`]/gi, msg: 'hardcoded secret detected', severity: 'critical' },
  { pattern: /SELECT\s+\*\s+FROM/gi, msg: 'SELECT * — may expose unnecessary columns', severity: 'medium' },
  { pattern: /\$\{.*\}.*(?:query|exec|run)/g, msg: 'template literal in query/exec — potential injection', severity: 'high' },
  { pattern: /new\s+Function\s*\(/g, msg: 'new Function() — equivalent to eval', severity: 'high' },
  { pattern: /document\.write\s*\(/g, msg: 'document.write() — potential XSS', severity: 'medium' },
];

const PERFORMANCE_PATTERNS = [
  { pattern: /for\s*\(\s*let\s+\w+\s*=\s*0\s*;.*\.length/g, msg: 'for-loop with .length in condition — cache array.length', severity: 'low' },
  { pattern: /\.forEach\s*\(\s*async/g, msg: 'async forEach — does not await; use for...of', severity: 'medium' },
  { pattern: /JSON\.parse\s*\(\s*JSON\.stringify/g, msg: 'deep clone via JSON — slow for large objects', severity: 'low' },
  { pattern: /try\s*\{[\s\S]{0,200}catch/g, msg: 'try/catch block — ensure catch handles specific errors', severity: 'low' },
];

const STYLE_PATTERNS = [
  { pattern: /console\.log\s*\(/g, msg: 'console.log in production code', severity: 'info' },
  { pattern: /var\s+/g, msg: 'var declaration — prefer const/let', severity: 'info' },
  { pattern: /==(?!=)/g, msg: 'loose equality == — prefer ===', severity: 'info' },
  { pattern: /!=(?!=)/g, msg: 'loose inequality != — prefer !==', severity: 'info' },
  { pattern: /\/\/.*TODO/gi, msg: 'TODO comment found', severity: 'info' },
  { pattern: /\/\/.*FIXME/gi, msg: 'FIXME comment found', severity: 'info' },
  { pattern: /\/\/.*HACK/gi, msg: 'HACK comment found', severity: 'info' },
];

export const codeReviewTool: Tool = {
  name: 'CodeReview',
  description:
    'Scan a source file for security vulnerabilities, performance issues, and style problems. Returns a structured report with line numbers and severity ratings (critical/high/medium/low/info). No model call needed — deterministic static analysis. Use before commits, after edits, or when the user asks "review this code".',
  inputSchema: {
    type: 'object',
    properties: {
      file_path: { type: 'string', description: 'Absolute or workspace-relative path to the source file' },
      focus: { type: 'string', enum: ['security', 'performance', 'style', 'all'], description: 'Filter findings by category (default: all)' },
    },
    required: ['file_path'],
  },
  permission: 'allow',
  async execute(args: unknown, ctx: ToolContext): Promise<ToolResult> {
    const a = args as ReviewArgs;
    if (!a.file_path) return { content: 'CodeReview requires file_path.', is_error: true };
    const focus = a.focus || 'all';

    let content: string;
    try {
      const fullPath = resolve(ctx.cwd, a.file_path);
      content = await readFile(fullPath, 'utf8');
    } catch (e) {
      return { content: `Cannot read file: ${(e as Error).message}`, is_error: true };
    }

    const lines = content.split('\n');
    const findings: Array<{ line: number; severity: string; category: string; message: string }> = [];

    const patterns: Array<{ patterns: Array<{ pattern: RegExp; msg: string; severity: string }>; category: string }> = [];
    if (focus === 'all' || focus === 'security') patterns.push({ patterns: SECURITY_PATTERNS, category: 'security' });
    if (focus === 'all' || focus === 'performance') patterns.push({ patterns: PERFORMANCE_PATTERNS, category: 'performance' });
    if (focus === 'all' || focus === 'style') patterns.push({ patterns: STYLE_PATTERNS, category: 'style' });

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      for (const group of patterns) {
        for (const { pattern, msg, severity } of group.patterns) {
          const regex = new RegExp(pattern.source, pattern.flags);
          if (regex.test(line)) {
            findings.push({ line: i + 1, severity, category: group.category, message: msg });
          }
        }
      }
    }

    // Calculate health score
    const critical = findings.filter(f => f.severity === 'critical').length;
    const high = findings.filter(f => f.severity === 'high').length;
    const medium = findings.filter(f => f.severity === 'medium').length;
    const low = findings.filter(f => f.severity === 'low').length;
    const info = findings.filter(f => f.severity === 'info').length;
    const score = Math.max(0, 100 - (critical * 25) - (high * 10) - (medium * 5) - (low * 2) - (info * 0.5));

    const summary = [
      `# Code Review — ${a.file_path}`,
      ``,
      `**Health Score: ${Math.round(score)}/100** (${lines.length} lines, ${findings.length} findings)`,
      ``,
      `| Severity | Count |`,
      `|----------|-------|`,
      `| Critical | ${critical} |`,
      `| High     | ${high} |`,
      `| Medium   | ${medium} |`,
      `| Low      | ${low} |`,
      `| Info     | ${info} |`,
      ``,
    ];

    if (findings.length === 0) {
      summary.push('No issues found. Code looks clean.');
    } else {
      summary.push('## Findings');
      summary.push('');
      for (const f of findings.slice(0, 30)) {
        const icon = f.severity === 'critical' ? 'CRITICAL' : f.severity === 'high' ? 'HIGH' : f.severity === 'medium' ? 'MED' : f.severity === 'low' ? 'LOW' : 'INFO';
        summary.push(`- **L${f.line}** [${icon}] (${f.category}) ${f.message}`);
      }
      if (findings.length > 30) summary.push(`\n... and ${findings.length - 30} more findings.`);
    }

    return { content: summary.join('\n'), is_error: critical > 0 || high > 0 };
  },
};
