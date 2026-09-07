/**
 * GitHub Integration System
 * 
 * Full GitHub API integration for:
 * - Repository management (create, clone, delete)
 * - Issues and PR management
 * - Deployments
 * - Actions workflow management
 * - Code review
 */

import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { infiniteHome } from '../profiles/home.js';

export interface GitHubConfig {
  token?: string;
  username?: string;
  defaultBranch?: string;
}

export interface RepoInfo {
  id: number;
  name: string;
  fullName: string;
  description: string;
  private: boolean;
  htmlUrl: string;
  cloneUrl: string;
  defaultBranch: string;
  updatedAt: string;
}

export interface IssueInfo {
  id: number;
  number: number;
  title: string;
  body: string;
  state: 'open' | 'closed';
  labels: string[];
  assignees: string[];
  createdAt: string;
  updatedAt: string;
  htmlUrl: string;
}

export interface PRInfo {
  id: number;
  number: number;
  title: string;
  body: string;
  state: 'open' | 'closed' | 'merged';
  sourceBranch: string;
  targetBranch: string;
  createdAt: string;
  htmlUrl: string;
  merged: boolean;
  additions: number;
  deletions: number;
}

export interface DeploymentInfo {
  id: number;
  sha: string;
  ref: string;
  environment: string;
  state: 'pending' | 'success' | 'failure' | 'error' | 'queued';
  createdAt: string;
  htmlUrl: string;
}

export interface FileChange {
  path: string;
  contents?: string;
  operation: 'create' | 'modify' | 'delete';
  sha?: string;
}

/**
 * GitHub API Manager
 */
export class GitHubManager {
  private config: GitHubConfig;
  private dataDir: string;
  private baseUrl = 'https://api.github.com';

  constructor(config?: GitHubConfig) {
    this.config = {
      defaultBranch: 'main',
      ...config,
    };
    this.dataDir = join(infiniteHome(), 'github');
    this.ensureDir();
    this.loadConfig();
  }

  private ensureDir(): void {
    if (!existsSync(this.dataDir)) {
      mkdirSync(this.dataDir, { recursive: true });
    }
  }

  private loadConfig(): void {
    try {
      const configPath = join(this.dataDir, 'config.json');
      if (existsSync(configPath)) {
        const data = JSON.parse(readFileSync(configPath, 'utf-8'));
        this.config = { ...this.config, ...data };
      }
    } catch { /* silent */ }
  }

  private saveConfig(): void {
    try {
      const configPath = join(this.dataDir, 'config.json');
      writeFileSync(configPath, JSON.stringify(this.config, null, 2));
    } catch { /* silent */ }
  }

  /**
   * Set GitHub token
   */
  setToken(token: string): void {
    this.config.token = token;
    this.saveConfig();
  }

  /**
   * Set GitHub username
   */
  setUsername(username: string): void {
    this.config.username = username;
    this.saveConfig();
  }

  /**
   * Check if GitHub is configured
   */
  isConfigured(): boolean {
    return !!(this.config.token && this.config.username);
  }

  /**
   * Make authenticated API request
   */
  private async apiRequest(
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    endpoint: string,
    body?: unknown
  ): Promise<unknown> {
    if (!this.config.token) {
      throw new Error('GitHub token not configured. Use setToken() first.');
    }

    const url = `${this.baseUrl}${endpoint}`;

    return new Promise((resolve, reject) => {
      const child = spawn('curl', [
        '-s', '-X', method,
        '-H', `Authorization: Bearer ${this.config.token}`,
        '-H', `Accept: application/vnd.github+json`,
        '-H', `X-GitHub-Api-Version: 2022-11-28`,
        '-H', `Content-Type: application/json`,
        ...(body ? ['-d', JSON.stringify(body)] : []),
        url,
      ], { windowsHide: true });

      let output = '';
      child.stdout.on('data', (d) => { output += d.toString(); });
      child.on('close', (code) => {
        if (code === 0) {
          try {
            resolve(JSON.parse(output));
          } catch {
            resolve(output);
          }
        } else {
          reject(new Error(`GitHub API error: ${output}`));
        }
      });
      child.on('error', reject);
    });
  }

  // ========== REPOSITORY OPERATIONS ==========

