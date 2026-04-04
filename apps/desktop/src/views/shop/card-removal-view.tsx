"use client";

import { cn } from "@sts2/shared/lib/cn";
import type { GameState } from "@sts2/shared/types/game-state";
import { useAppSelector, useAppDispatch } from "../../store/hooks";
import { selectEvalResult, selectEvalIsLoading, selectEvalError } from "../../features/evaluation/evaluationSelectors";
import { evalRetryRequested } from "../../features/evaluation/evaluationSlice";
import { EvalError } from "../../components/eval-error";

interface CardRemovalViewProps {
  state: GameState & { state_type: "card_select" };
}

interface RemovalRecommendation {
  cardName: string;
  reasoning: string;
}

const selectRemovalResult = selectEvalResult<RemovalRecommendation | null>("card_removal");
const selectRemovalLoading = selectEvalIsLoading("card_removal");
const selectRemovalError = selectEvalError("card_removal");

export function CardRemovalView({ state }: CardRemovalViewProps) {
  const dispatch = useAppDispatch();
  const recommendation = useAppSelector(selectRemovalResult);
  const isLoading = useAppSelector(selectRemovalLoading);
  const error = useAppSelector(selectRemovalError);
  const cards = state.card_select.cards;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-display font-bold text-spire-text shrink-0">
          Remove a Card
        </h2>
        {isLoading && (
          <span className="text-[10px] font-mono text-zinc-500 bg-zinc-900/80 px-2 py-0.5 rounded border border-zinc-800 animate-pulse">
            Evaluating...
          </span>
        )}
      </div>

      {recommendation && !isLoading && (
        <div className="rounded border border-emerald-500/30 bg-emerald-950/20 px-3 py-2 flex items-center gap-2">
          <span className="text-[9px] font-bold uppercase tracking-widest text-emerald-400 bg-emerald-500/15 px-1.5 py-0.5 rounded border border-emerald-500/25 shrink-0">
            Remove
          </span>
          <span className="text-xs font-semibold text-emerald-300">{recommendation.cardName}</span>
          {recommendation.reasoning && (
            <span className="text-[10px] text-zinc-500 truncate">{recommendation.reasoning}</span>
          )}
        </div>
      )}

      {error && <EvalError error={error} onRetry={() => dispatch(evalRetryRequested("card_removal"))} />}

      <div className="grid grid-cols-5 gap-1.5">
        {(() => {
          let highlightedOne = false;
          return cards.map((card) => {
            const nameMatch = recommendation?.cardName.toLowerCase() === card.name.toLowerCase();
            const isRecommended = nameMatch && !highlightedOne;
            if (isRecommended) highlightedOne = true;

            return (
              <div
                key={card.index}
                className={cn(
                  "rounded-lg border px-2.5 py-2 transition-all duration-150",
                  isRecommended
                    ? "border-emerald-500/50 bg-emerald-950/20 shadow-[0_0_10px_rgba(52,211,153,0.12)]"
                    : "border-spire-border bg-spire-surface hover:bg-spire-elevated"
                )}
                title={card.description}
              >
                <span className={cn(
                  "font-medium text-[11px] truncate block",
                  isRecommended ? "text-emerald-200" : "text-zinc-300"
                )}>
                  {card.name}
                </span>
                <span className="text-[9px] text-zinc-600 truncate block mt-0.5">
                  {card.description.slice(0, 40)}{card.description.length > 40 ? "..." : ""}
                </span>
              </div>
            );
          });
        })()}
      </div>
    </div>
  );
}
