/**
 * Code Completion Engine
 * 
 * Provides intelligent code completion suggestions.
 * Uses context-aware completion with language understanding.
 */

import { extname } from 'node:path';
import { randomUUID } from 'node:crypto';

export interface CompletionItem {
  id: string;
  label: string;
  kind: 'function' | 'method' | 'property' | 'variable' | 'class' | 'interface' | 'type' | 'keyword' | 'snippet';
  detail: string;
  documentation?: string;
  insertText: string;
  range: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
  score: number;
  source: 'syntax' | 'context' | 'ai' | 'imports';
}

export interface CompletionRequest {
  id: string;
  filePath: string;
  content: string;
  position: { line: number; character: number };
  language: string;
}

interface SymbolInfo {
  name: string;
  type: string;
  line: number;
  detail: string;
}

// Language-specific keywords and snippets
const LANGUAGE_KEYWORDS: Record<string, string[]> = {
  typescript: ['const', 'let', 'var', 'function', 'class', 'interface', 'type', 'enum', 'import', 'export', 'async', 'await', 'return', 'if', 'else', 'for', 'while', 'switch', 'case', 'default', 'try', 'catch', 'finally', 'throw', 'new', 'this', 'extends', 'implements', 'public', 'private', 'protected', 'static', 'readonly', 'abstract', 'as', 'typeof', 'keyof', 'in', 'of', 'from', 'namespace', 'module', 'declare', 'interface'],
  javascript: ['const', 'let', 'var', 'function', 'class', 'import', 'export', 'async', 'await', 'return', 'if', 'else', 'for', 'while', 'switch', 'case', 'default', 'try', 'catch', 'finally', 'throw', 'new', 'this', 'extends', 'super', 'from', 'of', 'in', 'yield'],
  python: ['def', 'class', 'if', 'elif', 'else', 'for', 'while', 'try', 'except', 'finally', 'with', 'as', 'import', 'from', 'return', 'yield', 'lambda', 'pass', 'break', 'continue', 'raise', 'assert', 'global', 'nonlocal', 'async', 'await', 'def', 'self', 'True', 'False', 'None'],
  go: ['func', 'type', 'struct', 'interface', 'package', 'import', 'var', 'const', 'if', 'else', 'for', 'range', 'switch', 'case', 'default', 'select', 'return', 'break', 'continue', 'goto', 'defer', 'go', 'chan', 'map', 'make', 'new', 'append', 'len', 'cap', 'copy'],
  rust: ['fn', 'let', 'mut', 'const', 'static', 'struct', 'enum', 'trait', 'impl', 'type', 'mod', 'use', 'pub', 'crate', 'super', 'self', 'Self', 'if', 'else', 'match', 'loop', 'while', 'for', 'in', 'return', 'break', 'continue', 'move', 'ref', 'as', 'where', 'async', 'await', 'dyn'],
  java: ['public', 'private', 'protected', 'class', 'interface', 'extends', 'implements', 'static', 'final', 'abstract', 'void', 'int', 'long', 'double', 'float', 'boolean', 'char', 'byte', 'short', 'new', 'return', 'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'default', 'try', 'catch', 'finally', 'throw', 'throws', 'import', 'package', 'this', 'super', 'true', 'false', 'null'],
};

const CODE_SNIPPETS: Record<string, Array<{ label: string; body: string; description: string }>> = {
  typescript: [
    { label: 'interface', body: 'interface ${1:Name} {\n  $0\n}', description: 'Interface definition' },
    { label: 'type', body: 'type ${1:Name} = ${2:Type};', description: 'Type alias' },
    { label: 'async', body: 'async function ${1:name}(${2:params}): Promise<${3:void}> {\n  $0\n}', description: 'Async function' },
    { label: 'export', body: 'export ${1:type} ${2:name};', description: 'Export declaration' },
    { label: 'trycatch', body: 'try {\n  $1\n} catch (${2:error}) {\n  $0\n}', description: 'Try-catch block' },
    { label: 'arrow', body: '(${1:args}) => ${2:expr}', description: 'Arrow function' },
  ],
  javascript: [
    { label: 'function', body: 'function ${1:name}(${2:params}) {\n  $0\n}', description: 'Function declaration' },
    { label: 'async', body: 'async function ${1:name}(${2:params}) {\n  $0\n}', description: 'Async function' },
    { label: 'trycatch', body: 'try {\n  $1\n} catch (${2:error}) {\n  $0\n}', description: 'Try-catch block' },
    { label: 'arrow', body: '(${1:args}) => ${2:expr}', description: 'Arrow function' },
    { label: 'foreach', body: '${1:array}.forEach((${2:item}) => {\n  $0\n});', description: 'forEach loop' },
    { label: 'promise', body: 'new Promise((resolve, reject) => {\n  $0\n});', description: 'Promise constructor' },
  ],
  python: [
    { label: 'def', body: 'def ${1:name}(${2:args}):\n    $0', description: 'Function definition' },
    { label: 'class', body: 'class ${1:Name}:\n    def __init__(self${2:, args}):\n        $0', description: 'Class definition' },
    { label: 'async', body: 'async def ${1:name}(${2:args}):\n    $0', description: 'Async function' },
    { label: 'with', body: 'with ${1:context}:\n    $0', description: 'With statement' },
    { label: 'try', body: 'try:\n    $1\nexcept ${2:Exception} as ${3:e}:\n    $0', description: 'Try-except' },
  ],
};

/**
 * Code Completion Engine
 */
export class CompletionEngine {
  private completions = new Map<string, CompletionRequest>();

  /**
   * Request completions for a position
   */
  getCompletions(
    filePath: string,
    content: string,
    position: { line: number; character: number }
  ): CompletionItem[] {
    const id = randomUUID();
    const language = this.detectLanguage(filePath);

    const request: CompletionRequest = {
      id,
      filePath,
      content,
      position,
      language,
    };

    this.completions.set(id, request);

    const items: CompletionItem[] = [];
    const line = content.split('\n')[position.line] ?? '';
    const prefix = this.getWordAtPosition(line, position.character);

    // 1. Keyword completions
    const keywords = LANGUAGE_KEYWORDS[language] ?? [];
    for (const keyword of keywords) {
      if (keyword.startsWith(prefix.toLowerCase()) && keyword !== prefix) {
        items.push(this.createCompletionItem(keyword, 'keyword', keyword, undefined, prefix, position, 'syntax'));
      }
    }

    // 2. Snippet completions
    const snippets = CODE_SNIPPETS[language] ?? [];
    for (const snippet of snippets) {
      if (snippet.label.startsWith(prefix)) {
        items.push(this.createCompletionItem(
          snippet.label,
          'snippet',
          snippet.description,
          snippet.description,
          prefix,
          position,
          'context',
          snippet.body
        ));
      }
    }

    // Sort by score
    items.sort((a, b) => b.score - a.score);

    return items.slice(0, 50); // Limit results
  }

  /**
   * Cancel a completion request
   */
  cancelCompletion(id: string): void {
    this.completions.delete(id);
  }

  /**
   * Extract symbols from content
   */
  extractSymbols(content: string): Map<string, SymbolInfo> {
    const symbols = new Map<string, SymbolInfo>();
    const lines = content.split('\n');

    const patterns: Record<string, RegExp[]> = {
      typescript: [
        /\b(?:export\s+)?(?:async\s+)?function\s+(\w+)/g,
        /\b(?:export\s+)?class\s+(\w+)/g,
        /\b(?:export\s+)?interface\s+(\w+)/g,
        /\b(?:export\s+)?type\s+(\w+)/g,
        /\bconst\s+(\w+)\s*=/g,
        /\blet\s+(\w+)\s*=/g,
        /\bvar\s+(\w+)\s*=/g,
      ],
      javascript: [
        /\b(?:export\s+)?(?:async\s+)?function\s+(\w+)/g,
        /\b(?:export\s+)?class\s+(\w+)/g,
        /\bconst\s+(\w+)\s*=/g,
        /\blet\s+(\w+)\s*=/g,
        /\bvar\s+(\w+)\s*=/g,
      ],
      python: [
        /\bdef\s+(\w+)/g,
        /\bclass\s+(\w+)/g,
      ],
      go: [
        /\bfunc\s+(?:\([^)]+\)\s+)?(\w+)/g,
        /\btype\s+(\w+)\s+struct/g,
        /\btype\s+(\w+)\s+interface/g,
      ],
      rust: [
        /\bfn\s+(\w+)/g,
        /\bstruct\s+(\w+)/g,
        /\benum\s+(\w+)/g,
        /\blet\s+(?:mut\s+)?(\w+)/g,
      ],
      java: [
        /\b(?:public|private|protected)?\s*(?:static\s+)?\s*(?:\w+)\s+(\w+)\s*\(/g,
        /\bclass\s+(\w+)/g,
        /\binterface\s+(\w+)/g,
      ],
    };

    const languagePatterns = patterns['typescript'] ?? [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      for (const pattern of languagePatterns) {
        pattern.lastIndex = 0;
        let match;
        while ((match = pattern.exec(line)) !== null) {
          const name = match[1];
          if (name && !name.startsWith('_')) {
            symbols.set(name, {
              name,
              type: this.inferType(name, line),
              line: i + 1,
              detail: line.trim().slice(0, 60),
            });
          }
        }
      }
    }

    return symbols;
  }

  private createCompletionItem(
    label: string,
    kind: CompletionItem['kind'],
    detail: string,
    documentation: string | undefined,
    prefix: string,
    position: { line: number; character: number },
    source: CompletionItem['source'],
    insertText?: string
  ): CompletionItem {
    return {
      id: randomUUID(),
      label,
      kind,
      detail,
      documentation,
      insertText: insertText ?? label.slice(prefix.length),
      range: {
        start: {
          line: position.line,
          character: position.character - prefix.length,
        },
        end: position,
      },
      score: source === 'syntax' ? 0.5 : source === 'context' ? 0.8 : 0.3,
      source,
    };
  }

  private getWordAtPosition(line: string, character: number): string {
    let start = character;
    let end = character;

    while (start > 0 && /[\w$]/.test(line[start - 1])) {
      start--;
    }
    while (end < line.length && /[\w$]/.test(line[end])) {
      end++;
    }

    return line.slice(start, end);
  }

  private detectLanguage(filePath: string): string {
    const ext = extname(filePath).toLowerCase();
    const langMap: Record<string, string> = {
      '.ts': 'typescript',
      '.tsx': 'typescript',
      '.js': 'javascript',
      '.jsx': 'javascript',
      '.py': 'python',
      '.go': 'go',
      '.rs': 'rust',
      '.java': 'java',
    };
    return langMap[ext] ?? 'typescript';
  }

  private inferType(name: string, line: string): string {
    if (/^[A-Z]/.test(name)) return 'class';
    if (/\(\s*\)/.test(line) || /=>?/.test(line)) return 'function';
    return 'variable';
  }
}

// Singleton
let engine: CompletionEngine | null = null;

export function getCompletionEngine(): CompletionEngine {
  if (!engine) {
    engine = new CompletionEngine();
  }
  return engine;
}