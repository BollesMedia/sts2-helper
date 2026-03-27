"use client";

import type { CardRewardState, GameCard } from "@/lib/types/game-state";
import { useCardEvaluation } from "./use-card-evaluation";
import { CardRating } from "./card-rating";
import { CardSkeleton } from "@/components/loading-skeleton";

interface CardPickViewProps {
  state: CardRewardState;
  deckCards: GameCard[];
}

export function CardPickView({ state, deckCards }: CardPickViewProps) {
  const { evaluation, isLoading, error } = useCardEvaluation(state, deckCards);

  return (
    <div className="flex flex-1 flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-zinc-100">Card Reward</h2>
        {isLoading && (
          <span className="text-xs text-zinc-500 animate-pulse">
            Evaluating...
          </span>
        )}
        {evaluation && !isLoading && (
          <span className="text-xs text-zinc-600">
            {evaluation.rankings[0]?.source === "statistical"
              ? "From historical data"
              : "Claude evaluation"}
          </span>
        )}
      </div>

      {/* Skip recommendation */}
      {evaluation?.skipRecommended && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3">
          <p className="text-sm font-medium text-amber-400">
            Consider skipping all cards
          </p>
          {evaluation.skipReasoning && (
            <p className="mt-1 text-sm text-zinc-400">
              {evaluation.skipReasoning}
            </p>
          )}
        </div>
      )}

      {/* Card ratings */}
      <div className="grid gap-3">
        {isLoading && !evaluation ? (
          <>
            <CardSkeleton />
            <CardSkeleton />
            <CardSkeleton />
          </>
        ) : (
          state.cards.map((card) => {
            const cardEval = evaluation?.rankings.find(
              (r) => r.itemId === card.id
            );
            return (
              <CardRating
                key={card.index}
                card={card}
                evaluation={cardEval ?? null}
                rank={cardEval?.rank}
              />
            );
          })
        )}
      </div>

      {error && (
        <p className="text-sm text-red-400">
          Evaluation error: {error}
        </p>
      )}

      {/* Can skip indicator */}
      {state.can_skip && (
        <p className="text-xs text-zinc-600">You can skip this reward</p>
      )}
    </div>
  );
}
