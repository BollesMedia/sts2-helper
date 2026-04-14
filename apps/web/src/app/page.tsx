"use client";

import { useAuth } from "@/features/auth/auth-provider";
import { LoginScreen } from "@/features/auth/login-screen";

export default function HomePage() {
  const { user, loading, signOut } = useAuth();

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-sm text-zinc-500">Loading...</p>
      </div>
    );
  }

  if (!user) {
    return <LoginScreen />;
  }

  return (
    <div className="flex flex-1 flex-col">
      {/* Header */}
      <header className="flex items-center justify-between border-b border-zinc-800 px-6 py-3">
        <span className="text-sm font-semibold text-zinc-100 tracking-tight">
          STS2 Replay
        </span>
        <div className="flex items-center gap-4 text-xs">
          {user && (
            <span className="text-zinc-500">{user.email}</span>
          )}
          <a href="/account" className="text-zinc-500 hover:text-zinc-300 transition-colors">
            Account
          </a>
          <a href="/runs" className="text-zinc-500 hover:text-zinc-300 transition-colors">
            Run History
          </a>
          {user && (
            <button onClick={signOut} className="text-zinc-600 hover:text-zinc-400 transition-colors">
              Sign out
            </button>
          )}
        </div>
      </header>

      {/* Dashboard */}
      <main className="flex-1 p-6 max-w-4xl mx-auto w-full">
        <div className="space-y-8">
          <div>
            <h1 className="text-2xl font-semibold text-zinc-100">Dashboard</h1>
            <p className="mt-1 text-sm text-zinc-500">
              Your STS2 Replay companion overview
            </p>
          </div>

          {/* Quick links */}
          <div className="grid grid-cols-3 gap-4">
            <a
              href="/runs"
              className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4 hover:border-zinc-700 transition-colors"
            >
              <h3 className="text-sm font-medium text-zinc-200">Run History</h3>
              <p className="mt-1 text-xs text-zinc-500">
                View past runs, choices, and notes
              </p>
            </a>
            <a
              href="/account"
              className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4 hover:border-zinc-700 transition-colors"
            >
              <h3 className="text-sm font-medium text-zinc-200">Account</h3>
              <p className="mt-1 text-xs text-zinc-500">
                Manage your profile and settings
              </p>
            </a>
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
              <h3 className="text-sm font-medium text-zinc-200">Desktop App</h3>
              <p className="mt-1 text-xs text-zinc-500">
                Download the companion app for real-time game advice
              </p>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
