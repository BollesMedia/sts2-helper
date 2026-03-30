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

      {/* Pick summary */}
      {evaluation?.pickSummary && (
        <p className={cn(
          "text-sm font-medium px-3 py-2 rounded-lg border",
          evaluation.skipRecommended 
            ? "text-zinc-400 bg-zinc-800/50 border-zinc-700/50" 
            : "text-amber-300 bg-amber-500/10 border-amber-500/30"
        )}>
          {evaluation.pickSummary}
        </p>
      )}

      {/* Skip recommendation */}
      {evaluation?.skipRecommended && !evaluation.pickSummary && (
        <p className="text-sm font-medium text-amber-300">
          Skip — {evaluation.skipReasoning ?? "none worth adding"}
        </p>
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
