"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  type ReactNode,
} from "react";
import { createClient, initSupabase } from "@sts2/shared/supabase/client";
import {
  signInWithMagicLink,
  signInWithPassword,
  signUpWithPassword,
  signInWithDiscord,
  signOut as authSignOut,
} from "@sts2/shared/supabase/auth";
import type { User } from "@supabase/supabase-js";

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  signInMagicLink: (email: string) => Promise<{ error: string | null }>;
  signInPassword: (email: string, password: string) => Promise<{ error: string | null }>;
  signUp: (email: string, password: string) => Promise<{ error: string | null }>;
  signInDiscord: () => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  loading: true,
  signInMagicLink: async () => ({ error: "Not initialized" }),
  signInPassword: async () => ({ error: "Not initialized" }),
  signUp: async () => ({ error: "Not initialized" }),
  signInDiscord: async () => ({ error: "Not initialized" }),
  signOut: async () => {},
});

export function useAuth() {
  return useContext(AuthContext);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Initialize shared Supabase client with web app env vars (client-only)
    initSupabase(
      process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ""
    );
    const supabase = createClient();

    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      setLoading(false);
      if (session?.user?.id) {
        localStorage.setItem("sts2-user-id", session.user.id);
      }
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      setLoading(false);
      if (session?.user?.id) {
        localStorage.setItem("sts2-user-id", session.user.id);
      } else {
        localStorage.removeItem("sts2-user-id");
      }
    });

    return () => sub.subscription.unsubscribe();
  }, []);

  const signOut = useCallback(async () => {
    await authSignOut();
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        signInMagicLink: useCallback((email: string) => signInWithMagicLink(email), []),
        signInPassword: useCallback((email: string, password: string) => signInWithPassword(email, password), []),
        signUp: useCallback((email: string, password: string) => signUpWithPassword(email, password), []),
        signInDiscord: useCallback(() => signInWithDiscord(), []),
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
