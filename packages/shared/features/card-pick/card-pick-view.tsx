"use client";

import { cn } from "../../lib/cn";
import type { CardRewardState, CombatCard } from "../../types/game-state";
import type { TrackedPlayer } from "../connection/use-player-tracker";
import { useCardEvaluation } from "./use-card-evaluation";
import { CardRating } from "./card-rating";
import { CardSkeleton } from "../../components/loading-skeleton";
import { RefineInput } from "../../components/refine-input";
import { EvalError } from "../../components/eval-error";

interface CardPickViewProps {
  state: CardRewardState;
  deckCards: CombatCard[];
  player: TrackedPlayer | null;
  runId: string | null;
  exclusive?: boolean;
}

export function CardPickView({ state, deckCards, player, runId, exclusive = true }: CardPickViewProps) {
  const { evaluation, isLoading, error, retry } = useCardEvaluation(state, deckCards, player, runId, exclusive);
  const cards = state.card_reward.cards;

  return (
    <div className="flex flex-col gap-3">
      {/* Header row with inline summary */}
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-zinc-100 shrink-0">Card Reward</h2>
        
        {/* Inline pick summary or skip message */}
        {evaluation?.pickSummary && !isLoading && (
          <p className={cn(
            "text-xs font-medium truncate flex-1 text-right",
            evaluation.skipRecommended ? "text-zinc-500" : "text-emerald-400"
          )}>
            {evaluation.pickSummary}
          </p>
        )}
        {evaluation?.skipRecommended && !evaluation.pickSummary && !isLoading && (
          <p className="text-xs font-medium text-zinc-500 truncate flex-1 text-right">
            Skip — {evaluation.skipReasoning ?? "none worth adding"}
          </p>
        )}
        
        {isLoading && (
          <span className="text-xs text-zinc-500 animate-pulse">
            Evaluating...
          </span>
        )}
      </div>

      {/* Card ratings — compact grid */}
      <div className="grid grid-cols-3 gap-3">
        {isLoading && !evaluation ? (
          <>
            <CardSkeleton />
            <CardSkeleton />
            <CardSkeleton />
          </>
        ) : (
          (() => {
            // Derive the recommended card from pick_summary when available,
            // fall back to the strong_pick/good_pick ranking
            const summaryLower = evaluation?.pickSummary?.toLowerCase() ?? "";
            const strongPick = evaluation?.rankings.find(
              (r) => r.recommendation === "strong_pick" || r.recommendation === "good_pick"
            );

            return cards.map((card, cardIndex) => {
              const cardEval = evaluation?.rankings.find(
                (r) =>
                  r.itemIndex === cardIndex ||
                  r.itemId.toLowerCase() === card.id.toLowerCase() ||
                  r.itemName.toLowerCase() === card.name.toLowerCase()
              );

              // Match from pick_summary text, then strong_pick recommendation, then rank
              const matchesSummary = summaryLower.includes(card.name.toLowerCase());
              const isStrongPick = cardEval && cardEval === strongPick;
              const isTopPick = !evaluation?.skipRecommended && (
                matchesSummary || (!summaryLower && isStrongPick) || (!summaryLower && !strongPick && cardEval?.rank === 1)
              );

              return (
                <CardRating
                  key={card.index}
                  card={card}
                  evaluation={cardEval ?? null}
                  rank={cardEval?.rank}
                  isTopPick={isTopPick}
                />
              );
            });
          })()
        )}
      </div>

      {error && <EvalError error={error} onRetry={retry} />}

    </div>
  );
}
