// Chart Generator Tool — SVG and PNG chart generation
import { randomUUID } from 'node:crypto';
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { Tool, ToolContext, ToolResult } from './base.js';

const OUTPUT_DIR = join(process.env.HOME || process.env.USERPROFILE || '.', 'infinite-charts');

interface ChartArgs {
  action: 'create' | 'list' | 'open';
  type: 'bar' | 'line' | 'pie' | 'doughnut' | 'scatter' | 'area' | 'horizontalBar' | 'radar' | 'polarArea';
  title?: string;
  labels: string[];
  datasets: {
    label: string;
    data: number[];
    color?: string;
    borderColor?: string;
    backgroundColor?: string;
  }[];
  width?: number;
  height?: number;
  filename?: string;
  format?: 'svg' | 'png';
  outputDir?: string;
  showLegend?: boolean;
  showGrid?: boolean;
}

const CHART_COLORS = [
  'rgba(99, 102, 241, 0.8)',   // Indigo
  'rgba(236, 72, 153, 0.8)',   // Pink
  'rgba(34, 211, 238, 0.8)',   // Cyan
  'rgba(74, 222, 128, 0.8)',   // Green
  'rgba(251, 191, 36, 0.8)',   // Amber
  'rgba(167, 139, 250, 0.8)',  // Violet
  'rgba(248, 113, 113, 0.8)',  // Red
  'rgba(52, 211, 153, 0.8)',   // Emerald
];

