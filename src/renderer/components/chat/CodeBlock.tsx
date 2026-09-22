import { useState, useEffect, useRef } from 'react';
import { Copy, Check, ExternalLink } from 'lucide-react';

interface CodeBlockProps {
  code: string;
  language?: string;
  filename?: string;
  showLineNumbers?: boolean;
}

// Map common language aliases to shiki language IDs
const LANG_MAP: Record<string, string> = {
  js: 'javascript',
  ts: 'typescript',
  jsx: 'jsx',
  tsx: 'tsx',
  py: 'python',
  rb: 'ruby',
  rs: 'rust',
  sh: 'bash',
  shell: 'bash',
  zsh: 'bash',
  yml: 'yaml',
  md: 'markdown',
  dockerfile: 'docker',
  json5: 'json',
  jsonc: 'json',
  text: 'plaintext',
  txt: 'plaintext',
};

// Simple token-based syntax highlighting as fallback
function simpleHighlight(code: string, lang: string): string {
  let escaped = code
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // Comments
  if (['javascript', 'typescript', 'jsx', 'tsx', 'java', 'c', 'cpp', 'cs', 'go', 'rust', 'swift'].includes(lang)) {
    escaped = escaped.replace(/(\/\/.*$)/gm, '<span style="color:#6a9955">$1</span>');
    escaped = escaped.replace(/(\/\*[\s\S]*?\*\/)/g, '<span style="color:#6a9955">$1</span>');
  }
  if (['python', 'ruby', 'yaml', 'bash', 'shell', 'toml'].includes(lang)) {
    escaped = escaped.replace(/(#.*$)/gm, '<span style="color:#6a9955">$1</span>');
  }

  // Strings
  escaped = escaped.replace(/(&quot;[^&]*?&quot;|&#39;[^&]*?&#39;|`[^`]*?`)/g, '<span style="color:#ce9178">$1</span>');
  escaped = escaped.replace(/("[^"\\]*(?:\\.[^"\\]*)*"|'[^'\\]*(?:\\.[^'\\]*)*')/g, '<span style="color:#ce9178">$1</span>');

  // Keywords
  const keywords = ['const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'break', 'continue', 'class', 'extends', 'import', 'export', 'from', 'default', 'new', 'this', 'super', 'try', 'catch', 'finally', 'throw', 'async', 'await', 'yield', 'true', 'false', 'null', 'undefined', 'void', 'typeof', 'instanceof', 'in', 'of', 'def', 'self', 'print', 'lambda', 'with', 'as', 'elif', 'except', 'raise', 'pass', 'global', 'nonlocal', 'assert', 'del', 'True', 'False', 'None', 'fn', 'pub', 'use', 'mod', 'struct', 'impl', 'trait', 'enum', 'match', 'mut', 'ref', 'move', 'loop', 'where', 'type', 'interface', 'enum', 'namespace', 'module', 'declare', 'abstract', 'readonly', 'private', 'protected', 'public', 'static', 'final', 'override'];
  const kwRegex = new RegExp(`\\b(${keywords.join('|')})\\b`, 'g');
  escaped = escaped.replace(kwRegex, '<span style="color:#c586c0">$1</span>');

  // Numbers
  escaped = escaped.replace(/\b(\d+\.?\d*)\b/g, '<span style="color:#b5cea8">$1</span>');

  return escaped;
}

export function CodeBlock({ code, language, filename, showLineNumbers = false }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);
  const [highlighted, setHighlighted] = useState('');
  const codeRef = useRef<HTMLPreElement>(null);
  const lang = LANG_MAP[language?.toLowerCase() ?? ''] ?? language?.toLowerCase() ?? '';

  useEffect(() => {
    let cancelled = false;

    async function highlight() {
      try {
        const shiki = await import('shiki');
        if (cancelled) return;
        const highlighter = await shiki.createHighlighter({
          themes: ['github-dark-default'],
          langs: ['javascript', 'typescript', 'python', 'rust', 'go', 'java', 'bash', 'json', 'html', 'css', 'yaml', 'markdown', 'sql', 'cpp', 'c', 'ruby', 'php', 'swift', 'kotlin', 'docker', 'lua', 'r', 'toml'],
        });
        if (cancelled) return;
        const html = highlighter.codeToHtml(code, {
          lang: lang && highlighter.getLoadedLanguages().includes(lang) ? lang : 'text',
          theme: 'github-dark-default',
        });
        if (!cancelled) setHighlighted(html);
        highlighter.dispose();
      } catch {
        // Fallback to simple highlighting
        if (!cancelled) setHighlighted(`<pre class="shiki" style="background-color:#0d1117;color:#c9d1d9;padding:1em;overflow-x:auto">${simpleHighlight(code, lang)}</pre>`);
      }
    }

    if (code.trim()) {
      highlight();
    }
    return () => { cancelled = true; };
  }, [code, lang]);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const lines = code.split('\n');
  const lineCount = lines.length;

  return (
    <div className="relative my-3 rounded-lg border border-white/[0.08] bg-[#0d1117] overflow-hidden group">
      {/* Header bar */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-white/[0.03] border-b border-white/[0.06]">
        <div className="flex items-center gap-2">
          {filename && (
            <span className="text-[10px] text-zinc-400 font-mono flex items-center gap-1">
              <ExternalLink className="w-3 h-3" />
              {filename}
            </span>
          )}
          {lang && (
            <span className="text-[10px] text-zinc-500 font-mono px-1.5 py-0.5 rounded bg-white/[0.05]">
              {lang}
            </span>
          )}
          {lineCount > 1 && (
            <span className="text-[10px] text-zinc-600 font-mono">{lineCount} lines</span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={handleCopy}
            className="flex items-center gap-1 text-[10px] text-zinc-500 hover:text-zinc-300 transition-colors px-2 py-1 rounded hover:bg-white/[0.05]"
          >
            {copied ? <Check className="w-3 h-3 text-green-400" /> : <Copy className="w-3 h-3" />}
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
      </div>

      {/* Code content */}
      {highlighted ? (
        <div
          className="overflow-x-auto text-[12px] leading-relaxed [&>pre]:p-3 [&>pre]:m-0 [&>pre]:bg-transparent"
          dangerouslySetInnerHTML={{ __html: highlighted }}
        />
      ) : (
        <pre ref={codeRef} className="p-3 overflow-x-auto text-[12px] font-mono leading-relaxed text-zinc-300">
          <code>{code}</code>
        </pre>
      )}

      {/* Line numbers overlay for large files */}
      {showLineNumbers && lineCount > 10 && (
        <div className="absolute left-0 top-[33px] bottom-0 w-8 bg-[#0d1117] border-r border-white/[0.04] overflow-hidden pointer-events-none">
          <div className="p-3 text-[10px] font-mono text-zinc-600 leading-relaxed text-right pr-2">
            {lines.map((_, i) => (
              <div key={i}>{i + 1}</div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
