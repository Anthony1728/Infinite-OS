/**
 * Workspace Semantic Indexing
 * 
 * Provides code semantic search using embeddings.
 * Supports file indexing, search, and semantic query.
 * Vectors come from Ollama embedding models when available (real semantic
 * search, local + free) with a deterministic lexical fallback when offline.
 * Files are embedded as symbol/heading-aware chunks, not whole-file vectors.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync, readdirSync } from 'node:fs';
import { join, extname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { infiniteHome } from '../profiles/home.js';
import { embedText, lexicalVector, cosineSimilarity } from './embeddings.js';

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

/** A symbol/heading-aware chunk of a file with its own vector. */
export interface IndexedChunk {
  fileId: string;
  path: string;
  startLine: number;
  endLine: number;
  text: string;
  vector: number[];
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
 * Split file content into symbol/heading-aware chunks (~80 lines target).
 * Boundaries prefer function/class/def/section markers so a chunk is a
 * meaningful unit, then fall back to hard line cuts.
 */
export function chunkFileContent(content: string, targetLines = 80): Array<{ startLine: number; endLine: number; text: string }> {
  const lines = content.split('\n');
  if (lines.length <= targetLines) return [{ startLine: 1, endLine: lines.length, text: content }];
  const boundaryRe = /^(?:\s*(?:export\s+)?(?:async\s+)?(?:function|class|interface|type|struct|def|fn|func|const\s+[A-Z_][A-Za-z0-9_]*\s*=)\b|#{1,3}\s|\/\*\*|\/\/\s*={3,})/;
  const chunks: Array<{ startLine: number; endLine: number; text: string }> = [];
  let start = 0;
  while (start < lines.length) {
    let end = Math.min(start + targetLines, lines.length);
    if (end < lines.length) {
      // Look back up to 30 lines for a symbol boundary to cut at.
      for (let i = end; i > Math.max(start + targetLines - 30, start + 1); i--) {
        if (boundaryRe.test(lines[i])) { end = i; break; }
      }
    }
    chunks.push({ startLine: start + 1, endLine: end, text: lines.slice(start, end).join('\n') });
    start = end;
  }
  return chunks;
}

/**
 * Workspace Indexer
 */
export class WorkspaceIndexer {
  private dataDir: string;
  private index: Map<string, IndexedFile> = new Map();
  private embeddings: Map<string, number[]> = new Map();
  /** Symbol/heading-aware chunks with per-chunk vectors (the search unit). */
  private chunks: Map<string, IndexedChunk[]> = new Map();
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
      this.embeddings.set(indexedFile.id, await this.embedFor(content));
      await this.buildChunks(indexedFile);

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
    this.chunks.delete(file.id);
    this.chunkBackend.delete(file.id);
    this.upgradeQueued.delete(file.id);
    this.save();
    return true;
  }

  /** Best available embedding: Ollama model when present, lexical otherwise. */
  private async embedFor(text: string): Promise<number[]> {
    try {
      const { vector } = await embedText(text);
      return vector;
    } catch {
      return lexicalVector(text);
    }
  }

  /** Which backend produced a file's chunk vectors — lexical vectors must
   * never be cosine-compared against Ollama vectors (meaningless scores). */
  private chunkBackend: Map<string, 'lexical' | 'ollama'> = new Map();
  /** Files queued for a background Ollama re-embed so one search doesn't
   * queue the same repo fifty times. */
  private upgradeQueued: Set<string> = new Set();

  /** Chunk a freshly indexed file and embed each chunk. */
  private async buildChunks(file: IndexedFile): Promise<void> {
    const pieces = chunkFileContent(file.content);
    const chunks: IndexedChunk[] = [];
    let backend: 'lexical' | 'ollama' = 'lexical';
    for (const piece of pieces) {
      let vector: number[];
      try {
        const embedded = await embedText(`${file.path}\n${piece.text}`);
        vector = embedded.vector;
        if (embedded.backend === 'ollama') backend = 'ollama';
      } catch {
        vector = lexicalVector(`${file.path}\n${piece.text}`);
      }
      chunks.push({
        fileId: file.id,
        path: file.path,
        startLine: piece.startLine,
        endLine: piece.endLine,
        text: piece.text,
        vector,
      });
    }
    this.chunkBackend.set(file.id, backend);
    this.chunks.set(file.id, chunks);
  }

  /**
   * Search the index — chunk-level semantic search. Each chunk's vector is
   * compared to the query vector; the file's score is its best chunk so a
   * relevant function inside a big file surfaces without the whole file
   * diluting the signal.
   */
  search(query: string, limit: number = 20): SearchResult[] {
    if (!query.trim()) return [];

    const results: SearchResult[] = [];
    for (const [fileId, chunks] of this.chunks) {
      const file = this.index.get(fileId);
      if (!file) continue;

      const queryVector = lexicalVector(query); // sync path uses lexical; embedText is async
      let bestScore = 0;
      let bestMatches: SearchResult['matches'] = [];

      for (const chunk of chunks) {
        const score = cosineSimilarity(queryVector, chunk.vector);
        if (score > bestScore) {
          bestScore = score;
          const chunkLines = chunk.text.split('\n');
          const queryWords = query.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
          const matches: SearchResult['matches'] = [];
          for (let i = 0; i < chunkLines.length; i++) {
            const lineLower = chunkLines[i].toLowerCase();
            if (queryWords.some((w) => lineLower.includes(w))) {
              matches.push({
                line: chunk.startLine + i,
                content: chunkLines[i],
                snippet: this.getSnippet(chunkLines[i], query),
              });
            }
          }
          bestMatches = matches.slice(0, 5);
        }
      }

      if (bestScore >= 0.1 && bestMatches.length) {
        results.push({ file, score: bestScore, matches: bestMatches });
      }
    }

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, limit);
  }

