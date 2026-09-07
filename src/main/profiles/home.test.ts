import { describe, it, expect } from 'vitest';
import { join } from 'node:path';

// infiniteHome caches per process; the env override keeps this hermetic.
// (Each test file runs in its own worker, so this cannot leak.)
process.env.INFINITE_TEST_HOME = join('test-override', 'infinite-home');

const { infiniteHome, isAdoptable, profileDirFor, adoptMarkerPath, sessionUidFor } = await import('./home.js');

describe('infiniteHome', () => {
  it('honors the test override', () => {
    expect(infiniteHome()).toBe(join('test-override', 'infinite-home'));
  });

  it('builds profile dirs under profiles/', () => {
    expect(profileDirFor('/base', 'user-1')).toBe(join('/base', 'profiles', 'user-1'));
  });

  it('sanitizes hostile uids and rejects empty ones', () => {
    expect(profileDirFor('/base', '../../etc')).toBe(join('/base', 'profiles', 'etc'));
    expect(() => profileDirFor('/base', '!!!')).toThrow('Invalid profile id');
  });

  it('adopts user-data dirs but never global files', () => {
    for (const d of ['sessions', 'memory', 'agents.db', 'INFINITE.md', 'secrets.bin', 'projects', 'skills']) {
      expect(isAdoptable(d)).toBe(true);
    }
    for (const d of ['auth.json', 'auth-session.json', 'logs', 'profiles', 'active-profile.json', 'chrome-operator-profile', '.screenshots-trash']) {
      expect(isAdoptable(d)).toBe(false);
    }
  });

  it('adopt marker lives inside the profile dir', () => {
    expect(adoptMarkerPath('/p')).toBe(join('/p', '.adopted'));
  });
});

describe('profile activation', () => {
  it('moves legacy data on first login, never overwrites, and is idempotent', async () => {
    const { mkdtemp, rm, mkdir, writeFile, readFile, readdir } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { getActiveUid, setActiveUid, adoptProfileData, profileDirFor } = await import('./home.js');
    const base = await mkdtemp(join(tmpdir(), 'infinite-profiles-test-'));
    try {
      await writeFile(join(base, 'INFINITE.md'), 'prefs');
      await mkdir(join(base, 'sessions'), { recursive: true });
      await writeFile(join(base, 'sessions', 'a.jsonl'), '{}');
      await writeFile(join(base, 'auth.json'), '{}');

      expect(getActiveUid(base)).toBe(null);
      const moved = adoptProfileData(base, 'User@Mail.com');
      expect(moved).toContain('INFINITE.md');
      expect(moved).toContain('sessions');
      expect(moved).not.toContain('auth.json');
      const dir = profileDirFor(base, 'User@Mail.com');
      expect(await readFile(join(dir, 'INFINITE.md'), 'utf8')).toBe('prefs');
      expect(await readdir(join(dir, 'sessions'))).toEqual(['a.jsonl']);
      // Legacy entries are gone (moved, not copied); globals stay.
      await expect(readFile(join(base, 'INFINITE.md'), 'utf8')).rejects.toThrow();
      expect(await readFile(join(base, 'auth.json'), 'utf8')).toBe('{}');

      // Second login: idempotent, adopts nothing.
      expect(adoptProfileData(base, 'User@Mail.com')).toEqual([]);

      // Active-profile pointer round-trips; logout clears.
      setActiveUid('User@Mail.com', base);
      expect(getActiveUid(base)).toBe('UserMailcom');
      setActiveUid(null, base);
      expect(getActiveUid(base)).toBe(null);
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });

  it('sessionUidFor matches getActiveUid for the same account (no phantom switch)', async () => {
    const { mkdtemp, rm } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { getActiveUid, setActiveUid } = await import('./home.js');
    // Regression: the auth handler once compared the RAW session email
    // against the SANITIZED pointer, mismatched forever, and relaunched
    // on every boot — black orphan window in dev.
    const base = await mkdtemp(join(tmpdir(), 'profiles-uid-'));
    try {
      const session = { user: { email: 'test@example.com' }, isAuthenticated: true };
      const uid = sessionUidFor(session);
      expect(uid).toBe('testexamplegmailcom');
      setActiveUid(uid, base);
      expect(getActiveUid(base)).toBe(uid);
      expect(sessionUidFor(null)).toBe(null);
      expect(sessionUidFor({})).toBe(null);
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });
});
