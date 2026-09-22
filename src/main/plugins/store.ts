/**
 * Plugin Store
 *
 * Manage plugins for extending Infinite AI:
 * - Install plugins
 * - Enable/disable plugins
 * - Plugin marketplace
 * - Plugin dependencies
 * - Plugin configuration
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { infiniteHome } from '../profiles/home.js';
import { execSync } from 'node:child_process';

export interface PluginConfig {
  dataDir: string;
}

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  category: string;
  icon: string;
  tags: string[];
  dependencies: string[];
  config: Record<string, { type: string; default: unknown; description: string }>;
  permissions: string[];
  minVersion: string;
}

export interface Plugin {
  manifest: PluginManifest;
  enabled: boolean;
  installed: boolean;
  installedAt?: number;
  config: Record<string, unknown>;
  rating: number;
  downloads: number;
}

export interface PluginCategory {
  id: string;
  name: string;
  description: string;
  icon: string;
}

export class PluginStore {
  private config: PluginConfig;
  private plugins: Map<string, Plugin> = new Map();
  private categories: PluginCategory[] = [];
  private dataDir: string;

  constructor(config?: Partial<PluginConfig>) {
    this.config = {
      dataDir: config?.dataDir ?? join(infiniteHome(), 'plugins'),
    };
    this.dataDir = this.config.dataDir;
    this.ensureDir();
    this.loadData();
    this.initCategories();
    this.initPlugins();
  }

  private ensureDir(): void {
    if (!existsSync(this.dataDir)) mkdirSync(this.dataDir, { recursive: true });
  }

  private loadData(): void {
    try {
      const pluginsPath = join(this.dataDir, 'plugins.json');
      if (existsSync(pluginsPath)) {
        const data = JSON.parse(readFileSync(pluginsPath, 'utf-8'));
        this.plugins = new Map(data);
      }
    } catch { /* silent */ }
  }

  private saveData(): void {
    try {
      writeFileSync(join(this.dataDir, 'plugins.json'), JSON.stringify(Array.from(this.plugins.entries()), null, 2));
    } catch { /* silent */ }
  }

  private initCategories(): void {
    this.categories = [
      { id: 'productivity', name: 'Productivity', description: 'Boost your workflow', icon: '⚡' },
      { id: 'development', name: 'Development', description: 'Code and dev tools', icon: '💻' },
      { id: 'data', name: 'Data', description: 'Data processing', icon: '📊' },
      { id: 'communication', name: 'Communication', description: 'Messaging and notifications', icon: '💬' },
      { id: 'media', name: 'Media', description: 'Image, video, audio', icon: '🎬' },
      { id: 'system', name: 'System', description: 'System utilities', icon: '⚙️' },
      { id: 'ai', name: 'AI', description: 'AI and ML tools', icon: '🤖' },
    ];
  }

  private initPlugins(): void {
    const builtIn: PluginManifest[] = [
      {
        id: 'github', name: 'GitHub Integration', version: '1.0.0', description: 'Git and GitHub integration',
        author: 'Infinite AI', category: 'development', icon: '🐙', tags: ['git', 'github'],
        dependencies: [], config: {}, permissions: ['read', 'write'], minVersion: '0.1.0',
      },
      {
        id: 'notion', name: 'Notion Sync', version: '1.0.0', description: 'Sync with Notion workspace',
        author: 'Infinite AI', category: 'productivity', icon: '📝', tags: ['notion', 'sync'],
        dependencies: [], config: { apiKey: { type: 'string', default: '', description: 'Notion API Key' } },
        permissions: ['read', 'write'], minVersion: '0.1.0',
      },
      {
        id: 'slack', name: 'Slack Notifications', version: '1.0.0', description: 'Send notifications to Slack',
        author: 'Infinite AI', category: 'communication', icon: '📢', tags: ['slack', 'notifications'],
        dependencies: [], config: { webhookUrl: { type: 'string', default: '', description: 'Slack Webhook URL' } },
        permissions: ['network'], minVersion: '0.1.0',
      },
      {
        id: 'openai-tools', name: 'OpenAI Extended Tools', version: '1.0.0', description: 'DALL-E, Whisper, and more',
        author: 'Infinite AI', category: 'ai', icon: '🧠', tags: ['openai', 'dalle', 'whisper'],
        dependencies: [], config: { apiKey: { type: 'string', default: '', description: 'OpenAI API Key' } },
        permissions: ['network'], minVersion: '0.1.0',
      },
      {
        id: 'docker', name: 'Docker Manager', version: '1.0.0', description: 'Manage Docker containers',
        author: 'Infinite AI', category: 'system', icon: '🐳', tags: ['docker', 'containers'],
        dependencies: [], config: {}, permissions: ['execute', 'system'], minVersion: '0.1.0',
      },
    ];

    for (const manifest of builtIn) {
      if (!this.plugins.has(manifest.id)) {
        this.plugins.set(manifest.id, {
          manifest,
          enabled: true,
          installed: true,
          installedAt: Date.now(),
          config: {},
          rating: 4.5,
          downloads: Math.floor(Math.random() * 10000),
        });
      }
    }
    this.saveData();
  }

  installPlugin(manifest: PluginManifest): Plugin {
    const plugin: Plugin = {
      manifest,
      enabled: true,
      installed: true,
      installedAt: Date.now(),
      config: {},
      rating: 0,
      downloads: 0,
    };
    this.plugins.set(manifest.id, plugin);
    this.saveData();
    return plugin;
  }

  uninstallPlugin(pluginId: string): boolean {
    const plugin = this.plugins.get(pluginId);
    if (!plugin || !plugin.installed) return false;
    plugin.installed = false;
    plugin.enabled = false;
    this.saveData();
    return true;
  }

  enablePlugin(pluginId: string): boolean {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) return false;
    plugin.enabled = true;
    this.saveData();
    return true;
  }

  disablePlugin(pluginId: string): boolean {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) return false;
    plugin.enabled = false;
    this.saveData();
    return true;
  }

  async executePluginCommand(pluginId: string, command: string, args?: Record<string, unknown>): Promise<{ success: boolean; result?: string; error?: string }> {
    const plugin = this.plugins.get(pluginId);
    if (!plugin || !plugin.installed || !plugin.enabled) {
      return { success: false, error: 'Plugin not installed or disabled' };
    }

    try {
      switch (pluginId) {
        case 'github':
          return this.executeGitHubPlugin(command, args);
        case 'notion':
          return this.executeNotionPlugin(command, args);
        case 'slack':
          return this.executeSlackPlugin(command, args);
        case 'openai-tools':
          return this.executeOpenAIToolsPlugin(command, args);
        case 'docker':
          return this.executeDockerPlugin(command, args);
        default:
          return { success: false, error: `Unknown command: ${command}` };
      }
    } catch (e) {
      return { success: false, error: (e as Error).message };
    }
  }

  private pluginToken(pluginId: string): string {
    const cfg = this.plugins.get(pluginId)?.config ?? {};
    const raw = (cfg.token ?? cfg.apiKey ?? '') as unknown;
    return typeof raw === 'string' ? raw.trim() : '';
  }

  private async executeGitHubPlugin(command: string, args?: Record<string, unknown>): Promise<{ success: boolean; result?: string; error?: string }> {
    const token = this.pluginToken('github');
    
    switch (command) {
      case 'list_repos': {
        if (!token) return { success: false, error: 'GitHub token not configured' };
        try {
          const res = await fetch('https://api.github.com/user/repos?per_page=10', {
            headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
            signal: AbortSignal.timeout(15000),
          });
          if (!res.ok) return { success: false, error: `GitHub HTTP ${res.status}` };
          const repos = (await res.json()) as Array<{ name: string; description?: string }>;
          return { success: true, result: repos.map((r) => `${r.name}: ${r.description || 'No description'}`).join('\n') };
        } catch (e) {
          return { success: false, error: (e as Error).message };
        }
      }
      case 'create_issue': {
        if (!token) return { success: false, error: 'GitHub token not configured' };
        const repo = args?.repo as string;
        const title = args?.title as string;
        const body = args?.body as string;
        if (!repo || !title) return { success: false, error: 'repo and title required' };
        if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) return { success: false, error: 'Invalid repo format. Use owner/repo.' };
        try {
          const res = await fetch(`https://api.github.com/repos/${repo}/issues`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/vnd.github+json' },
            body: JSON.stringify({ title, body: body || '' }),
            signal: AbortSignal.timeout(15000),
          });
          if (!res.ok) return { success: false, error: `GitHub HTTP ${res.status}` };
          const issue = (await res.json()) as { number: number; html_url: string };
          return { success: true, result: `Created issue #${issue.number}: ${issue.html_url}` };
        } catch (e) {
          return { success: false, error: (e as Error).message };
        }
      }
      default:
        return { success: false, error: `Unknown GitHub command: ${command}` };
    }
  }

  private async executeNotionPlugin(command: string, _args?: Record<string, unknown>): Promise<{ success: boolean; result?: string; error?: string }> {
    const token = this.pluginToken('notion');
    
    switch (command) {
      case 'list_pages': {
        if (!token) return { success: false, error: 'Notion token not configured' };
        try {
          const res = await fetch('https://api.notion.com/v1/search', {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}`, 'Notion-Version': '2022-06-28', 'Content-Type': 'application/json' },
            body: JSON.stringify({ page_size: 10 }),
            signal: AbortSignal.timeout(15000),
          });
          if (!res.ok) return { success: false, error: `Notion HTTP ${res.status}` };
          const data = (await res.json()) as { results?: Array<{ properties?: { title?: { title?: Array<{ plain_text?: string }> } } }> };
          return { success: true, result: data.results?.map((r) => `${r.properties?.title?.title?.[0]?.plain_text || 'Untitled'}`).join('\n') || 'No pages found' };
        } catch (e) {
          return { success: false, error: (e as Error).message };
        }
      }
      default:
        return { success: false, error: `Unknown Notion command: ${command}` };
    }
  }

  private async executeSlackPlugin(command: string, args?: Record<string, unknown>): Promise<{ success: boolean; result?: string; error?: string }> {
    const token = this.pluginToken('slack');
    
    switch (command) {
      case 'list_channels': {
        if (!token) return { success: false, error: 'Slack token not configured' };
        try {
          const res = await fetch('https://slack.com/api/conversations.list', {
            headers: { Authorization: `Bearer ${token}` },
            signal: AbortSignal.timeout(15000),
          });
          if (!res.ok) return { success: false, error: `Slack HTTP ${res.status}` };
          const data = (await res.json()) as { channels?: Array<{ name: string }> };
          return { success: true, result: data.channels?.map((c) => `#${c.name}`).join('\n') || 'No channels found' };
        } catch (e) {
          return { success: false, error: (e as Error).message };
        }
      }
      case 'send_message': {
        if (!token) return { success: false, error: 'Slack token not configured' };
        const channel = args?.channel as string;
        const text = args?.text as string;
        if (!channel || !text) return { success: false, error: 'channel and text required' };
        try {
          const res = await fetch('https://slack.com/api/chat.postMessage', {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ channel, text }),
            signal: AbortSignal.timeout(15000),
          });
          const data = (await res.json()) as { ok: boolean; error?: string };
          return { success: data.ok, result: data.ok ? 'Message sent' : data.error };
        } catch (e) {
          return { success: false, error: (e as Error).message };
        }
      }
      default:
        return { success: false, error: `Unknown Slack command: ${command}` };
    }
  }

  private async executeOpenAIToolsPlugin(command: string, _args?: Record<string, unknown>): Promise<{ success: boolean; result?: string; error?: string }> {
    const token = this.pluginToken('openai-tools');
    switch (command) {
      case 'status': {
        if (!token) return { success: false, error: 'OpenAI API key not configured (Plugin → OpenAI Extended Tools → apiKey)' };
        try {
          const res = await fetch('https://api.openai.com/v1/models', {
            headers: { Authorization: `Bearer ${token}` },
            signal: AbortSignal.timeout(15000),
          });
          return res.ok
            ? { success: true, result: 'OpenAI Extended Tools connected.' }
            : { success: false, error: `OpenAI HTTP ${res.status}` };
        } catch (e) {
          return { success: false, error: (e as Error).message };
        }
      }
      default:
        return { success: false, error: `Unknown OpenAI tools command: ${command}. Available: status` };
    }
  }

  private async executeDockerPlugin(command: string, args?: Record<string, unknown>): Promise<{ success: boolean; result?: string; error?: string }> {
    switch (command) {
      case 'list_containers': {
        try {
          const result = execSync('docker ps -a --format "{{.Names}}\t{{.Status}}\t{{.Image}}"', { encoding: 'utf-8' });
          return { success: true, result: result || 'No containers found' };
        } catch {
          return { success: false, error: 'Docker not running or not installed' };
        }
      }
      case 'list_images': {
        try {
          const result = execSync('docker images --format "{{.Repository}}:{{.Tag}}\t{{.Size}}"', { encoding: 'utf-8' });
          return { success: true, result: result || 'No images found' };
        } catch {
          return { success: false, error: 'Docker not running or not installed' };
        }
      }
      case 'run': {
        const image = args?.image as string;
        const name = args?.name as string;
        if (!image) return { success: false, error: 'image required' };
        if (!/^[\w][\w.:/-]{0,255}$/.test(image)) return { success: false, error: 'Invalid image name.' };
        if (name && !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(name)) return { success: false, error: 'Invalid container name.' };
        try {
          const { execFileSync } = await import('node:child_process');
          const result = name
            ? execFileSync('docker', ['run', '-d', '--name', name, image], { encoding: 'utf-8' })
            : execFileSync('docker', ['run', '-d', image], { encoding: 'utf-8' });
          return { success: true, result: `Container started: ${result.trim()}` };
        } catch (e) {
          return { success: false, error: (e as Error).message };
        }
      }
      case 'stop': {
        const container = args?.container as string;
        if (!container) return { success: false, error: 'container required' };
        if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(container)) return { success: false, error: 'Invalid container name.' };
        try {
          const { execFileSync } = await import('node:child_process');
          execFileSync('docker', ['stop', container]);
          return { success: true, result: `Container ${container} stopped` };
        } catch (e) {
          return { success: false, error: (e as Error).message };
        }
      }
      default:
        return { success: false, error: `Unknown Docker command: ${command}` };
    }
  }

  updatePluginConfig(pluginId: string, config: Record<string, unknown>): boolean {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) return false;
    plugin.config = { ...plugin.config, ...config };
    this.saveData();
    return true;
  }

  searchPlugins(query: string): Plugin[] {
    const lower = query.toLowerCase();
    return Array.from(this.plugins.values()).filter(
      (p) => p.manifest.name.toLowerCase().includes(lower) ||
        p.manifest.description.toLowerCase().includes(lower) ||
        p.manifest.tags.some((t) => t.toLowerCase().includes(lower)),
    );
  }

  getPluginsByCategory(categoryId: string): Plugin[] {
    return Array.from(this.plugins.values()).filter((p) => p.manifest.category === categoryId);
  }

  getInstalledPlugins(): Plugin[] {
    return Array.from(this.plugins.values()).filter((p) => p.installed);
  }

  getPlugin(pluginId: string): Plugin | undefined {
    return this.plugins.get(pluginId);
  }

  listPlugins(): Plugin[] {
    return Array.from(this.plugins.values());
  }

  getCategories(): PluginCategory[] {
    return this.categories;
  }

  getStats(): {
    totalPlugins: number;
    installedPlugins: number;
    enabledPlugins: number;
    totalDownloads: number;
  } {
    const plugins = Array.from(this.plugins.values());
    return {
      totalPlugins: plugins.length,
      installedPlugins: plugins.filter((p) => p.installed).length,
      enabledPlugins: plugins.filter((p) => p.enabled).length,
      totalDownloads: plugins.reduce((sum, p) => sum + p.downloads, 0),
    };
  }
}

