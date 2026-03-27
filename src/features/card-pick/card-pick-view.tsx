"use client";

import type { CardRewardState, CombatCard } from "@/lib/types/game-state";
import { useCardEvaluation } from "./use-card-evaluation";
import { CardRating } from "./card-rating";
import { CardSkeleton } from "@/components/loading-skeleton";

interface CardPickViewProps {
  state: CardRewardState;
  deckCards: CombatCard[];
}

export function CardPickView({ state, deckCards }: CardPickViewProps) {
  const { evaluation, isLoading, error } = useCardEvaluation(state, deckCards);
  const cards = state.card_reward.cards;

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
      <div className="grid grid-cols-3 gap-3">
        {isLoading && !evaluation ? (
          <>
            <CardSkeleton />
            <CardSkeleton />
            <CardSkeleton />
          </>
        ) : (
          cards.map((card) => {
            const cardEval = evaluation?.rankings.find(
              (r) =>
                r.itemId.toLowerCase() === card.id.toLowerCase() ||
                r.itemName.toLowerCase() === card.name.toLowerCase()
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

      {state.card_reward.can_skip && (
        <p className="text-xs text-zinc-600">You can skip this reward</p>
      )}
    </div>
  );
}
