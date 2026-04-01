import { useState } from "react";
import { useAuth } from "./auth-provider";

type AuthMode = "signin" | "signup";

export function LoginScreen() {
  const { signInPassword, signUp, signInDiscord } = useAuth();
  const [mode, setMode] = useState<AuthMode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password.trim() || submitting) return;

    setSubmitting(true);
    setError(null);
    setMessage(null);

    if (mode === "signup") {
      const { error } = await signUp(email.trim(), password);
      if (error) {
        setError(error);
      }
    } else {
      const { error } = await signInPassword(email.trim(), password);
      if (error) {
        setError(error);
      }
    }
    setSubmitting(false);
  };

  const handleDiscord = async () => {
    setError(null);
    const { error } = await signInDiscord();
    if (error) {
      setError(error);
    }
  };

  return (
    <div className="flex flex-1 items-center justify-center min-h-screen">
      <div className="w-full max-w-sm space-y-6 text-center">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-100">
            STS2 Replay
          </h1>
          <p className="text-sm text-zinc-500">
            Sign in to track your runs and get AI advice
          </p>
        </div>

        {/* Discord OAuth */}
        <button
          onClick={handleDiscord}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#5865F2] px-4 py-2.5 text-sm font-medium text-white hover:bg-[#4752C4] transition-colors"
        >
          <svg width="20" height="15" viewBox="0 0 71 55" fill="currentColor">
            <path d="M60.1 4.9A58.5 58.5 0 0045.4.2a.2.2 0 00-.2.1 40.8 40.8 0 00-1.8 3.7 54 54 0 00-16.2 0A37.3 37.3 0 0025.4.3a.2.2 0 00-.2-.1A58.4 58.4 0 0010.5 5a.2.2 0 00-.1 0C1.5 18.7-.9 32 .3 45.1a.2.2 0 000 .2 58.9 58.9 0 0017.7 9 .2.2 0 00.3-.1 42.1 42.1 0 003.6-5.9.2.2 0 00-.1-.3 38.8 38.8 0 01-5.5-2.7.2.2 0 01 0-.4l1.1-.9a.2.2 0 01.2 0 42 42 0 0035.6 0 .2.2 0 01.2 0l1.1.9a.2.2 0 010 .3 36.4 36.4 0 01-5.5 2.7.2.2 0 00-.1.4 47.2 47.2 0 003.6 5.8.2.2 0 00.3.1A58.7 58.7 0 0070.4 45.3a.2.2 0 000-.1c1.4-15-2.3-28-9.8-39.6a.2.2 0 00-.1-.1zM23.7 37a6.7 6.7 0 01-6.3-7 6.7 6.7 0 016.3-7 6.7 6.7 0 016.3 7 6.7 6.7 0 01-6.3 7zm23.2 0a6.7 6.7 0 01-6.3-7 6.7 6.7 0 016.3-7 6.7 6.7 0 016.3 7 6.7 6.7 0 01-6.3 7z" />
          </svg>
          Sign in with Discord
        </button>

        <div className="flex items-center gap-3">
          <div className="h-px flex-1 bg-zinc-800" />
          <span className="text-xs text-zinc-600">or</span>
          <div className="h-px flex-1 bg-zinc-800" />
        </div>

        {/* Email + password */}
        <form onSubmit={handleSubmit} className="space-y-3">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            required
            className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-2.5 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
          />
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            required
            minLength={6}
            className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-2.5 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
          />
          <button
            type="submit"
            disabled={submitting || !email.trim() || !password.trim()}
            className="w-full rounded-lg bg-zinc-100 px-4 py-2.5 text-sm font-medium text-zinc-900 hover:bg-zinc-200 transition-colors disabled:opacity-50"
          >
            {submitting
              ? mode === "signup" ? "Creating account..." : "Signing in..."
              : mode === "signup" ? "Create account" : "Sign in"
            }
          </button>

          <button
            type="button"
            onClick={() => {
              setMode(mode === "signup" ? "signin" : "signup");
              setError(null);
              setMessage(null);
            }}
            className="text-xs text-zinc-600 hover:text-zinc-400 transition-colors"
          >
            {mode === "signup"
              ? "Already have an account? Sign in"
              : "Need an account? Sign up"}
          </button>
        </form>

        {message && (
          <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-4 py-3">
            <p className="text-sm text-emerald-400">{message}</p>
          </div>
        )}

        {error && <p className="text-sm text-red-400">{error}</p>}
      </div>
    </div>
  );
}
