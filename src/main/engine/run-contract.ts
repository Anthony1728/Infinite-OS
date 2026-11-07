// Run contract — the execution engine's proof-of-work gate.
//
// The coordination layer (agent/coordination.ts) enforces this contract for
// CREW delegates: claims are checked against the filesystem, failed claims
// get a revision round. But the MAIN execution loop (agent/loop.ts) accepted
// a hallucinated delivery in a real eval run (2026-11-11): the model said
// "Created notes/welcome.md ... verified" with zero real writes, and the run
// finished successfully. The eval's mechanical checks caught it AFTER the
// fact; the loop itself never looked.
//
// This module brings the same proof requirement INTO the engine: every run
// that claims file writes gets those claims verified against the disk before
// verified completion, with one revision round to fix phantom claims.

import { existsSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';

export interface FileClaimResult {
  /** Absolute paths the model claimed to have written. */
  claimed: string[];
  /** Claimed paths that do not exist on disk. */
  missing: string[];
}

const ABSOLUTE_PATH =
  /(?:[A-Za-z]:[\\/](?:[\w.@()-]+[\\/]?)+)|(?:\/(?:home|Users|tmp|var|opt)\/(?:[\w.@()-]+\/?)+)/g;

/**
 * Extract file paths the model claims to have written — absolute paths from
 * its result text. Space is excluded from path segments (under-matching
 * beats falsely failing every delivery; quoted paths are the contract).
 */
export function extractClaimedPaths(result: string): string[] {
  const out = new Set<string>();
  for (const match of result.matchAll(ABSOLUTE_PATH)) {
    const candidate = match[0].replace(/[)\].,;'"]+$/g, '').trim();
    if (candidate.length > 4) out.add(candidate);
  }
  return [...out];
}

/** Evaluate every claimed path against the real filesystem. */
export function evaluateFileClaims(result: string, cwd: string): FileClaimResult {
  const claimed = extractClaimedPaths(result);
  const missing = claimed.filter((claim) => {
    const candidate = isAbsolute(claim) ? claim : resolve(cwd, claim);
    return !existsSync(candidate);
  });
  return { claimed, missing };
}

/** The revision directive: proof-first, no re-description. */
export function renderClaimRevisionDirective(missing: string[]): string {
  return [
    '[File-claim verification FAILED — your previous reply claimed file writes that do not exist on disk.]',
    '',
    'Missing files:',
    ...missing.map((m) => `- ${m}`),
    '',
    'Fix this now: actually perform the writes with the Write tool (or create the directories first),',
    'then reply with the real, completed delivery. A reply that only re-describes the work will be',
    'rejected again — the file system is checked mechanically on every reply.',
  ].join('\n');
}
