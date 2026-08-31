import { useMemo, useState, useEffect, useCallback, useRef } from 'react';
import type { AiWorkspaceTab, TabSection, TabMetric, TabChartData, TabTableData } from '../../stores/aiTabs';
import { useChatStore } from '../../stores/chat';
import { useAiTabsStore } from '../../stores/aiTabs';

interface DynamicTabViewProps {
  tab: AiWorkspaceTab;
  onViewChange: (view: string) => void;
}

export function DynamicTabView({ tab, onViewChange }: DynamicTabViewProps) {
  const sendMessage = useChatStore((state) => state.sendMessage);

  const continueInChat = (prompt: string) => {
    onViewChange('chats');
    void sendMessage(prompt);
  };

  const isBrowserTab = tab.kind === 'website' || tab.kind === 'embed';
  const initialUrl = (tab.metadata as Record<string, unknown> | undefined)?.browserUrl as string | undefined;
  const htmlIsUrl = typeof tab.htmlContent === 'string' && /^https?:\/\//i.test(tab.htmlContent.trim());
  const shouldShowBrowser = isBrowserTab && (htmlIsUrl || typeof initialUrl === 'string');

  if (shouldShowBrowser) {
    return (
      <div className="flex h-full min-h-0 bg-[#080a10]">
        <div className="flex-1 min-w-0 flex flex-col">
          <TabHeader tab={tab} compact />
          <WebsiteBrowser tab={tab} />
          {tab.filePath && (
            <div className="mx-6 mb-4 rounded-lg border border-white/[0.07] bg-[#0c1018] p-3 flex items-center gap-3">
              <span className="text-sm">📁</span>
              <div className="text-xs text-zinc-400">Generated file</div>
              <div className="text-xs text-zinc-200 font-mono truncate">{tab.filePath}</div>
            </div>
          )}
        </div>
        <aside className="hidden lg:flex w-[280px] shrink-0 flex-col border-l border-white/[0.06] bg-[#0b0d14] p-4">
          <TabActions tab={tab} onAction={continueInChat} />
        </aside>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 bg-[#080a10]">
      <section className="flex-1 min-w-0 overflow-y-auto chat-scrollbar px-6 py-6 sm:px-10">
        <div className="max-w-5xl">
          <TabHeader tab={tab} />
          {tab.metrics && tab.metrics.length > 0 && <MetricsRow metrics={tab.metrics} />}
          {tab.chartData && <ChartSection data={tab.chartData} title={tab.title} />}
          {tab.tableData && <TableSection data={tab.tableData} />}
          {tab.sections && tab.sections.length > 0 && (
            <div className="mt-5 space-y-4">
              {tab.sections.map((section, i) => (
                <SectionBlock key={i} section={section} />
              ))}
            </div>
          )}
          {tab.htmlContent && !htmlIsUrl && <HtmlBlock html={tab.htmlContent} />}
          {htmlIsUrl && (
            <div className="mt-4">
              <WebsiteBrowser tab={tab} embedded />
            </div>
          )}
          {!tab.htmlContent && !tab.sections && !tab.chartData && !tab.tableData && !tab.metrics && (
            <div className="mt-4 rounded-xl border border-white/[0.07] bg-[#0c1018] p-5 shadow-[0_16px_44px_rgba(0,0,0,.22)]">
              <pre className="whitespace-pre-wrap font-sans text-sm leading-7 text-zinc-300">{tab.content}</pre>
            </div>
          )}
          {tab.filePath && (
            <div className="mt-4 rounded-lg border border-white/[0.07] bg-[#0c1018] p-4 flex items-center gap-3">
              <span className="text-lg">📁</span>
              <div>
                <div className="text-xs text-zinc-400">Generated file</div>
                <div className="text-sm text-zinc-200 font-mono">{tab.filePath}</div>
              </div>
            </div>
          )}
        </div>
      </section>
      <aside className="hidden lg:flex w-[280px] shrink-0 flex-col border-l border-white/[0.06] bg-[#0b0d14] p-4">
        <TabActions tab={tab} onAction={continueInChat} />
      </aside>
    </div>
  );
}

function TabHeader({ tab, compact }: { tab: AiWorkspaceTab; compact?: boolean }) {
  if (compact) {
    return (
      <div className="px-6 pt-5 pb-3 border-b border-white/[0.06] bg-[#0c1018]/50 backdrop-blur">
        <div className="flex items-center gap-2">
          <span className="text-sm">{tab.icon || '🌐'}</span>
          <span className="text-[10px] uppercase tracking-[0.18em]" style={{ color: tab.color || '#22d3ee' }}>{tab.kind}</span>
          <span className="text-xs text-zinc-600">•</span>
          <span className="text-xs text-zinc-500 truncate">{tab.title}</span>
        </div>
        <h2 className="mt-1 text-sm font-semibold text-zinc-100 truncate">{tab.title}</h2>
      </div>
    );
  }
  return (
    <div className="mb-5 flex items-start justify-between gap-4">
      <div>
        <div className="flex items-center gap-2">
          <span className="text-lg">{tab.icon || '✨'}</span>
          <span className="text-[10px] uppercase tracking-[0.18em]" style={{ color: tab.color || '#22d3ee' }}>
            {tab.kind}
          </span>
        </div>
        <h1 className="mt-1.5 text-2xl font-semibold text-zinc-100 tracking-[-0.02em]">{tab.title}</h1>
        <p className="mt-1.5 max-w-2xl text-sm text-zinc-500">{tab.prompt}</p>
      </div>
    </div>
  );
}

function WebsiteBrowser({ tab, embedded }: { tab: AiWorkspaceTab; embedded?: boolean }) {
  const updateTab = useAiTabsStore((s) => s.updateTab);
  const metaUrl = (tab.metadata as Record<string, unknown> | undefined)?.browserUrl as string | undefined;
  const initial = metaUrl || (tab.htmlContent && /^https?:\/\//i.test(tab.htmlContent.trim()) ? tab.htmlContent.trim() : 'https://www.google.com');
  const [url, setUrl] = useState(initial);
  const [inputUrl, setInputUrl] = useState(initial);
  const [history, setHistory] = useState<string[]>([initial]);
  const [hIdx, setHIdx] = useState(0);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // AI can navigate by updating tab.htmlContent / metadata.browserUrl
  useEffect(() => {
    const newUrl = (tab.metadata as Record<string, unknown> | undefined)?.browserUrl as string | undefined;
    const htmlUrl = tab.htmlContent && /^https?:\/\//i.test(tab.htmlContent.trim()) ? tab.htmlContent.trim() : null;
    const target = newUrl || htmlUrl;
    if (target && target !== url) {
      setUrl(target);
      setInputUrl(target);
      setHistory((prev) => {
        const next = prev.slice(0, hIdx + 1);
        next.push(target);
        return next.slice(-30);
      });
      setHIdx((prev) => Math.min(prev + 1, 29));
    }
  }, [tab.htmlContent, (tab.metadata as Record<string, unknown> | undefined)?.browserUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  const navigate = useCallback((nextUrl: string) => {
    let target = nextUrl.trim();
    if (!target) return;
    if (!/^https?:\/\//i.test(target)) {
      if (/^[\w-]+(\.[\w-]+)+/.test(target)) target = 'https://' + target;
      else target = 'https://www.google.com/search?q=' + encodeURIComponent(target);
    }
    setUrl(target);
    setInputUrl(target);
    setHistory((prev) => {
      const next = prev.slice(0, hIdx + 1);
      next.push(target);
      return next.slice(-30);
    });
    setHIdx((prev) => Math.min(prev + 1, 29));
    // Persist so AI sees the new URL and user can return
    updateTab(tab.id, { htmlContent: target, metadata: { ...(tab.metadata || {}), browserUrl: target } });
  }, [hIdx, tab.id, tab.metadata, updateTab]);

  const goBack = useCallback(() => {
    if (hIdx > 0) {
      const nextIdx = hIdx - 1;
      setHIdx(nextIdx);
      const target = history[nextIdx];
      setUrl(target);
      setInputUrl(target);
    } else {
      try { iframeRef.current?.contentWindow?.history.back(); } catch {}
    }
  }, [hIdx, history]);

  const goForward = useCallback(() => {
    if (hIdx < history.length - 1) {
      const nextIdx = hIdx + 1;
      setHIdx(nextIdx);
      const target = history[nextIdx];
      setUrl(target);
      setInputUrl(target);
    } else {
      try { iframeRef.current?.contentWindow?.history.forward(); } catch {}
    }
  }, [hIdx, history]);

  const reload = useCallback(() => {
    const src = iframeRef.current?.src;
    if (iframeRef.current && src) iframeRef.current.src = src;
  }, []);

  const lastBrowserActionRef = useRef<number>(0);
  useEffect(() => {
    const meta = tab.metadata as Record<string, unknown> | undefined;
    const action = meta?.browserAction as string | undefined;
    const at = meta?.at as number | undefined;
    if (!action || !at || at === lastBrowserActionRef.current) return;
    lastBrowserActionRef.current = at;
    if (action === 'back') goBack();
    else if (action === 'forward') goForward();
    else if (action === 'reload') reload();
  }, [tab.metadata, goBack, goForward, reload]);

  const openExternal = useCallback(() => {
    window.open(url, '_blank');
  }, [url]);

  return (
    <div className={embedded ? 'rounded-xl overflow-hidden border border-white/[0.07] bg-[#0c1018]' : 'flex-1 min-h-0 flex flex-col bg-[#0c1018]'}>
      <div className="flex items-center gap-1.5 px-2 py-2 border-b border-white/[0.06] bg-[#0b1018]">
        <button onClick={goBack} disabled={hIdx <= 0} className="p-1.5 rounded-md hover:bg-white/[0.06] text-zinc-400 hover:text-zinc-100 disabled:opacity-30 disabled:cursor-not-allowed" title="Back">‹</button>
        <button onClick={goForward} disabled={hIdx >= history.length - 1} className="p-1.5 rounded-md hover:bg-white/[0.06] text-zinc-400 hover:text-zinc-100 disabled:opacity-30 disabled:cursor-not-allowed" title="Forward">›</button>
        <button onClick={reload} className="p-1.5 rounded-md hover:bg-white/[0.06] text-zinc-400 hover:text-zinc-100" title="Reload">↻</button>
        <div className="flex-1 flex items-center gap-2 bg-black/30 border border-white/[0.07] rounded-full px-3 py-1.5">
          <span className="text-[10px] text-emerald-400">●</span>
          <input
            value={inputUrl}
            onChange={(e) => setInputUrl(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') navigate(inputUrl); }}
            placeholder="Search or enter URL — AI can control this browser too"
            className="flex-1 bg-transparent text-xs text-zinc-200 placeholder:text-zinc-500 outline-none"
          />
          <button onClick={() => navigate(inputUrl)} className="text-[10px] font-medium text-cyan-300 hover:text-cyan-200">Go</button>
        </div>
        <button onClick={openExternal} className="hidden sm:inline-flex items-center gap-1 px-2 py-1 rounded-md bg-white/[0.04] hover:bg-white/[0.08] text-[11px] text-zinc-400 hover:text-zinc-100" title="Open in external Chrome">↗</button>
        <span className="hidden sm:inline text-[10px] text-zinc-600 border border-white/[0.06] rounded-full px-2 py-1">AI controllable</span>
      </div>
      <div className={embedded ? 'h-[520px] bg-white' : 'flex-1 min-h-0 bg-white relative'}>
        <iframe
          ref={iframeRef}
          src={url}
          title={tab.title}
          className="w-full h-full border-0 bg-white"
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-downloads"
          allow="fullscreen; clipboard-read; clipboard-write"
          referrerPolicy="no-referrer-when-downgrade"
        />
      </div>
      <div className="px-3 py-1.5 bg-[#0b1018] border-t border-white/[0.06] flex items-center justify-between">
        <span className="text-[11px] text-zinc-500 truncate">{url}</span>
        <span className="text-[10px] text-zinc-600 hidden sm:inline">Tab as browser — AI uses this via TabBrowser tool • You can type, back, forward too</span>
      </div>
    </div>
  );
}

function MetricsRow({ metrics }: { metrics: TabMetric[] }) {
  return (
    <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
      {metrics.map((m, i) => (
        <div key={i} className="rounded-xl border border-white/[0.07] bg-[#0c1018] p-4">
          <div className="text-[10px] uppercase tracking-wider text-zinc-500">{m.label}</div>
          <div className="mt-1.5 text-xl font-semibold text-zinc-100">{m.value}</div>
          {m.change && (
            <div className={`mt-1 text-xs ${m.change.startsWith('+') || m.change.startsWith('↑') ? 'text-emerald-400' : m.change.startsWith('-') || m.change.startsWith('↓') ? 'text-red-400' : 'text-zinc-500'}`}>
              {m.change}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function ChartSection({ data, title }: { data: TabChartData; title: string }) {
  const svg = useMemo(() => generateChartSVG(data, title), [data, title]);
  return (
    <div className="mt-4 rounded-xl border border-white/[0.07] bg-[#0c1018] p-5">
      <div className="text-xs text-zinc-500 mb-3">{title}</div>
      <div dangerouslySetInnerHTML={{ __html: svg }} />
    </div>
  );
}

function generateChartSVG(data: TabChartData, _title: string): string {
  const w = 700, h = 320;
  const pad = { t: 20, r: 20, b: 50, l: 50 };
  const cw = w - pad.l - pad.r, ch = h - pad.t - pad.b;
  const allVals = data.datasets.flatMap((d) => d.data);
  const maxVal = Math.max(...allVals, 1);
  const type = data.chartType || 'bar';
  const colors = ['#6366f1', '#22d3ee', '#ec4899', '#4ade80', '#f59e0b', '#f97316'];

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="100%" viewBox="0 0 ${w} ${h}">`;
  svg += `<rect width="${w}" height="${h}" fill="transparent"/>`;

  // Grid
  for (let i = 0; i <= 4; i++) {
    const y = pad.t + ch - (ch * i) / 4;
    svg += `<line x1="${pad.l}" y1="${y}" x2="${w - pad.r}" y2="${y}" stroke="rgba(255,255,255,0.06)" stroke-width="1"/>`;
    svg += `<text x="${pad.l - 8}" y="${y + 4}" text-anchor="end" font-size="9" fill="#71717a">${Math.round((maxVal * i) / 4)}</text>`;
  }

  if (type === 'pie' || type === 'doughnut') {
    const total = data.datasets[0]?.data.reduce((a, b) => a + b, 0) || 1;
    const cx = w / 2, cy = h / 2, r = Math.min(cw, ch) / 2 - 10;
    let angle = -Math.PI / 2;
    data.datasets[0]?.data.forEach((val, i) => {
      const slice = (val / total) * 2 * Math.PI;
      const end = angle + slice;
      const x1 = cx + r * Math.cos(angle), y1 = cy + r * Math.sin(angle);
      const x2 = cx + r * Math.cos(end), y2 = cy + r * Math.sin(end);
      const large = slice > Math.PI ? 1 : 0;
      svg += `<path d="M${cx},${cy} L${x1},${y1} A${r},${r} 0 ${large},1 ${x2},${y2} Z" fill="${colors[i % colors.length]}" opacity="0.85"/>`;
      if (slice > 0.3) {
        const mid = angle + slice / 2;
        const lx = cx + r * 0.6 * Math.cos(mid), ly = cy + r * 0.6 * Math.sin(mid);
        svg += `<text x="${lx}" y="${ly}" text-anchor="middle" font-size="10" fill="white" font-weight="bold">${((val / total) * 100).toFixed(0)}%</text>`;
      }
      angle = end;
    });
  } else {
    // Bar or line
    const groupW = cw / data.labels.length;
    data.datasets.forEach((ds, dsIdx) => {
      const color = colors[dsIdx % colors.length];
      if (type === 'line') {
        const pts = ds.data.map((val, i) => {
          const x = pad.l + i * groupW + groupW / 2;
          const y = pad.t + ch - (val / maxVal) * ch;
          return `${x},${y}`;
        });
        svg += `<polyline points="${pts.join(' ')}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linecap="round"/>`;
        ds.data.forEach((val, i) => {
          const x = pad.l + i * groupW + groupW / 2;
          const y = pad.t + ch - (val / maxVal) * ch;
          svg += `<circle cx="${x}" cy="${y}" r="4" fill="#0c1018" stroke="${color}" stroke-width="2"/>`;
        });
      } else {
        const barW = Math.min((groupW * 0.6) / data.datasets.length, 30);
        ds.data.forEach((val, i) => {
          const barH = (val / maxVal) * ch;
          const x = pad.l + i * groupW + (groupW - barW * data.datasets.length) / 2 + dsIdx * barW;
          const y = pad.t + ch - barH;
          svg += `<rect x="${x}" y="${y}" width="${barW}" height="${barH}" fill="${color}" rx="3" opacity="0.85"/>`;
          svg += `<text x="${x + barW / 2}" y="${y - 5}" text-anchor="middle" font-size="8" fill="#a1a1aa">${val}</text>`;
        });
      }
    });

    // X labels
    data.labels.forEach((label, i) => {
      const x = pad.l + i * groupW + groupW / 2;
      svg += `<text x="${x}" y="${h - pad.b + 18}" text-anchor="middle" font-size="9" fill="#71717a">${label.substring(0, 10)}</text>`;
    });
  }

  svg += '</svg>';
  return svg;
}

function TableSection({ data }: { data: TabTableData }) {
  return (
    <div className="mt-4 rounded-xl border border-white/[0.07] bg-[#0c1018] overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/[0.07]">
              {data.columns.map((col) => (
                <th key={col.key} className="px-4 py-2.5 text-left text-[10px] uppercase tracking-wider text-zinc-500 font-medium">
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.rows.map((row, i) => (
              <tr key={i} className="border-b border-white/[0.04] hover:bg-white/[0.02]">
                {data.columns.map((col) => (
                  <td key={col.key} className="px-4 py-2 text-zinc-300">
                    {String(row[col.key] ?? '')}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SectionBlock({ section }: { section: TabSection }) {
  return (
    <div className="rounded-xl border border-white/[0.07] bg-[#0c1018] p-5">
      {section.title && (
        <div className="text-xs uppercase tracking-wider text-zinc-500 mb-2">{section.title}</div>
      )}
      {section.type === 'code' ? (
        <pre className="whitespace-pre-wrap font-mono text-xs leading-6 text-zinc-300 bg-black/30 rounded-lg p-3">{section.content}</pre>
      ) : section.type === 'list' ? (
        <ul className="space-y-1.5">
          {section.content.split('\n').filter(Boolean).map((line, i) => (
            <li key={i} className="flex items-start gap-2 text-sm text-zinc-300">
              <span className="text-zinc-600 mt-0.5">•</span>
              <span>{line.replace(/^[-*]\s*/, '')}</span>
            </li>
          ))}
        </ul>
      ) : section.type === 'metrics' && Array.isArray(section.data?.metrics) ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {(section.data!.metrics as { label: string; value: string | number; change?: string }[]).map((m, i) => (
            <div key={i} className="rounded-lg bg-white/[0.03] p-3">
              <div className="text-[10px] text-zinc-500">{m.label}</div>
              <div className="text-lg font-semibold text-zinc-100">{m.value}</div>
              {m.change && <div className="text-xs text-zinc-500">{m.change}</div>}
            </div>
          ))}
        </div>
      ) : section.type === 'table' && section.data ? (
        <TableSection data={section.data as unknown as TabTableData} />
      ) : section.type === 'chart' && section.data ? (
        <ChartSection data={section.data as unknown as TabChartData} title={section.title} />
      ) : section.type === 'image' ? (
        (() => {
          const src = section.content.trim();
          const isUrl = /^https?:\/\//i.test(src) || src.startsWith('data:image');
          return isUrl ? (
            <img src={src} alt={section.title || 'Generated image'} className="w-full rounded-lg border border-white/[0.07] max-h-[520px] object-contain bg-black/20" />
          ) : (
            <div className="text-sm text-zinc-400 italic">Image: {section.content}</div>
          );
        })()
      ) : section.type === 'embed' || section.type === 'website' ? (
        (() => {
          const src = section.content.trim();
          const isUrl = /^https?:\/\//i.test(src);
          return isUrl ? (
            <iframe src={src} title={section.title || 'Embedded content'} className="w-full h-[420px] rounded-lg border border-white/[0.07] bg-white" sandbox="allow-scripts allow-same-origin allow-forms allow-popups" allow="fullscreen" />
          ) : section.data && typeof (section.data as Record<string, unknown>).url === 'string' ? (
            <iframe src={String((section.data as Record<string, unknown>).url)} title={section.title || 'Embedded content'} className="w-full h-[420px] rounded-lg border border-white/[0.07] bg-white" sandbox="allow-scripts allow-same-origin allow-forms allow-popups" allow="fullscreen" />
          ) : (
            <div className="text-sm text-zinc-400 italic">Embedded content: {section.content}</div>
          );
        })()
      ) : section.type === 'video' ? (
        (() => {
          const src = section.content.trim();
          const isUrl = /^https?:\/\//i.test(src);
          return isUrl ? (
            <video src={src} controls className="w-full rounded-lg border border-white/[0.07] max-h-[420px] bg-black" />
          ) : (
            <div className="text-sm text-zinc-400 italic">Video: {section.content}</div>
          );
        })()
      ) : section.type === 'media' ? (
        (() => {
          const src = section.content.trim();
          const isUrl = /^https?:\/\//i.test(src);
          const isImage = /\.(png|jpe?g|gif|webp|svg)$/i.test(src) || src.startsWith('data:image');
          const isVideo = /\.(mp4|webm|mov)$/i.test(src);
          if (isImage) return <img src={src} alt={section.title || 'Media'} className="w-full rounded-lg border border-white/[0.07] max-h-[520px] object-contain bg-black/20" />;
          if (isVideo) return <video src={src} controls className="w-full rounded-lg border border-white/[0.07] bg-black" />;
          if (isUrl) return <iframe src={src} title={section.title || 'Media'} className="w-full h-[420px] rounded-lg border border-white/[0.07] bg-white" sandbox="allow-scripts allow-same-origin allow-forms allow-popups" />;
          return <div className="text-sm text-zinc-400">{section.content}</div>;
        })()
      ) : section.type === 'html' ? (
        <HtmlBlock html={section.htmlContent || section.content} />
      ) : (
        <pre className="whitespace-pre-wrap font-sans text-sm leading-7 text-zinc-300">{section.content}</pre>
      )}
    </div>
  );
}

function HtmlBlock({ html }: { html: string }) {
  const sanitized = useMemo(() => {
    let cleaned = html;
    // Strip inline background styles that override Infinite OS theme
    cleaned = cleaned.replace(/background(-color|-image)?:\s*[^;"]+;?/gi, '');
    cleaned = cleaned.replace(/background:\s*[^;"]+;?/gi, '');
    // Strip gradient patterns
    cleaned = cleaned.replace(/linear-gradient\([^)]+\)/gi, 'transparent');
    cleaned = cleaned.replace(/radial-gradient\([^)]+\)/gi, 'transparent');
    // Strip background-image inline
    cleaned = cleaned.replace(/style="[^"]*background[^"]*"/gi, 'style=""');
    return cleaned;
  }, [html]);
  return (
    <div className="mt-4 rounded-xl border border-white/[0.07] bg-[#0c1018] p-5 overflow-hidden">
      <div dangerouslySetInnerHTML={{ __html: sanitized }} />
    </div>
  );
}

function TabActions({ tab, onAction }: { tab: AiWorkspaceTab; onAction: (prompt: string) => void }) {
  const actions = useMemo(() => {
    const base = [
      { label: 'Expand in Chat', prompt: `Expand on this ${tab.kind}: ${tab.prompt}` },
      { label: 'Export as PDF', prompt: `Export the contents of the "${tab.title}" tab as a professional PDF document` },
    ];

    switch (tab.kind) {
      case 'chart':
        return [
          { label: 'Modify Chart', prompt: `Modify the chart for: ${tab.prompt}` },
          { label: 'Add Data Series', prompt: `Add another data series to the chart for: ${tab.prompt}` },
          ...base,
        ];
      case 'invoice':
        return [
          { label: 'Send Invoice', prompt: `Send the invoice for: ${tab.prompt}` },
          { label: 'Add Line Items', prompt: `Add more line items to the invoice for: ${tab.prompt}` },
          ...base,
        ];
      case 'financial':
        return [
          { label: 'Deep Analysis', prompt: `Do a deeper financial analysis for: ${tab.prompt}` },
          { label: 'Create Forecast', prompt: `Create a financial forecast for: ${tab.prompt}` },
          ...base,
        ];
      case 'video':
        return [
          { label: 'Edit Video', prompt: `Edit or regenerate the video for: ${tab.prompt}` },
          { label: 'Add Captions', prompt: `Add captions/subtitles to the video for: ${tab.prompt}` },
          ...base,
        ];
      case 'document':
        return [
          { label: 'Edit Document', prompt: `Edit the document for: ${tab.prompt}` },
          { label: 'Convert Format', prompt: `Convert the document to a different format for: ${tab.prompt}` },
          ...base,
        ];
      case 'data':
        return [
          { label: 'Deeper Analysis', prompt: `Do a deeper data analysis for: ${tab.prompt}` },
          { label: 'Visualize Data', prompt: `Create charts to visualize the data for: ${tab.prompt}` },
          ...base,
        ];
      case 'dashboard':
        return [
          { label: 'Add Widget', prompt: `Add another widget to the dashboard for: ${tab.prompt}` },
          { label: 'Refresh Data', prompt: `Refresh the dashboard data for: ${tab.prompt}` },
          ...base,
        ];
      default:
        return [
          { label: 'Continue Work', prompt: `Continue working on: ${tab.prompt}` },
          ...base,
        ];
    }
  }, [tab.kind, tab.prompt, tab.title]);

  const allActions = useMemo(() => {
    const custom = (tab.actions || []).map((a) => ({ label: a.label, prompt: a.prompt }));
    return [...custom, ...actions];
  }, [tab.actions, actions]);

  return (
    <>
      <div className="rounded-xl border p-4" style={{ borderColor: `${tab.color || '#22d3ee'}25`, background: `${tab.color || '#22d3ee'}08` }}>
        <div className="text-[10px] uppercase tracking-[0.16em]" style={{ color: tab.color || '#22d3ee' }}>Actions</div>
        <p className="mt-2 text-xs leading-5 text-zinc-400">
          Use these actions to modify, expand, or export this {tab.kind}.
        </p>
      </div>
      <div className="mt-3 space-y-1.5">
        {allActions.map((action) => (
          <button
            key={`${action.label}-${action.prompt.slice(0, 20)}`}
            onClick={() => onAction(action.prompt)}
            className="w-full rounded-lg border border-white/[0.07] bg-white/[0.025] px-3 py-2.5 text-left text-xs text-zinc-400 hover:border-cyan-400/25 hover:text-zinc-100 hover:bg-cyan-400/[0.035] transition-colors"
          >
            {action.label}
          </button>
        ))}
      </div>
    </>
  );
}
