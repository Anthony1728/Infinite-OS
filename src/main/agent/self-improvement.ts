// Self-Improvement Agent — runs locally without API keys.
// Monitors the OS for errors, fixes common issues, maintains quality.

import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

type AuditProgress = (message: string) => void;

function selfExec(command: string, opts: { cwd: string; timeout: number }, onProgress?: AuditProgress): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    onProgress?.(`$ ${command}`);
    const shell = process.platform === 'win32' ? 'powershell.exe' : '/bin/sh';
    const shellArgs = process.platform === 'win32' ? ['-NoProfile', '-Command', command] : ['-c', command];
    const child = spawn(shell, shellArgs, { cwd: opts.cwd, timeout: opts.timeout, env: process.env, windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
    child.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
    child.on('close', (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(stderr || `exited with code ${code}`));
    });
    child.on('error', reject);
  });
}

export interface HealthReport {
  timestamp: number;
  overall: 'healthy' | 'degraded' | 'critical';
  checks: CheckResult[];
  fixes: FixResult[];
  recommendations: string[];
}

export interface CheckResult {
  name: string;
  status: 'pass' | 'warn' | 'fail';
  message: string;
  details?: string;
}

export interface FixResult {
  file: string;
  issue: string;
  action: 'fixed' | 'skipped' | 'failed';
  details?: string;
}

export class SelfImprovementAgent {
  private workspaceRoot: string;
  private reportHistory: HealthReport[] = [];
  private maxHistory = 50;

  constructor(workspaceRoot: string) {
    this.workspaceRoot = workspaceRoot;
  }

  async runFullAudit(onProgress?: AuditProgress): Promise<HealthReport> {
    const checks: CheckResult[] = [];
    const fixes: FixResult[] = [];
    const recommendations: string[] = [];

    // 1. TypeScript compilation check
    onProgress?.('Inspecting TypeScript compilation and project configuration...');
    const tsCheck = await this.checkTypeScript(onProgress);
    checks.push(tsCheck);

    // 2. File integrity check
    onProgress?.('Inspecting source-tree integrity...');
    const fileCheck = await this.checkFileIntegrity();
    checks.push(fileCheck);

    // 3. Tool registry check
    onProgress?.('Checking tool imports and registrations...');
    const toolCheck = await this.checkToolRegistry();
    checks.push(toolCheck);

    // 4. Package dependency check
    onProgress?.('Checking dependency metadata...');
    const depCheck = await this.checkDependencies();
    checks.push(depCheck);

    // 5. IPC handler completeness
    onProgress?.('Checking main/preload IPC coverage...');
    const ipcCheck = await this.checkIPCHandlers();
    checks.push(ipcCheck);

    // 6. Auto-fix common issues
    onProgress?.('Applying safe, deterministic fixes...');
    const autoFixes = await this.autoFix();
    fixes.push(...autoFixes);

    // 7. Generate recommendations
    if (tsCheck.status === 'fail') {
      recommendations.push('Fix TypeScript compilation errors before deploying');
    }
    if (fileCheck.status === 'warn') {
      recommendations.push('Review missing or orphaned files');
    }
    if (depCheck.status === 'warn') {
      recommendations.push('Update outdated dependencies');
    }

    // Determine overall status
    const hasFailure = checks.some((c) => c.status === 'fail');
    const hasWarning = checks.some((c) => c.status === 'warn');
    const overall = hasFailure ? 'critical' : hasWarning ? 'degraded' : 'healthy';

    const report: HealthReport = {
      timestamp: Date.now(),
      overall,
      checks,
      fixes,
      recommendations,
    };

    this.reportHistory.push(report);
    if (this.reportHistory.length > this.maxHistory) {
      this.reportHistory.shift();
    }

    onProgress?.(`Audit complete: ${overall}. ${fixes.filter((fix) => fix.action === 'fixed').length} file(s) fixed.`);
    return report;
  }

