import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface UserProfile {
  name: string;
  codingPreferences?: string;
  workspaceTheme?: 'dark' | 'light' | 'midnight';
  notificationsEnabled?: boolean;
  aiMemoryEnabled?: boolean;
}

export interface SessionState {
  lastProject?: string;
  openChats?: string[];
  fileExplorerPath?: string;
  terminalState?: 'open' | 'closed';
  lastActiveView?: string;
  recentActivity?: Array<{
    type: 'chat' | 'project' | 'file' | 'deploy';
    title: string;
    timestamp: number;
    id?: string;
  }>;
}

export interface User {
  id: string;
  email: string;
  name: string;
  avatar?: string;
  createdAt: number;
  hasCompletedOnboarding?: boolean;
  profile: UserProfile;
  lastSession?: SessionState;
  lastLoginAt?: number;
}

interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  /** True when the signed-in account is the Infinite OS owner (creator). */
  isOwner: boolean;
  isLoading: boolean;
  isNewUser: boolean;
  isRestoringSession: boolean;
  /** True right after register() succeeds — App shows the welcome splash once. */
  justRegistered: boolean;
  clearJustRegistered: () => void;
  /** True when the splash follows a login (welcome back) vs a signup. */
  welcomeBack: boolean;

  login: (email: string, password: string) => Promise<{ success: boolean; error?: string }>;
  register: (name: string, email: string, password: string) => Promise<{ success: boolean; error?: string }>;
  /** Profile entry: pick a face, then confirm the account password. */
  loginAs: (email: string, password?: string) => Promise<{ success: boolean; error?: string }>;
  /** Forgot-password flow: verify the email exists on this machine, set a new local password. */
  resetPassword: (email: string, newPassword: string) => Promise<{ success: boolean; error?: string }>;
  logout: () => void;
  completeOnboarding: () => void;
  updateAccount: (updates: Partial<Pick<User, 'name' | 'avatar'>>) => void;
  updateProfile: (updates: Partial<UserProfile>) => void;
  updateSessionState: (updates: Partial<SessionState>) => void;
  setRestoringSession: (val: boolean) => void;
}

// File-based storage (works across dev and prod — both read from ~/.infinite-ai/auth.json)
const getUsers = async (): Promise<Record<string, { user: User; password: string }>> => {
  try {
    return await window.api.authGetUsers();
  } catch {
    return {};
  }
};

const saveUsers = async (users: Record<string, { user: User; password: string }>) => {
  await window.api.authSetUsers(users);
};

// ── Password hashing ────────────────────────────────────────────────────────
// Passwords used to be stored in PLAINTEXT in auth.json. New/updated
// passwords are stored as `sha256:<saltHex>:<hashHex>` (per-user random salt,
// 100k SHA-256 iterations via Web Crypto in the renderer). Legacy plaintext
// entries still verify and are transparently upgraded on the next successful
// login. This is a local convenience lock: the profile data itself lives
// unencrypted on the same disk, so the reset flow (see resetPassword) is
// honest about what this protects.
const PBKDF2_ITERATIONS = 100_000;

function toHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function isHashed(password: string): boolean {
  return password.startsWith('sha256:');
}

async function hashPassword(password: string, saltHex: string): Promise<string> {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const salt = Uint8Array.from(saltHex.match(/.{2}/g)!.map((byte) => parseInt(byte, 16)));
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    keyMaterial,
    256,
  );
  return `sha256:${saltHex}:${toHex(bits)}`;
}

async function makePasswordRecord(password: string): Promise<string> {
  const saltHex = toHex(crypto.getRandomValues(new Uint8Array(16)).buffer);
  return hashPassword(password, saltHex);
}

/** Fire-and-forget: stash an encrypted recovery copy at the one moment the
 *  plaintext is known (successful login / register / reset). DPAPI-bound:
 *  decryptable only by this Windows user on this machine. */
function stashRecovery(email: string, password: string): void {
  void window.api.authStoreRecovery({ email, password }).catch(() => undefined);
}

/** Verify `attempted` against a stored record (hashed or legacy plaintext). */
async function verifyPassword(attempted: string, stored: string): Promise<boolean> {
  if (isHashed(stored)) {
    const [, saltHex, ] = stored.split(':');
    const candidate = await hashPassword(attempted, saltHex);
    return candidate === stored;
  }
  return attempted === stored;
}

let lastSavedSessionJson: string | undefined;
const saveSession = async (user: User | null) => {
  // Dedupe identical back-to-back writes (restore + persists + queue replays
  // spam main otherwise). Full-payload compare so profile updates still land.
  const payload = user ? { user, isAuthenticated: true } : null;
  const json = JSON.stringify(payload);
  if (json === lastSavedSessionJson) return;
  lastSavedSessionJson = json;
  if (typeof window !== 'undefined') {
    console.log('[auth] saveSession:', user ? user.email : null);
  }
  await window.api.authSetSession(payload);
};

