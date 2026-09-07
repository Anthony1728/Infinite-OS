/**
 * Workspace Semantic Indexing
 * 
 * Provides code semantic search using embeddings.
 * Supports file indexing, search, and semantic query.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync, readdirSync } from 'node:fs';
import { join, extname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { infiniteHome } from '../profiles/home.js';

export interface IndexedFile {
  id: string;
  path: string;
  content: string;
  language: string;
  hash: string;
  size: number;
  indexedAt: number;
  modifiedAt: number;
}

export interface SearchResult {
  file: IndexedFile;
  score: number;
  matches: Array<{
    line: number;
    content: string;
    snippet: string;
  }>;
}

export interface IndexStats {
  totalFiles: number;
  totalLines: number;
  languages: Record<string, number>;
  lastIndexed: number;
  size: number;
}

// Language detection by extension
const EXTENSION_TO_LANGUAGE: Record<string, string> = {
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.py': 'python',
  '.rb': 'ruby',
  '.go': 'go',
  '.rs': 'rust',
  '.java': 'java',
  '.c': 'c',
  '.cpp': 'cpp',
  '.h': 'c',
  '.hpp': 'cpp',
  '.cs': 'csharp',
  '.php': 'php',
  '.swift': 'swift',
  '.kt': 'kotlin',
  '.scala': 'scala',
  '.vue': 'vue',
  '.svelte': 'svelte',
  '.html': 'html',
  '.css': 'css',
  '.scss': 'scss',
  '.less': 'less',
  '.json': 'json',
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.xml': 'xml',
  '.md': 'markdown',
  '.sql': 'sql',
  '.sh': 'bash',
  '.bash': 'bash',
  '.zsh': 'bash',
  '.ps1': 'powershell',
  '.psm1': 'powershell',
  '.dockerfile': 'dockerfile',
};

const EXCLUDED_DIRS = new Set([
  'node_modules', '.git', '.svn', '.hg',
  'dist', 'build', 'out', 'target', 'bin',
  '.next', '.nuxt', '.svelte-kit',
  '__pycache__', '.pytest_cache', 'venv', '.venv',
  '.cache', '.tmp', 'temp',
]);

const EXCLUDED_EXTENSIONS = new Set([
  '.exe', '.dll', '.so', '.dylib', '.o', '.obj',
  '.png', '.jpg', '.jpeg', '.gif', '.ico', '.svg', '.webp',
  '.mp3', '.mp4', '.wav', '.webm', '.avi',
  '.zip', '.tar', '.gz', '.rar', '.7z',
  '.pdf', '.doc', '.docx', '.xls', '.xlsx',
  '.lock', '.map',
]);

/**
 * Simple embedding generator
 * In production, this would use Ollama or an external API
 */
function generateEmbedding(text: string): number[] {
  // Simple hash-based pseudo-embedding for demo
  // Real implementation should use: Ollama embeddings API, OpenAI, etc.
  const embedding = new Array(384).fill(0);
  const words = text.toLowerCase().split(/\s+/);
  
  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    for (let j = 0; j < word.length; j++) {
      const idx = (word.charCodeAt(j) * (i + 1) * (j + 1)) % 384;
      embedding[idx] += 1;
    }
  }

  // Normalize
  const magnitude = Math.sqrt(embedding.reduce((sum, val) => sum + val * val, 0));
  if (magnitude > 0) {
    for (let i = 0; i < embedding.length; i++) {
      embedding[i] /= magnitude;
    }
  }

  return embedding;
}

/**
 * Cosine similarity between two vectors
 */
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  
  let dotProduct = 0;
  let magnitudeA = 0;
  let magnitudeB = 0;
  
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    magnitudeA += a[i] * a[i];
    magnitudeB += b[i] * b[i];
  }
  
  const magA = Math.sqrt(magnitudeA);
  const magB = Math.sqrt(magnitudeB);
  
  if (magA === 0 || magB === 0) return 0;
  return dotProduct / (magA * magB);
}

/**
 * Workspace Indexer
 */
export class WorkspaceIndexer {
  private dataDir: string;
  private index: Map<string, IndexedFile> = new Map();
  private embeddings: Map<string, number[]> = new Map();
  private lastIndexed: number = 0;

  constructor(dataDir?: string) {
    this.dataDir = dataDir ?? join(infiniteHome(), 'index');
    this.load();
  }

