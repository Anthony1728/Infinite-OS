import { useMemo } from 'react';
import { InfinityIcon } from '../brand/InfinityIcons';

// Deterministic bot face from name + seed (Hermes blob-face idea, Infinite glass look).
// Same name + seed = same face forever; no two bots look alike by accident.
const PALETTES: Array<[string, string]> = [
  ['#8b5cf6', '#22d3ee'],
  ['#06b6d4', '#34d399'],
  ['#f43f5e', '#fb923c'],
  ['#f59e0b', '#facc15'],
  ['#6366f1', '#a78bfa'],
  ['#14b8a6', '#67e8f9'],
  ['#ec4899', '#8b5cf6'],
  ['#10b981', '#a3e635'],
];

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function botPalette(name: string, seed?: string): [string, string] {
  return PALETTES[hash(`${seed ?? ''}:${name.toLowerCase()}`) % PALETTES.length];
}

export function BotAvatar({
  name,
  seed,
  size = 40,
  busy = false,
}: {
  name: string;
  seed?: string;
  size?: number;
  busy?: boolean;
}) {
  const [from, to] = useMemo(() => botPalette(name, seed), [name, seed]);
  // A bot named "1" (or any digit) renders a bare number as its "initial",
  // which reads like a placeholder. Numbers and '?' get the brand agent
  // glyph in the bot's own palette instead — every avatar looks designed.
  const useGlyph = useMemo(() => {
    const clean = name.trim();
    return !clean || /^[0-9?]/.test(clean);
  }, [name]);
  const initial = useMemo(() => {
    const clean = name.trim();
    return clean ? clean.charAt(0).toUpperCase() : '?';
  }, [name]);
  return (
    <span
      className="relative inline-flex flex-shrink-0 items-center justify-center rounded-2xl font-bold text-white"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.42,
        background: `radial-gradient(circle at 30% 25%, ${from}55, transparent 70%), linear-gradient(135deg, ${from}33, ${to}22)`,
        border: `1px solid ${from}66`,
        boxShadow: `inset 0 1px 0 rgba(255,255,255,.08), 0 4px 16px rgba(0,0,0,.25)`,
      }}
      aria-hidden="true"
    >
      {useGlyph ? (
        <InfinityIcon name="inf.agent" className="h-1/2 w-1/2" gradient={[from, to]} strokeWidth={1.7} />
      ) : (
        initial
      )}
      <span
        className={`absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-[#0c0c10] ${
          busy ? 'bg-amber-400 animate-pulse' : 'bg-emerald-400'
        }`}
      />
    </span>
  );
}