const loadSession = async (): Promise<{ user: User; isAuthenticated: boolean } | null> => {
  try {
    const session = await window.api.authGetSession();
    // Fail open: a session file is not proof of identity. If the account it
    // represents no longer exists in auth.json (deleted, or a stale session
    // copied over from another machine), refuse the login instead of
    // auto-opening someone else's account.
    if (session?.user?.email) {
      const users = await window.api.authGetUsers();
      if (!users[session.user.email.toLowerCase()]) {
        return null;
      }
    }
    return session;
  } catch {
    return null;
  }
};

/** The signed-in account owns this OS when its email matches the owner
 *  profile (syncLocalOwner binds them at sign-in). Advisory: never blocks auth. */
async function checkOwner(email: string | undefined): Promise<boolean> {
  if (!email) return false;
  try {
    const profile = (await window.api.ownerGetProfile()) as { email?: string };
    const isOwner = !!profile?.email && profile.email.toLowerCase() === email.toLowerCase();
    useAuthStore.setState({ isOwner });
    return isOwner;
  } catch {
    return false;
  }
}

let persistenceQueue: Promise<void> = Promise.resolve();

const persistLatestUser = (): void => {
  persistenceQueue = persistenceQueue
    .catch(() => undefined)
    .then(async () => {
      const latest = useAuthStore.getState().user;
      if (!latest) return;
      const users = await getUsers();
      // Fail OPEN on an unreadable store: an empty read must never wipe
      // auth.json or the session file (that bricks auto-login).
      if (Object.keys(users).length === 0) return;
      // Ghost guard: the account may have been deleted (profiles cleanup).
      // Never write a file session for an unknown account — that flaps the
      // active profile and breaks auto-login. Drop to logged-out instead.
      if (!users[latest.email]) {
        useAuthStore.setState({ user: null, isAuthenticated: false, isNewUser: false });
        await saveSession(null);
        return;
      }
      if (users[latest.email]) users[latest.email].user = latest;
      await saveUsers(users);
      await saveSession(latest);
    });
};

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      isAuthenticated: false,
      isOwner: false,
      isLoading: false,
      isNewUser: false,
      isRestoringSession: false,
      justRegistered: false,
      welcomeBack: false,
      clearJustRegistered: () => set({ justRegistered: false, welcomeBack: false }),

      login: async (email: string, password: string) => {
        set({ isLoading: true });
        await new Promise((r) => setTimeout(r, 800));

        const users = await getUsers();
        const entry = users[email.toLowerCase()];

        if (!entry || !(await verifyPassword(password, entry.password))) {
          set({ isLoading: false });
          return { success: false, error: 'Invalid email or password' };
        }

        const hasOnboarded = entry.user.hasCompletedOnboarding === true;

        // Transparent upgrade: a legacy plaintext password is re-stored hashed
        // on the first successful login, so every active account converges on
        // hashed records without a migration banner.
        if (!isHashed(entry.password)) {
          entry.password = await makePasswordRecord(password);
        }

        // Update last login time
        const updatedUser = { ...entry.user, lastLoginAt: Date.now() };
        entry.user = updatedUser;
        await saveUsers(users);
        await saveSession(updatedUser);
        stashRecovery(email.toLowerCase(), password);
        void checkOwner(updatedUser.email);

        set({
          user: updatedUser,
          isAuthenticated: true,
          isLoading: false,
          isNewUser: !hasOnboarded,
          justRegistered: true,
          welcomeBack: true,
        });
        return { success: true };
      },

      loginAs: async (email: string, password: string | undefined) => {
        set({ isLoading: true });
        try {
          const users = await getUsers();
          const entry = users[email.toLowerCase()];
          if (!entry) {
            set({ isLoading: false });
            return { success: false, error: 'Profile not found on this machine' };
          }
          // A profile picker is convenience, not authentication. Require the
          // account password before opening any account.
          if (!password || password.trim() === '') {
            set({ isLoading: false });
            return { success: false, error: 'Password required to open this profile' };
          }
          if (!(await verifyPassword(password, entry.password))) {
            set({ isLoading: false });
            return { success: false, error: 'Incorrect password' };
          }
          if (!isHashed(entry.password)) {
            entry.password = await makePasswordRecord(password);
          }
          const updatedUser = { ...entry.user, lastLoginAt: Date.now() };
          entry.user = updatedUser;
          await saveUsers(users);
          await saveSession(updatedUser);
          stashRecovery(email.toLowerCase(), password);
          void checkOwner(updatedUser.email);
          set({
            user: updatedUser,
            isAuthenticated: true,
            isLoading: false,
            isNewUser: !entry.user.hasCompletedOnboarding,
            justRegistered: true,
            welcomeBack: true,
          });
          return { success: true };
        } catch {
          set({ isLoading: false });
          return { success: false, error: 'Could not open profile' };
        }
      },

      register: async (name: string, email: string, password: string) => {
        set({ isLoading: true });
        await new Promise((r) => setTimeout(r, 1000));

        const users = await getUsers();

        if (users[email.toLowerCase()]) {
          set({ isLoading: false });
          return { success: false, error: 'Email already exists' };
        }

        const newUser: User = {
          id: crypto.randomUUID(),
          email: email.toLowerCase(),
          name,
          createdAt: Date.now(),
          hasCompletedOnboarding: false,
          profile: {
            name,
            workspaceTheme: 'dark',
            notificationsEnabled: true,
            aiMemoryEnabled: true,
          },
          lastLoginAt: Date.now(),
        };

        users[email.toLowerCase()] = { user: newUser, password: await makePasswordRecord(password) };
        stashRecovery(email.toLowerCase(), password);
        void checkOwner(newUser.email);
        await saveUsers(users);
        await saveSession(newUser);

        set({
          user: newUser,
          isAuthenticated: true,
          isLoading: false,
          isNewUser: true,
          justRegistered: true,
          welcomeBack: false,
        });
        return { success: true };
      },

      /** Local lock-screen reset: verifies the account email exists, then
       *  stores a fresh hashed password. Honest scope — this unlocks the
       *  LOCAL profile (the profile data itself is unencrypted on this disk,
       *  so this is a lock screen, not encryption). */
      resetPassword: async (email: string, newPassword: string) => {
        set({ isLoading: true });
        const users = await getUsers();
        const entry = users[email.toLowerCase()];
        if (!entry) {
          set({ isLoading: false });
          return { success: false, error: 'No account with that email exists on this machine' };
        }
        if (newPassword.length < 8) {
          set({ isLoading: false });
          return { success: false, error: 'New password must be at least 8 characters' };
        }
        entry.password = await makePasswordRecord(newPassword);
        stashRecovery(email.toLowerCase(), newPassword);
        await saveUsers(users);
        set({ isLoading: false });
        return { success: true };
      },

      logout: () => {
        saveSession(null);
        set({
          user: null,
          isAuthenticated: false,
          isOwner: false,
          isNewUser: false,
          isRestoringSession: false,
        });
      },

      completeOnboarding: () => {
        const { user } = get();
        if (user) {
          const updatedUser = { ...user, hasCompletedOnboarding: true };
          set({ user: updatedUser, isNewUser: false });

          persistLatestUser();
        }
      },

      updateAccount: (updates) => {
        const { user } = get();
        if (!user) return;
        const updatedUser = {
          ...user,
          ...updates,
          profile: { ...user.profile, ...(updates.name ? { name: updates.name } : {}) },
        };
        set({ user: updatedUser });
        persistLatestUser();
      },

      updateProfile: (updates) => {
        const { user } = get();
        if (!user) return;

        const updatedUser = {
          ...user,
          profile: { ...user.profile, ...updates },
        };
        set({ user: updatedUser });

        persistLatestUser();
      },

      updateSessionState: (updates) => {
        const { user } = get();
        if (!user) return;

        const updatedUser = {
          ...user,
          lastSession: { ...user.lastSession, ...updates },
        };
        set({ user: updatedUser });

        persistLatestUser();
      },

      setRestoringSession: (val) => set({ isRestoringSession: val }),
    }),
    {
      name: 'infinite:auth',
      partialize: (state) => ({
        user: state.user,
        isAuthenticated: state.isAuthenticated,
      }),
    },
  ),
);

