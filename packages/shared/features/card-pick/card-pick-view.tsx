"use client";

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
          cards.map((card, cardIndex) => {
            const cardEval = evaluation?.rankings.find(
              (r) =>
                r.itemIndex === cardIndex ||
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

      {error && <EvalError error={error} onRetry={retry} />}

      {evaluation && !isLoading && (
        <RefineInput
          originalContext={`Card reward: ${cards.map((c) => c.name).join(", ")}. Deck size: ${deckCards.length}. Character: ${player?.character ?? "unknown"}.`}
          originalResponse={[
            evaluation.skipRecommended ? `Skip recommended: ${evaluation.skipReasoning}` : null,
            ...evaluation.rankings.map((r) => `#${r.rank} ${r.itemName}: ${r.reasoning}`),
          ].filter(Boolean).join(" ")}
        />
      )}

      {state.card_reward.can_skip && !evaluation?.skipRecommended && (
        <p className="text-xs text-zinc-600">You can skip this reward</p>
      )}
    </div>
  );
}
