import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { settings } from '../settings/store.js';
import { getOwnerManager } from '../owner/manager.js';
import { infiniteHome } from '../profiles/home.js';

/**
 * Guard rails for the agent modifying Infinite OS itself.
 *
 * ## Why this exists
 *
 * The user asked for an agent that can do anything on the PC, and it can:
 * `Full system access` bypasses every deny rule and prompt, and `Write`/`Edit`/
 * `Delete` reach any file. That is the right default and it is not being
 * narrowed here.
 *
 * What was missing is the other half of that bargain. Infinite OS already
 * versions and reverts agent edits (`snapshots.ts` for file state,
 * `edit-checkpoint.ts` for per-message rewind) and already records every action
 * to an append-only log (`audit/action-log.ts`). Those are what make
 * unrestricted autonomy *usable* — they are how you see what changed and put it
 * back.
 *
 * None of them could stop the agent rewriting the code that performs them. An
 * agent that quietly disables its own undo, or corrupts the audit log, removes
 * the user's ability to find out what happened. That is the one failure mode
 * that turns "the AI can do anything" from a feature into a trap, and it is
 * what this file prevents.
 *
 * ## What is protected, and why
 *
 * Only the machinery that protects the *user* — the thing that records what the
 * agent did and the thing that puts it back. Not the agent's own features, not
 * its personality, not the UI, not its tools. The agent remains free to
 * rewrite itself in every way that does not blind the user.
 *
 * `selfProtectionEnabled` defaults to **on** and can be turned off from settings.
 * It is a user choice, not a restriction imposed by the system.
 *
 * ## What is deliberately not here
 *
 * Conway's `automaton` also has survival tiers, a crypto wallet, self-
 * replication and on-chain identity. None of it applies to software running on
 * the user's own PC, and self-replication would be actively harmful here. The
 * two ideas worth taking were these guards and the audit discipline; the audit
 * discipline was already built.
 */

/** Files that implement the user's ability to see and undo agent changes. */
const PROTECTED_PATHS = [
  // Versions pre-edit file state. Removing it makes every change unundoable.
  'src/main/tools/snapshots.ts',
  // Per-message rewind. Same reason.
  'src/main/agent/edit-checkpoint.ts',
  'src/main/checkpoint/',
  // The append-only record of what the agent did.
  'src/main/audit/',
  // The permission engine and this file. A guard that can be edited away is not
  // a guard, so the enforcement point is inside the protected set.
  'src/main/agent/permissions.ts',
  'src/main/agent/self-modification.ts',
];

/**
 * How many times one file may be modified inside the window before it is
 * treated as a runaway loop.
 *
 * A sensible agent edits a file a few times while iterating on a fix. A loop
 * that rewrites the same file hundreds of times is not working, and on a slow
 * machine it burns the user's time and fills the snapshot store. The limit is
 * high enough that no real fix hits it.
 */
const RUNAWAY_LIMIT = 25;
const RUNAWAY_WINDOW_MS = 60_000;

interface RecentEdit {
  at: number;
}

/**
 * Recent edits per repo-relative path.
 *
 * Persisted, because the loop this guards against does not stop when the app
 * does: an agent that has rewritten the same file twenty-four times, restarts,
 * and writes it again was in a loop either way, and an in-memory counter hands
 * it a clean budget every time. Only the entries still inside the window are
 * kept, so the file cannot grow without bound.
 */
const recentEdits = new Map<string, RecentEdit[]>();

/** Where the window state lives between runs. */
function runawayStatePath(): string {
  return join(infiniteHome(), 'self-modification-runaway.json');
}

function loadRecentEdits(): Map<string, RecentEdit[]> {
  try {
    const path = runawayStatePath();
    if (!existsSync(path)) return new Map();
    const raw = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
    const now = Date.now();
    const out = new Map<string, RecentEdit[]>();
    for (const [rel, times] of Object.entries(raw ?? {})) {
      if (!Array.isArray(times)) continue;
      // Drop anything that has aged out — the window is what matters, not the
      // history, and keeping stale entries would grow the file forever.
      const live = times.filter((t): t is number => typeof t === 'number' && now - t < RUNAWAY_WINDOW_MS);
      if (live.length) out.set(rel, live.map((at) => ({ at })));
    }
    return out;
  } catch {
    // A corrupt or unreadable file must not disable the protection.
    return new Map();
  }
}

/** Best-effort: failing to save the counter must never fail the user's edit. */
function saveRecentEdits(): void {
  try {
    mkdirSync(infiniteHome(), { recursive: true });
    const out: Record<string, number[]> = {};
    for (const [rel, edits] of recentEdits) {
      if (edits.length) out[rel] = edits.map((e) => e.at);
    }
    writeFileSync(runawayStatePath(), JSON.stringify(out));
  } catch { /* best-effort */ }
}

/**
 * Whether the user has switched the guard off.
 *
 * Read lazily through the settings module so a change takes effect without a
 * restart, and so tests can control it.
 */
function protectionEnabled(): boolean {
  try {
    // `get` is synchronous, so the guard is synchronous too. Anything async
    // here would let a write through before the check finished.
    return settings.get('selfProtectionEnabled') !== false;
  } catch {
    // If settings cannot be read, keep the guard on. Failing open would mean a
    // broken settings module silently disables protection.
    return true;
  }
}

