import type { Tool, ToolContext, ToolResult } from './base.js';

/**
 * Color Tool — color conversion, palette generation, and contrast checking.
 * Deterministic, no model call.
 */
interface ColorArgs {
  action: 'convert' | 'palette' | 'contrast' | 'harmony';
  color?: string;
  format?: string;
  base?: string;
  scheme?: 'complementary' | 'analogous' | 'triadic' | 'split-complementary' | 'tetradic';
}

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const h = hex.replace('#', '');
  if (h.length === 3) {
    const r = parseInt(h[0] + h[0], 16);
    const g = parseInt(h[1] + h[1], 16);
    const b = parseInt(h[2] + h[2], 16);
    return { r, g, b };
  }
  if (h.length === 6) {
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    return { r, g, b };
  }
  return null;
}

function rgbToHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b].map(x => Math.round(Math.max(0, Math.min(255, x))).toString(16).padStart(2, '0')).join('');
}

function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l: Math.round(l * 100) };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return { h: Math.round(h * 360), s: Math.round(s * 100), l: Math.round(l * 100) };
}

function hslToRgb(h: number, s: number, l: number): { r: number; g: number; b: number } {
  h /= 360; s /= 100; l /= 100;
  if (s === 0) { const v = Math.round(l * 255); return { r: v, g: v, b: v }; }
  const hue2rgb = (p: number, q: number, t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1/6) return p + (q - p) * 6 * t;
    if (t < 1/2) return q;
    if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return {
    r: Math.round(hue2rgb(p, q, h + 1/3) * 255),
    g: Math.round(hue2rgb(p, q, h) * 255),
    b: Math.round(hue2rgb(p, q, h - 1/3) * 255),
  };
}

function luminance(r: number, g: number, b: number): number {
  const a = [r, g, b].map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
  return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2];
}