// Auto-login on startup: try to restore from file-based session
// Wait for window.api to be available (preload)
const tryRestoreSession = async () => {
  console.info('[auth] restore: start, api =', typeof window.api, typeof window.api?.authGetSession);
  useAuthStore.getState().setRestoringSession(true);
  for (let i = 0; i < 50; i++) {
    if (window.api?.authGetSession) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  try {
    console.info('[auth] restore: loading session');
    const session = await loadSession();
    console.info('[auth] restore: session =', session ? session.user?.email ?? '(no email)' : null);
    if (session?.user && session.isAuthenticated) {
      // Ghost guard: ignore sessions for deleted accounts (stale file).
      // Fail open: only skip when the store positively loaded and lacks it.
      console.info('[auth] restore: checking users');
      const users = await getUsers();
      console.info('[auth] restore: users =', Object.keys(users).join(',') || '(none)');
      if (Object.keys(users).length > 0 && !users[session.user.email]) return;
      useAuthStore.setState({
        user: session.user,
        isAuthenticated: true,
        isNewUser: false,
      });
      console.log('[auth] Auto-restored session for:', session.user.email);
      void checkOwner(session.user.email);
    }
  } catch (e) {
    console.error('[auth] Session restore failed:', e);
  } finally {
    useAuthStore.getState().setRestoringSession(false);
  }
};
tryRestoreSession();
