"use client";

import type { ConnectionStatus } from "../../hooks/useGameState";
import { cn } from "@sts2/shared/lib/cn";

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

interface ConnectionBannerProps {
  status: ConnectionStatus;
  userEmail?: string | null;
  onSignOut?: () => void;
  navLinks?: { href: string; label: string }[];
}

export function ConnectionBanner({
  status,
  userEmail,
  onSignOut,
  navLinks,
}: ConnectionBannerProps) {
  const config = STATUS_CONFIG[status];

  return (
    <div className="flex flex-1 flex-col">
      <header className="flex items-center justify-between border-b border-spire-border px-6 py-3">
        <span className="text-sm font-display font-semibold text-spire-text tracking-tight">
          STS2 Replay
        </span>
        {(userEmail || onSignOut || navLinks) && (
          <div className="flex items-center gap-4 text-xs">
            {userEmail && (
              <span className="text-spire-text-tertiary">{userEmail}</span>
            )}
            {navLinks?.map((link) => (
              <a
                key={link.href}
                href={link.href}
                className="text-spire-text-tertiary hover:text-spire-text-secondary transition-colors"
              >
                {link.label}
              </a>
            ))}
            {onSignOut && (
              <button
                onClick={onSignOut}
                className="text-spire-text-muted hover:text-spire-text-tertiary transition-colors"
              >
                Sign out
              </button>
            )}
          </div>
        )}
      </header>

      <div className="flex flex-1 items-center justify-center">
        <div className="flex flex-col items-center gap-5 text-center">
          <div className="flex items-center gap-2">
            <span className={cn("h-2 w-2 rounded-full", config.dotColor)} />
            <span className="text-sm font-medium text-spire-text-secondary">
              {config.label}
            </span>
          </div>
          <p className="max-w-sm text-sm text-spire-text-tertiary leading-relaxed">
            {config.description}
          </p>
          <p className="max-w-sm text-xs text-spire-text-muted leading-relaxed">
            Launch Slay the Spire 2 with the STS2MCP mod enabled, then this
            page will automatically connect.
          </p>
        </div>
      </div>
    </div>
  );
}
