// Transcript locations.
//
// The sessions directory is resolved on every call instead of once at import
// time. `infiniteHome()` honours the test home override on every call, so a
// module-scope constant would pin whichever profile happened to be active
// when the module was first loaded and quietly write test transcripts into
// the user's real data.

import { join } from 'node:path';
import { infiniteHome } from '../profiles/home.js';

/** The directory holding every conversation transcript. */
export function sessionsDir(): string {
  return join(infiniteHome(), 'sessions');
}