  /**
   * Async search that embeds the query with the real backend (Ollama when
   * available), giving true semantic recall. Falls back to the sync lexical
   * path on any failure.
   */
  async searchSemantic(query: string, limit: number = 20): Promise<SearchResult[]> {
    if (!query.trim()) return [];
    try {
      const { vector: queryVector, backend } = await embedText(query);
      // Lexical twin of the query: restored-from-disk chunks carry lexical
      // vectors, and comparing those to an Ollama query vector produces
      // meaningless scores. Each chunk is scored against its own backend's
      // query vector only.
      const lexicalQueryVector = backend === 'ollama' ? lexicalVector(query) : queryVector;
      const results: SearchResult[] = [];
      for (const [fileId, chunks] of this.chunks) {
        const file = this.index.get(fileId);
        if (!file) continue;
        const chunkBackend = this.chunkBackend.get(fileId) ?? 'lexical';
        // One-shot upgrade: when the real embedding model is available but a
        // file's chunks are still lexical (fresh from load), re-embed them in
        // the background so every later query gets true semantic recall.
        if (backend === 'ollama' && chunkBackend === 'lexical' && !this.upgradeQueued.has(fileId)) {
          this.upgradeQueued.add(fileId);
          void this.buildChunks(file).catch(() => {
            // Upgrade failed — keep scoring lexically and allow a retry later.
            this.upgradeQueued.delete(fileId);
          });
        }
        let bestScore = 0;
        let bestChunk: IndexedChunk | null = null;
        for (const chunk of chunks) {
          const score = cosineSimilarity(
            chunkBackend === 'ollama' && backend === 'ollama' ? queryVector : lexicalQueryVector,
            chunk.vector,
          );
          if (score > bestScore) {
            bestScore = score;
            bestChunk = chunk;
          }
        }
        if (bestScore >= 0.1 && bestChunk) {
          const chunkLines = bestChunk.text.split('\n');
          const queryWords = query.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
          const matches: SearchResult['matches'] = chunkLines
            .map((line, i) => ({ line: bestChunk!.startLine + i, content: line, snippet: this.getSnippet(line, query) }))
            .filter((m) => queryWords.some((w) => m.content.toLowerCase().includes(w)))
            .slice(0, 5);
          results.push({ file, score: bestScore, matches: matches.length ? matches : [{ line: bestChunk.startLine, content: chunkLines[0] ?? '', snippet: '' }] });
        }
      }
      results.sort((a, b) => b.score - a.score);
      return results.slice(0, limit);
    } catch {
      return this.search(query, limit);
    }
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
    this.chunks.clear();
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
          this.embeddings.set(file.id, lexicalVector(content));
          // Rebuild the chunk map — search() and searchSemantic() iterate
          // this.chunks, so a load that skips this step left the index
          // "present but empty": every query returned zero results until a
          // forced re-index. Restored chunks are lexical; searchSemantic
          // upgrades them to Ollama vectors lazily on first semantic query.
          const pieces = chunkFileContent(content);
          this.chunks.set(file.id, pieces.map((piece) => ({
            fileId: file.id,
            path: file.path,
            startLine: piece.startLine,
            endLine: piece.endLine,
            text: piece.text,
            vector: lexicalVector(`${file.path}\n${piece.text}`),
          })));
          this.chunkBackend.set(file.id, 'lexical');
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