  /**
   * Create a new repository
   */
  async createRepo(
    name: string,
    options: {
      description?: string;
      private?: boolean;
      autoInit?: boolean;
      gitignoreTemplate?: string;
      licenseTemplate?: string;
    } = {}
  ): Promise<RepoInfo> {
    const data = {
      name,
      description: options.description ?? '',
      private: options.private ?? false,
      auto_init: options.autoInit ?? true,
      ...(options.gitignoreTemplate && { gitignore_template: options.gitignoreTemplate }),
      ...(options.licenseTemplate && { license_template: options.licenseTemplate }),
    };

    const result = await this.apiRequest('POST', '/user/repos', data) as Record<string, unknown>;
    return this.parseRepoInfo(result);
  }

  /**
   * Get repository info
   */
  async getRepo(owner: string, repo: string): Promise<RepoInfo> {
    const result = await this.apiRequest('GET', `/repos/${owner}/${repo}`) as Record<string, unknown>;
    return this.parseRepoInfo(result);
  }

  /**
   * List user repositories
   */
  async listRepos(options?: {
    type?: 'all' | 'owner' | 'member';
    sort?: 'created' | 'updated' | 'pushed' | 'full_name';
    direction?: 'asc' | 'desc';
    perPage?: number;
    page?: number;
  }): Promise<RepoInfo[]> {
    const params = new URLSearchParams();
    if (options?.type) params.set('type', options.type);
    if (options?.sort) params.set('sort', options.sort);
    if (options?.direction) params.set('direction', options.direction);
    if (options?.perPage) params.set('per_page', String(options.perPage));
    if (options?.page) params.set('page', String(options.page));

    const result = await this.apiRequest('GET', `/user/repos?${params}`) as Record<string, unknown>[];
    return result.map(r => this.parseRepoInfo(r));
  }

