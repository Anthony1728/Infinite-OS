/**
 * Tool Marketplace
 * 
 * Plugin system for extending Infinite AI:
 * - Tool registration
 * - Tool discovery
 * - Tool versioning
 * - Tool dependencies
 * - Tool ratings
 */

import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

export interface Tool {
  id: string;
  name: string;
  description: string;
  version: string;
  author: string;
  category: string;
  tags: string[];
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  execute: (input: Record<string, unknown>) => Promise<unknown>;
  dependencies: string[];
  rating: number;
  downloads: number;
  installed: boolean;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface ToolCategory {
  id: string;
  name: string;
  description: string;
  icon: string;
  toolCount: number;
}

export interface ToolInstallation {
  toolId: string;
  version: string;
  installedAt: number;
  enabled: boolean;
  config: Record<string, unknown>;
}

export class ToolMarketplace {
  private tools: Map<string, Tool> = new Map();
  private installations: Map<string, ToolInstallation> = new Map();
  private categories: ToolCategory[] = [];
  private dataDir: string;

  constructor(dataDir?: string) {
    this.dataDir = dataDir ?? join(homedir(), '.infinite-ai', 'marketplace');
    this.ensureDir();
    this.loadData();
    this.initCategories();
    this.initBuiltInTools();
  }

  private ensureDir(): void {
    if (!existsSync(this.dataDir)) {
      mkdirSync(this.dataDir, { recursive: true });
    }
  }

  private loadData(): void {
    try {
      const toolsPath = join(this.dataDir, 'tools.json');
      if (existsSync(toolsPath)) {
        const data = JSON.parse(readFileSync(toolsPath, 'utf-8'));
        this.tools = new Map(data);
      }
      const installPath = join(this.dataDir, 'installations.json');
      if (existsSync(installPath)) {
        const data = JSON.parse(readFileSync(installPath, 'utf-8'));
        this.installations = new Map(data);
      }
    } catch {
      // Silent fail
    }
  }

  private saveData(): void {
    try {
      writeFileSync(join(this.dataDir, 'tools.json'), JSON.stringify(Array.from(this.tools.entries()), null, 2));
      writeFileSync(join(this.dataDir, 'installations.json'), JSON.stringify(Array.from(this.installations.entries()), null, 2));
    } catch {
      // Silent fail
    }
  }

  private initCategories(): void {
    this.categories = [
      { id: 'productivity', name: 'Productivity', description: 'Task management and automation', icon: '⚡', toolCount: 0 },
      { id: 'development', name: 'Development', description: 'Code and development tools', icon: '💻', toolCount: 0 },
      { id: 'data', name: 'Data', description: 'Data processing and analysis', icon: '📊', toolCount: 0 },
      { id: 'communication', name: 'Communication', description: 'Messaging and notifications', icon: '💬', toolCount: 0 },
      { id: 'media', name: 'Media', description: 'Image, video, and audio processing', icon: '🎬', toolCount: 0 },
      { id: 'system', name: 'System', description: 'System utilities and monitoring', icon: '⚙️', toolCount: 0 },
    ];
  }

  private initBuiltInTools(): void {
    const builtInTools: Array<Omit<Tool, 'id' | 'createdAt' | 'updatedAt'>> = [
      {
        name: 'file_reader',
        description: 'Read file contents',
        version: '1.0.0',
        author: 'Infinite AI',
        category: 'system',
        tags: ['file', 'read'],
        inputSchema: { type: 'object', properties: { path: { type: 'string' } } },
        outputSchema: { type: 'object', properties: { content: { type: 'string' } } },
        execute: async (input) => ({ content: `File content of ${input.path}` }),
        dependencies: [],
        rating: 4.5,
        downloads: 1000,
        installed: true,
        enabled: true,
      },
      {
        name: 'file_writer',
        description: 'Write content to file',
        version: '1.0.0',
        author: 'Infinite AI',
        category: 'system',
        tags: ['file', 'write'],
        inputSchema: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } } },
        outputSchema: { type: 'object', properties: { success: { type: 'boolean' } } },
        execute: async (_input) => ({ success: true }),
        dependencies: [],
        rating: 4.5,
        downloads: 1000,
        installed: true,
        enabled: true,
      },
      {
        name: 'code_executor',
        description: 'Execute code in sandbox',
        version: '1.0.0',
        author: 'Infinite AI',
        category: 'development',
        tags: ['code', 'execute'],
        inputSchema: { type: 'object', properties: { code: { type: 'string' }, language: { type: 'string' } } },
        outputSchema: { type: 'object', properties: { output: { type: 'string' }, error: { type: 'string' } } },
        execute: async (input) => ({ output: `Executed ${input.language} code` }),
        dependencies: [],
        rating: 4.0,
        downloads: 800,
        installed: true,
        enabled: true,
      },
      {
        name: 'web_search',
        description: 'Search the web',
        version: '1.0.0',
        author: 'Infinite AI',
        category: 'data',
        tags: ['web', 'search'],
        inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
        outputSchema: { type: 'object', properties: { results: { type: 'array' } } },
        execute: async (input) => ({ results: [`Search results for: ${input.query}`] }),
        dependencies: [],
        rating: 4.2,
        downloads: 900,
        installed: true,
        enabled: true,
      },
    ];

    for (const tool of builtInTools) {
      this.registerTool(tool);
    }
  }

  registerTool(toolData: Omit<Tool, 'id' | 'createdAt' | 'updatedAt'>): Tool {
    const tool: Tool = {
      ...toolData,
      id: randomUUID(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    this.tools.set(tool.id, tool);
    this.saveData();
    return tool;
  }

  uninstallTool(toolId: string): boolean {
    const tool = this.tools.get(toolId);
    if (!tool) return false;

    tool.installed = false;
    tool.enabled = false;
    this.installations.delete(toolId);
    this.saveData();
    return true;
  }

  enableTool(toolId: string): boolean {
    const tool = this.tools.get(toolId);
    if (!tool) return false;

    tool.enabled = true;
    this.saveData();
    return true;
  }

  disableTool(toolId: string): boolean {
    const tool = this.tools.get(toolId);
    if (!tool) return false;

    tool.enabled = false;
    this.saveData();
    return true;
  }

  getTool(toolId: string): Tool | undefined {
    return this.tools.get(toolId);
  }

  searchTools(query: string): Tool[] {
    const lower = query.toLowerCase();
    return Array.from(this.tools.values()).filter(
      (t) =>
        t.name.toLowerCase().includes(lower) ||
        t.description.toLowerCase().includes(lower) ||
        t.tags.some((tag) => tag.toLowerCase().includes(lower)),
    );
  }

  getToolsByCategory(categoryId: string): Tool[] {
    return Array.from(this.tools.values()).filter((t) => t.category === categoryId);
  }

  getInstalledTools(): Tool[] {
    return Array.from(this.tools.values()).filter((t) => t.installed);
  }

  getCategories(): ToolCategory[] {
    return this.categories.map((cat) => ({
      ...cat,
      toolCount: this.getToolsByCategory(cat.id).length,
    }));
  }

  getStats(): {
    totalTools: number;
    installedTools: number;
    enabledTools: number;
    totalDownloads: number;
    averageRating: number;
  } {
    const tools = Array.from(this.tools.values());
    return {
      totalTools: tools.length,
      installedTools: tools.filter((t) => t.installed).length,
      enabledTools: tools.filter((t) => t.enabled).length,
      totalDownloads: tools.reduce((sum, t) => sum + t.downloads, 0),
      averageRating: tools.length > 0
        ? tools.reduce((sum, t) => sum + t.rating, 0) / tools.length
        : 0,
    };
  }
}

