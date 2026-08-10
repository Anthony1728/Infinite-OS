/**
 * App Builder
 *
 * Generate complete applications:
 * - React apps
 * - Electron apps
 * - API backends
 * - CLI tools
 * - Mobile apps (React Native)
 */

import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { execSync, spawn } from 'node:child_process';

export interface AppBuilderConfig {
  dataDir: string;
  outputDir: string;
}

export interface AppFile {
  path: string;
  content: string;
  type: 'component' | 'page' | 'util' | 'store' | 'api' | 'config' | 'test' | 'style' | 'asset';
}

export interface AppProject {
  id: string;
  name: string;
  description: string;
  framework: 'react' | 'electron' | 'nextjs' | 'express' | 'fastify' | 'react-native' | 'flutter';
  language: 'typescript' | 'javascript';
  files: AppFile[];
  dependencies: Record<string, string>;
  scripts: Record<string, string>;
  status: 'scaffolded' | 'in_progress' | 'buildable' | 'deployed';
  createdAt: number;
  updatedAt: number;
  outputPath?: string;
  lastBuildLog?: string;
}

export interface AppTemplate {
  id: string;
  name: string;
  description: string;
  framework: AppProject['framework'];
  language: AppProject['language'];
  files: AppFile[];
  dependencies: Record<string, string>;
  scripts: Record<string, string>;
  category: string;
  tags: string[];
}

export class AppBuilder {
  private config: AppBuilderConfig;
  private projects: Map<string, AppProject> = new Map();
  private templates: AppTemplate[] = [];
  private dataDir: string;
  private outputDir: string;

  constructor(config?: Partial<AppBuilderConfig>) {
    this.config = {
      dataDir: config?.dataDir ?? join(homedir(), '.infinite-ai', 'apps'),
      outputDir: config?.outputDir ?? join(homedir(), '.infinite-ai', 'apps', 'output'),
    };
    this.dataDir = this.config.dataDir;
    this.outputDir = this.config.outputDir;
    this.ensureDir();
    this.loadData();
    this.initTemplates();
  }

  private ensureDir(): void {
    for (const dir of [this.dataDir, this.outputDir]) {
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    }
  }

  private loadData(): void {
    try {
      const projectsPath = join(this.dataDir, 'projects.json');
      if (existsSync(projectsPath)) {
        const data = JSON.parse(readFileSync(projectsPath, 'utf-8'));
        this.projects = new Map(data);
      }
    } catch { /* silent */ }
  }

  private saveData(): void {
    try {
      writeFileSync(join(this.dataDir, 'projects.json'), JSON.stringify(Array.from(this.projects.entries()), null, 2));
    } catch { /* silent */ }
  }

  private initTemplates(): void {
    this.templates = [
      {
        id: 'react_app',
        name: 'React App',
        description: 'Modern React application with TypeScript',
        framework: 'react',
        language: 'typescript',
        files: [
          { path: 'index.html', content: '<!doctype html><html><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/><title>Infinite App</title></head><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>', type: 'page' },
          { path: 'src/App.tsx', content: "import './style.css';\nexport default function App() { return <main><h1>Your app is ready</h1><p>Built with Infinite OS.</p></main>; }", type: 'component' },
          { path: 'src/main.tsx', content: "import React from 'react';\nimport { createRoot } from 'react-dom/client';\nimport App from './App';\ncreateRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);", type: 'page' },
          { path: 'src/style.css', content: ':root{font-family:Inter,system-ui,sans-serif;color:#f4f4f5;background:#09090b}body{margin:0}main{max-width:760px;margin:12vh auto;padding:40px;border:1px solid #27272a;border-radius:20px;background:#111113}h1{font-size:3rem;margin:0 0 12px}', type: 'style' },
        ],
        dependencies: { react: '^18.2.0', 'react-dom': '^18.2.0', vite: '^6.0.0', typescript: '^5.6.0', '@types/react': '^18.3.0', '@types/react-dom': '^18.3.0' },
        scripts: { dev: 'vite', build: 'vite build' },
        category: 'web',
        tags: ['react', 'frontend'],
      },
      {
        id: 'electron_app',
        name: 'Electron App',
        description: 'Desktop application with Electron',
        framework: 'electron',
        language: 'typescript',
        files: [
          { path: 'main.js', content: "const { app, BrowserWindow } = require('electron');\nconst path = require('path');\napp.whenReady().then(() => { const win = new BrowserWindow({ width: 1100, height: 720 }); win.loadFile(path.join(__dirname, 'index.html')); });\napp.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });", type: 'component' },
          { path: 'index.html', content: '<!doctype html><html><head><meta charset="UTF-8"><title>Infinite Desktop App</title><style>body{font-family:system-ui;background:#0b1020;color:white;padding:48px}</style></head><body><h1>Your desktop app is ready</h1><p>Built with Infinite OS.</p></body></html>', type: 'page' },
        ],
        dependencies: { electron: '^28.0.0' },
        scripts: { dev: 'electron .', start: 'electron .' },
        category: 'desktop',
        tags: ['electron', 'desktop'],
      },
      {
        id: 'express_api',
        name: 'Express API',
        description: 'REST API with Express.js',
        framework: 'express',
        language: 'typescript',
        files: [
          { path: 'src/index.ts', content: "import express from 'express';\nconst app = express();\napp.use(express.json());\napp.get('/health', (_req, res) => res.json({ ok: true }));\napp.listen(3000, () => console.log('API listening on http://localhost:3000'));", type: 'component' },
        ],
        dependencies: { express: '^4.21.0', '@types/express': '^5.0.0', typescript: '^5.6.0', tsx: '^4.19.0' },
        scripts: { dev: 'tsx watch src/index.ts', build: 'tsc --outDir dist --module commonjs', start: 'node dist/index.js' },
        category: 'backend',
        tags: ['api', 'backend'],
      },
    ];
  }

