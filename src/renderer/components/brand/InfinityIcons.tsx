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
  // Speech bubble holding an infinity mark — "infinite conversation"
  'inf.chat': {
    segs: [
      {
        d: 'M5.6 4.2h12.8a2.4 2.4 0 0 1 2.4 2.4v7.2a2.4 2.4 0 0 1-2.4 2.4h-8l-4 3.75a.55.55 0 0 1-.93-.42v-3.33H5.6a2.4 2.4 0 0 1-2.4-2.4V6.6a2.4 2.4 0 0 1 2.4-2.4Z',
      },
      { d: lem(12, 10.1, 3.3, 1.65) },
    ],
    circles: [[8.7, 10.1, 1.05]],
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

  // Infinity loop with chasing arrowheads — perpetual automation
  'inf.automation': {
    segs: [
      { d: lem(12, 12, 6.9, 3.4) },
      { d: 'M17.6 7.7 19.6 9.9 16.9 10.6' },
      { d: 'M6.4 16.3 4.4 14.1 7.1 13.4' },
    ],
  },

  // Robot head with an infinity visor — the brand's agent
  'inf.agent': {
    segs: [
      {
        d: 'M7.2 7.6h9.6a2.6 2.6 0 0 1 2.6 2.6v4.6a2.6 2.6 0 0 1-2.6 2.6H7.2a2.6 2.6 0 0 1-2.6-2.6v-4.6a2.6 2.6 0 0 1 2.6-2.6Z',
      },
      { d: 'M12 7.6V5.1' },
      { d: 'M4.6 10.9H3.2v2.6h1.4M19.4 10.9h1.4v2.6h-1.4' },
      { d: lem(12, 12.7, 3.4, 1.6) },
    ],
    circles: [[12, 3.9, 1.05]],
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

  // Bulb with an infinity filament — the memory that keeps glowing
  'inf.memory': {
    segs: [
      {
        d: 'M12 3.5c-3.9 0-6.8 2.8-6.8 6.5 0 1.77.72 3.42 1.9 4.6.4.4.65.98.65 1.57v2.13h8.5v-2.13c0-.6.25-1.18.65-1.57 1.18-1.18 1.9-2.83 1.9-4.6 0-3.7-2.9-6.5-6.8-6.5Z',
      },
      { d: 'M9.7 21.35h4.6' },
      { d: lem(12, 10.3, 2.7, 1.35) },
    ],
    circles: [[12, 21.35, 1.1]],
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

  // Kanban board with an infinity card — the Projects workspace
  'inf.project': {
    segs: [
      {
        d: 'M4.1 4.5h15.8A1.6 1.6 0 0 1 21.5 6.1v11.8a1.6 1.6 0 0 1-1.6 1.6H4.1a1.6 1.6 0 0 1-1.6-1.6V6.1a1.6 1.6 0 0 1 1.6-1.6Z',
      },
      { d: 'M12 4.7v14.6', tone: 0.65 },
      { d: 'M7.2 8.4v4.4', tone: 0.75 },
      { d: 'M16.8 8.4v3.1', tone: 0.75 },
      { d: lem(12, 14.7, 3.5, 1.65) },
    ],
    circles: [
      [7.2, 15.2, 1.25],
      [16.8, 13.9, 1.25],
    ],
  },

  // File tree — a folder whose branches fold into an infinity leaf
  'inf.folder-tree': {
    segs: [
      {
        d: 'M3.8 5.8a1.6 1.6 0 0 1 1.6-1.6h3.4a1.2 1.2 0 0 1 .95.46l1.3 1.54h7.35a1.9 1.9 0 0 1 1.9 1.9v8.3a1.9 1.9 0 0 1-1.9 1.9H5.7a1.9 1.9 0 0 1-1.9-1.9V5.8Z',
      },
      { d: 'M8.6 10.6v4.6M8.6 10.6h3.5', tone: 0.8 },
      { d: lem(12.1, 14.8, 2.05, 1) },
      { d: 'M15.1 12.9V9.1M15.1 12.9l2.4 2.4', tone: 0.8 },
    ],
    circles: [
      [17.9, 16.9, 1.15],
      [10.3, 8.9, 1.15],
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

  // Dashboard mosaic with an infinity running through one cell — workspace
  'inf.dashboard': {
    segs: [
      { d: 'M4.9 4.3h5.6a1.1 1.1 0 0 1 1.1 1.1v6.2a1.1 1.1 0 0 1-1.1 1.1H4.9a1.1 1.1 0 0 1-1.1-1.1V5.4a1.1 1.1 0 0 1 1.1-1.1Z' },
      { d: 'M14.1 4.3h5a1.1 1.1 0 0 1 1.1 1.1v3.7a1.1 1.1 0 0 1-1.1 1.1h-5a1.1 1.1 0 0 1-1.1-1.1V5.4a1.1 1.1 0 0 1 1.1-1.1Z' },
      { d: 'M14.1 12.4h5a1.1 1.1 0 0 1 1.1 1.1v5.2a1.1 1.1 0 0 1-1.1 1.1h-5a1.1 1.1 0 0 1-1.1-1.1v-5.2a1.1 1.1 0 0 1 1.1-1.1Z' },
      { d: 'M4.9 15.2h5.6a1.1 1.1 0 0 1 1.1 1.1v1.6a1.1 1.1 0 0 1-1.1 1.1H4.9a1.1 1.1 0 0 1-1.1-1.1v-1.6a1.1 1.1 0 0 1 1.1-1.1Z', tone: 0.8 },
      { d: lem(16.6, 16.05, 1.7, 0.85) },
    ],
    circles: [[7.7, 12.7, 1.15]],
  },

  // Gear with an infinity hub — settings
  'inf.gear': {
    segs: [
      { d: 'M12 4.55V2M19.55 12h2.45M12 19.45V22M4.45 12H2M17.36 6.64 19.2 4.8M19.2 19.2 17.36 17.36M6.64 17.36 4.8 19.2M4.8 4.8 6.64 6.64' },
      { d: lem(12, 12, 2.15, 1.1) },
    ],
    circles: [
      [12, 12, 7.4],
      [12, 12, 1.15],
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

  // Honeycomb of capability modules around an infinity core
  'inf.hex-stack': {
    segs: [
      { d: 'M13.9 9.6 11.5 13.8 6.6 13.8 4.2 9.6 6.6 5.4 11.5 5.4Z' },
      { d: 'M19.9 15.9 18.5 18.4 15.6 18.4 14.2 15.9 15.6 13.4 18.5 13.4Z', tone: 0.8 },
      { d: 'M18 6.3 16.9 8.2 14.6 8.2 13.5 6.3 14.6 4.4 16.9 4.4Z', tone: 0.8 },
      { d: lem(9.1, 9.6, 1.65, 0.82) },
    ],
    circles: [[17.1, 15.9, 1.15]],
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
