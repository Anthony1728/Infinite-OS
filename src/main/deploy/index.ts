import { EventEmitter } from 'events';
import log from 'electron-log';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';

const execAsync = promisify(exec);

export interface DeployTarget {
  id: string;
  name: string;
  type: 'npm' | 'docker' | 'vercel' | 'netlify' | 'aws' | 'azure' | 'gcloud' | 'ssh' | 'ftp' | 'local';
  config: Record<string, string>;
  lastDeploy?: number;
  status: 'idle' | 'deploying' | 'success' | 'failed';
  createdAt: number;
}

export interface DeployPipeline {
  id: string;
  name: string;
  projectId: string;
  targetId: string;
  steps: DeployStep[];
  status: 'idle' | 'running' | 'success' | 'failed' | 'cancelled';
  currentStep: number;
  logs: string[];
  startedAt?: number;
  completedAt?: number;
  createdAt: number;
}

export interface DeployStep {
  id: string;
  name: string;
  command: string;
  condition?: string;
  timeout?: number;
  status: 'pending' | 'running' | 'success' | 'failed' | 'skipped';
  output?: string;
}

export interface BuildConfig {
  type: 'electron' | 'web' | 'node' | 'python' | 'go' | 'rust' | 'java' | 'mobile';
  entryPoint: string;
  outputDir: string;
  target?: string;
  env?: Record<string, string>;
  commands: {
    build: string;
    test?: string;
    lint?: string;
    package?: string;
    publish?: string;
  };
}

class DeploymentSystem extends EventEmitter {
  private targets: Map<string, DeployTarget> = new Map();
  private pipelines: Map<string, DeployPipeline> = new Map();
  private buildConfigs: Map<string, BuildConfig> = new Map();

  createTarget(name: string, type: DeployTarget['type'], config: Record<string, string>): DeployTarget {
    const target: DeployTarget = {
      id: uuidv4(),
      name,
      type,
      config,
      status: 'idle',
      createdAt: Date.now(),
    };
    this.targets.set(target.id, target);
    this.emit('targetCreated', target);
    return target;
  }

  getTarget(id: string): DeployTarget | undefined {
    return this.targets.get(id);
  }

  listTargets(): DeployTarget[] {
    return Array.from(this.targets.values());
  }

  deleteTarget(id: string): boolean {
    return this.targets.delete(id);
  }

  saveBuildConfig(projectId: string, config: BuildConfig): void {
    this.buildConfigs.set(projectId, config);
  }

  getBuildConfig(projectId: string): BuildConfig | undefined {
    return this.buildConfigs.get(projectId);
  }

  async createPipeline(name: string, projectId: string, targetId: string, commands: string[]): Promise<DeployPipeline> {
    const steps: DeployStep[] = commands.map((cmd, i) => ({
      id: uuidv4(),
      name: `Step ${i + 1}`,
      command: cmd,
      status: 'pending' as const,
    }));

    const pipeline: DeployPipeline = {
      id: uuidv4(),
      name,
      projectId,
      targetId,
      steps,
      status: 'idle',
      currentStep: 0,
      logs: [],
      createdAt: Date.now(),
    };

    this.pipelines.set(pipeline.id, pipeline);
    this.emit('pipelineCreated', pipeline);
    return pipeline;
  }

  async runPipeline(pipelineId: string, cwd?: string): Promise<DeployPipeline | null> {
    const pipeline = this.pipelines.get(pipelineId);
    if (!pipeline) return null;

    pipeline.status = 'running';
    pipeline.startedAt = Date.now();
    pipeline.logs = [];
    this.emit('pipelineStarted', pipeline);

    for (let i = 0; i < pipeline.steps.length; i++) {
      const step = pipeline.steps[i];
      pipeline.currentStep = i;
      step.status = 'running';
      this.emit('stepStarted', { pipelineId, step });

      try {
        const workDir = cwd || process.cwd();
        const { stdout, stderr } = await execAsync(step.command, {
          cwd: workDir,
          timeout: step.timeout || 300000,
          env: { ...process.env },
        });
        step.output = stdout || stderr;
        step.status = 'success';
        pipeline.logs.push(`[${step.name}] ${step.output}`);
        this.emit('stepCompleted', { pipelineId, step });
      } catch (err: any) {
        step.status = 'failed';
        step.output = err.message || 'Command failed';
        pipeline.logs.push(`[${step.name}] ERROR: ${step.output}`);
        pipeline.status = 'failed';
        pipeline.completedAt = Date.now();
        this.emit('stepFailed', { pipelineId, step });
        this.emit('pipelineFailed', pipeline);
        return pipeline;
      }
    }

    pipeline.status = 'success';
    pipeline.completedAt = Date.now();

    const target = this.targets.get(pipeline.targetId);
    if (target) {
      target.lastDeploy = Date.now();
    }

    this.emit('pipelineCompleted', pipeline);
    return pipeline;
  }

  cancelPipeline(pipelineId: string): boolean {
    const pipeline = this.pipelines.get(pipelineId);
    if (!pipeline || pipeline.status !== 'running') return false;
    pipeline.status = 'cancelled';
    pipeline.completedAt = Date.now();
    this.emit('pipelineCancelled', pipeline);
    return true;
  }

  getPipeline(id: string): DeployPipeline | undefined {
    return this.pipelines.get(id);
  }

  listPipelines(): DeployPipeline[] {
    return Array.from(this.pipelines.values());
  }

  async detectProjectType(projectPath: string): Promise<BuildConfig['type'] | null> {
    try {
      const files = await fs.readdir(projectPath);
      if (files.includes('package.json')) {
        const pkg = JSON.parse(await fs.readFile(path.join(projectPath, 'package.json'), 'utf-8'));
        if (pkg.main?.includes('electron') || pkg.devDependencies?.electron) return 'electron';
        if (pkg.dependencies?.next || pkg.dependencies?.react) return 'web';
        return 'node';
      }
      if (files.includes('requirements.txt') || files.includes('pyproject.toml')) return 'python';
      if (files.includes('go.mod')) return 'go';
      if (files.includes('Cargo.toml')) return 'rust';
      if (files.includes('pom.xml') || files.includes('build.gradle')) return 'java';
      return null;
    } catch {
      return null;
    }
  }

  getDefaultBuildConfig(type: BuildConfig['type']): BuildConfig {
    const configs: Record<string, BuildConfig> = {
      electron: {
        type: 'electron',
        entryPoint: 'src/main/index.ts',
        outputDir: 'out',
        commands: { build: 'npx electron-vite build', test: 'npx vitest run', lint: 'npx eslint .', package: 'npx electron-builder' },
      },
      web: {
        type: 'web',
        entryPoint: 'src/index.tsx',
        outputDir: 'dist',
        commands: { build: 'npm run build', test: 'npx vitest run', lint: 'npx eslint .' },
      },
      node: {
        type: 'node',
        entryPoint: 'src/index.ts',
        outputDir: 'dist',
        commands: { build: 'npx tsc', test: 'npx vitest run', lint: 'npx eslint .' },
      },
      python: {
        type: 'python',
        entryPoint: 'main.py',
        outputDir: 'dist',
        commands: { build: 'python -m build', test: 'pytest' },
      },
    };
    return configs[type] || configs.node;
  }
}

export const deploySystem = new DeploymentSystem();
