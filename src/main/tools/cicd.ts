// CI/CD Tool — GitHub Actions, GitLab CI workflow generation and management
import { writeFile, readFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Tool, ToolContext, ToolResult } from './base.js';

const OUTPUT_DIR = join(process.env.HOME || process.env.USERPROFILE || '.', 'infinite-cicd');

interface CICDArgs {
  action: 'generate' | 'list' | 'validate' | 'enable' | 'disable' | 'status';
  platform?: 'github' | 'gitlab';
  projectType?: 'node' | 'python' | 'go' | 'rust' | 'java' | 'dotnet' | 'docker' | 'static';
  name?: string;
  triggers?: string[];
  steps?: { name: string; run?: string; uses?: string; with?: Record<string, string> }[];
  branches?: string[];
  env?: Record<string, string>;
  services?: string[];
  artifacts?: string[];
  deployTarget?: string;
  filename?: string;
  outputDir?: string;
}

function generateGitHubActions(args: CICDArgs): string {
  const name = args.name || 'CI/CD Pipeline';
  const triggers = args.triggers || ['push', 'pull_request'];
  const branches = args.branches || ['main', 'develop'];

  let workflow = `name: ${name}\n\n`;
  workflow += `on:\n`;
  for (const trigger of triggers) {
    if (trigger === 'push' || trigger === 'pull_request') {
      workflow += `  ${trigger}:\n    branches: [${branches.join(', ')}]\n`;
    } else {
      workflow += `  ${trigger}:\n`;
    }
  }

  workflow += `\njobs:\n`;

  // Build job
  workflow += `  build:\n    runs-on: ubuntu-latest\n\n`;
  if (args.services && args.services.length > 0) {
    workflow += `    services:\n`;
    for (const svc of args.services) {
      if (svc === 'postgres') {
        workflow += `      postgres:\n        image: postgres:15\n        env:\n          POSTGRES_PASSWORD: postgres\n        ports: ['5432:5432']\n        options: --health-cmd pg_isready --health-interval 10s --health-timeout 5s --health-retries 5\n`;
      } else if (svc === 'redis') {
        workflow += `      redis:\n        image: redis:7\n        ports: ['6379:6379']\n`;
      } else if (svc === 'mysql') {
        workflow += `      mysql:\n        image: mysql:8\n        env:\n          MYSQL_ROOT_PASSWORD: root\n        ports: ['3306:3306']\n`;
      }
    }
  }

  workflow += `\n    steps:\n`;
  workflow += `      - uses: actions/checkout@v4\n`;

  // Language-specific setup
  switch (args.projectType) {
    case 'node':
      workflow += `      - uses: actions/setup-node@v4\n        with:\n          node-version: '20'\n          cache: 'npm'\n`;
      workflow += `      - run: npm ci\n`;
      workflow += `      - run: npm run lint --if-present\n`;
      workflow += `      - run: npm test\n`;
      workflow += `      - run: npm run build --if-present\n`;
      break;
    case 'python':
      workflow += `      - uses: actions/setup-python@v5\n        with:\n          python-version: '3.12'\n`;
      workflow += `      - run: pip install -r requirements.txt\n`;
      workflow += `      - run: python -m pytest\n`;
      break;
    case 'go':
      workflow += `      - uses: actions/setup-go@v5\n        with:\n          go-version: '1.22'\n`;
      workflow += `      - run: go mod download\n`;
      workflow += `      - run: go vet ./...\n`;
      workflow += `      - run: go test ./...\n`;
      break;
    case 'rust':
      workflow += `      - uses: dtolnay/rust-toolchain@stable\n`;
      workflow += `      - run: cargo check\n`;
      workflow += `      - run: cargo test\n`;
      workflow += `      - run: cargo build --release\n`;
      break;
    case 'java':
      workflow += `      - uses: actions/setup-java@v4\n        with:\n          java-version: '21'\n          distribution: 'temurin'\n`;
      workflow += `      - run: mvn verify\n`;
      break;
    case 'docker':
      workflow += `      - uses: docker/setup-buildx-action@v3\n`;
      workflow += `      - uses: docker/build-push-action@v5\n`;
      workflow += `        with:\n          push: false\n          tags: \${{ github.repository }}:latest\n`;
      break;
    case 'static':
      workflow += `      - uses: actions/setup-node@v4\n        with:\n          node-version: '20'\n`;
      workflow += `      - run: npm ci && npm run build --if-present\n`;
      break;
    default:
      workflow += `      - run: echo "Add your build steps here"\n`;
  }

  // Custom steps
  if (args.steps && args.steps.length > 0) {
    for (const step of args.steps) {
      workflow += `      - name: ${step.name}\n`;
      if (step.run) workflow += `        run: ${step.run}\n`;
      if (step.uses) workflow += `        uses: ${step.uses}\n`;
      if (step.with) {
        workflow += `        with:\n`;
        for (const [k, v] of Object.entries(step.with)) {
          workflow += `          ${k}: ${v}\n`;
        }
      }
    }
  }

  // Artifacts
  if (args.artifacts && args.artifacts.length > 0) {
    workflow += `      - uses: actions/upload-artifact@v4\n        with:\n          name: build-output\n          path: ${args.artifacts.join(', ')}\n`;
  }

  // Deploy job
  if (args.deployTarget) {
    workflow += `\n  deploy:\n    needs: build\n    runs-on: ubuntu-latest\n    if: github.ref == 'refs/heads/main'\n    steps:\n`;
    workflow += `      - uses: actions/checkout@v4\n`;
    workflow += `      - uses: actions/download-artifact@v4\n`;
    workflow += `      - name: Deploy to ${args.deployTarget}\n`;
    workflow += `        run: echo "Deploy to ${args.deployTarget} here"\n`;
  }

  return workflow;
}

