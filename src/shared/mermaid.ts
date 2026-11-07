export function isMermaidLanguage(language: string | undefined | null): boolean {
  return (language ?? '').trim().toLowerCase() === 'mermaid';
}

export function normalizeMermaidSource(code: string): string {
  return code.replace(/\r\n/g, '\n').replace(/\n+$/, '');
}

export function extractMermaidBlocks(text: string): string[] {
  const blocks: string[] = [];
  const fence = /```mermaid\s*\n([\s\S]*?)```/g;
  let match: RegExpExecArray | null;
  while ((match = fence.exec(text)) !== null) {
    const source = normalizeMermaidSource(match[1]);
    if (source.trim()) blocks.push(source);
  }
  return blocks;
}