  createProject(data: {
    name: string;
    description?: string;
    framework: AppProject['framework'];
    language?: AppProject['language'];
    templateId?: string;
  }): AppProject {
    let files: AppFile[] = [];
    let dependencies: Record<string, string> = {};
    let scripts: Record<string, string> = {};

    if (data.templateId) {
      const template = this.templates.find((t) => t.id === data.templateId);
      if (template) {
        files = [...template.files];
        dependencies = { ...template.dependencies };
        scripts = { ...template.scripts };
      }
    }

    const project: AppProject = {
      id: randomUUID(),
      name: data.name,
      description: data.description ?? '',
      framework: data.framework,
      language: data.language ?? 'typescript',
      files,
      dependencies,
      scripts,
      status: 'scaffolded',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    this.projects.set(project.id, project);
    this.saveData();
    return project;
  }

  addFile(projectId: string, file: AppFile): boolean {
    const project = this.projects.get(projectId);
    if (!project) return false;

    const existing = project.files.findIndex((f) => f.path === file.path);
    if (existing >= 0) {
      project.files[existing] = file;
    } else {
      project.files.push(file);
    }
    project.updatedAt = Date.now();
    this.saveData();
    return true;
  }

  removeFile(projectId: string, filePath: string): boolean {
    const project = this.projects.get(projectId);
    if (!project) return false;
    project.files = project.files.filter((f) => f.path !== filePath);
    project.updatedAt = Date.now();
    this.saveData();
    return true;
  }

  generateComponent(projectId: string, name: string, props: string[]): string {
    const code = `import React from 'react';

interface ${name}Props {
  ${props.map((p) => `${p}: string;`).join('\n  ')}
}

export function ${name}({ ${props.join(', ')} }: ${name}Props) {
  return (
    <div>
      <h1>${name}</h1>
    </div>
  );
}

export default ${name};
`;

    this.addFile(projectId, { path: `src/components/${name}.tsx`, content: code, type: 'component' });
    return code;
  }

  generatePage(projectId: string, name: string, _route: string): string {
    const code = `import React from 'react';

export default function ${name}Page() {
  return (
    <div>
      <h1>${name}</h1>
      <p>Welcome to ${name}</p>
    </div>
  );
}
`;

    this.addFile(projectId, { path: `src/pages/${name}.tsx`, content: code, type: 'page' });
    return code;
  }

  generateAPI(projectId: string, endpoint: string, method: string): string {
    const code = `import { Router } from 'express';

const router = Router();

router.${method.toLowerCase()}('${endpoint}', (req, res) => {
  res.json({ message: '${endpoint}' });
});

export default router;
`;

    this.addFile(projectId, { path: `src/routes${endpoint.replace(/\//g, '-')}.ts`, content: code, type: 'api' });
    return code;
  }

  buildProject(projectId: string): { success: boolean; output?: string; error?: string } {
    const project = this.projects.get(projectId);
    if (!project) return { success: false, error: 'Project not found' };

    try {
      const outputDir = join(this.outputDir, project.name.toLowerCase().replace(/\s+/g, '-'));
      if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true });

      // Write all project files to disk
      for (const file of project.files) {
        const filePath = join(outputDir, file.path);
        const dir = join(filePath, '..');
        if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
        writeFileSync(filePath, file.content, 'utf-8');
      }

      // Write package.json
      const packageJson = {
        name: project.name.toLowerCase().replace(/\s+/g, '-'),
        version: '1.0.0',
        private: true,
        ...(project.framework === 'electron' ? { main: 'main.js' } : {}),
        dependencies: project.dependencies,
        scripts: project.scripts,
      };
      writeFileSync(join(outputDir, 'package.json'), JSON.stringify(packageJson, null, 2), 'utf-8');

      // Write tsconfig.json for TypeScript projects
      if (project.language === 'typescript' && project.framework !== 'electron') {
        const tsconfig = project.framework === 'express' || project.framework === 'fastify' ? {
          compilerOptions: {
            target: 'ES2020', module: 'CommonJS', moduleResolution: 'node', outDir: 'dist',
            esModuleInterop: true, strict: true, skipLibCheck: true,
          },
          include: ['src'],
        } : {
          compilerOptions: {
            target: 'ES2020',
            lib: ['ES2020', 'DOM', 'DOM.Iterable'],
            module: 'ESNext',
            skipLibCheck: true,
            moduleResolution: 'bundler',
            allowImportingTsExtensions: true,
            resolveJsonModule: true,
            isolatedModules: true,
            noEmit: true,
            jsx: 'react-jsx',
            strict: true,
            noUnusedLocals: false,
            noUnusedParameters: false,
            noFallthroughCasesInSwitch: true,
          },
          include: ['src'],
        };
        writeFileSync(join(outputDir, 'tsconfig.json'), JSON.stringify(tsconfig, null, 2), 'utf-8');
      }

      // Run npm install
      try {
        const installLog = execSync('npm install --no-audit --no-fund', {
          cwd: outputDir, 
          encoding: 'utf-8', 
          timeout: 120000,
          stdio: ['pipe', 'pipe', 'pipe']
        });
        
        let buildLog = '';
        if (project.scripts.build) buildLog = execSync('npm run build', { cwd: outputDir, encoding: 'utf-8', timeout: 120000, stdio: ['pipe', 'pipe', 'pipe'] });
        project.status = 'buildable';
        project.outputPath = outputDir;
        project.lastBuildLog = `${installLog}\n${buildLog}`.trim().slice(-20_000);
        project.updatedAt = Date.now();
        this.saveData();

        return { success: true, output: `Project built successfully at ${outputDir}` };
      } catch (error) {
        project.status = 'in_progress';
        project.outputPath = outputDir;
        project.lastBuildLog = (error as { stdout?: string; stderr?: string; message?: string }).stderr || (error as { stdout?: string }).stdout || (error as Error).message;
        project.updatedAt = Date.now();
        this.saveData();
        return { success: false, error: `Build failed in ${outputDir}: ${project.lastBuildLog?.slice(-1_000)}` };
      }
    } catch (e) {
      return { success: false, error: (e as Error).message };
    }
  }

  async runDev(projectId: string): Promise<{ success: boolean; output?: string; error?: string }> {
    const project = this.projects.get(projectId);
    if (!project) return { success: false, error: 'Project not found' };
    if (!project.outputPath) return { success: false, error: 'Project not built yet. Run build first.' };

    try {
      const script = project.scripts?.dev ? 'dev' : project.scripts?.start ? 'start' : '';
      if (!script) return { success: false, error: 'This project has no dev or start script.' };
      const child = spawn(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', script], {
        cwd: project.outputPath,
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      });
      child.unref();
      return { success: true, output: `Started npm run ${script}` };
    } catch (e) {
      return { success: false, error: (e as Error).message };
    }
  }

  getProject(projectId: string): AppProject | undefined {
    return this.projects.get(projectId);
  }

  renameProject(projectId: string, name: string): AppProject | undefined {
    const project = this.projects.get(projectId);
    if (!project || !name.trim()) return undefined;
    project.name = name.trim();
    project.updatedAt = Date.now();
    this.saveData();
    return project;
  }

  moveProject(projectId: string, destination: string): { success: boolean; output?: string; error?: string } {
    const project = this.projects.get(projectId);
    if (!project?.outputPath) return { success: false, error: 'Build the project before moving it.' };
    try {
      const target = join(resolve(destination), basename(project.outputPath));
      renameSync(project.outputPath, target);
      project.outputPath = target;
      project.updatedAt = Date.now();
      this.saveData();
      return { success: true, output: target };
    } catch (error) { return { success: false, error: (error as Error).message }; }
  }

  listProjects(): AppProject[] {
    return Array.from(this.projects.values());
  }

  getTemplates(): AppTemplate[] {
    return this.templates;
  }

  deleteProject(projectId: string): boolean {
    const result = this.projects.delete(projectId);
    this.saveData();
    return result;
  }

  getStats(): {
    totalProjects: number;
    byFramework: Record<string, number>;
    buildable: number;
    deployed: number;
  } {
    const projects = Array.from(this.projects.values());
    const byFramework: Record<string, number> = {};
    for (const p of projects) {
      byFramework[p.framework] = (byFramework[p.framework] ?? 0) + 1;
    }
    return {
      totalProjects: projects.length,
      byFramework,
      buildable: projects.filter((p) => p.status === 'buildable').length,
      deployed: projects.filter((p) => p.status === 'deployed').length,
    };
  }
}