  /**
   * Build or rebuild the index
   */
  async buildIndex(paths: string[], force: boolean = false): Promise<{
    indexed: number;
    skipped: number;
    errors: string[];
  }> {
    const errors: string[] = [];
    let indexed = 0;
    let skipped = 0;

    for (const rootPath of paths) {
      try {
        const result = await this.indexDirectory(rootPath, force);
        indexed += result.indexed;
        skipped += result.skipped;
        errors.push(...result.errors);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        errors.push(`Failed to index ${rootPath}: ${message}`);
      }
    }

    this.lastIndexed = Date.now();
    this.save();

    return { indexed, skipped, errors };
  }

  /**
   * Index a single file
   */
  async indexFile(filePath: string): Promise<IndexedFile | null> {
    try {
      if (!existsSync(filePath)) return null;
      
      const stat = statSync(filePath);
      if (!stat.isFile()) return null;
      
      const ext = extname(filePath).toLowerCase();
      if (EXCLUDED_EXTENSIONS.has(ext)) return null;

      const content = readFileSync(filePath, 'utf-8');
      const hash = this.simpleHash(content);
      
      // Check if already indexed and unchanged
      const existing = this.getByPath(filePath);
      if (existing && existing.hash === hash) {
        return existing;
      }

      const indexedFile: IndexedFile = {
        id: randomUUID(),
        path: filePath,
        content,
        language: this.detectLanguage(filePath),
        hash,
        size: stat.size,
        indexedAt: Date.now(),
        modifiedAt: stat.mtimeMs,
      };

      this.index.set(indexedFile.id, indexedFile);
      this.embeddings.set(indexedFile.id, generateEmbedding(content));

      return indexedFile;
    } catch (err) {
      console.error('[WorkspaceIndexer] Failed to index file:', err);
      return null;
    }
  }

  /**
   * Remove a file from index
   */
  removeFile(filePath: string): boolean {
    const file = this.getByPath(filePath);
    if (!file) return false;

    this.index.delete(file.id);
    this.embeddings.delete(file.id);
    this.save();
    return true;
  }

  /**
   * Search the index
   */
  search(query: string, limit: number = 20): SearchResult[] {
    if (!query.trim()) return [];

    const queryEmbedding = generateEmbedding(query);
    const results: SearchResult[] = [];

    for (const [fileId, embedding] of this.embeddings) {
      const file = this.index.get(fileId);
      if (!file) continue;

      const score = cosineSimilarity(queryEmbedding, embedding);
      if (score < 0.1) continue; // Threshold

      // Find matching lines
      const lines = file.content.split('\n');
      const matches: SearchResult['matches'] = [];
      
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const lineLower = line.toLowerCase();
        const queryLower = query.toLowerCase();
        
        // Simple keyword matching
        const queryWords = queryLower.split(/\s+/);
        const matchCount = queryWords.filter(w => 
          w.length > 2 && lineLower.includes(w)
        ).length;
        
        if (matchCount > 0) {
          matches.push({
            line: i + 1,
            content: line,
            snippet: this.getSnippet(line, query),
          });
        }
      }

      // Sort matches by relevance
      matches.sort((a, b) => {
        const aLen = a.content.length;
        const bLen = b.content.length;
        return aLen - bLen;
      });

      results.push({
        file,
        score,
        matches: matches.slice(0, 5), // Top 5 matches per file
      });
    }

    // Sort by score
    results.sort((a, b) => b.score - a.score);

