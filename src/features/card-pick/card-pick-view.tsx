"use client";

import type { CardRewardState, CombatCard } from "@/lib/types/game-state";
import type { TrackedPlayer } from "@/features/connection/use-player-tracker";
import { useCardEvaluation } from "./use-card-evaluation";
import { CardRating } from "./card-rating";
import { CardSkeleton } from "@/components/loading-skeleton";

interface CardPickViewProps {
  state: CardRewardState;
  deckCards: CombatCard[];
  player: TrackedPlayer | null;
}

export function CardPickView({ state, deckCards, player }: CardPickViewProps) {
  const { evaluation, isLoading, error } = useCardEvaluation(state, deckCards, player);
  const cards = state.card_reward.cards;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-baseline justify-between">
        <h2 className="text-xl font-semibold text-zinc-100">Card Reward</h2>
        {isLoading && (
          <span className="text-xs text-zinc-500 animate-pulse">
            Evaluating...
          </span>
        )}
        {evaluation && !isLoading && (
          <span className="text-xs text-zinc-600">
            {evaluation.rankings[0]?.source === "statistical"
              ? "Historical data"
              : "Claude evaluation"}
          </span>
        )}
      </div>

      {/* Skip recommendation */}
      {evaluation?.skipRecommended && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3">
          <p className="text-sm font-medium text-amber-300">
            Consider skipping
          </p>
          {evaluation.skipReasoning && (
            <p className="mt-1 text-sm text-zinc-400">
              {evaluation.skipReasoning}
            </p>
          )}
        </div>
      )}

      {/* Card ratings */}
      <div className="grid grid-cols-3 gap-4">
        {isLoading && !evaluation ? (
          <>
            <CardSkeleton />
            <CardSkeleton />
            <CardSkeleton />
          </>
        ) : (
          cards.map((card) => {
            const normalize = (s: string) =>
              s.toLowerCase().replace(/[+\s_]/g, "").replace(/plus$/, "");
            const cardEval = evaluation?.rankings.find(
              (r) =>
                r.itemId.toLowerCase() === card.id.toLowerCase() ||
                r.itemName.toLowerCase() === card.name.toLowerCase() ||
                normalize(r.itemId) === normalize(card.id) ||
                normalize(r.itemId) === normalize(card.name) ||
                normalize(r.itemName) === normalize(card.name)
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
        <p className="text-sm text-red-400">{error}</p>
      )}

      {state.card_reward.can_skip && !evaluation?.skipRecommended && (
        <p className="text-xs text-zinc-600">You can skip this reward</p>
      )}
    </div>
  );
}
