// Self-Improvement Agent — runs locally without API keys.
// Monitors the OS for errors, fixes common issues, maintains quality.

import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const execAsync = promisify(exec);

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

  async runFullAudit(): Promise<HealthReport> {
    const checks: CheckResult[] = [];
    const fixes: FixResult[] = [];
    const recommendations: string[] = [];

    // 1. TypeScript compilation check
    const tsCheck = await this.checkTypeScript();
    checks.push(tsCheck);

    // 2. File integrity check
    const fileCheck = await this.checkFileIntegrity();
    checks.push(fileCheck);

    // 3. Tool registry check
    const toolCheck = await this.checkToolRegistry();
    checks.push(toolCheck);

    // 4. Package dependency check
    const depCheck = await this.checkDependencies();
    checks.push(depCheck);

    // 5. IPC handler completeness
    const ipcCheck = await this.checkIPCHandlers();
    checks.push(ipcCheck);

    // 6. Auto-fix common issues
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

    return report;
  }

  private async checkTypeScript(): Promise<CheckResult> {
    try {
      const { stdout, stderr } = await execAsync('npx tsc --noEmit -p tsconfig.node.json 2>&1', {
        cwd: this.workspaceRoot,
        timeout: 60000,
      });
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
      return { name: 'TypeScript (main)', status: 'pass', message: 'No errors' };
    } catch (e) {
      return { name: 'TypeScript (main)', status: 'fail', message: (e as Error).message.slice(0, 500) };
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
      const toolImports = (content.match(/import.*from.*\.\/.*\.js/g) || []).length;
      const toolRegistrations = (content.match(/toolRegistry\.register/g) || []).length;

      if (toolImports !== toolRegistrations) {
        return {
          name: 'Tool Registry',
          status: 'warn',
          message: `Import/registration mismatch: ${toolImports} imports vs ${toolRegistrations} registrations`,
        };
      }
      return { name: 'Tool Registry', status: 'pass', message: `${toolRegistrations} tools registered` };
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