    return results.slice(0, limit);
  }

  /**
   * Text search (simple grep-like)
   */
  textSearch(query: string, fileFilter?: string): SearchResult[] {
    const results: SearchResult[] = [];
    const queryLower = query.toLowerCase();

    for (const file of this.index.values()) {
      if (fileFilter && !file.path.includes(fileFilter)) continue;

      const matches: SearchResult['matches'] = [];
      const lines = file.content.split('\n');

      for (let i = 0; i < lines.length; i++) {
        if (lines[i].toLowerCase().includes(queryLower)) {
          matches.push({
            line: i + 1,
            content: lines[i],
            snippet: this.getSnippet(lines[i], query),
          });
        }
      }

      if (matches.length > 0) {
        results.push({
          file,
          score: matches.length,
          matches,
        });
      }
    }

    return results.sort((a, b) => b.score - a.score);
  }

  /**
   * Get index status
   */
  getStatus(): IndexStats {
    const languages: Record<string, number> = {};
    let totalLines = 0;
    let totalSize = 0;

    for (const file of this.index.values()) {
      languages[file.language] = (languages[file.language] || 0) + 1;
      totalLines += file.content.split('\n').length;
      totalSize += file.size;
    }

    return {
      totalFiles: this.index.size,
      totalLines,
      languages,
      lastIndexed: this.lastIndexed,
      size: totalSize,
    };
  }

  /**
   * Clear the index
   */
  clear(): void {
    this.index.clear();
    this.embeddings.clear();
    this.save();
  }

  /**
   * Get file by path
   */
  getByPath(path: string): IndexedFile | undefined {
    for (const file of this.index.values()) {
      if (file.path === path) return file;
    }
    return undefined;
  }

  // Private helpers

  private async indexDirectory(
    dirPath: string,
    force: boolean,
    depth: number = 0
  ): Promise<{ indexed: number; skipped: number; errors: string[] }> {
    const errors: string[] = [];
    let indexed = 0;
    let skipped = 0;

    try {
      if (!existsSync(dirPath)) {
        return { indexed, skipped, errors };
      }

      const entries = readdirSync(dirPath, { withFileTypes: true });

      for (const entry of entries) {
        try {
          const fullPath = join(dirPath, entry.name);

          if (entry.isDirectory()) {
            if (EXCLUDED_DIRS.has(entry.name)) continue;
            if (depth > 20) continue; // Max depth

            const result = await this.indexDirectory(fullPath, force, depth + 1);
            indexed += result.indexed;
            skipped += result.skipped;
            errors.push(...result.errors);
          } else if (entry.isFile()) {
            const ext = extname(entry.name).toLowerCase();
            if (EXCLUDED_EXTENSIONS.has(ext)) {
              skipped++;
              continue;
            }

            const existing = this.getByPath(fullPath);
            if (!force && existing) {
              skipped++;
              continue;
            }

            const file = await this.indexFile(fullPath);
            if (file) {
              indexed++;
            } else {
              skipped++;
            }
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          errors.push(`Failed to process ${entry.name}: ${message}`);
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push(`Failed to read directory ${dirPath}: ${message}`);
    }

    return { indexed, skipped, errors };
  }

  private detectLanguage(filePath: string): string {
    const ext = extname(filePath).toLowerCase();
    return EXTENSION_TO_LANGUAGE[ext] ?? 'unknown';
  }

  private simpleHash(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return hash.toString(16);
  }

  private getSnippet(line: string, query: string): string {
    const maxLength = 100;
    if (line.length <= maxLength) return line;
    
    const queryLower = query.toLowerCase();
    const lineLower = line.toLowerCase();
    const index = lineLower.indexOf(queryLower.split(/\s+/)[0]);
    
    if (index === -1) return line.slice(0, maxLength) + '...';
    
    const start = Math.max(0, index - 20);
    const end = Math.min(line.length, index + query.length + 40);
    
    return (start > 0 ? '...' : '') + line.slice(start, end) + (end < line.length ? '...' : '');
  }

  private save(): void {
    try {
      if (!existsSync(this.dataDir)) {
        mkdirSync(this.dataDir, { recursive: true });
      }

      const files: IndexedFile[] = [];
      for (const file of this.index.values()) {
        // Don't save full content, just metadata + hash
        files.push({
          ...file,
          content: '', // Don't persist content
        });
      }

      writeFileSync(
        join(this.dataDir, 'index.json'),
        JSON.stringify({
          files,
          lastIndexed: this.lastIndexed,
        }, null, 2)
      );
    } catch (err) {
      console.error('[WorkspaceIndexer] Failed to save:', err);
    }
  }

  private load(): void {
    try {
      if (!existsSync(this.dataDir)) return;

      const filePath = join(this.dataDir, 'index.json');
      if (!existsSync(filePath)) return;

      const data = JSON.parse(readFileSync(filePath, 'utf-8')) as {
        files: IndexedFile[];
        lastIndexed: number;
      };

      for (const file of data.files) {
        if (!existsSync(file.path)) continue;
        try {
          const content = readFileSync(file.path, 'utf-8');
          const hydrated = { ...file, content };
          this.index.set(file.id, hydrated);
          this.embeddings.set(file.id, generateEmbedding(content));
        } catch {
          // Skip files that became unreadable since the previous index.
        }
      }
      this.lastIndexed = data.lastIndexed;
    } catch (err) {
      console.error('[WorkspaceIndexer] Failed to load:', err);
    }
  }
}

// Singleton
let indexer: WorkspaceIndexer | null = null;

export function getWorkspaceIndexer(): WorkspaceIndexer {
  if (!indexer) {
    indexer = new WorkspaceIndexer();
  }
  return indexer;
}
