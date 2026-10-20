/**
 * InfinityIcons — the custom Infinite OS glyph set ("Axiom" cut).
 *
 * Design language, so every icon stays coherent as the set grows:
 *   • One 24×24 grid, 1.75 stroke, round caps/joins, fill none.
 *   • A bold primary silhouette that still reads at 16px — detail is layered
 *     with `tone` (reduced opacity), never with more stroke weight.
 *   • The brand's infinity (lemniscate) motif appears once per icon, sized
 *     to stay crisp: as the core of the glyph, its visor, filament, or hub.
 *
 * Render via <InfinityIcon name="…" /> or the central <AppIcon /> registry.
 * Pass `gradient={[from, to]}` on bright surfaces (module tiles) for a
 * neon spectrum stroke; it falls back to currentColor everywhere else.
 */

import { useId } from 'react';

interface IconSeg {
  d: string;
  dash?: string;
  /** Secondary detail layer — rendered at reduced opacity for depth. */
  tone?: number;
  transform?: string;
}

interface InfinityIconDef {
  segs: IconSeg[];
  circles?: [cx: number, cy: number, r: number][];
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Horizontal infinity loop (figure-8) centered at (cx, cy). */
function lem(cx: number, cy: number, w: number, h: number): string {
  return [
    `M${r2(cx)} ${r2(cy)}`,
    `C${r2(cx - w * 0.62)} ${r2(cy - h)} ${r2(cx - w)} ${r2(cy - h * 0.7)} ${r2(cx - w)} ${r2(cy)}`,
    `C${r2(cx - w)} ${r2(cy + h * 0.7)} ${r2(cx - w * 0.62)} ${r2(cy + h)} ${r2(cx)} ${r2(cy)}`,
    `C${r2(cx + w * 0.62)} ${r2(cy - h)} ${r2(cx + w)} ${r2(cy - h * 0.7)} ${r2(cx + w)} ${r2(cy)}`,
    `C${r2(cx + w)} ${r2(cy + h * 0.7)} ${r2(cx + w * 0.62)} ${r2(cy + h)} ${r2(cx)} ${r2(cy)}`,
    'Z',
  ].join('');
}

/** Vertical infinity loop — lobes above and below the center. */
function lemV(cx: number, cy: number, w: number, h: number): string {
  return [
    `M${r2(cx)} ${r2(cy)}`,
    `C${r2(cx - w)} ${r2(cy - h * 0.62)} ${r2(cx - w * 0.7)} ${r2(cy - h)} ${r2(cx)} ${r2(cy - h)}`,
    `C${r2(cx + w * 0.7)} ${r2(cy - h)} ${r2(cx + w)} ${r2(cy - h * 0.62)} ${r2(cx)} ${r2(cy)}`,
    `C${r2(cx - w)} ${r2(cy + h * 0.62)} ${r2(cx - w * 0.7)} ${r2(cy + h)} ${r2(cx)} ${r2(cy + h)}`,
    `C${r2(cx + w * 0.7)} ${r2(cy + h)} ${r2(cx + w)} ${r2(cy + h * 0.62)} ${r2(cx)} ${r2(cy)}`,
    'Z',
  ].join('');
}

export const INF_ICONS = {
  // Speech bubble — polished, tighter tail
  'inf.chat': {
    segs: [
      {
        d: 'M4.9 4.4h14.2a2.15 2.15 0 0 1 2.15 2.15v7.05a2.15 2.15 0 0 1-2.15 2.15H11l-3.6 3.25a0.5 0.5 0 0 1-.82-.38v-2.87H4.9a2.15 2.15 0 0 1-2.15-2.15V6.55a2.15 2.15 0 0 1 2.15-2.15Z',
      },
      { d: lem(12, 9.85, 3.55, 1.72) },
    ],
    circles: [[8.55, 9.85, 0.95]],
  },

  // Open book with tone-layered page lines — knowledge
  'inf.learn': {
    segs: [
      {
        d: 'M12 6.4C10.5 5.1 8.6 4.4 6.4 4.4c-1.02 0-2 .15-2.9.43v12.34c.9-.28 1.88-.43 2.9-.43 2.2 0 4.1.7 5.6 2 1.5-1.3 3.4-2 5.6-2 1.02 0 2 .15 2.9.43V4.83c-.9-.28-1.88-.43-2.9-.43-2.2 0-4.1.7-5.6 2Z',
      },
      { d: 'M12 6.4v12.34' },
      { d: 'M6.3 8.3c1.28.05 2.42.46 3.42 1.14M17.7 8.3c-1.28.05-2.42.46-3.42 1.14', tone: 0.6 },
      { d: 'M6.3 11.3c1.28.05 2.42.46 3.42 1.14M17.7 11.3c-1.28.05-2.42.46-3.42 1.14', tone: 0.6 },
    ],
  },

  // Artboard corner brackets framing an infinity sketch — the canvas
  'inf.canvas': {
    segs: [
      {
        d: 'M9 4.5H6.4A1.9 1.9 0 0 0 4.5 6.4V9M15 4.5h2.6a1.9 1.9 0 0 1 1.9 1.9V9M19.5 15v2.6a1.9 1.9 0 0 1-1.9 1.9H15M9 19.5H6.4a1.9 1.9 0 0 1-1.9-1.9V15',
      },
      { d: lem(12, 12, 4.3, 2.1) },
    ],
  },

  // Angle brackets with a tilted vertical infinity as the slash — code without end
  'inf.code': {
    segs: [
      { d: 'M8.6 6.8 4.1 11.3a1 1 0 0 0 0 1.4l4.5 4.5' },
      { d: 'M15.4 6.8l4.5 4.4a1 1 0 0 1 0 1.4l-4.5 4.5' },
      { d: lemV(12, 12, 1.5, 3), transform: 'rotate(22 12 12)' },
    ],
  },

  // Perpetual automation — smoother loop
  'inf.automation': {
    segs: [
      { d: lem(12, 12, 6.7, 3.25) },
      { d: 'M18.0 7.9 19.8 9.85 17.2 10.55' },
      { d: 'M6.0 16.1 4.2 14.15 6.8 13.45' },
      { d: 'M12 8.7v1.1M12 14.2v1.1', tone: 0.45 },
    ],
  },

  // Robot head — crisper visor
  'inf.agent': {
    segs: [
      {
        d: 'M6.9 7.9h10.2a2.7 2.7 0 0 1 2.7 2.7v4.9a2.7 2.7 0 0 1-2.7 2.7H6.9a2.7 2.7 0 0 1-2.7-2.7v-4.9a2.7 2.7 0 0 1 2.7-2.7Z',
      },
      { d: 'M12 7.9V4.9' },
      { d: 'M4.3 10.9H3v2.4h1.3M20.7 10.9h1.3v2.4h-1.3' },
      { d: lem(12, 12.55, 3.6, 1.68) },
      { d: 'M9.2 15.1h5.6', tone: 0.5 },
    ],
    circles: [[12, 3.8, 1.0]],
  },

  // Infinity core linked to three satellite nodes — orchestration
  'inf.orchestrator': {
    segs: [
      {
        d: 'M6.35 5.85C8.2 7.6 9.55 9.2 10.55 10.45M17.65 5.85C15.8 7.6 14.45 9.2 13.45 10.45M12 13.4v4.1',
        tone: 0.75,
      },
      { d: lem(12, 11.8, 2.5, 1.25) },
    ],
    circles: [
      [4.8, 4.9, 1.5],
      [19.2, 4.9, 1.5],
      [12, 19.2, 1.5],
    ],
  },

  // Briefcase with a vertical infinity clasp
  'inf.business': {
    segs: [
      {
        d: 'M4.2 7.8h15.6a1.2 1.2 0 0 1 1.2 1.2v8a2.5 2.5 0 0 1-2.5 2.5H5.5A2.5 2.5 0 0 1 3 17V9a1.2 1.2 0 0 1 1.2-1.2Z',
      },
      { d: 'M8.9 7.8V6.1a1.8 1.8 0 0 1 1.8-1.8h2.6a1.8 1.8 0 0 1 1.8 1.8v1.7' },
      { d: 'M3 12.4h18', tone: 0.55 },
      { d: lemV(12, 12.4, 0.8, 1.55) },
    ],
  },

  // Clock wrapped by a recurrence arrow — routines
  'inf.routines': {
    segs: [
      { d: 'M20.5 12a8.5 8.5 0 1 1-2.5-6.05' },
      { d: 'M16.25 4.35 18.3 6.2 16.1 8.15' },
      { d: 'M12 7.8V12l3.1 1.95' },
    ],
  },

  // Shield holding infinity — standing orders that never lapse
  'inf.shield': {
    segs: [
      {
        d: 'M12 2.8 5.3 5.55v5.1c0 4.4 2.85 8.5 6.7 10.3 3.85-1.8 6.7-5.9 6.7-10.3V5.55Z',
      },
      { d: lem(12, 10.9, 2.9, 1.4) },
    ],
  },

  // Memory — softer bulb
  'inf.memory': {
    segs: [
      {
        d: 'M12 3.6c-3.85 0-6.65 2.75-6.65 6.35 0 1.72.7 3.32 1.85 4.48.42.42.68 1.0.68 1.6v2.05h8.24v-2.05c0-.6.26-1.18.68-1.6 1.15-1.16 1.85-2.76 1.85-4.48 0-3.6-2.8-6.35-6.65-6.35Z',
      },
      { d: 'M9.9 20.0h4.2M10.2 21.5h3.6', tone: 0.6 },
      { d: lem(12, 10.25, 2.85, 1.4) },
    ],
    circles: [[12, 21.5, 1.0]],
  },

  // Power plug carrying the infinity emblem — extensions of the core
  'inf.plugins': {
    segs: [
      { d: 'M9.8 3.4v3M14.2 3.4v3' },
      { d: 'M7.2 6.4h9.6v3.9a4.8 4.8 0 0 1-9.6 0Z' },
      { d: 'M12 15.1v5.5' },
      { d: lem(12, 10.3, 2.1, 1) },
    ],
  },

  // Cloud with an infinity core — sync without end
  'inf.cloud': {
    segs: [
      { d: 'M6.8 18.6a4.3 4.3 0 0 1-.55-8.55 5.6 5.6 0 0 1 11-1.35 4 4 0 0 1-.45 7.9Z' },
      { d: lem(12, 14.1, 2.45, 1.2) },
    ],
  },

  // Magnifier whose lens is an infinity — research
  'inf.research': {
    segs: [{ d: 'M13.95 13.95 20.3 20.3' }, { d: lem(10.6, 10.6, 2.5, 1.2) }],
    circles: [[10.6, 10.6, 4.7]],
  },

  // Pen nib — design
  'inf.design': {
    segs: [{ d: 'M7 17 12 3.7 17 17 12 20.3Z' }, { d: 'M12 11.6v8.7' }],
    circles: [[12, 9.3, 1.1]],
  },

  // Stacked database — data
  'inf.data': {
    segs: [
      {
        d: 'M12 3.4c4.55 0 8.25 1.15 8.25 2.55S16.55 8.5 12 8.5 3.75 7.4 3.75 5.95 7.45 3.4 12 3.4Z',
      },
      { d: 'M3.75 5.95v12.1c0 1.4 3.7 2.55 8.25 2.55s8.25-1.15 8.25-2.55V5.95' },
      { d: 'M3.75 12c0 1.4 3.7 2.55 8.25 2.55s8.25-1.15 8.25-2.55', tone: 0.6 },
    ],
  },

  // Magnifier with a rising trend line in the lens — SEO
  'inf.seo': {
    segs: [
      { d: 'M13.95 13.95 20.3 20.3' },
      { d: 'M7.6 12.75l1.9-1.85 1.35 1.15 2.25-2.85' },
    ],
    circles: [[10.6, 10.6, 4.7]],
  },

  // Shield with keyhole — security
  'inf.security': {
    segs: [
      {
        d: 'M12 2.8 5.3 5.55v5.1c0 4.4 2.85 8.5 6.7 10.3 3.85-1.8 6.7-5.9 6.7-10.3V5.55Z',
      },
      { d: 'M11.1 10.85 10.55 13.8h2.9l-.55-2.95' },
    ],
    circles: [[12, 9.7, 1.55]],
  },

  // The pure loop — DevOps is literally an infinity symbol
  'inf.devops': {
    segs: [{ d: lem(12, 12, 6.9, 3.4) }],
  },

  // Pen — writer
  'inf.writer': {
    segs: [
      { d: 'M16.9 3.3a2.35 2.35 0 0 1 3.85 3.85L8.4 19.5 3.5 20.5l1-4.9Z' },
      { d: 'M15.1 5.1l3.9 3.9' },
    ],
  },

  // Sticky note with folded corner — quick captures
  'inf.note': {
    segs: [
      {
        d: 'M6 3.8h12a1.8 1.8 0 0 1 1.8 1.8v8.9l-5.5 5.7H6a1.8 1.8 0 0 1-1.8-1.8V5.6A1.8 1.8 0 0 1 6 3.8Z',
      },
      { d: 'M14.3 20.2v-4.6a1.1 1.1 0 0 1 1.1-1.1h4.4' },
      { d: 'M8 8.3h8M8 11.5h5.5', tone: 0.6 },
    ],
  },

  // Sliders — preferences
  'inf.preference': {
    segs: [{ d: 'M4 7.2h6M14.7 7.2H20M4 16.8h8.6M17 16.8h3' }],
    circles: [
      [12.4, 7.2, 2.05],
      [14.7, 16.8, 2.05],
    ],
  },

  // Projects — refined board
  'inf.project': {
    segs: [
      {
        d: 'M4.2 4.6h15.6a1.5 1.5 0 0 1 1.5 1.5v11.8a1.5 1.5 0 0 1-1.5 1.5H4.2a1.5 1.5 0 0 1-1.5-1.5V6.1a1.5 1.5 0 0 1 1.5-1.5Z',
      },
      { d: 'M12 4.8v14.6', tone: 0.6 },
      { d: 'M7.0 8.2v4.6M16.9 8.2v3.4', tone: 0.7 },
      { d: lem(12, 14.85, 3.3, 1.55) },
      { d: 'M7.0 7.0h2.2M16.9 7.0h1.4', tone: 0.45 },
    ],
    circles: [
      [7.0, 15.35, 1.15],
      [16.9, 14.05, 1.15],
    ],
  },

  // File Explorer — cleaner folder
  'inf.folder-tree': {
    segs: [
      {
        d: 'M3.9 5.9a1.55 1.55 0 0 1 1.55-1.55h3.25a1.15 1.15 0 0 1 .92.45l1.28 1.55h7.2a1.85 1.85 0 0 1 1.85 1.85v8.25a1.85 1.85 0 0 1-1.85 1.85H5.7a1.85 1.85 0 0 1-1.85-1.85V5.9Z',
      },
      { d: 'M8.4 10.7v4.4M8.4 10.7h3.4', tone: 0.75 },
      { d: lem(12.0, 14.9, 2.1, 1.02) },
      { d: 'M14.9 13.0V9.2M14.9 13.0l2.35 2.3', tone: 0.75 },
    ],
    circles: [
      [17.7, 16.95, 1.05],
      [10.1, 9.0, 1.05],
    ],
  },

  // Document with folded corner — stored documents
  'inf.document': {
    segs: [
      {
        d: 'M6.2 3.6h7.2l4.4 4.4v11a1.4 1.4 0 0 1-1.4 1.4H6.2a1.4 1.4 0 0 1-1.4-1.4V5a1.4 1.4 0 0 1 1.4-1.4Z',
      },
      { d: 'M13.4 3.6V8h4.4' },
      { d: 'M8.2 12h7.6M8.2 15.2h5.2', tone: 0.6 },
    ],
  },

  // Terminal window with prompt
  'inf.terminal': {
    segs: [
      {
        d: 'M3.8 5.2h16.4a1.3 1.3 0 0 1 1.3 1.3v11a1.3 1.3 0 0 1-1.3 1.3H3.8a1.3 1.3 0 0 1-1.3-1.3v-11a1.3 1.3 0 0 1 1.3-1.3Z',
      },
      { d: 'M6.7 9.2 9.4 12l-2.7 2.8M11.9 14.9h4.5' },
    ],
  },

  // Globe with meridian — web/browser agent
  'inf.globe': {
    segs: [
      { d: 'M3.6 12h16.8' },
      {
        d: 'M12 3.6c2.5 2.3 3.8 5.2 3.8 8.4s-1.3 6.1-3.8 8.4c-2.5-2.3-3.8-5.2-3.8-8.4s1.3-6.1 3.8-8.4Z',
      },
    ],
    circles: [[12, 12, 8.4]],
  },

  // Cursor with radiating marks — manual trigger
  'inf.manual': {
    segs: [
      { d: 'M13.6 16.5l-2.4 2.3.5-9.4 5.2 7.9-3.3-.8Z' },
      {
        d: 'M12 2.5v2.2M17.7 4.7l-1.55 1.55M20.2 10.4H18M7.8 14.6l-1.6 1.6M6 10.4H3.8M8 6.1 6.5 4.6',
        tone: 0.7,
      },
    ],
  },

  // Calendar — one-shot schedule
  'inf.once': {
    segs: [
      { d: 'M6.8 3.2v2.2M17.2 3.2v2.2' },
      {
        d: 'M4.4 7.2h15.2a1.4 1.4 0 0 1 1.4 1.4v10a1.8 1.8 0 0 1-1.8 1.8H4.8a1.8 1.8 0 0 1-1.8-1.8v-10a1.4 1.4 0 0 1 1.4-1.4Z',
      },
      { d: 'M3 11.2h18' },
      { d: 'M12 13.9v3M10.5 15.4h3' },
    ],
  },

  // Wrench — tool call
  'inf.tool': {
    segs: [
      {
        d: 'M14.5 6.2a4.1 4.1 0 0 1 5.4-3.9l-3 3 1.1 2.9 2.9 1.1 3-3a4.1 4.1 0 0 1-5.5 5.4L8.6 20.5a2 2 0 0 1-2.85 0l-1.25-1.25a2 2 0 0 1 0-2.85l8.8-8.8a4.1 4.1 0 0 1 1.2-1.4Z',
      },
    ],
  },

  // Bell — notification action
  'inf.bell': {
    segs: [
      { d: 'M18 9.3a6 6 0 1 0-12 0c0 5-2 6.1-2 6.1h16s-2-1.1-2-6.1' },
      { d: 'M13.8 19.6a2 2 0 0 1-3.6 0' },
    ],
  },

  // Heart-pulse — system health
  'inf.pulse': {
    segs: [
      {
        d: 'M19.5 8.4c0 4.9-7.5 9.9-7.5 9.9s-7.5-5-7.5-9.9a4.15 4.15 0 0 1 7.5-2.4 4.15 4.15 0 0 1 7.5 2.4Z',
      },
      { d: 'M6.5 12h2.6l1.4-2.2 1.9 3.6 1.4-2.4h3.2' },
    ],
  },

  // Interlocking links — dependencies
  'inf.link': {
    segs: [
      { d: 'M9.8 14.2a4.3 4.3 0 0 1 0-6.05l2.1-2.1a4.28 4.28 0 0 1 6.05 6.05l-1.1 1.1' },
      { d: 'M14.2 9.8a4.3 4.3 0 0 1 0 6.05l-2.1 2.1a4.28 4.28 0 0 1-6.05-6.05l1.1-1.1' },
    ],
  },

  // Waste bin — cleanup
  'inf.trash': {
    segs: [
      { d: 'M4.4 6.2h15.2M9.9 6V4.6A1.4 1.4 0 0 1 11.3 3.2h1.4a1.4 1.4 0 0 1 1.4 1.4V6' },
      { d: 'M6.2 6.4l.9 12.3a1.9 1.9 0 0 0 1.9 1.8h6a1.9 1.9 0 0 0 1.9-1.8l.9-12.3' },
      { d: 'M10.1 10v6.4M13.9 10v6.4', tone: 0.6 },
    ],
  },

  // Sun ring — morning brief
  'inf.sun': {
    segs: [
      {
        d: 'M12 2.6v2M18.4 5.6l-1.4 1.4M21.4 12h-2M18.4 18.4l-1.4-1.4M12 19.4v2M7 17l-1.4 1.4M4.6 12h-2M7 7 5.6 5.6',
      },
    ],
    circles: [[12, 12, 3.9]],
  },

  // ── Navigation & surface glyphs ─────────────────────────────────

  // Workspace — tighter grid
  'inf.dashboard': {
    segs: [
      { d: 'M4.7 4.4h5.7a1.05 1.05 0 0 1 1.05 1.05v6.15a1.05 1.05 0 0 1-1.05 1.05H4.7a1.05 1.05 0 0 1-1.05-1.05V5.45a1.05 1.05 0 0 1 1.05-1.05Z' },
      { d: 'M14.0 4.4h5.3a1.05 1.05 0 0 1 1.05 1.05v3.85a1.05 1.05 0 0 1-1.05 1.05H14.0a1.05 1.05 0 0 1-1.05-1.05V5.45a1.05 1.05 0 0 1 1.05-1.05Z' },
      { d: 'M14.0 12.3h5.3a1.05 1.05 0 0 1 1.05 1.05v5.2a1.05 1.05 0 0 1-1.05 1.05H14.0a1.05 1.05 0 0 1-1.05-1.05v-5.2a1.05 1.05 0 0 1 1.05-1.05Z' },
      { d: 'M4.7 15.0h5.7a1.05 1.05 0 0 1 1.05 1.05v1.55a1.05 1.05 0 0 1-1.05 1.05H4.7a1.05 1.05 0 0 1-1.05-1.05v-1.55a1.05 1.05 0 0 1 1.05-1.05Z', tone: 0.75 },
      { d: lem(16.65, 16.0, 1.75, 0.88) },
    ],
    circles: [[7.55, 12.65, 1.05]],
  },

  // Settings — crisper gear
  'inf.gear': {
    segs: [
      { d: 'M12 4.6V2.1M19.4 12h2.5M12 19.4V21.9M4.6 12H2.1M17.25 6.75 19.0 5.0M19.0 19.0 17.25 17.25M6.75 17.25 5.0 19.0M5.0 5.0 6.75 6.75' },
      { d: 'M13.15 5.9a6.6 6.6 0 0 1 3.95 3.95M18.1 13.15a6.6 6.6 0 0 1-3.95 3.95M10.85 18.1a6.6 6.6 0 0 1-3.95-3.95M5.9 10.85a6.6 6.6 0 0 1 3.95-3.95', tone: 0.55 },
      { d: lem(12, 12, 2.2, 1.1) },
    ],
    circles: [
      [12, 12, 7.1],
      [12, 12, 1.12],
    ],
  },

  // Phone carrying an infinity on its screen — remote companion
  'inf.phone': {
    segs: [
      { d: 'M9.4 3h5.2a2.2 2.2 0 0 1 2.2 2.2v13.6a2.2 2.2 0 0 1-2.2 2.2H9.4a2.2 2.2 0 0 1-2.2-2.2V5.2A2.2 2.2 0 0 1 9.4 3Z' },
      { d: 'M10.8 5.3h2.4', tone: 0.55 },
      { d: lem(12, 12.6, 1.85, 1) },
      { d: 'M12 17.9v.01' },
    ],
  },

  // Capabilities — sharper hexes
  'inf.hex-stack': {
    segs: [
      { d: 'M13.7 9.55 11.3 13.75 6.7 13.75 4.3 9.55 6.7 5.35 11.3 5.35Z' },
      { d: 'M20.0 15.85 18.65 18.25 15.75 18.25 14.4 15.85 15.75 13.45 18.65 13.45Z', tone: 0.78 },
      { d: 'M18.1 6.2 17.05 8.05 14.75 8.05 13.7 6.2 14.75 4.35 17.05 4.35Z', tone: 0.78 },
      { d: lem(9.0, 9.55, 1.7, 0.84) },
    ],
    circles: [[17.2, 15.85, 1.05]],
  },

  // Twin four-point sparks — AI features
  'inf.sparkle': {
    segs: [
      {
        d: 'M12 3.6C12.7 8.3 13.9 9.5 18.6 10.2 13.9 10.9 12.7 12.1 12 16.8 11.3 12.1 10.1 10.9 5.4 10.2 10.1 9.5 11.3 8.3 12 3.6Z',
      },
      {
        d: 'M17.4 14.2c.3 2 .5 2.2 2.5 2.5-2 .3-2.2.5-2.5 2.5-.3-2-.5-2.2-2.5-2.5 2-.3 2.2-.5 2.5-2.5Z',
      },
    ],
  },

  // Axis, bars, and a tone-layered trend line — charts
  'inf.chart': {
    segs: [
      { d: 'M4.2 4.2v13.7a2.1 2.1 0 0 0 2.1 2.1h13.5' },
      { d: 'M9.2 16.6v-4.4M13.4 16.6V9.4M17.6 16.6V6.6' },
      { d: 'M6.8 10.9l4-3.6 2.7 2.2 4.3-3.9', tone: 0.55 },
    ],
  },

  // Graduation cap — lessons
  'inf.cap': {
    segs: [
      { d: 'M12 4.2l8.6 4.1L12 12.4 3.4 8.3Z' },
      { d: 'M7 10.6v3.8c0 1.4 2.24 2.9 5 2.9s5-1.5 5-2.9v-3.8' },
      { d: 'M20.6 8.3v5.2' },
    ],
    circles: [[20.6, 14.9, 0.9]],
  },

  // Checklist with mixed markers — task panels
  'inf.tasks': {
    segs: [
      { d: 'M9.4 6.6h11M9.4 12h11M9.4 17.4h11' },
      { d: 'M3.5 12l.85.85 1.6-1.85' },
    ],
    circles: [
      [4.6, 6.6, 1.1],
      [4.6, 17.4, 1.1],
    ],
  },

  // Silicon chip — the engine
  'inf.chip': {
    segs: [
      { d: 'M9.4 9.4h5.2v5.2H9.4Z' },
      {
        d: 'M7 6.6h10a.9.9 0 0 1 .9.9v9a.9.9 0 0 1-.9.9H7a.9.9 0 0 1-.9-.9v-9a.9.9 0 0 1 .9-.9Z',
      },
      {
        d: 'M9.8 3.6v3M14.2 3.6v3M9.8 17.4v3M14.2 17.4v3M3.6 9.8h3M3.6 14.2h3M17.4 9.8h3M17.4 14.2h3',
      },
    ],
  },

  // App window with an insert plus — the builder
  'inf.build': {
    segs: [
      {
        d: 'M4 4.6h16a1.1 1.1 0 0 1 1.1 1.1v12.6a1.1 1.1 0 0 1-1.1 1.1H4a1.1 1.1 0 0 1-1.1-1.1V5.7A1.1 1.1 0 0 1 4 4.6Z',
      },
      { d: 'M2.9 8.4h18.2' },
      { d: 'M12 11.4v5M9.5 13.9h5' },
    ],
  },

  // Microphone
  'inf.mic': {
    segs: [
      { d: 'M9.4 5.4a2.6 2.6 0 0 1 5.2 0v5a2.6 2.6 0 0 1-5.2 0Z' },
      { d: 'M5.9 10.6a6.1 6.1 0 0 0 12.2 0' },
      { d: 'M12 16.7v3.4M9.2 20.1h5.6' },
    ],
  },

  // Magnifier with a lens glint — search
  'inf.search': {
    segs: [
      { d: 'M7.7 10.8a3.1 3.1 0 0 1 2.1-2.9', tone: 0.55 },
      { d: 'M15.3 15.3l5.2 5.2' },
    ],
    circles: [[10.8, 10.8, 5.9]],
  },

  // Right panel with content ticks
  'inf.panel': {
    segs: [
      {
        d: 'M4.4 4.6h15.2a1.4 1.4 0 0 1 1.4 1.4v12a1.4 1.4 0 0 1-1.4 1.4H4.4A1.4 1.4 0 0 1 3 18V6a1.4 1.4 0 0 1 1.4-1.4Z',
      },
      { d: 'M14.6 4.6v14.8' },
      { d: 'M16.9 8.1h1.7M16.9 11.3h1.7', tone: 0.55 },
    ],
  },

  // Menu lines with a node — the command menu
  'inf.menu': {
    segs: [{ d: 'M4 6.8h16M4 12h10.5M4 17.2h16' }],
    circles: [[18.4, 12, 1.35]],
  },

  // Pen and ink — spelling tutor
  'inf.spell': {
    segs: [
      { d: 'M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c1.5 0 3-.3 4.3-.9' },
      { d: 'M17.5 6.5L21 10l-3.5 3.5' },
      { d: 'M14 9l1 1', tone: 0.5 },
    ],
    circles: [[12, 12, 9.5]],
  },
} satisfies Record<string, InfinityIconDef>;

export type InfinityIconName = keyof typeof INF_ICONS;

interface InfinityIconProps {
  name: InfinityIconName;
  className?: string;
  strokeWidth?: number;
  /** Spectrum stroke for bright surfaces (module tiles); defaults to currentColor. */
  gradient?: [string, string];
}

export function InfinityIcon({
  name,
  className = 'w-4 h-4',
  strokeWidth = 1.75,
  gradient,
}: InfinityIconProps) {
  // Widen to the declared shape: `satisfies` preserves each entry's literal
  // type, which breaks optional-property access across the icon union here.
  const def: InfinityIconDef = INF_ICONS[name];
  const gradId = useId().replace(/:/g, '');
  const stroke = gradient ? `url(#inf-g-${gradId})` : 'currentColor';
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke={stroke}
      strokeWidth={strokeWidth}
      shapeRendering="geometricPrecision"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {gradient && (
        <defs>
          <linearGradient
            id={`inf-g-${gradId}`}
            x1="4"
            y1="4"
            x2="20"
            y2="20"
            gradientUnits="userSpaceOnUse"
          >
            <stop stopColor={gradient[0]} />
            <stop offset="1" stopColor={gradient[1]} />
          </linearGradient>
        </defs>
      )}
      {def.segs.map((seg, i) => (
        <path
          key={i}
          d={seg.d}
          strokeDasharray={seg.dash}
          opacity={seg.tone}
          transform={seg.transform}
        />
      ))}
      {def.circles?.map(([cx, cy, r], i) => (
        <circle key={`c${i}`} cx={cx} cy={cy} r={r} />
      ))}
    </svg>
  );
}