function generateGitLabCI(args: CICDArgs): string {
  const stages = ['build', 'test', 'deploy'];
  let ci = `stages:\n  - ${stages.join('\n  - ')}\n\n`;

  // Build stage
  ci += `build:\n  stage: build\n  image: `;
  switch (args.projectType) {
    case 'node': ci += 'node:20\n'; break;
    case 'python': ci += 'python:3.12\n'; break;
    case 'go': ci += 'golang:1.22\n'; break;
    default: ci += 'alpine:latest\n';
  }
  ci += `  script:\n`;
  switch (args.projectType) {
    case 'node':
      ci += `    - npm ci\n    - npm run build\n`;
      break;
    case 'python':
      ci += `    - pip install -r requirements.txt\n    - python -m build\n`;
      break;
    case 'go':
      ci += `    - go mod download\n    - go build ./...\n`;
      break;
    default:
      ci += `    - echo "Build step"\n`;
  }
  ci += `  artifacts:\n    paths:\n      - dist/\n    expire_in: 1 week\n\n`;

  // Test stage
  ci += `test:\n  stage: test\n  script:\n`;
  switch (args.projectType) {
    case 'node':
      ci += `    - npm test\n`;
      break;
    case 'python':
      ci += `    - python -m pytest\n`;
      break;
    case 'go':
      ci += `    - go test ./...\n`;
      break;
    default:
      ci += `    - echo "Test step"\n`;
  }

  // Services
  if (args.services && args.services.length > 0) {
    ci += `  services:\n`;
    for (const svc of args.services) {
      if (svc === 'postgres') ci += `    - postgres:15\n`;
      if (svc === 'redis') ci += `    - redis:7\n`;
    }
  }

  // Deploy stage
  if (args.deployTarget) {
    ci += `\ndeploy:\n  stage: deploy\n  only:\n    - main\n  script:\n    - echo "Deploying to ${args.deployTarget}"\n`;
  }

  return ci;
}