export const colorTool: Tool = {
  name: 'Color',
  description:
    'Color conversion (hex/rgb/hsl), palette generation (complementary/analogous/triadic/split-complementary/tetradic), contrast ratio checking (WCAG AA/AAA), and color harmony. Deterministic — no model call.',
  inputSchema: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['convert', 'palette', 'contrast', 'harmony'], description: 'What to do' },
      color: { type: 'string', description: 'Color in hex (#ff0000), rgb(r,g,b), or hsl(h,s%,l%) format' },
      format: { type: 'string', enum: ['hex', 'rgb', 'hsl'], description: 'Target format for convert' },
      base: { type: 'string', description: 'Base color for palette/harmony' },
      scheme: { type: 'string', enum: ['complementary', 'analogous', 'triadic', 'split-complementary', 'tetradic'], description: 'Color scheme for palette' },
    },
    required: ['action'],
  },
  permission: 'allow',
  async execute(args: unknown, _ctx: ToolContext): Promise<ToolResult> {
    const a = args as ColorArgs;

    if (a.action === 'contrast') {
      const c1 = a.color ? hexToRgb(a.color.replace(/[^a-fA-F0-9#]/g, '')) : null;
      const c2 = a.base ? hexToRgb(a.base.replace(/[^a-fA-F0-9#]/g, '')) : null;
      if (!c1 || !c2) return { content: 'Contrast requires two valid hex colors (color and base).', is_error: true };
      const l1 = luminance(c1.r, c1.g, c1.b);
      const l2 = luminance(c2.r, c2.g, c2.b);
      const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
      const aa = ratio >= 4.5;
      const aaa = ratio >= 7;
      const aaLarge = ratio >= 3;
      return {
        content: [
          `**Contrast Ratio: ${ratio.toFixed(2)}:1**`,
          ``,
          `- WCAG AA (normal text): ${aa ? 'PASS' : 'FAIL'}`,
          `- WCAG AA (large text): ${aaLarge ? 'PASS' : 'FAIL'}`,
          `- WCAG AAA (normal text): ${aaa ? 'PASS' : 'FAIL'}`,
          ``,
          `Colors: ${a.color} on ${a.base}`,
        ].join('\n'),
      };
    }

    if (a.action === 'palette') {
      const base = a.base || '#3b82f6';
      const rgb = hexToRgb(base);
      if (!rgb) return { content: `Invalid base color: ${base}`, is_error: true };
      const hsl = rgbToHsl(rgb.r, rgb.g, rgb.b);
      const scheme = a.scheme || 'complementary';

      const hues: number[] = [];
      switch (scheme) {
        case 'complementary': hues.push(hsl.h, (hsl.h + 180) % 360); break;
        case 'analogous': hues.push(hsl.h, (hsl.h + 30) % 360, (hsl.h + 60) % 360, (hsl.h - 30 + 360) % 360); break;
        case 'triadic': hues.push(hsl.h, (hsl.h + 120) % 360, (hsl.h + 240) % 360); break;
        case 'split-complementary': hues.push(hsl.h, (hsl.h + 150) % 360, (hsl.h + 210) % 360); break;
        case 'tetradic': hues.push(hsl.h, (hsl.h + 90) % 360, (hsl.h + 180) % 360, (hsl.h + 270) % 360); break;
      }

      const colors = hues.map(h => {
        const rgb = hslToRgb(h, hsl.s, hsl.l);
        return { hex: rgbToHex(rgb.r, rgb.g, rgb.b), hsl: `hsl(${h}, ${hsl.s}%, ${hsl.l}%)` };
      });

      return {
        content: [
          `**${scheme.charAt(0).toUpperCase() + scheme.slice(1)} Palette from ${base}**`,
          ``,
          ...colors.map((c, i) => `${i + 1}. ${c.hex} (${c.hsl})`),
        ].join('\n'),
      };
    }

    if (a.action === 'convert') {
      if (!a.color) return { content: 'Convert requires a color.', is_error: true };
      const cleaned = a.color.replace(/\s/g, '');
      let rgb: { r: number; g: number; b: number } | null = null;

      // Parse hex
      if (cleaned.startsWith('#')) rgb = hexToRgb(cleaned);
      // Parse rgb(r,g,b)
      const rgbMatch = cleaned.match(/rgb\((\d+),(\d+),(\d+)\)/i);
      if (rgbMatch) rgb = { r: +rgbMatch[1], g: +rgbMatch[2], b: +rgbMatch[3] };
      // Parse hsl(h,s%,l%)
      const hslMatch = cleaned.match(/hsl\((\d+),(\d+)%,(\d+)%\)/i);
      if (hslMatch) rgb = hslToRgb(+hslMatch[1], +hslMatch[2], +hslMatch[3]);

      if (!rgb) return { content: `Cannot parse color: ${a.color}. Use hex (#ff0000), rgb(r,g,b), or hsl(h,s%,l%).`, is_error: true };

      const hsl = rgbToHsl(rgb.r, rgb.g, rgb.b);
      const hex = rgbToHex(rgb.r, rgb.g, rgb.b);
      const format = a.format || 'hex';

      if (format === 'hex') return { content: `**Hex:** ${hex}\n**RGB:** rgb(${rgb.r}, ${rgb.g}, ${rgb.b})\n**HSL:** hsl(${hsl.h}, ${hsl.s}%, ${hsl.l}%)` };
      if (format === 'rgb') return { content: `**RGB:** rgb(${rgb.r}, ${rgb.g}, ${rgb.b})\n**Hex:** ${hex}\n**HSL:** hsl(${hsl.h}, ${hsl.s}%, ${hsl.l}%)` };
      if (format === 'hsl') return { content: `**HSL:** hsl(${hsl.h}, ${hsl.s}%, ${hsl.l}%)\n**Hex:** ${hex}\n**RGB:** rgb(${rgb.r}, ${rgb.g}, ${rgb.b})` };
    }

    if (a.action === 'harmony') {
      if (!a.color) return { content: 'Harmony requires a color.', is_error: true };
      const rgb = hexToRgb(a.color);
      if (!rgb) return { content: `Invalid color: ${a.color}`, is_error: true };
      const hsl = rgbToHsl(rgb.r, rgb.g, rgb.b);
      const harmonies = [
        { name: 'Complementary', hues: [(hsl.h + 180) % 360] },
        { name: 'Analogous', hues: [(hsl.h + 30) % 360, (hsl.h - 30 + 360) % 360] },
        { name: 'Triadic', hues: [(hsl.h + 120) % 360, (hsl.h + 240) % 360] },
      ];
      const output = [
        `**Color Harmony for ${a.color}**`,
        ``,
        ...harmonies.map(h => {
          const colors = h.hues.map(hue => {
            const rgb = hslToRgb(hue, hsl.s, hsl.l);
            return rgbToHex(rgb.r, rgb.g, rgb.b);
          });
          return `- **${h.name}:** ${colors.join(', ')}`;
        }),
      ].join('\n');
      return { content: output };
    }

    return { content: `Unknown color action: ${a.action}`, is_error: true };
  },
};
