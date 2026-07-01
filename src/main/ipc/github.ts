/**
 * GitHub IPC Handler
 */

import { ipcMain } from 'electron';
import { getGitHubManager } from '../github/manager.js';

export function registerGitHubIpc(): void {
  const github = getGitHubManager();

  // Configuration
  ipcMain.handle('github:setToken', async (_event, { token }: { token: string }) => {
    github.setToken(token);
    return { ok: true };
  });

  ipcMain.handle('github:setUsername', async (_event, { username }: { username: string }) => {
    github.setUsername(username);
    return { ok: true };
  });

  ipcMain.handle('github:isConfigured', async () => {
    return { ok: true, configured: github.isConfigured() };
  });

  // Repository operations
  ipcMain.handle('github:createRepo', async (_event, args: {
    name: string;
    description?: string;
    private?: boolean;
    autoInit?: boolean;
  }) => {
    try {
      const repo = await github.createRepo(args.name, args);
      return { ok: true, repo };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('github:getRepo', async (_event, args: { owner: string; repo: string }) => {
    try {
      const repo = await github.getRepo(args.owner, args.repo);
      return { ok: true, repo };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('github:listRepos', async (_event, args?: {
    type?: 'all' | 'owner' | 'member';
    sort?: 'created' | 'updated' | 'pushed' | 'full_name';
    perPage?: number;
  }) => {
    try {
      const repos = await github.listRepos(args);
      return { ok: true, repos };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('github:deleteRepo', async (_event, args: { owner: string; repo: string }) => {
    try {
      const deleted = await github.deleteRepo(args.owner, args.repo);
      return { ok: deleted };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('github:forkRepo', async (_event, args: { owner: string; repo: string }) => {
    try {
      const repo = await github.forkRepo(args.owner, args.repo);
      return { ok: true, repo };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  // File operations
  ipcMain.handle('github:getFile', async (_event, args: {
    owner: string;
    repo: string;
    path: string;
    ref?: string;
  }) => {
    try {
      const file = await github.getFile(args.owner, args.repo, args.path, args.ref);
      return { ok: true, ...file };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('github:saveFile', async (_event, args: {
    owner: string;
    repo: string;
    path: string;
    content: string;
    message: string;
    sha?: string;
    branch?: string;
  }) => {
    try {
      const result = await github.saveFile(
        args.owner, args.repo, args.path, args.content, args.message, args.sha, args.branch
      );
      return { ok: true, ...result };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('github:listContents', async (_event, args: {
    owner: string;
    repo: string;
    path: string;
  }) => {
    try {
      const contents = await github.listContents(args.owner, args.repo, args.path);
      return { ok: true, contents };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  // Branch operations
  ipcMain.handle('github:listBranches', async (_event, args: {
    owner: string;
    repo: string;
  }) => {
    try {
      const branches = await github.listBranches(args.owner, args.repo);
      return { ok: true, branches };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('github:createBranch', async (_event, args: {
    owner: string;
    repo: string;
    name: string;
    fromSha: string;
  }) => {
    try {
      const branch = await github.createBranch(args.owner, args.repo, args.name, args.fromSha);
      return { ok: true, branch };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  // Issue operations
  ipcMain.handle('github:createIssue', async (_event, args: {
    owner: string;
    repo: string;
    title: string;
    body: string;
    labels?: string[];
  }) => {
    try {
      const issue = await github.createIssue(args.owner, args.repo, args.title, args.body, {
        labels: args.labels,
      });
      return { ok: true, issue };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('github:listIssues', async (_event, args: {
    owner: string;
    repo: string;
    state?: 'open' | 'closed' | 'all';
  }) => {
    try {
      const issues = await github.listIssues(args.owner, args.repo, args);
      return { ok: true, issues };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('github:updateIssue', async (_event, args: {
    owner: string;
    repo: string;
    number: number;
    updates: { title?: string; body?: string; state?: 'open' | 'closed' };
  }) => {
    try {
      const issue = await github.updateIssue(args.owner, args.repo, args.number, args.updates);
      return { ok: true, issue };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  // Pull Request operations
  ipcMain.handle('github:createPR', async (_event, args: {
    owner: string;
    repo: string;
    title: string;
    body: string;
    head: string;
    base: string;
    draft?: boolean;
  }) => {
    try {
      const pr = await github.createPR(args.owner, args.repo, args.title, args.body, args.head, args.base, {
        draft: args.draft,
      });
      return { ok: true, pr };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('github:listPRs', async (_event, args: {
    owner: string;
    repo: string;
    state?: 'open' | 'closed' | 'all';
  }) => {
    try {
      const prs = await github.listPRs(args.owner, args.repo, args);
      return { ok: true, prs };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('github:mergePR', async (_event, args: {
    owner: string;
    repo: string;
    number: number;
    method?: 'merge' | 'squash' | 'rebase';
  }) => {
    try {
      const result = await github.mergePR(args.owner, args.repo, args.number, { method: args.method });
      return { ok: true, ...result };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  // Deployments
  ipcMain.handle('github:createDeployment', async (_event, args: {
    owner: string;
    repo: string;
    ref: string;
    environment?: string;
    description?: string;
  }) => {
    try {
      const deployment = await github.createDeployment(args.owner, args.repo, args.ref, args.environment, {
        description: args.description,
      });
      return { ok: true, deployment };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('github:listDeployments', async (_event, args: {
    owner: string;
    repo: string;
    environment?: string;
  }) => {
    try {
      const deployments = await github.listDeployments(args.owner, args.repo, args);
      return { ok: true, deployments };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  // Workflows
  ipcMain.handle('github:listWorkflowRuns', async (_event, args: {
    owner: string;
    repo: string;
    workflowId?: string;
    branch?: string;
  }) => {
    try {
      const runs = await github.listWorkflowRuns(args.owner, args.repo, args);
      return { ok: true, runs };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('github:triggerWorkflow', async (_event, args: {
    owner: string;
    repo: string;
    workflowId: string;
    ref: string;
    inputs?: Record<string, string>;
  }) => {
    try {
      const triggered = await github.triggerWorkflow(args.owner, args.repo, args.workflowId, args.ref, args.inputs);
      return { ok: triggered };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  // Git operations
  ipcMain.handle('github:cloneRepo', async (_event, args: {
    url: string;
    targetPath: string;
    depth?: number;
    branch?: string;
  }) => {
    try {
      const cloned = await github.cloneRepo(args.url, args.targetPath, args);
      return { ok: cloned };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('github:push', async (_event, args: {
    cwd: string;
    remote?: string;
    branch?: string;
  }) => {
    try {
      const pushed = await github.push(args.cwd, args.remote, args.branch);
      return { ok: pushed };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });
}