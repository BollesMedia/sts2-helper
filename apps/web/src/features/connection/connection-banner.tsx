"use client";

import type { ConnectionStatus } from "./use-game-state";
import { useAuth } from "@/features/auth/auth-provider";
import { cn } from "@/lib/cn";

const STATUS_CONFIG: Record<
  ConnectionStatus,
  { label: string; description: string; dotColor: string }
> = {
  connected: {
    label: "Connected",
    description: "Receiving game data from STS2MCP mod",
    dotColor: "bg-emerald-400",
  },
  connecting: {
    label: "Connecting",
    description: "Looking for STS2MCP mod on localhost:15526",
    dotColor: "bg-amber-400 animate-pulse",
  },
  disconnected: {
    label: "Disconnected",
    description:
      "Cannot reach STS2MCP mod. Make sure the game is running with the mod enabled.",
    dotColor: "bg-red-400",
  },
};

export function ConnectionBanner({ status }: { status: ConnectionStatus }) {
  const config = STATUS_CONFIG[status];
  const { user, signOut } = useAuth();

  return (
    <div className="flex flex-1 flex-col">
      {/* Header */}
      <header className="flex items-center justify-between border-b border-zinc-800 px-6 py-3">
        <span className="text-sm font-semibold text-zinc-100 tracking-tight">
          STS2 Replay
        </span>
        {user && (
          <div className="flex items-center gap-4 text-xs">
            <span className="text-zinc-500">{user.email ?? "Account"}</span>
            <a
              href="/account"
              className="text-zinc-500 hover:text-zinc-300 transition-colors"
            >
              Settings
            </a>
            <a
              href="/runs"
              className="text-zinc-500 hover:text-zinc-300 transition-colors"
            >
              Run History
            </a>
            <button
              onClick={signOut}
              className="text-zinc-600 hover:text-zinc-400 transition-colors"
            >
              Sign out
            </button>
          </div>
        )}
      </header>

      {/* Connection status */}
      <div className="flex flex-1 items-center justify-center">
        <div className="flex flex-col items-center gap-5 text-center">
          <div className="flex items-center gap-2">
            <span className={cn("h-2 w-2 rounded-full", config.dotColor)} />
            <span className="text-sm font-medium text-zinc-400">
              {config.label}
            </span>
          </div>
          <p className="max-w-sm text-sm text-zinc-500 leading-relaxed">
            {config.description}
          </p>
          <p className="max-w-sm text-xs text-zinc-600 leading-relaxed">
            Launch Slay the Spire 2 with the STS2MCP mod enabled, then this
            page will automatically connect.
          </p>
        </div>
      </div>
    </div>
  );
}
