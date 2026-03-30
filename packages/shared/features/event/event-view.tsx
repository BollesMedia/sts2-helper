"use client";

import { cn } from "../../lib/cn";
import { TierBadge } from "../../components/tier-badge";
import type { EventState, CombatCard } from "../../types/game-state";
import type { TrackedPlayer } from "../connection/use-player-tracker";
import type { TierLetter } from "../../evaluation/tier-utils";
import { useEventEvaluation } from "./use-event-evaluation";
import { CardSkeleton } from "../../components/loading-skeleton";
import { EvalError } from "../../components/eval-error";
import { RECOMMENDATION_BORDER, RECOMMENDATION_CHIP, RECOMMENDATION_LABEL } from "../../lib/recommendation-styles";

interface EventViewProps {
  state: EventState;
  deckCards: CombatCard[];
  player: TrackedPlayer | null;
  runId: string | null;
}

export function EventView({ state, deckCards, player, runId }: EventViewProps) {
  const { evaluation, isLoading, error, retry } = useEventEvaluation(
    state,
    deckCards,
    player,
    runId
  );
  const options = state.event.options.filter((o) => !o.is_proceed && !o.is_locked);
  const topRank = evaluation?.rankings.find((r) => r.rank === 1);

  return (
    <div className="flex flex-col gap-3">
      {/* Header with inline summary */}
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-zinc-100 shrink-0">
          {state.event.event_name}
        </h2>
        {isLoading && (
          <span className="text-xs text-zinc-500 animate-pulse">Evaluating...</span>
        )}
      </div>

      {state.event.body && (
        <p className="text-xs text-zinc-400 leading-snug line-clamp-2" title={state.event.body}>
          {state.event.body}
        </p>
      )}

      {error && <EvalError error={error} onRetry={retry} />}

      {options.length === 0 && (
        <p className="text-xs text-zinc-500">Waiting for selection...</p>
      )}

      <div className="grid grid-cols-3 gap-3">
        {isLoading && !evaluation ? (
          <>
            <CardSkeleton />
            <CardSkeleton />
            <CardSkeleton />
          </>
        ) : (
          options.map((opt, arrayIdx) => {
            // Match by array position (0-indexed) since Claude returns EVENT_1, EVENT_2
            // and the parser converts to 0-indexed itemIndex
            const evalData = evaluation?.rankings.find(
              (r) => r.itemIndex === arrayIdx
            );
            const isTopPick = topRank?.itemIndex === arrayIdx;

            return (
              <div
                key={opt.index}
                className={cn(
                  "rounded-lg border bg-zinc-900/60 p-3 flex flex-col gap-2 relative card-depth card-depth-hover",
                  opt.is_locked && "opacity-50",
                  isTopPick
                    ? "border-emerald-500/60 ring-2 ring-emerald-500/30 shadow-[0_0_16px_rgba(52,211,153,0.2)]"
                    : evalData
                      ? RECOMMENDATION_BORDER[evalData.recommendation] ?? "border-zinc-800"
                      : "border-zinc-800"
                )}
                title={evalData?.reasoning}
              >
                {/* "Pick This" banner */}
                {isTopPick && (
                  <div className="absolute -top-2.5 left-1/2 -translate-x-1/2 z-10">
                    <div className="px-3 py-0.5 rounded-full bg-emerald-500 text-[10px] font-bold uppercase tracking-widest text-zinc-950 shadow-[0_0_12px_rgba(52,211,153,0.5),0_2px_8px_rgba(0,0,0,0.4)] border border-emerald-400/50">
                      Pick This
                    </div>
                  </div>
                )}

                {/* Top: tier + rank + chip */}
                <div className={cn("flex items-center justify-between", isTopPick && "mt-1.5")}>
                  <div className="flex items-center gap-2">
                    {evalData && (
                      <TierBadge tier={evalData.tier as TierLetter} size="md" glow={isTopPick} />
                    )}
                    {evalData?.rank != null && (
                      <span className={cn("text-lg font-bold tabular-nums", isTopPick ? "text-emerald-500/80" : "text-zinc-600")}>
                        #{evalData.rank}
                      </span>
                    )}
                  </div>
                  {evalData && (
                    <span className={cn(
                      "rounded px-1.5 py-0.5 text-[10px] font-medium border",
                      isTopPick ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" : RECOMMENDATION_CHIP[evalData.recommendation] + " border-transparent"
                    )}>
                      {RECOMMENDATION_LABEL[evalData.recommendation]}
                    </span>
                  )}
                </div>

                {/* Option info — compact */}
                <div>
                  <h3 className="font-semibold text-sm text-zinc-100 truncate">{opt.title}</h3>
                  <p className="text-[10px] text-zinc-500 leading-snug line-clamp-2 mt-0.5">
                    {opt.description}
                  </p>
                </div>

                {/* Reasoning — truncated */}
                {evalData && (
                  <p className="text-xs text-zinc-400 leading-snug line-clamp-2">
                    {evalData.reasoning}
                  </p>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