/** Normalise a path to the repo-relative, forward-slash form the list uses. */
export function toRepoRelative(repoRoot: string, target: string): string {
  const absolute = isAbsolute(target) ? resolve(target) : resolve(repoRoot, target);
  const rel = relative(repoRoot, absolute).replace(/\\/g, '/');
  return rel;
}

export function isProtectedPath(repoRoot: string, target: string): boolean {
  const rel = toRepoRelative(repoRoot, target);
  if (!rel || rel.startsWith('..')) return false; // outside the repo
  return PROTECTED_PATHS.some(
    (p) => (p.endsWith('/') ? rel.startsWith(p) : rel === p),
  );
}

export interface GuardResult {
  allowed: boolean;
  reason?: string;
}

/**
 * Decide whether the agent may change a file inside Infinite OS.
 *
 * `repoRoot` is the Infinite OS source root. Paths outside it are never
 * protected — this guards the app's own machinery, not the user's documents.
 */
export function guardSelfModification(
  repoRoot: string,
  target: string,
  operation: 'create' | 'modify' | 'delete',
): GuardResult {
  const rel = toRepoRelative(repoRoot, target);

  // Outside the repository: not this guard's business.
  if (!rel || rel.startsWith('..')) return { allowed: true };

  // Owner gate: editing Infinite OS itself is the creator's privilege.
  // The signed-in identity comes from the main-owned session file — the
  // renderer is never trusted for this decision. INFINITE_ALLOW_SELF_MODIFICATION=1
  // bypasses for tests and headless tooling.
  if (process.env.INFINITE_ALLOW_SELF_MODIFICATION !== '1' && !signedInEmailIsOwner()) {
    return {
      allowed: false,
      reason:
        `Self-modification is reserved for the OS owner. Sign in as the creator's account ` +
        `(or set INFINITE_ALLOW_SELF_MODIFICATION=1) to let the agent change Infinite OS itself.`,
    };
  }

  if (protectionEnabled() && isProtectedPath(repoRoot, target)) {
    const verb = operation === 'delete' ? 'deleting' : operation === 'create' ? 'creating' : 'changing';
    return {
      allowed: false,
      reason:
        `Refused to ${operation} ${rel} — it is protected. ` +
        'It is part of the machinery that records what you do and lets you undo it, so ' +
        `${verb} it would remove your ability to see or reverse this edit. ` +
        'Turn self-protection off in Settings if you mean to do this.',
    };
  }

  // Runaway loop protection, applied regardless of the protection setting:
  // this is about the agent wasting the user's time, not about limiting what
  // it may build.
  const now = Date.now();
  if (!runawayLoaded) {
    recentEdits.clear();
    for (const [k, v] of loadRecentEdits()) recentEdits.set(k, v);
    runawayLoaded = true;
  }
  const history = (recentEdits.get(rel) ?? []).filter((e) => now - e.at < RUNAWAY_WINDOW_MS);
  if (history.length >= RUNAWAY_LIMIT) {
    return {
      allowed: false,
      reason:
        `${rel} has been modified ${history.length} times in the last minute, which looks like a ` +
        'loop rather than progress. Change something else, or make the edit deliberately. ' +
        'Snapshot history is unaffected.',
    };
  }
  history.push({ at: now });
  recentEdits.set(rel, history);
  saveRecentEdits();
  return { allowed: true };
}

let runawayLoaded = false;

/** Clear the runaway counter. For tests, and for a deliberate "start over". */
export function resetSelfModificationGuard(): void {
  recentEdits.clear();
  runawayLoaded = true;
  try { rmSync(runawayStatePath(), { force: true }); } catch { /* best-effort */ }
}

/** The protected list, for showing the user what is guarded. */
export function listProtectedPaths(): string[] {
  return [...PROTECTED_PATHS];
}function signedInEmailIsOwner(): boolean {
  try {
    const sessionPath = join(infiniteHome(), 'auth-session.json');
    // No signed-in account (CI, headless tooling, pre-login dev): behave
    // exactly as before the gate existed. The privilege split applies only
    // between signed-in local accounts — which is the owner-vs-guest case.
    if (!existsSync(sessionPath)) return true;
    const session = JSON.parse(readFileSync(sessionPath, 'utf8')) as { user?: { email?: string } } | null;
    const email = session?.user?.email;
    if (!email) return true;
    // Owner email source: the owner DB when loadable, else the marker file
    // written at sign-in (better-sqlite3 is Electron-ABI after postinstall,
    // so the DB is not always loadable from the runtime this guard runs in).
    try {
      return getOwnerManager().isOwnerEmail(email);
    } catch {
      const markerPath = join(infiniteHome(), 'owner-email.json');
      if (existsSync(markerPath)) {
        const owner = (JSON.parse(readFileSync(markerPath, 'utf8')) as { email?: string }).email;
        return !!owner && owner.toLowerCase() === email.toLowerCase();
      }
      return false;
    }
  } catch {
    return true; // advisory machinery must never brick the tools
  }
}
