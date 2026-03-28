"use client";

import { useState } from "react";
import { useAuth } from "./auth-provider";

export function LoginScreen() {
  const { signIn } = useAuth();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || submitting) return;

    setSubmitting(true);
    setError(null);

    const { error } = await signIn(email.trim());

    if (error) {
      setError(error);
    } else {
      setSent(true);
    }
    setSubmitting(false);
  };

  return (
    <div className="flex flex-1 items-center justify-center">
      <div className="w-full max-w-sm space-y-6 text-center">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-100">
            STS2 Replay
          </h1>
          <p className="text-sm text-zinc-500">
            Companion app for Slay the Spire 2
          </p>
        </div>

        {sent ? (
          <div className="space-y-3">
            <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-4 py-3">
              <p className="text-sm text-emerald-400">
                Check your email for a login link
              </p>
              <p className="mt-1 text-xs text-zinc-500">{email}</p>
            </div>
            <button
              onClick={() => {
                setSent(false);
                setEmail("");
              }}
              className="text-xs text-zinc-600 hover:text-zinc-400 transition-colors"
            >
              Use a different email
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-3">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
              className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-2.5 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
            />
            <button
              type="submit"
              disabled={submitting || !email.trim()}
              className="w-full rounded-lg bg-zinc-100 px-4 py-2.5 text-sm font-medium text-zinc-900 hover:bg-zinc-200 transition-colors disabled:opacity-50"
            >
              {submitting ? "Sending..." : "Sign in with email"}
            </button>
            {error && (
              <p className="text-sm text-red-400">{error}</p>
            )}
          </form>
        )}
      </div>
    </div>
  );
}