  private async checkTypeScript(onProgress?: AuditProgress): Promise<CheckResult> {
    try {
      const { stdout, stderr } = await selfExec('npm run typecheck', {
        cwd: this.workspaceRoot,
        timeout: 120000,
      }, onProgress);
      const output = stdout + stderr;
      if (output.includes('error TS')) {
        const errorCount = (output.match(/error TS/g) || []).length;
        return {
          name: 'TypeScript (main)',
          status: 'fail',
          message: `${errorCount} TypeScript error(s) found`,
          details: output.slice(0, 2000),
        };
      }
      return { name: 'TypeScript', status: 'pass', message: 'Main, preload, and renderer type-check passed' };
    } catch (e) {
      return { name: 'TypeScript', status: 'fail', message: (e as Error).message.slice(0, 500) };
    }
  }

  private async checkFileIntegrity(): Promise<CheckResult> {
    const issues: string[] = [];
    const srcDir = join(this.workspaceRoot, 'src');

    if (!existsSync(srcDir)) {
      return { name: 'File Integrity', status: 'fail', message: 'src/ directory not found' };
    }

    // Check for key directories
    const requiredDirs = ['main', 'renderer', 'shared'];
    for (const dir of requiredDirs) {
      const dirPath = join(srcDir, dir);
      if (!existsSync(dirPath)) {
        issues.push(`Missing directory: src/${dir}`);
      }
    }

    // Check for orphaned .ts files without imports (basic check)
    const orphaned = this.findOrphanedFiles(srcDir);
    if (orphaned.length > 0) {
      issues.push(`${orphaned.length} potentially orphaned file(s)`);
    }

    return {
      name: 'File Integrity',
      status: issues.length > 0 ? 'warn' : 'pass',
      message: issues.length > 0 ? issues.join('; ') : 'All key files present',
    };
  }