export const cicdTool: Tool = {
  name: 'CICD',
  description:
    'Generate and manage CI/CD pipelines: GitHub Actions workflows, GitLab CI configs. Supports Node, Python, Go, Rust, Java, Docker, static sites. Auto-generates build, test, deploy stages.',
  permission: 'allow',
  inputSchema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['generate', 'list', 'validate', 'enable', 'disable', 'status'],
        description: 'CI/CD action',
      },
      platform: { type: 'string', enum: ['github', 'gitlab'], description: 'CI platform (default github)' },
      projectType: { type: 'string', enum: ['node', 'python', 'go', 'rust', 'java', 'dotnet', 'docker', 'static'] },
      name: { type: 'string', description: 'Pipeline name' },
      triggers: { type: 'array', items: { type: 'string' }, description: 'Triggers (push, pull_request, schedule, workflow_dispatch)' },
      steps: { type: 'array', description: 'Custom steps' },
      branches: { type: 'array', items: { type: 'string' }, description: 'Branches to trigger on' },
      env: { type: 'object', description: 'Environment variables' },
      services: { type: 'array', items: { type: 'string' }, description: 'Services (postgres, redis, mysql)' },
      artifacts: { type: 'array', items: { type: 'string' }, description: 'Artifact paths' },
      deployTarget: { type: 'string', description: 'Deployment target (vercel, netlify, aws, etc.)' },
      filename: { type: 'string', description: 'Output filename' },
      outputDir: { type: 'string', description: 'Output directory' },
    },
    required: ['action'],
  },

  async execute(args: unknown, ctx: ToolContext): Promise<ToolResult> {
    const a = args as CICDArgs;

    try {
      switch (a.action) {
        case 'generate': {
          const platform = a.platform || 'github';
          let content: string;
          let filename: string;

          if (platform === 'gitlab') {
            content = generateGitLabCI(a);
            filename = a.filename || '.gitlab-ci.yml';
          } else {
            content = generateGitHubActions(a);
            filename = a.filename || `${a.name || 'ci-cd'}.yml`;
          }

          const outDir = a.outputDir || OUTPUT_DIR;
          if (platform === 'github') {
            const ghDir = join(outDir, '.github', 'workflows');
            await mkdir(ghDir, { recursive: true });
            const filePath = join(ghDir, filename);
            await writeFile(filePath, content);
            return { content: `GitHub Actions workflow created: ${filePath}\n\n${content}` };
          } else {
            await mkdir(outDir, { recursive: true });
            const filePath = join(outDir, filename);
            await writeFile(filePath, content);
            return { content: `GitLab CI config created: ${filePath}\n\n${content}` };
          }
        }

        case 'list': {
          const { readdirSync } = await import('node:fs');
          const dir = a.outputDir || OUTPUT_DIR;
          try {
            const files: string[] = [];
            const walk = (d: string) => {
              for (const f of readdirSync(d, { withFileTypes: true })) {
                if (f.isDirectory()) walk(join(d, f.name));
                else if (/\.(yml|yaml)$/i.test(f.name)) files.push(join(d, f.name));
              }
            };
            walk(dir);
            return { content: `CI/CD files:\n${files.map((f) => `  ${f}`).join('\n') || '(none)'}` };
          } catch {
            return { content: 'No CI/CD files found' };
          }
        }

        case 'validate': {
          const { readFileSync, existsSync } = await import('node:fs');
          const dir = a.outputDir || OUTPUT_DIR;
          const file = a.filename ? join(dir, a.filename) : join(dir, '.github', 'workflows', a.filename || 'ci-cd.yml');
          if (!existsSync(file)) return { content: `File not found: ${file}`, is_error: true };
          const content = readFileSync(file, 'utf-8');
          // Basic YAML validation
          const errors: string[] = [];
          if (!content.includes('name:')) errors.push('Missing "name" field');
          if (!content.includes('on:')) errors.push('Missing "on" trigger');
          if (!content.includes('jobs:')) errors.push('Missing "jobs" section');
          if (errors.length > 0) {
            return { content: `Validation errors:\n${errors.map((e) => `  - ${e}`).join('\n')}`, is_error: true };
          }
          return { content: `Validation passed: ${file}` };
        }

        case 'enable':
        case 'disable': {
          return { content: `${a.action}: Use "git" to enable/disable workflows by committing/removing the workflow file` };
        }

        case 'status': {
          return { content: 'CI/CD Status: Check your platform dashboard (GitHub Actions / GitLab CI) for pipeline status' };
        }

        default:
          return { content: `Unknown action: ${a.action}`, is_error: true };
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { content: `CI/CD error: ${msg}`, is_error: true };
    }
  },
};