function generateBarChartSVG(args: ChartArgs): string {
  const w = args.width || 800;
  const h = args.height || 500;
  const padding = { top: 60, right: 30, bottom: 80, left: 60 };
  const chartW = w - padding.left - padding.right;
  const chartH = h - padding.top - padding.bottom;

  const allValues = args.datasets.flatMap((ds) => ds.data);
  const maxVal = Math.max(...allValues, 1);
  const groupCount = args.labels.length;
  const dsCount = args.datasets.length;
  const groupWidth = chartW / groupCount;
  const barWidth = Math.min((groupWidth * 0.7) / dsCount, 40);

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`;
  svg += `<rect width="${w}" height="${h}" fill="white"/>`;

  // Title
  if (args.title) {
    svg += `<text x="${w / 2}" y="30" text-anchor="middle" font-size="18" font-weight="bold" fill="#1a1a5c">${escapeXml(args.title)}</text>`;
  }

  // Grid lines
  if (args.showGrid !== false) {
    for (let i = 0; i <= 5; i++) {
      const y = padding.top + chartH - (chartH * i) / 5;
      const val = Math.round((maxVal * i) / 5);
      svg += `<line x1="${padding.left}" y1="${y}" x2="${w - padding.right}" y2="${y}" stroke="#e5e7eb" stroke-width="1"/>`;
      svg += `<text x="${padding.left - 8}" y="${y + 4}" text-anchor="end" font-size="10" fill="#6b7280">${val}</text>`;
    }
  }

  // Bars
  args.datasets.forEach((ds, dsIdx) => {
    const color = ds.backgroundColor || CHART_COLORS[dsIdx % CHART_COLORS.length];
    ds.data.forEach((val, i) => {
      const barH = (val / maxVal) * chartH;
      const x = padding.left + i * groupWidth + (groupWidth - dsCount * barWidth) / 2 + dsIdx * barWidth;
      const y = padding.top + chartH - barH;
      svg += `<rect x="${x}" y="${y}" width="${barWidth}" height="${barH}" fill="${color}" rx="2"/>`;
      // Value label
      svg += `<text x="${x + barWidth / 2}" y="${y - 5}" text-anchor="middle" font-size="9" fill="#374151">${val}</text>`;
    });
  });

  // X-axis labels
  args.labels.forEach((label, i) => {
    const x = padding.left + i * groupWidth + groupWidth / 2;
    svg += `<text x="${x}" y="${h - padding.bottom + 20}" text-anchor="middle" font-size="10" fill="#6b7280">${escapeXml(label.substring(0, 15))}</text>`;
  });

  // Legend
  if (args.showLegend !== false && dsCount > 1) {
    const legendY = h - 20;
    args.datasets.forEach((ds, i) => {
      const lx = padding.left + i * 120;
      const color = ds.backgroundColor || CHART_COLORS[i % CHART_COLORS.length];
      svg += `<rect x="${lx}" y="${legendY - 8}" width="12" height="12" fill="${color}"/>`;
      svg += `<text x="${lx + 16}" y="${legendY + 2}" font-size="10" fill="#374151">${escapeXml(ds.label)}</text>`;
    });
  }

  svg += '</svg>';
  return svg;
}

function generateLineChartSVG(args: ChartArgs): string {
  const w = args.width || 800;
  const h = args.height || 500;
  const padding = { top: 60, right: 30, bottom: 80, left: 60 };
  const chartW = w - padding.left - padding.right;
  const chartH = h - padding.top - padding.bottom;

  const allValues = args.datasets.flatMap((ds) => ds.data);
  const maxVal = Math.max(...allValues, 1);

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`;
  svg += `<rect width="${w}" height="${h}" fill="white"/>`;

  if (args.title) {
    svg += `<text x="${w / 2}" y="30" text-anchor="middle" font-size="18" font-weight="bold" fill="#1a1a5c">${escapeXml(args.title)}</text>`;
  }

  // Grid
  if (args.showGrid !== false) {
    for (let i = 0; i <= 5; i++) {
      const y = padding.top + chartH - (chartH * i) / 5;
      svg += `<line x1="${padding.left}" y1="${y}" x2="${w - padding.right}" y2="${y}" stroke="#e5e7eb" stroke-width="1"/>`;
      svg += `<text x="${padding.left - 8}" y="${y + 4}" text-anchor="end" font-size="10" fill="#6b7280">${Math.round((maxVal * i) / 5)}</text>`;
    }
  }

  // Lines
  args.datasets.forEach((ds, dsIdx) => {
    const color = ds.borderColor || CHART_COLORS[dsIdx % CHART_COLORS.length];
    const points = ds.data.map((val, i) => {
      const x = padding.left + (i / (args.labels.length - 1 || 1)) * chartW;
      const y = padding.top + chartH - (val / maxVal) * chartH;
      return `${x},${y}`;
    });

    // Area fill
    if (args.type === 'area') {
      const firstX = padding.left;
      const lastX = padding.left + ((ds.data.length - 1) / (args.labels.length - 1 || 1)) * chartW;
      svg += `<polygon points="${points.join(' ')} ${lastX},${padding.top + chartH} ${firstX},${padding.top + chartH}" fill="${color.replace('0.8', '0.2')}"/>`;
    }

    // Line
    svg += `<polyline points="${points.join(' ')}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>`;

    // Dots
    ds.data.forEach((val, i) => {
      const x = padding.left + (i / (args.labels.length - 1 || 1)) * chartW;
      const y = padding.top + chartH - (val / maxVal) * chartH;
      svg += `<circle cx="${x}" cy="${y}" r="4" fill="white" stroke="${color}" stroke-width="2"/>`;
    });
  });

  // X-axis labels
  args.labels.forEach((label, i) => {
    const x = padding.left + (i / (args.labels.length - 1 || 1)) * chartW;
    svg += `<text x="${x}" y="${h - padding.bottom + 20}" text-anchor="middle" font-size="10" fill="#6b7280">${escapeXml(label.substring(0, 10))}</text>`;
  });

  // Legend
  if (args.showLegend !== false && args.datasets.length > 1) {
    const legendY = h - 20;
    args.datasets.forEach((ds, i) => {
      const lx = padding.left + i * 120;
      const color = ds.borderColor || CHART_COLORS[i % CHART_COLORS.length];
      svg += `<line x1="${lx}" y1="${legendY}" x2="${lx + 20}" y2="${legendY}" stroke="${color}" stroke-width="2"/>`;
      svg += `<circle cx="${lx + 10}" cy="${legendY}" r="3" fill="${color}"/>`;
      svg += `<text x="${lx + 24}" y="${legendY + 4}" font-size="10" fill="#374151">${escapeXml(ds.label)}</text>`;
    });
  }

  svg += '</svg>';
  return svg;
}

