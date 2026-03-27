"use client";

import type { ConnectionStatus } from "./use-game-state";
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

  return (
    <div className="flex flex-1 items-center justify-center">
      <div className="flex flex-col items-center gap-5 text-center">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-100">
          STS2 Companion
        </h1>
        <div className="flex items-center gap-2">
          <span className={cn("h-2 w-2 rounded-full", config.dotColor)} />
          <span className="text-sm font-medium text-zinc-400">
            {config.label}
          </span>
        </div>
        <p className="max-w-sm text-sm text-zinc-500 leading-relaxed">
          {config.description}
        </p>
      </div>
    </div>
  );
}
