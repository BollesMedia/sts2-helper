"use client";

import { cn } from "@/lib/cn";

interface EvalErrorProps {
  error: string;
  onRetry?: () => void;
  className?: string;
}

const USER_FRIENDLY_MESSAGES: Record<string, string> = {
  "Evaluation failed: 429": "Rate limited — please wait a moment and try again",
  "Evaluation failed: 500": "Evaluation service error — retrying may help",
  "Evaluation failed: 502": "Evaluation service temporarily unavailable",
  "Evaluation failed: 503": "Evaluation service temporarily unavailable",
  "Could not build evaluation context": "Not enough game data yet — play through a combat first",
  "Failed to fetch": "Network error — check your internet connection",
};

function friendlyMessage(error: string): string {
  for (const [pattern, message] of Object.entries(USER_FRIENDLY_MESSAGES)) {
    if (error.includes(pattern)) return message;
  }
  return "Evaluation unavailable";
}

export function EvalError({ error, onRetry, className }: EvalErrorProps) {
  return (
    <div
      className={cn(
        "rounded-lg border border-zinc-800 bg-zinc-900/50 px-4 py-3 flex items-center justify-between",
        className
      )}
    >
      <p className="text-sm text-zinc-400">{friendlyMessage(error)}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="shrink-0 rounded bg-zinc-800 px-3 py-1 text-xs text-zinc-300 hover:bg-zinc-700 transition-colors"
        >
          Retry
        </button>
      )}
    </div>
  );
}
