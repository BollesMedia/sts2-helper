"use client";

import { cn } from "@sts2/shared/lib/cn";
import type { CardRewardState } from "@sts2/shared/types/game-state";
import type { CardRewardEvaluation } from "@sts2/shared/evaluation/types";
import { CardRating } from "./card-rating";
import { CardSkeleton } from "../../components/loading-skeleton";
import { EvalError } from "../../components/eval-error";
import { resolveTopPick } from "../../lib/resolve-top-pick";
import { useAppSelector, useAppDispatch } from "../../store/hooks";
import { selectActivePlayer } from "../../features/run/runSelectors";
import { selectEvalResult, selectEvalIsLoading, selectEvalError } from "../../features/evaluation/evaluationSelectors";
import { evalRetryRequested } from "../../features/evaluation/evaluationSlice";

interface CardPickViewProps {
  state: CardRewardState;
  exclusive?: boolean;
}

const selectCardRewardResult = selectEvalResult<CardRewardEvaluation>("card_reward");
const selectCardRewardLoading = selectEvalIsLoading("card_reward");
const selectCardRewardError = selectEvalError("card_reward");

export function CardPickView({ state }: CardPickViewProps) {
  const dispatch = useAppDispatch();
  const player = useAppSelector(selectActivePlayer);
  const evaluation = useAppSelector(selectCardRewardResult);
  const isLoading = useAppSelector(selectCardRewardLoading);
  const error = useAppSelector(selectCardRewardError);
  const cards = state.card_reward.cards;

  // Single source of truth for top pick — drives both badge and summary text
  const topPickResult = evaluation?.rankings
    ? resolveTopPick(evaluation.rankings, evaluation.skipRecommended ?? false)
    : null;

  return (
    <div className="flex flex-col gap-3">
      {/* Header row with inline summary */}
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-display font-bold text-spire-text shrink-0">Card Reward</h2>

        {topPickResult && !isLoading && (
          <p className="text-xs font-medium truncate flex-1 text-right text-emerald-400">
            {topPickResult.summary}
          </p>
        )}
        {evaluation?.skipRecommended && !topPickResult && !isLoading && (
          <p className="text-xs font-medium text-zinc-500 truncate flex-1 text-right">
            Skip — {evaluation.skipReasoning ?? "none worth adding"}
          </p>
        )}

        {isLoading && (
          <span className="text-[10px] font-mono text-zinc-500 bg-zinc-900/80 px-2 py-0.5 rounded border border-zinc-800 animate-pulse">
            Evaluating...
          </span>
        )}
      </div>

      {/* Card ratings — compact grid */}
      <div className="grid grid-cols-3 gap-3">
        {isLoading && !evaluation ? (
          <>
            {cards.map((c) => <CardSkeleton key={c.index} />)}
          </>
        ) : (
          cards.map((card, cardIndex) => {
            const cardEval = evaluation?.rankings.find(
              (r) =>
                r.itemIndex === cardIndex ||
                r.itemId.toLowerCase() === card.id.toLowerCase() ||
                r.itemName.toLowerCase() === card.name.toLowerCase()
            );

            const isTopPick = topPickResult != null &&
              cardEval != null &&
              cardEval.itemId === topPickResult.item.itemId;

            return (
              <CardRating
                key={card.index}
                card={card}
                evaluation={cardEval ?? null}
                rank={cardEval?.rank}
                isTopPick={isTopPick}
                character={player?.character}
              />
            );
          })
        )}
      </div>

      {error && (
        <EvalError
          error={error}
          onRetry={() => dispatch(evalRetryRequested("card_reward"))}
        />
      )}
    </div>
  );
}
