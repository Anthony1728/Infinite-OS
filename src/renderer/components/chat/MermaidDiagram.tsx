import { useEffect, useRef, useState } from 'react';
import mermaid from 'mermaid';
import { normalizeMermaidSource } from '../../../shared/mermaid.js';

interface MermaidDiagramProps {
  code: string;
}

let initialized = false;

function ensureInit() {
  if (initialized) return;
  mermaid.initialize({
    startOnLoad: false,
    theme: 'dark',
    securityLevel: 'strict',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  });
  initialized = true;
}

export function MermaidDiagram({ code }: MermaidDiagramProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [svg, setSvg] = useState<string>('');
  const source = normalizeMermaidSource(code);

  useEffect(() => {
    let cancelled = false;
    async function render() {
      try {
        ensureInit();
        const id = `mermaid-${Math.random().toString(36).slice(2, 10)}`;
        const result = await mermaid.render(id, source);
        if (cancelled) return;
        setSvg(result.svg);
        setError(null);
        if (ref.current) {
          ref.current.innerHTML = result.svg;
          result.bindFunctions?.(ref.current);
        }
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
        setSvg('');
      }
    }
    render();
    return () => {
      cancelled = true;
    };
  }, [source]);

  if (error) {
    return (
      <div className="my-3 rounded-lg border border-red-500/30 bg-red-500/5 p-3">
        <div className="text-xs text-red-300 font-medium mb-2">Mermaid diagram failed to render</div>
        <pre className="text-[11px] text-zinc-400 overflow-x-auto whitespace-pre-wrap">{source}</pre>
        <div className="text-[10px] text-red-400/80 mt-2">{error}</div>
      </div>
    );
  }

  return (
    <div className="my-3 rounded-lg border border-white/[0.08] bg-[#0d1117] p-3 overflow-x-auto">
      <div ref={ref} className="flex justify-center [&_svg]:max-w-full" dangerouslySetInnerHTML={{ __html: svg }} />
    </div>
  );
}

export default MermaidDiagram;
