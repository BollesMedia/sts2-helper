"use client";

import { useMemo } from "react";
import type { CardRewardState } from "@sts2/shared/types/game-state";
import type { CardRewardEvaluation } from "@sts2/shared/evaluation/types";
import { CardRating } from "./card-rating";
import { CardPickCoaching } from "../../components/card-pick-coaching";
import { EvalError } from "../../components/eval-error";
import { resolveTopPick } from "../../lib/resolve-top-pick";
import { useAppSelector, useAppDispatch } from "../../store/hooks";
import { selectActivePlayer } from "../../features/run/runSelectors";
import {
  selectEvalResult,
  selectEvalIsLoading,
  selectEvalError,
  selectEvalKey,
} from "../../features/evaluation/evaluationSelectors";
import { evalRetryRequested } from "../../features/evaluation/evaluationSlice";
import { computeCardRewardEvalKey } from "../../lib/eval-inputs/card-reward";

interface CardPickViewProps {
  state: CardRewardState;
  exclusive?: boolean;
}

const selectCardRewardResult = selectEvalResult<CardRewardEvaluation>("card_reward");
const selectCardRewardLoading = selectEvalIsLoading("card_reward");
const selectCardRewardError = selectEvalError("card_reward");
const selectCardRewardEvalKey = selectEvalKey("card_reward");

export function CardPickView({ state }: CardPickViewProps) {
  const dispatch = useAppDispatch();
  const player = useAppSelector(selectActivePlayer);
  const rawEvaluation = useAppSelector(selectCardRewardResult);
  const isLoading = useAppSelector(selectCardRewardLoading);
  const error = useAppSelector(selectCardRewardError);
  const storedEvalKey = useAppSelector(selectCardRewardEvalKey);
  const cards = state.card_reward.cards;

  // Discard any stored eval that doesn't match the current cards. When a
  // new card_reward arrives, the slice still holds the previous eval until
  // the listener fires `evalStarted`; without this guard the prior result
  // would render against the new cards by id/name collision (#136).
  const currentCardsKey = useMemo(() => computeCardRewardEvalKey(cards), [cards]);
  const evaluation = storedEvalKey === currentCardsKey ? rawEvaluation : null;

  // Single source of truth for top pick — drives both badge and summary text
  const topPickResult = evaluation?.rankings
    ? resolveTopPick(evaluation.rankings, evaluation.skipRecommended ?? false)
    : null;

  // The coaching panel owns the verdict line when present. Fall back to the
  // legacy ranking-derived summary only when coaching is missing so the
  // player never sees two competing verdicts on the same screen.
  const showLegacySummary = !evaluation?.coaching;

  return (
    <div className="flex flex-col gap-3 min-h-0 h-full overflow-y-auto overflow-x-hidden pr-1">
      {/* Header row — label + loading indicator. Legacy summary only renders
          when coaching is absent (phase-3 backwards-compat fallback). */}
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-display font-bold text-spire-text shrink-0">Card Reward</h2>

        {showLegacySummary && topPickResult && !isLoading && (
          <p className="text-xs font-medium truncate flex-1 text-right text-emerald-400">
            {topPickResult.summary}
          </p>
        )}
        {showLegacySummary && evaluation?.skipRecommended && !topPickResult && !isLoading && (
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

      {/* Card ratings come FIRST — this is the actual decision surface.
          Cards always render so the player can read the offered cards
          immediately; rating badges and Top Pick only appear once a
          matching eval has landed. */}
      <div className="grid grid-cols-3 gap-3">
        {cards.map((card) => {
          // Match strictly by id (case-insensitive) with name as a fallback.
          // The previous index-based fallback could match the prior eval's
          // rankings to new cards by position, producing stale ratings.
          const cardEval = evaluation?.rankings.find(
            (r) =>
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
        })}
      </div>

      <CardPickCoaching coaching={evaluation?.coaching} />

      {error && (
        <EvalError
          error={error}
          onRetry={() => dispatch(evalRetryRequested("card_reward"))}
        />
      )}
    </div>
  );
}
