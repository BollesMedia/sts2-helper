import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useRef,
  type ReactNode,
} from "react";
import { createClient } from "@sts2/shared/supabase/client";
import { setReportingUser } from "@sts2/shared/lib/error-reporter";
import {
  signInWithPassword,
  signUpWithPassword,
  signOut as authSignOut,
} from "@sts2/shared/supabase/auth";
import { onOpenUrl } from "@tauri-apps/plugin-deep-link";
import { open } from "@tauri-apps/plugin-shell";
import type { User } from "@supabase/supabase-js";

const DEEP_LINK_PREFIX = "sts2replay://auth/callback";

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  signInPassword: (email: string, password: string) => Promise<{ error: string | null }>;
  signUp: (email: string, password: string) => Promise<{ error: string | null }>;
  signInDiscord: () => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  loading: true,
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
  const supabaseRef = useRef(createClient());

  useEffect(() => {
    const supabase = supabaseRef.current;

    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      setLoading(false);
      if (session?.user?.id) {
        localStorage.setItem("sts2-user-id", session.user.id);
        setReportingUser({ id: session.user.id, email: session.user.email });
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      setLoading(false);
      if (session?.user?.id) {
        localStorage.setItem("sts2-user-id", session.user.id);
        setReportingUser({ id: session.user.id, email: session.user.email });
      } else {
        localStorage.removeItem("sts2-user-id");
        setReportingUser(null);
      }
    });

    // Listen for deep link callbacks (OAuth redirect from browser)
    let unlistenDeepLink: (() => void) | undefined;
    onOpenUrl(async (urls) => {
      for (const url of urls) {
        if (!url.startsWith(DEEP_LINK_PREFIX)) continue;
        const hash = url.split("#")[1];
        if (!hash) continue;
        const params = new URLSearchParams(hash);
        const accessToken = params.get("access_token");
        const refreshToken = params.get("refresh_token");
        if (accessToken && refreshToken) {
          const { error } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          });
          if (error) {
            console.error("[deep-link] Failed to set session:", error.message);
          }
        }
      }
    }).then((fn) => { unlistenDeepLink = fn; });

    return () => {
      subscription.unsubscribe();
      unlistenDeepLink?.();
    };
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
        signInPassword: useCallback(
          (email: string, password: string) => signInWithPassword(email, password),
          []
        ),
        signUp: useCallback(
          (email: string, password: string) => signUpWithPassword(email, password),
          []
        ),
        signInDiscord: useCallback(async () => {
          const supabase = supabaseRef.current;
          const { data, error } = await supabase.auth.signInWithOAuth({
            provider: "discord",
            options: {
              redirectTo: DEEP_LINK_PREFIX,
              skipBrowserRedirect: true,
            },
          });
          if (error) return { error: error.message };
          if (data.url) await open(data.url);
          return { error: null };
        }, []),
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
