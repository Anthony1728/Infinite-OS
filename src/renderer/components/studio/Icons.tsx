/**
 * Line icons for Studio and Planner.
 *
 * Drawn on the same 24px / 1.8-stroke grid as the rest of Infinite OS, so the
 * editors feel like part of the shell rather than a bolted-on widget. Icons are
 * inline rather than a dependency: the app stays fast and the set stays
 * coherent.
 */

export type StudioIconName =
  | 'plus' | 'search' | 'star' | 'star-filled' | 'trash' | 'copy' | 'download'
  | 'sparkles' | 'x' | 'check' | 'chevron-down' | 'chevron-left' | 'chevron-right'
  | 'chevron-up' | 'bold' | 'italic' | 'underline' | 'h1' | 'h2' | 'list'
  | 'list-ordered' | 'quote' | 'link' | 'undo' | 'redo' | 'align-left'
  | 'align-center' | 'align-right' | 'file' | 'sheet' | 'slides' | 'more'
  | 'calendar' | 'bell' | 'clock' | 'tag' | 'flag' | 'play' | 'grid'
  | 'arrow-up' | 'arrow-down' | 'save' | 'panel-right' | 'external' | 'inbox'
  | 'sun' | 'repeat' | 'filter' | 'refresh';

const PATHS: Record<StudioIconName, string[]> = {
  plus: ['M12 5v14', 'M5 12h14'],
  search: ['M20.5 20.5 16 16', 'M11 18a7 7 0 1 1 0-14 7 7 0 0 1 0 14Z'],
  star: ['M12 3.6l2.6 5.3 5.8.8-4.2 4.1 1 5.8-5.2-2.8-5.2 2.8 1-5.8L3.6 9.7l5.8-.8L12 3.6Z'],
  'star-filled': ['M12 3.6l2.6 5.3 5.8.8-4.2 4.1 1 5.8-5.2-2.8-5.2 2.8 1-5.8L3.6 9.7l5.8-.8L12 3.6Z'],
  trash: ['M4 7h16', 'M9 7V5h6v2', 'M6 7l1 13h10l1-13', 'M10 11v5', 'M14 11v5'],
  copy: ['M9 9h11v11H9z', 'M4 4h11v11', 'M4 4v11h4'],
  download: ['M12 3v12', 'M7 10l5 5 5-5', 'M4 20h16'],
  sparkles: ['M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6L12 3Z', 'M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15Z'],
  x: ['M6 6l12 12', 'M18 6 6 18'],
  check: ['M5 12.5l4 4L19 6.5'],
  'chevron-down': ['M7 9.5l5 5 5-5'],
  'chevron-up': ['M7 14.5l5-5 5 5'],
  'chevron-left': ['M14.5 6l-6 6 6 6'],
  'chevron-right': ['M9.5 6l6 6-6 6'],
  bold: ['M7 5h6a4 4 0 0 1 0 8H7V5Z', 'M7 13h7a4 4 0 0 1 0 8H7v-8Z'],
  italic: ['M10 5h8', 'M6 19h8', 'M14 5l-4 14'],
  underline: ['M7 4v7a5 5 0 0 0 10 0V4', 'M5 21h14'],
  h1: ['M4 5v14', 'M12 5v14', 'M4 12h8', 'M16 10l3-2v11'],
  h2: ['M4 5v14', 'M12 5v14', 'M4 12h8', 'M16 10a2.5 2.5 0 0 1 4.8 1c0 2-4.8 4-4.8 7h5'],
  list: ['M9 6h11', 'M9 12h11', 'M9 18h11', 'M4.5 6h.01', 'M4.5 12h.01', 'M4.5 18h.01'],
  'list-ordered': ['M9 6h11', 'M9 12h11', 'M9 18h11', 'M4 5h1v4', 'M4 13h2l-2 4h2'],
  quote: ['M7 7h4v4c0 2.2-1.2 3.4-4 4', 'M15 7h4v4c0 2.2-1.2 3.4-4 4'],
  link: ['M10 13.5a4 4 0 0 0 5.7 0l2.8-2.8a4 4 0 0 0-5.7-5.7L11 6.8', 'M14 10.5a4 4 0 0 0-5.7 0L5.5 13.3a4 4 0 0 0 5.7 5.7l1.8-1.8'],
  undo: ['M9 14l-4-4 4-4', 'M5 10h9a5 5 0 0 1 0 10h-3'],
  redo: ['M15 14l4-4-4-4', 'M19 10h-9a5 5 0 0 0 0 10h3'],
  'align-left': ['M4 6h16', 'M4 10h10', 'M4 14h16', 'M4 18h8'],
  'align-center': ['M4 6h16', 'M7 10h10', 'M4 14h16', 'M8 18h8'],
  'align-right': ['M4 6h16', 'M10 10h10', 'M4 14h16', 'M12 18h8'],
  file: ['M7 3h7l4 4v14H7V3Z', 'M14 3v5h5', 'M10 13h5', 'M10 17h5'],
  sheet: ['M4 5h16v14H4V5Z', 'M4 10h16', 'M4 15h16', 'M9 5v14', 'M15 5v14'],
  slides: ['M4 4h16v11H4V4Z', 'M12 15v4', 'M8 21h8'],
  more: ['M5 12h.01', 'M12 12h.01', 'M19 12h.01'],
  calendar: ['M4 6h16v15H4V6Z', 'M4 10h16', 'M8 3v5', 'M16 3v5', 'M8 14h2', 'M14 14h2', 'M8 18h2'],
  bell: ['M6 9a6 6 0 0 1 12 0c0 4 1.5 5 2 6H4c.5-1 2-2 2-6Z', 'M10 19a2 2 0 0 0 4 0'],
  clock: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z', 'M12 7v5l3 2'],
  tag: ['M3 11.5V4h7.5L21 14.5 14.5 21 3 11.5Z', 'M7.5 7.5h.01'],
  flag: ['M5 21V4', 'M5 4h10l-2 4 2 4H5'],
  play: ['M8 5l11 7-11 7V5Z'],
  grid: ['M4 4h6v6H4V4Z', 'M14 4h6v6h-6V4Z', 'M4 14h6v6H4v-6Z', 'M14 14h6v6h-6v-6Z'],
  'arrow-up': ['M12 19V5', 'M6 11l6-6 6 6'],
  'arrow-down': ['M12 5v14', 'M6 13l6 6 6-6'],
  save: ['M5 3h12l2 2v16H5V3Z', 'M8 3v6h8V3', 'M8 21v-7h8v7'],
  'panel-right': ['M4 4h16v16H4V4Z', 'M15 4v16'],
  external: ['M14 4h6v6', 'M20 4l-9 9', 'M18 14v5H5V6h5'],
  inbox: ['M4 13l2-9h12l2 9v7H4v-7Z', 'M4 13h5l1 2h4l1-2h5'],
  sun: ['M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10Z', 'M12 2v2', 'M12 20v2', 'M2 12h2', 'M20 12h2', 'M4.9 4.9l1.4 1.4', 'M17.7 17.7l1.4 1.4', 'M19.1 4.9l-1.4 1.4', 'M6.3 17.7l-1.4 1.4'],
  repeat: ['M17 2l4 4-4 4', 'M3 11V9a3 3 0 0 1 3-3h15', 'M7 22l-4-4 4-4', 'M21 13v2a3 3 0 0 1-3 3H3'],
  filter: ['M3 5h18l-7 8v6l-4 2v-8L3 5Z'],
  refresh: ['M20 11a8 8 0 1 0-2 5', 'M20 4v7h-7'],
};

interface StudioIconProps {
  name: StudioIconName;
  size?: number;
  className?: string;
  strokeWidth?: number;
}

export function StudioIcon({ name, size = 16, className, strokeWidth = 1.8 }: StudioIconProps) {
  const filled = name === 'star-filled';
  const dotNames = name === 'more' || name === 'list';
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {PATHS[name].map((d, index) =>
        dotNames && d.endsWith('h.01') ? (
          <circle key={index} cx={Number(d.slice(1, d.indexOf(' ')))} cy={Number(d.split(' ')[1].slice(0, -3))} r="1" fill="currentColor" stroke="none" />
        ) : (
          <path key={index} d={d} />
        ),
      )}
    </svg>
  );
}