  private findOrphanedFiles(dir: string): string[] {
    const orphaned: string[] = [];
    try {
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory() && entry.name !== 'node_modules' && entry.name !== '.git') {
          orphaned.push(...this.findOrphanedFiles(join(dir, entry.name)));
        } else if (entry.isFile() && extname(entry.name) === '.ts') {
          const filePath = join(dir, entry.name);
          const content = readFileSync(filePath, 'utf-8');
          // Very basic: file has no imports and is not imported by anything
          if (!content.includes('import ') && !content.includes('export ') && content.length < 100) {
            orphaned.push(filePath);
          }
        }
      }
    } catch { /* ignore permission errors */ }
    return orphaned;
  }

  private async checkToolRegistry(): Promise<CheckResult> {
    try {
      const registryPath = join(this.workspaceRoot, 'src', 'main', 'tools', 'registry.ts');
      if (!existsSync(registryPath)) {
        return { name: 'Tool Registry', status: 'fail', message: 'registry.ts not found' };
      }
      const content = readFileSync(registryPath, 'utf-8');

      // Collect the local identifiers brought in by each `import { … } from './…js' line.
      // Handles aliased imports like `import { agent as agentTool } from './agent.js'`
      // (the local name is `agentTool`). Excludes non-tool imports such as `toolRegistry`.
      const nonToolImports = new Set(['toolRegistry', 'ToolRegistry']);
      const importBlockMatches = [...content.matchAll(/import\s+\{([^}]*)\}\s+from\s+['"]\.\/[^'"]+\.js['"]/g)];
      const importedTools = new Set<string>();
      for (const m of importBlockMatches) {
        for (const raw of m[1].split(',')) {
          const spec = raw.trim();
          if (!spec) continue;
          // `agent as agentTool` → local name is the part after `as`
          const localName = spec.includes(' as ') ? spec.split(' as ')[1].trim() : spec;
          if (!nonToolImports.has(localName)) importedTools.add(localName);
        }
      }

      // Collect the tool identifiers actually passed into the registration loop.
      // The registry registers via `for (const t of [ ... ]) toolRegistry.register(t)`,
      // so we gather the comma-separated entries inside that array literal, skipping
      // comment-only lines.
      const loopMatch = content.match(/for\s*\(\s*const\s+\w+\s+of\s*\[([\s\S]*?)\]\s*\)/);
      const registeredTools = new Set<string>();
      if (loopMatch) {
        for (const raw of loopMatch[1].split(',')) {
          const name = raw.trim();
          if (name && !name.startsWith('//')) registeredTools.add(name);
        }
      }

      const toolImports = importedTools.size;
      const toolRegistrations = registeredTools.size;
      const unregistered = [...importedTools].filter((t) => !registeredTools.has(t));

      if (toolImports !== toolRegistrations || unregistered.length > 0) {
        return {
          name: 'Tool Registry',
          status: 'warn',
          message: `Import/registration mismatch: ${toolImports} imported tool(s) vs ${toolRegistrations} registered tool(s)` +
            (unregistered.length > 0 ? ` — unregistered: ${unregistered.join(', ')}` : ''),
        };
      }
      return { name: 'Tool Registry', status: 'pass', message: `${toolRegistrations} tools imported and registered` };
    } catch (e) {
      return { name: 'Tool Registry', status: 'fail', message: (e as Error).message };
    }
  }

  private async checkDependencies(): Promise<CheckResult> {
    try {
      const pkgPath = join(this.workspaceRoot, 'package.json');
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
      const depCount = Object.keys(pkg.dependencies || {}).length;
      const devDepCount = Object.keys(pkg.devDependencies || {}).length;
      return {
        name: 'Dependencies',
        status: 'pass',
        message: `${depCount} dependencies, ${devDepCount} dev dependencies`,
      };
    } catch (e) {
      return { name: 'Dependencies', status: 'warn', message: (e as Error).message };
    }
  }

  private async checkIPCHandlers(): Promise<CheckResult> {
    try {
      const ipcPath = join(this.workspaceRoot, 'src', 'main', 'ipc', 'index.ts');
      const preloadPath = join(this.workspaceRoot, 'src', 'preload', 'index.ts');
      const ipcPath2 = join(this.workspaceRoot, 'src', 'shared', 'ipc.ts');

      if (!existsSync(ipcPath) || !existsSync(preloadPath) || !existsSync(ipcPath2)) {
        return { name: 'IPC Handlers', status: 'fail', message: 'IPC files missing' };
      }

      const ipcContent = readFileSync(ipcPath, 'utf-8');
      const preloadContent = readFileSync(preloadPath, 'utf-8');

      const mainHandlers = (ipcContent.match(/ipcMain\.handle\(/g) || []).length;
      const preloadBridges = (preloadContent.match(/ipcRenderer\.invoke\(/g) || []).length;

      if (mainHandlers < 5) {
        return {
          name: 'IPC Handlers',
          status: 'warn',
          message: `Only ${mainHandlers} IPC handlers registered (expected more)`,
        };
      }

      return {
        name: 'IPC Handlers',
        status: 'pass',
        message: `${mainHandlers} handlers, ${preloadBridges} bridges`,
      };
    } catch (e) {
      return { name: 'IPC Handlers', status: 'warn', message: (e as Error).message };
    }
  }

  private async autoFix(): Promise<FixResult[]> {
    const fixes: FixResult[] = [];

    // Fix 1: Ensure .env is in gitignore
    const gitignorePath = join(this.workspaceRoot, '.gitignore');
    if (existsSync(gitignorePath)) {
      const content = readFileSync(gitignorePath, 'utf-8');
      if (!content.includes('.env')) {
        writeFileSync(gitignorePath, content + '\n.env\n.env.local\n');
        fixes.push({ file: '.gitignore', issue: 'Missing .env entries', action: 'fixed' });
      }
    }

    // Fix 2: Remove empty nul files (Windows artifact)
    const nulPath = join(this.workspaceRoot, 'nul');
    if (existsSync(nulPath)) {
      try {
        const stat = statSync(nulPath);
        if (stat.size === 0) {
          fixes.push({ file: 'nul', issue: 'Windows reserved name artifact', action: 'skipped', details: 'Cannot delete Windows reserved names' });
        }
      } catch { /* ignore */ }
    }

    return fixes;
  }

  getHistory(): HealthReport[] {
    return [...this.reportHistory];
  }

  getLastReport(): HealthReport | null {
    return this.reportHistory[this.reportHistory.length - 1] ?? null;
  }
}

