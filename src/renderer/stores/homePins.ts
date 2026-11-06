import { create } from 'zustand';

/**
 * Pinned Home cards, ported clean-room from Otto's HomePinsStore idea:
 * a pin references its source file and never mutates it. Pins are scoped to
 * the signed-in profile and the active workspace so two accounts on one
 * machine can never see each other's home.
 */
export interface HomePin {
  id: string;
  path: string;
  title: string;
  /** Tall cards show the long preview; compact cards show a few lines. */
  expanded: boolean;
}

interface HomePinsState {
  pins: HomePin[];
  /** Key the current list was loaded from — null until load() runs. */
  storageKey: string | null;
  load: () => void;
  addPin: (path: string, title?: string) => void;
  removePin: (id: string) => void;
  movePin: (id: string, direction: -1 | 1) => void;
  toggleExpanded: (id: string) => void;
  clearPins: () => void;
}

const PIN_PREFIX = 'infinite:home.pins.v1';

/** Profile + workspace key. Reading the stores directly keeps actions usable
 *  before the Home section mounts (e.g. "Save & pin" from Quick Capture). */
export function currentPinsKey(): string {
  let profileId = 'local';
  try {
    const auth = JSON.parse(localStorage.getItem('infinite:auth') ?? 'null') as {
      state?: { user?: { id?: string } };
    } | null;
    profileId = auth?.state?.user?.id || 'local';
  } catch { /* fall back to the local profile */ }
  let workspace = 'default';
  try {
    const current = JSON.parse(localStorage.getItem('infinite:current') ?? '{}') as { cwd?: string };
    workspace = (current.cwd || 'default').trim() || 'default';
  } catch { /* fall back to the default workspace */ }
  return `${PIN_PREFIX}:${profileId}:${workspace}`;
}

function readPins(key: string): HomePin[] {
  try {
    const raw = JSON.parse(localStorage.getItem(key) ?? '[]') as unknown;
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((item): item is HomePin => Boolean(item) && typeof item === 'object'
        && typeof (item as HomePin).path === 'string'
        && typeof (item as HomePin).id === 'string')
      .map((item) => ({
        id: item.id,
        path: item.path,
        title: item.title || item.path.split(/[\\/]/).pop() || item.path,
        expanded: item.expanded === true,
      }));
  } catch {
    return [];
  }
}

function writePins(key: string, pins: HomePin[]): void {
  try { localStorage.setItem(key, JSON.stringify(pins)); } catch { /* storage may be full */ }
}

function basename(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

export const useHomePinsStore = create<HomePinsState>((set, get) => ({
  pins: [],
  storageKey: null,

  load: () => {
    const key = currentPinsKey();
    set({ storageKey: key, pins: readPins(key) });
  },

  addPin: (path, title) => {
    const clean = path.trim();
    if (!clean) return;
    const key = currentPinsKey();
    const existing = get().storageKey === key ? get().pins : readPins(key);
    const duplicate = existing.some((pin) => pin.path.toLowerCase() === clean.toLowerCase());
    if (duplicate) {
      set({ storageKey: key, pins: existing });
      return;
    }
    const pins = [
      ...existing,
      { id: crypto.randomUUID(), path: clean, title: title?.trim() || basename(clean), expanded: false },
    ];
    writePins(key, pins);
    set({ storageKey: key, pins });
  },

  removePin: (id) => {
    const key = currentPinsKey();
    const pins = get().pins.filter((pin) => pin.id !== id);
    writePins(key, pins);
    set({ storageKey: key, pins });
  },

  movePin: (id, direction) => {
    const key = currentPinsKey();
    const pins = [...get().pins];
    const index = pins.findIndex((pin) => pin.id === id);
    const next = index + direction;
    if (index < 0 || next < 0 || next >= pins.length) return;
    [pins[index], pins[next]] = [pins[next], pins[index]];
    writePins(key, pins);
    set({ storageKey: key, pins });
  },

  toggleExpanded: (id) => {
    const key = currentPinsKey();
    const pins = get().pins.map((pin) => (pin.id === id ? { ...pin, expanded: !pin.expanded } : pin));
    writePins(key, pins);
    set({ storageKey: key, pins });
  },

  clearPins: () => {
    const key = currentPinsKey();
    writePins(key, []);
    set({ storageKey: key, pins: [] });
  },
}));
