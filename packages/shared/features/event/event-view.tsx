"use client";

import { cn } from "../../lib/cn";
import type { EventState, CombatCard } from "../../types/game-state";
import type { TrackedPlayer } from "../connection/use-player-tracker";
import type { TierLetter } from "../../evaluation/tier-utils";
import { useEventEvaluation } from "./use-event-evaluation";
import { CardSkeleton } from "../../components/loading-skeleton";
import { EvalError } from "../../components/eval-error";
import { PickBanner, EvalRow, Reasoning, evalBorderClass, findTopPick } from "../../components/eval-card";

interface EventViewProps {
  state: EventState;
  deckCards: CombatCard[];
  player: TrackedPlayer | null;
  runId: string | null;
}

export function EventView({ state, deckCards, player, runId }: EventViewProps) {
  const { evaluation, isLoading, error, retry } = useEventEvaluation(
    state, deckCards, player, runId
  );
  const options = state.event.options.filter((o) => !o.is_proceed && !o.is_locked);
  const topPick = evaluation?.rankings ? findTopPick(evaluation.rankings) : null;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-display font-bold text-spire-text shrink-0">
          {state.event?.event_name ?? "Event"}
        </h2>
        {isLoading && (
          <span className="text-[10px] font-mono text-spire-text-muted bg-spire-elevated/50 px-2 py-0.5 rounded border border-spire-border animate-pulse">
            Evaluating...
          </span>
        )}
      </div>

      {state.event?.body && (
        <p className="text-sm text-spire-text-tertiary leading-relaxed line-clamp-2" title={state.event.body}>
          {state.event.body}
        </p>
      )}

      {error && <EvalError error={error} onRetry={retry} />}

      {options.length === 0 && (
        <p className="text-sm text-spire-text-tertiary">Waiting for game state to update...</p>
      )}

      <div className="grid grid-cols-3 gap-3">
        {isLoading && !evaluation ? (
          options.map((o) => <CardSkeleton key={o.index} />)
        ) : (
          options.map((opt, arrayIdx) => {
            const evalData = evaluation?.rankings.find(
              (r) => r.itemIndex === arrayIdx
            );
            const isTopPick = topPick === evalData && evalData != null;

            return (
              <div
                key={opt.index}
                className={cn(
                  "rounded-lg border bg-spire-surface relative transition-all duration-150",
                  opt.is_locked && "opacity-40",
                  evalBorderClass(evalData?.recommendation, isTopPick)
                )}
                title={evalData?.reasoning}
              >
                {isTopPick && <PickBanner />}

                <div className="p-4 pt-5 flex flex-col gap-3">
                  {/* Option info */}
                  <div>
                    <h3 className="font-display font-semibold text-sm text-spire-text truncate">{opt.title}</h3>
                    <p className="text-xs text-spire-text-tertiary leading-relaxed line-clamp-2 mt-1">
                      {opt.description}
                    </p>
                  </div>

                  {/* Evaluation */}
                  {evalData && (
                    <div className="pt-3 border-t border-spire-border-subtle">
                      <EvalRow tier={evalData.tier as TierLetter} recommendation={evalData.recommendation} isTopPick={isTopPick} />
                    </div>
                  )}

                  {evalData?.reasoning && (
                    <Reasoning text={evalData.reasoning} isTopPick={isTopPick} />
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