  /**
   * Delete a repository
   */
  async deleteRepo(owner: string, repo: string): Promise<boolean> {
    try {
      await this.apiRequest('DELETE', `/repos/${owner}/${repo}`);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Fork a repository
   */
  async forkRepo(owner: string, repo: string): Promise<RepoInfo> {
    const result = await this.apiRequest('POST', `/repos/${owner}/${repo}/forks`) as Record<string, unknown>;
    return this.parseRepoInfo(result);
  }

  // ========== FILE OPERATIONS ==========

  /**
   * Get file contents
   */
  async getFile(owner: string, repo: string, path: string, ref?: string): Promise<{
    content: string;
    sha: string;
    encoding: string;
  }> {
    const endpoint = ref
      ? `/repos/${owner}/${repo}/contents/${path}?ref=${ref}`
      : `/repos/${owner}/${repo}/contents/${path}`;

    const result = await this.apiRequest('GET', endpoint) as Record<string, unknown>;
    
    // Content is base64 encoded
    const content = Buffer.from(result.content as string, 'base64').toString('utf-8');
    
    return {
      content,
      sha: result.sha as string,
      encoding: result.encoding as string,
    };
  }

  /**
   * Create or update a file
   */
  async saveFile(
    owner: string,
    repo: string,
    path: string,
    content: string,
    message: string,
    sha?: string,
    branch?: string
  ): Promise<{ commit: { sha: string; htmlUrl: string } }> {
    const data = {
      message,
      content: Buffer.from(content).toString('base64'),
      ...(sha && { sha }),
      ...(branch && { branch }),
    };

    return await this.apiRequest('PUT', `/repos/${owner}/${repo}/contents/${path}`, data) as { commit: { sha: string; htmlUrl: string } };
  }

  /**
   * Delete a file
   */
  async deleteFile(
    owner: string,
    repo: string,
    path: string,
    sha: string,
    message: string,
    branch?: string
  ): Promise<boolean> {
    const data = {
      message,
      sha,
      ...(branch && { branch }),
    };

    try {
      await this.apiRequest('DELETE', `/repos/${owner}/${repo}/contents/${path}`, data);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * List directory contents
   */
  async listContents(owner: string, repo: string, path: string): Promise<Array<{
    name: string;
    path: string;
    type: 'file' | 'dir';
    size: number;
    sha: string;
  }>> {
    const result = await this.apiRequest('GET', `/repos/${owner}/${repo}/contents/${path}`);
    
    // Single file response (not an array)
    if (!Array.isArray(result)) {
      const res = result as Record<string, unknown>;
      return [{
        name: res.name as string,
        path: res.path as string,
        type: (res.type as string) === 'dir' ? 'dir' as const : 'file' as const,
        size: (res.size as number) || 0,
        sha: res.sha as string,
      }];
    }

    return (result as Record<string, unknown>[]).map(item => ({
      name: item.name as string,
      path: item.path as string,
      type: (item.type as string) === 'dir' ? 'dir' as const : 'file' as const,
      size: (item.size as number) || 0,
      sha: item.sha as string,
    }));
  }

  // ========== BRANCH OPERATIONS ==========

  /**
   * List branches
   */
  async listBranches(owner: string, repo: string): Promise<Array<{
    name: string;
    protected: boolean;
    commit: { sha: string };
  }>> {
    const result = await this.apiRequest('GET', `/repos/${owner}/${repo}/branches`) as Record<string, unknown>[];
    return result.map(b => ({
      name: b.name as string,
      protected: b.protected as boolean,
      commit: b.commit as { sha: string },
    }));
  }

  /**
   * Create a branch
   */
  async createBranch(owner: string, repo: string, name: string, fromSha: string): Promise<{
    name: string;
    commit: { sha: string };
  }> {
    const result = await this.apiRequest('POST', `/repos/${owner}/${repo}/git/refs`, {
      ref: `refs/heads/${name}`,
      sha: fromSha,
    }) as Record<string, unknown>;

    return {
      name,
      commit: result.object as { sha: string },
    };
  }

  /**
   * Delete a branch
   */
  async deleteBranch(owner: string, repo: string, name: string): Promise<boolean> {
    try {
      await this.apiRequest('DELETE', `/repos/${owner}/${repo}/git/refs/heads/${name}`);
      return true;
    } catch {
      return false;
    }
  }

  // ========== COMMIT OPERATIONS ==========

  /**
   * Get commit history
   */
  async getCommits(owner: string, repo: string, options?: {
    sha?: string;
    path?: string;
    since?: string;
    until?: string;
    perPage?: number;
  }): Promise<Array<{
    sha: string;
    message: string;
    author: { name: string; email: string; date: string };
  }>> {
    const params = new URLSearchParams();
    if (options?.sha) params.set('sha', options.sha);
    if (options?.path) params.set('path', options.path);
    if (options?.since) params.set('since', options.since);
    if (options?.until) params.set('until', options.until);
    if (options?.perPage) params.set('per_page', String(options.perPage));

    const endpoint = `/repos/${owner}/${repo}/commits${params.toString() ? `?${params}` : ''}`;
    const result = await this.apiRequest('GET', endpoint) as Record<string, unknown>[];

    return result.map(c => ({
      sha: c.sha as string,
      message: (c.commit as Record<string, unknown>)?.message as string,
      author: {
        name: ((c.commit as Record<string, unknown>)?.author as Record<string, unknown>)?.name as string,
        email: ((c.commit as Record<string, unknown>)?.author as Record<string, unknown>)?.email as string,
        date: ((c.commit as Record<string, unknown>)?.author as Record<string, unknown>)?.date as string,
      },
    }));
  }

  /**
   * Create a commit
   */
  async createCommit(
    owner: string,
    repo: string,
    message: string,
    files: FileChange[],
    branch?: string
  ): Promise<{ sha: string; htmlUrl: string }> {
    // First, get current tree and SHA
    const baseRef = branch || this.config.defaultBranch;
    const refsResult = await this.apiRequest('GET', `/repos/${owner}/${repo}/git/refs/heads/${baseRef}`) as Record<string, unknown>;
    const refSha = (refsResult.object as Record<string, unknown>)?.sha as string;

    // Create blobs for each file
    const treeItems = await Promise.all(files.map(async file => {
      const blobResult = await this.apiRequest('POST', `/repos/${owner}/${repo}/git/blobs`, {
        content: file.contents,
        encoding: 'utf-8',
      }) as Record<string, unknown>;

      return {
        path: file.path,
        mode: '100644' as const,
        type: 'blob' as const,
        sha: blobResult.sha,
      };
    }));

    // Create tree
    const treeResult = await this.apiRequest('POST', `/repos/${owner}/${repo}/git/trees`, {
      base_tree: refSha,
      tree: treeItems,
    }) as Record<string, unknown>;

    // Create commit
    const commitResult = await this.apiRequest('POST', `/repos/${owner}/${repo}/git/commits`, {
      message,
      tree: treeResult.sha,
      parents: [refSha],
    }) as Record<string, unknown>;

    // Update ref
    await this.apiRequest('PATCH', `/repos/${owner}/${repo}/git/refs/heads/${baseRef}`, {
      sha: commitResult.sha,
    });

    return {
      sha: commitResult.sha as string,
      htmlUrl: `https://github.com/${owner}/${repo}/commit/${commitResult.sha}`,
    };
  }

  // ========== ISSUE OPERATIONS ==========

  /**
   * Create an issue
   */
  async createIssue(
    owner: string,
    repo: string,
    title: string,
    body: string,
    options?: {
      labels?: string[];
      assignees?: string[];
      milestone?: number;
    }
  ): Promise<IssueInfo> {
    const data: Record<string, unknown> = { title, body };
    if (options?.labels) data.labels = options.labels;
    if (options?.assignees) data.assignees = options.assignees;
    if (options?.milestone) data.milestone = options.milestone;

    const result = await this.apiRequest('POST', `/repos/${owner}/${repo}/issues`, data) as Record<string, unknown>;
    return this.parseIssueInfo(result);
  }

  /**
   * List issues
   */
  async listIssues(owner: string, repo: string, options?: {
    state?: 'open' | 'closed' | 'all';
    labels?: string;
    sort?: 'created' | 'updated' | 'comments';
    direction?: 'asc' | 'desc';
    perPage?: number;
  }): Promise<IssueInfo[]> {
    const params = new URLSearchParams();
    if (options?.state) params.set('state', options.state);
    if (options?.labels) params.set('labels', options.labels);
    if (options?.sort) params.set('sort', options.sort);
    if (options?.direction) params.set('direction', options.direction);
    if (options?.perPage) params.set('per_page', String(options.perPage));

    const result = await this.apiRequest('GET', `/repos/${owner}/${repo}/issues?${params}`) as Record<string, unknown>[];
    return result
      .filter(i => !i.pull_request) // Filter out PRs
      .map(i => this.parseIssueInfo(i));
  }

  /**
   * Get issue
   */
  async getIssue(owner: string, repo: string, number: number): Promise<IssueInfo> {
    const result = await this.apiRequest('GET', `/repos/${owner}/${repo}/issues/${number}`) as Record<string, unknown>;
    return this.parseIssueInfo(result);
  }

  /**
   * Update issue
   */
  async updateIssue(
    owner: string,
    repo: string,
    number: number,
    updates: Partial<{
      title: string;
      body: string;
      state: 'open' | 'closed';
      labels: string[];
      assignees: string[];
    }>
  ): Promise<IssueInfo> {
    const result = await this.apiRequest('PATCH', `/repos/${owner}/${repo}/issues/${number}`, updates) as Record<string, unknown>;
    return this.parseIssueInfo(result);
  }

  /**
   * Add comment to issue
   */
  async addIssueComment(owner: string, repo: string, number: number, body: string): Promise<{ id: number; htmlUrl: string }> {
    const result = await this.apiRequest('POST', `/repos/${owner}/${repo}/issues/${number}/comments`, { body }) as Record<string, unknown>;
    return { id: result.id as number, htmlUrl: result.html_url as string };
  }

  // ========== PULL REQUEST OPERATIONS ==========

  /**
   * Create a pull request
   */
  async createPR(
    owner: string,
    repo: string,
    title: string,
    body: string,
    head: string,
    base: string,
    options?: {
      draft?: boolean;
      maintainerCanModify?: boolean;
    }
  ): Promise<PRInfo> {
    const data = {
      title,
      body,
      head,
      base,
      ...(options?.draft !== undefined && { draft: options.draft }),
      ...(options?.maintainerCanModify !== undefined && { maintainer_can_modify: options.maintainerCanModify }),
    };

    const result = await this.apiRequest('POST', `/repos/${owner}/${repo}/pulls`, data) as Record<string, unknown>;
    return this.parsePRInfo(result);
  }

  /**
   * List pull requests
   */
  async listPRs(owner: string, repo: string, options?: {
    state?: 'open' | 'closed' | 'all';
    sort?: 'created' | 'updated' | 'popularity';
    direction?: 'asc' | 'desc';
  }): Promise<PRInfo[]> {
    const params = new URLSearchParams();
    if (options?.state) params.set('state', options.state);
    if (options?.sort) params.set('sort', options.sort);
    if (options?.direction) params.set('direction', options.direction);

    const result = await this.apiRequest('GET', `/repos/${owner}/${repo}/pulls?${params}`) as Record<string, unknown>[];
    return result.map(pr => this.parsePRInfo(pr));
  }

  /**
   * Merge a pull request
   */
  async mergePR(owner: string, repo: string, number: number, options?: {
    commitTitle?: string;
    commitMessage?: string;
    method?: 'merge' | 'squash' | 'rebase';
  }): Promise<{ merged: boolean; sha: string }> {
    const data = {
      ...(options?.commitTitle && { commit_title: options.commitTitle }),
      ...(options?.commitMessage && { commit_message: options.commitMessage }),
      ...(options?.method && { merge_method: options.method }),
    };

    const result = await this.apiRequest('PUT', `/repos/${owner}/${repo}/pulls/${number}/merge`, data) as Record<string, unknown>;
    return { merged: result.merged as boolean, sha: result.sha as string };
  }

  // ========== DEPLOYMENT OPERATIONS ==========

  /**
   * Create deployment
   */
  async createDeployment(
    owner: string,
    repo: string,
    ref: string,
    environment: string = 'production',
    options?: {
      description?: string;
      autoMerge?: boolean;
      requiredContexts?: string[];
    }
  ): Promise<DeploymentInfo> {
    const data = {
      ref,
      environment,
      ...(options?.description && { description: options.description }),
      ...(options?.autoMerge !== undefined && { auto_merge: options.autoMerge }),
      ...(options?.requiredContexts && { required_contexts: options.requiredContexts }),
    };

    const result = await this.apiRequest('POST', `/repos/${owner}/${repo}/deployments`, data) as Record<string, unknown>;
    return this.parseDeploymentInfo(result);
  }

  /**
   * List deployments
   */
  async listDeployments(owner: string, repo: string, options?: {
    environment?: string;
    perPage?: number;
  }): Promise<DeploymentInfo[]> {
    const params = new URLSearchParams();
    if (options?.environment) params.set('environment', options.environment);
    if (options?.perPage) params.set('per_page', String(options.perPage));

    const result = await this.apiRequest('GET', `/repos/${owner}/${repo}/deployments?${params}`) as Record<string, unknown>[];
    return result.map(d => this.parseDeploymentInfo(d));
  }

  /**
   * Create deployment status
   */
  async createDeploymentStatus(
    owner: string,
    repo: string,
    deploymentId: number,
    state: DeploymentInfo['state'],
    options?: {
      description?: string;
      environmentUrl?: string;
      logUrl?: string;
    }
  ): Promise<boolean> {
    const data = {
      state,
      ...(options?.description && { description: options.description }),
      ...(options?.environmentUrl && { environment_url: options.environmentUrl }),
      ...(options?.logUrl && { log_url: options.logUrl }),
    };

    try {
      await this.apiRequest('POST', `/repos/${owner}/${repo}/deployments/${deploymentId}/statuses`, data);
      return true;
    } catch {
      return false;
    }
  }

  // ========== GITHUB ACTIONS ==========

  /**
   * List workflow runs
   */
  async listWorkflowRuns(owner: string, repo: string, options?: {
    workflowId?: string;
    branch?: string;
    status?: string;
  }): Promise<Array<{
    id: number;
    name: string;
    headBranch: string;
    headSha: string;
    status: string;
    conclusion: string | null;
    createdAt: string;
    htmlUrl: string;
  }>> {
    const path = options?.workflowId
      ? `/repos/${owner}/${repo}/actions/workflows/${options.workflowId}/runs`
      : `/repos/${owner}/${repo}/actions/runs`;

    const params = new URLSearchParams();
    if (options?.branch) params.set('branch', options.branch);
    if (options?.status) params.set('status', options.status);

    const result = await this.apiRequest('GET', `${path}${params.toString() ? `?${params}` : ''}`) as Record<string, unknown>;
    const runs = (result.workflow_runs || result.workflow_runs) as Record<string, unknown>[];
    
    return runs.map(r => ({
      id: r.id as number,
      name: r.name as string,
      headBranch: r.head_branch as string,
      headSha: r.head_sha as string,
      status: r.status as string,
      conclusion: r.conclusion as string | null,
      createdAt: r.created_at as string,
      htmlUrl: r.html_url as string,
    }));
  }

  /**
   * Trigger workflow dispatch
   */
  async triggerWorkflow(owner: string, repo: string, workflowId: string, ref: string, inputs?: Record<string, string>): Promise<boolean> {
    try {
      await this.apiRequest('POST', `/repos/${owner}/${repo}/actions/workflows/${workflowId}/dispatches`, {
        ref,
        ...(inputs && { inputs }),
      });
      return true;
    } catch {
      return false;
    }
  }

  // ========== UTILITY METHODS ==========

  /**
   * Clone a repository using git
   */
  async cloneRepo(url: string, targetPath: string, options?: { depth?: number; branch?: string }): Promise<boolean> {
    return new Promise((resolve) => {
      const args = ['clone'];
      if (options?.depth) args.push('--depth', String(options.depth));
      if (options?.branch) args.push('--branch', options.branch);
      args.push(url, targetPath);

      const child = spawn('git', args, { windowsHide: true });
      child.on('close', (code) => resolve(code === 0));
      child.on('error', () => resolve(false));
    });
  }

  /**
   * Push to a repository
   */
  async push(cwd: string, remote: string = 'origin', branch: string = 'main'): Promise<boolean> {
    return new Promise((resolve) => {
      const child = spawn('git', ['push', remote, branch], { cwd, windowsHide: true });
      child.on('close', (code) => resolve(code === 0));
      child.on('error', () => resolve(false));
    });
  }

  private parseRepoInfo(data: Record<string, unknown>): RepoInfo {
    return {
      id: data.id as number,
      name: data.name as string,
      fullName: data.full_name as string,
      description: (data.description as string) || '',
      private: data.private as boolean,
      htmlUrl: data.html_url as string,
      cloneUrl: data.clone_url as string,
      defaultBranch: data.default_branch as string,
      updatedAt: data.updated_at as string,
    };
  }

  private parseIssueInfo(data: Record<string, unknown>): IssueInfo {
    const labels = (data.labels as Array<{ name: string }>)?.map(l => l.name) || [];
    const assignees = (data.assignees as Array<{ login: string }>)?.map(a => a.login) || [];

    return {
      id: data.id as number,
      number: data.number as number,
      title: data.title as string,
      body: (data.body as string) || '',
      state: data.state as 'open' | 'closed',
      labels,
      assignees,
      createdAt: data.created_at as string,
      updatedAt: data.updated_at as string,
      htmlUrl: data.html_url as string,
    };
  }

  private parsePRInfo(data: Record<string, unknown>): PRInfo {
    const head = data.head as Record<string, unknown> || {};
    const base = data.base as Record<string, unknown> || {};
    
    return {
      id: data.id as number,
      number: data.number as number,
      title: data.title as string,
      body: (data.body as string) || '',
      state: data.state as 'open' | 'closed',
      sourceBranch: (head.ref as string) || '',
      targetBranch: (base.ref as string) || '',
      createdAt: data.created_at as string,
      htmlUrl: data.html_url as string,
      merged: data.merged as boolean,
      additions: (data.additions as number) || 0,
      deletions: (data.deletions as number) || 0,
    };
  }

  private parseDeploymentInfo(data: Record<string, unknown>): DeploymentInfo {
    const statuses = data.statuses as Array<{ state: string }> | undefined;
    const deploymentObj = data.deployment as Record<string, unknown> | undefined;
    const deploymentStatuses = deploymentObj?.statuses as Array<{ state: string }> | undefined;
    const state = statuses?.[0]?.state || deploymentStatuses?.[0]?.state || 'pending';
    
    return {
      id: data.id as number,
      sha: data.sha as string,
      ref: (data.ref as string) || '',
      environment: (data.environment as string) || 'production',
      state: state as DeploymentInfo['state'],
      createdAt: data.created_at as string,
      htmlUrl: (data.url as string) || '',
    };
  }
}

// Singleton
let githubManager: GitHubManager | null = null;

export function getGitHubManager(): GitHubManager {
  if (!githubManager) {
    githubManager = new GitHubManager();
  }
  return githubManager;
}