function generatePieChartSVG(args: ChartArgs): string {
  const w = args.width || 600;
  const h = args.height || 500;
  const cx = w / 2;
  const cy = h / 2 - 10;
  const r = Math.min(w, h) / 2 - 80;

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`;
  svg += `<rect width="${w}" height="${h}" fill="white"/>`;

  if (args.title) {
    svg += `<text x="${w / 2}" y="30" text-anchor="middle" font-size="18" font-weight="bold" fill="#1a1a5c">${escapeXml(args.title)}</text>`;
  }

  const total = args.datasets[0]?.data.reduce((a, b) => a + b, 0) || 1;
  let startAngle = -Math.PI / 2;

  args.datasets[0]?.data.forEach((val, i) => {
    const sliceAngle = (val / total) * 2 * Math.PI;
    const endAngle = startAngle + sliceAngle;
    const largeArc = sliceAngle > Math.PI ? 1 : 0;

    const x1 = cx + r * Math.cos(startAngle);
    const y1 = cy + r * Math.sin(startAngle);
    const x2 = cx + r * Math.cos(endAngle);
    const y2 = cy + r * Math.sin(endAngle);

    const color = CHART_COLORS[i % CHART_COLORS.length];
    svg += `<path d="M ${cx},${cy} L ${x1},${y1} A ${r},${r} 0 ${largeArc},1 ${x2},${y2} Z" fill="${color}" stroke="white" stroke-width="2"/>`;

    // Label
    const midAngle = startAngle + sliceAngle / 2;
    const labelR = r * 0.65;
    const lx = cx + labelR * Math.cos(midAngle);
    const ly = cy + labelR * Math.sin(midAngle);
    const pct = ((val / total) * 100).toFixed(1);
    if (sliceAngle > 0.3) {
      svg += `<text x="${lx}" y="${ly}" text-anchor="middle" font-size="11" fill="white" font-weight="bold">${pct}%</text>`;
    }

    startAngle = endAngle;
  });

  // Legend
  const legendY = h - 40;
  args.labels.forEach((label, i) => {
    const lx = 30 + i * 110;
    const color = CHART_COLORS[i % CHART_COLORS.length];
    svg += `<rect x="${lx}" y="${legendY - 8}" width="12" height="12" fill="${color}"/>`;
    svg += `<text x="${lx + 16}" y="${legendY + 2}" font-size="9" fill="#374151">${escapeXml(label.substring(0, 12))}</text>`;
  });

  svg += '</svg>';
  return svg;
}

function escapeXml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function generateSVG(args: ChartArgs): string {
  switch (args.type) {
    case 'line':
    case 'area':
      return generateLineChartSVG(args);
    case 'pie':
    case 'doughnut':
    case 'polarArea':
      return generatePieChartSVG(args);
    case 'bar':
    case 'horizontalBar':
    default:
      return generateBarChartSVG(args);
  }
}

async function generatePNG(args: ChartArgs): Promise<Buffer> {
  // Render the chart as SVG, then convert SVG to PNG with sharp.
  const svg = generateSVG(args);

  // Use sharp to convert SVG to PNG
  const sharp = (await import('sharp')).default;
  const pngBuffer = await sharp(Buffer.from(svg)).png().toBuffer();
  return pngBuffer;
}

export const chartGeneratorTool: Tool = {
  name: 'ChartGenerator',
  description:
    'Generate professional charts: bar, line, pie, doughnut, scatter, area, radar, polar area. Output as SVG (inline) or PNG (file). Supports multiple datasets, legends, and custom colors.',
  permission: 'allow',
  inputSchema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['create', 'list', 'open'],
        description: 'Chart action',
      },
      type: {
        type: 'string',
        enum: ['bar', 'line', 'pie', 'doughnut', 'scatter', 'area', 'horizontalBar', 'radar', 'polarArea'],
        description: 'Chart type',
      },
      title: { type: 'string', description: 'Chart title' },
      labels: {
        type: 'array',
        items: { type: 'string' },
        description: 'X-axis / category labels',
      },
      datasets: {
        type: 'array',
        description: 'Data series',
        items: {
          type: 'object',
          properties: {
            label: { type: 'string' },
            data: { type: 'array', items: { type: 'number' } },
            color: { type: 'string', description: 'Hex color for this dataset' },
            borderColor: { type: 'string' },
            backgroundColor: { type: 'string' },
          },
        },
      },
      width: { type: 'number', description: 'Chart width in pixels (default 800)' },
      height: { type: 'number', description: 'Chart height in pixels (default 500)' },
      filename: { type: 'string', description: 'Output filename for PNG' },
      format: { type: 'string', enum: ['svg', 'png'], description: 'Output format (default svg)' },
      outputDir: { type: 'string', description: 'Output directory for PNG' },
      showLegend: { type: 'boolean', description: 'Show legend (default true)' },
      showGrid: { type: 'boolean', description: 'Show grid lines (default true)' },
    },
    required: ['action', 'type', 'labels', 'datasets'],
  },

  async execute(args: unknown, _ctx: ToolContext): Promise<ToolResult> {
    const a = args as ChartArgs;

    try {
      switch (a.action) {
        case 'create': {
          if (a.format === 'png') {
            const pngBuffer = await generatePNG(a);
            const outDir = a.outputDir || OUTPUT_DIR;
            await mkdir(outDir, { recursive: true });
            const filename = a.filename || `chart-${randomUUID().slice(0, 8)}.png`;
            const filePath = join(outDir, filename);
            await writeFile(filePath, pngBuffer);
            return { content: `Chart created: ${filePath} (${(pngBuffer.length / 1024).toFixed(1)} KB, PNG format)` };
          }
          const svg = generateSVG(a);
          const outDir = a.outputDir || OUTPUT_DIR;
          await mkdir(outDir, { recursive: true });
          const filename = a.filename || `chart-${randomUUID().slice(0, 8)}.svg`;
          const filePath = join(outDir, filename);
          await writeFile(filePath, svg);
          return { content: `Chart created: ${filePath} (SVG format)\n\nSVG Preview:\n${svg.substring(0, 2000)}...` };
        }
        case 'list': {
          const { readdirSync, statSync } = await import('node:fs');
          const dir = a.outputDir || OUTPUT_DIR;
          try {
            const files = readdirSync(dir).filter((f) => /\.(svg|png)$/i.test(f));
            return { content: `Charts in ${dir}:\n${files.map((f) => `  ${f} (${(statSync(join(dir, f)).size / 1024).toFixed(1)} KB)`).join('\n') || '(none)'}` };
          } catch {
            return { content: `No charts found in ${dir}` };
          }
        }
        case 'open': {
          const { execSync } = await import('node:child_process');
          const dir = a.outputDir || OUTPUT_DIR;
          const file = a.filename ? join(dir, a.filename) : dir;
          try {
            execSync(`start "" "${file}"`, { timeout: 5000 });
            return { content: `Opened: ${file}` };
          } catch {
            return { content: `Opened folder: ${dir}` };
          }
        }
        default:
          return { content: `Unknown action: ${a.action}`, is_error: true };
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { content: `Chart generation failed: ${msg}`, is_error: true };
    }
  },
};
