"use client";

import { useState } from "react";
import { useAuth } from "@/features/auth/auth-provider";
import { LoginScreen } from "@/features/auth/login-screen";
import { createClient } from "@/lib/supabase/client";

export default function AccountPage() {
  const { user, loading, signOut } = useAuth();
  const isDev = process.env.NODE_ENV === "development";

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center min-h-screen bg-background text-foreground">
        <p className="text-sm text-zinc-500">Loading...</p>
      </div>
    );
  }

  if (!user && !isDev) {
    return (
      <div className="min-h-screen bg-background text-foreground flex flex-col">
        <LoginScreen />
      </div>
    );
  }

  return <AccountContent user={user} onSignOut={signOut} />;
}

function AccountContent({
  user,
  onSignOut,
}: {
  user: { id: string; email?: string | null } | null;
  onSignOut: () => void;
}) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-zinc-800 px-6 py-3">
        <div className="flex items-center justify-between max-w-2xl mx-auto">
          <div className="flex items-center gap-4">
            <a
              href="/"
              className="text-sm font-semibold text-zinc-100 tracking-tight hover:text-zinc-300 transition-colors"
            >
              STS2 Replay
            </a>
            <div className="h-4 w-px bg-zinc-800" />
            <span className="text-sm font-medium text-zinc-300">Account</span>
          </div>
          <div className="flex items-center gap-4 text-xs">
            <a href="/runs" className="text-zinc-500 hover:text-zinc-300 transition-colors">
              Run History
            </a>
            <button
              onClick={onSignOut}
              className="text-zinc-600 hover:text-zinc-400 transition-colors"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="p-6 max-w-2xl mx-auto space-y-8">
        {/* Profile */}
        <section className="space-y-4">
          <h2 className="text-lg font-semibold text-zinc-100">Profile</h2>
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-zinc-400">Email</span>
              <span className="text-sm text-zinc-200">
                {user?.email ?? "Not set"}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-zinc-400">User ID</span>
              <span className="text-xs font-mono text-zinc-500">
                {user?.id ?? "—"}
              </span>
            </div>
          </div>
        </section>

        {/* Change Password */}
        <ChangePasswordSection />

        {/* Danger Zone */}
        <section className="space-y-4">
          <h2 className="text-lg font-semibold text-zinc-100">Session</h2>
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-zinc-300">Sign out</p>
                <p className="text-xs text-zinc-500">
                  End your current session on this device
                </p>
              </div>
              <button
                onClick={onSignOut}
                className="rounded-lg border border-zinc-700 bg-zinc-800 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-700 transition-colors"
              >
                Sign out
              </button>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

function ChangePasswordSection() {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 6) {
      setError("Password must be at least 6 characters");
      return;
    }
    if (password !== confirm) {
      setError("Passwords don't match");
      return;
    }

    setSaving(true);
    setError(null);
    setMessage(null);

    const supabase = createClient();
    const { error } = await supabase.auth.updateUser({ password });

    if (error) {
      setError(error.message);
    } else {
      setMessage("Password updated");
      setPassword("");
      setConfirm("");
    }
    setSaving(false);
  };

  return (
    <section className="space-y-4">
      <h2 className="text-lg font-semibold text-zinc-100">Change Password</h2>
      <form
        onSubmit={handleSubmit}
        className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4 space-y-3"
      >
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="New password"
          minLength={6}
          className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-2.5 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
        />
        <input
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          placeholder="Confirm new password"
          minLength={6}
          className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-2.5 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
        />
        <button
          type="submit"
          disabled={saving || !password || !confirm}
          className="rounded-lg bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-200 transition-colors disabled:opacity-50"
        >
          {saving ? "Updating..." : "Update password"}
        </button>
        {message && (
          <p className="text-sm text-emerald-400">{message}</p>
        )}
        {error && <p className="text-sm text-red-400">{error}</p>}
      </form>
    </section>
  );
}
