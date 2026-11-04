/**
 * Composer drafts — what someone typed but hasn't sent, kept per session so
 * going elsewhere in the OS and coming back finds it still there. Survives
 * relaunch; sending clears it.
 *
 * Otto-derived design (ComposerDrafts.swift): an LRU-capped localStorage map,
 * oldest-written drafts evicted beyond the cap. Empty/whitespace text clears
 * the slot rather than storing nothing.
 */

const STORAGE_KEY = 'infinite:composer-drafts';
const LIMIT = 200;

let drafts = readAll();
let order: string[] = Object.keys(drafts);
let persistTimer: ReturnType<typeof setTimeout> | null = null;

function readAll(): Record<string, string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, string>) : {};
  } catch {
    return {};
  }
}

function persist(): void {
  // Debounced: typing must not write localStorage on every keystroke.
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(drafts));
    } catch {
      /* a full or blocked store must never break typing */
    }
  }, 400);
}

export function composerDraft(sessionId: string | null | undefined): string {
  if (!sessionId) return '';
  return drafts[sessionId] ?? '';
}

export function saveComposerDraft(sessionId: string | null | undefined, text: string): void {
  if (!sessionId) return;
  const next = text.trim().length ? text : '';
  if ((drafts[sessionId] ?? '') === next) return;
  if (next) drafts[sessionId] = next;
  else delete drafts[sessionId];
  order = order.filter((id) => id !== sessionId);
  if (next) order.push(sessionId);
  while (order.length > LIMIT) {
    const evicted = order.shift();
    if (evicted) delete drafts[evicted];
  }
  persist();
}

export function clearComposerDraft(sessionId: string | null | undefined): void {
  saveComposerDraft(sessionId, '');
}
