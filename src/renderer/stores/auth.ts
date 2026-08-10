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
  isLoading: boolean;
  isNewUser: boolean;
  isRestoringSession: boolean;

  login: (email: string, password: string) => Promise<{ success: boolean; error?: string }>;
  register: (name: string, email: string, password: string) => Promise<{ success: boolean; error?: string }>;
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

const saveSession = async (user: User | null) => {
  await window.api.authSetSession(user ? { user, isAuthenticated: true } : null);
};

const loadSession = async (): Promise<{ user: User; isAuthenticated: boolean } | null> => {
  try {
    return await window.api.authGetSession();
  } catch {
    return null;
  }
};

let persistenceQueue: Promise<void> = Promise.resolve();

const persistLatestUser = (): void => {
  persistenceQueue = persistenceQueue
    .catch(() => undefined)
    .then(async () => {
      const latest = useAuthStore.getState().user;
      if (!latest) return;
      const users = await getUsers();
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
      isLoading: false,
      isNewUser: false,
      isRestoringSession: false,

      login: async (email: string, password: string) => {
        set({ isLoading: true });
        await new Promise((r) => setTimeout(r, 800));

        const users = await getUsers();
        const entry = users[email.toLowerCase()];

        if (!entry || entry.password !== password) {
          set({ isLoading: false });
          return { success: false, error: 'Invalid email or password' };
        }

        const hasOnboarded = entry.user.hasCompletedOnboarding === true;

        // Update last login time
        const updatedUser = { ...entry.user, lastLoginAt: Date.now() };
        entry.user = updatedUser;
        await saveUsers(users);
        await saveSession(updatedUser);

        set({
          user: updatedUser,
          isAuthenticated: true,
          isLoading: false,
          isNewUser: !hasOnboarded,
        });
        return { success: true };
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

        users[email.toLowerCase()] = { user: newUser, password };
        await saveUsers(users);
        await saveSession(newUser);

        set({
          user: newUser,
          isAuthenticated: true,
          isLoading: false,
          isNewUser: true,
        });
        return { success: true };
      },

      logout: () => {
        saveSession(null);
        set({
          user: null,
          isAuthenticated: false,
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
  for (let i = 0; i < 50; i++) {
    if (window.api?.authGetSession) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  try {
    const session = await loadSession();
    if (session?.user && session.isAuthenticated) {
      useAuthStore.setState({
        user: session.user,
        isAuthenticated: true,
        isNewUser: false,
      });
      console.log('[auth] Auto-restored session for:', session.user.email);
    }
  } catch (e) {
    console.error('[auth] Session restore failed:', e);
  }
};
tryRestoreSession();
