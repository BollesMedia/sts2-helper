"use client";

import { cn } from "../../lib/cn";
import { TierBadge } from "../../components/tier-badge";
import { ConfidenceIndicator } from "../../components/confidence-indicator";
import type { EventState, CombatCard } from "../../types/game-state";
import type { TrackedPlayer } from "../connection/use-player-tracker";
import type { TierLetter } from "../../evaluation/tier-utils";
import { useEventEvaluation } from "./use-event-evaluation";
import { CardSkeleton } from "../../components/loading-skeleton";
import { RefineInput } from "../../components/refine-input";
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

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-baseline justify-between">
        <h2 className="text-xl font-semibold text-zinc-100">
          {state.event.event_name}
        </h2>
        {isLoading && (
          <span className="text-xs text-zinc-500 animate-pulse">
            Evaluating...
          </span>
        )}
        {evaluation && !isLoading && (
          <span className="text-xs text-zinc-600">Claude evaluation</span>
        )}
      </div>

      {state.event.body && (
        <p className="text-sm text-zinc-400 leading-relaxed">
          {state.event.body}
        </p>
      )}

      {error && <EvalError error={error} onRetry={retry} />}

      {options.length === 0 && (
        <p className="text-sm text-zinc-500">Waiting for selection...</p>
      )}

      <div className="grid grid-cols-3 gap-4">
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

            return (
              <div
                key={opt.index}
                className={cn(
                  "rounded-lg border bg-zinc-900/50 p-4 flex flex-col gap-3 transition-colors",
                  opt.is_locked && "opacity-50",
                  evalData
                    ? RECOMMENDATION_BORDER[evalData.recommendation] ?? "border-zinc-800"
                    : "border-zinc-800"
                )}
              >
                {/* Top: tier + rank */}
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2.5">
                    {evalData && (
                      <TierBadge tier={evalData.tier as TierLetter} size="lg" />
                    )}
                    {evalData?.rank != null && (
                      <span className="text-2xl font-bold tabular-nums text-zinc-600">
                        #{evalData.rank}
                      </span>
                    )}
                  </div>
                  {evalData && (
                    <span className={cn("rounded px-2 py-0.5 text-xs font-medium", RECOMMENDATION_CHIP[evalData.recommendation])}>
                      {RECOMMENDATION_LABEL[evalData.recommendation]}
                    </span>
                  )}
                </div>

                {/* Option info */}
                <div>
                  <h3 className="font-semibold text-zinc-100">{opt.title}</h3>
                  <p className="mt-1 text-sm text-zinc-400 leading-relaxed">
                    {opt.description}
                  </p>
                  {opt.relic_description && opt.relic_description !== opt.description && (
                    <p className="mt-1 text-xs text-zinc-500">
                      {opt.relic_description}
                    </p>
                  )}
                </div>

                {/* Evaluation */}
                {evalData && (
                  <div className="border-t border-zinc-800 pt-3 space-y-2">
                    <div className="flex items-center gap-2 text-xs text-zinc-500">
                      <span>Synergy {evalData.synergyScore}</span>
                      <span className="text-zinc-700">·</span>
                      <ConfidenceIndicator confidence={evalData.confidence} showLabel={false} />
                    </div>
                    <p className="text-sm text-zinc-300 leading-relaxed">
                      {evalData.reasoning}
                    </p>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {evaluation && !isLoading && (
        <RefineInput
          originalContext={`Event: ${state.event.event_name}. Options: ${options.map((o) => o.title).join(", ")}.`}
          originalResponse={evaluation.rankings.map((r) => `#${r.rank} ${r.itemName}: ${r.reasoning}`).join(" ")}
        />
      )}
    </div>
  );
}
