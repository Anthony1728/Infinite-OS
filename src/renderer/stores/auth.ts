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
  recentActivity?: Array<{ type: string; title: string; timestamp: number }>;
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
  updateProfile: (updates: Partial<UserProfile>) => void;
  updateSessionState: (updates: Partial<SessionState>) => void;
  setRestoringSession: (val: boolean) => void;
}

const getUsers = (): Record<string, { user: User; password: string }> => {
  try {
    return JSON.parse(localStorage.getItem('infinite:users') ?? '{}');
  } catch {
    return {};
  }
};

const saveUsers = (users: Record<string, { user: User; password: string }>) => {
  localStorage.setItem('infinite:users', JSON.stringify(users));
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
        await new Promise(r => setTimeout(r, 800));

        const users = getUsers();
        const entry = users[email.toLowerCase()];

        if (!entry || entry.password !== password) {
          set({ isLoading: false });
          return { success: false, error: 'Invalid email or password' };
        }

        const hasOnboarded = entry.user.hasCompletedOnboarding === true;

        // Update last login time
        const updatedUser = { ...entry.user, lastLoginAt: Date.now() };
        entry.user = updatedUser;
        saveUsers(users);

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
        await new Promise(r => setTimeout(r, 1000));

        const users = getUsers();

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
        saveUsers(users);

        set({
          user: newUser,
          isAuthenticated: true,
          isLoading: false,
          isNewUser: true,
        });
        return { success: true };
      },

      logout: () => {
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

          const users = getUsers();
          if (users[user.email]) {
            users[user.email].user = updatedUser;
            saveUsers(users);
          }
        }
      },

      updateProfile: (updates) => {
        const { user } = get();
        if (!user) return;

        const updatedUser = {
          ...user,
          profile: { ...user.profile, ...updates },
        };
        set({ user: updatedUser });

        const users = getUsers();
        if (users[user.email]) {
          users[user.email].user = updatedUser;
          saveUsers(users);
        }
      },

      updateSessionState: (updates) => {
        const { user } = get();
        if (!user) return;

        const updatedUser = {
          ...user,
          lastSession: { ...user.lastSession, ...updates },
        };
        set({ user: updatedUser });

        const users = getUsers();
        if (users[user.email]) {
          users[user.email].user = updatedUser;
          saveUsers(users);
        }
      },

      setRestoringSession: (val) => set({ isRestoringSession: val }),
    }),
    {
      name: 'infinite:auth',
      partialize: (state) => ({
        user: state.user,
        isAuthenticated: state.isAuthenticated,
      }),
    }
  )
);
