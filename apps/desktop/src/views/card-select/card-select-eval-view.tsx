"use client";

import { cn } from "@sts2/shared/lib/cn";
import type { GameState } from "@sts2/shared/types/game-state";
import { useAppSelector } from "../../store/hooks";
import { selectEvalResult, selectEvalIsLoading } from "../../features/evaluation/evaluationSelectors";

interface CardSelectEvalViewProps {
  state: GameState & { state_type: "card_select" };
}

interface SelectRecommendation {
  cardName: string;
  reasoning: string;
}

const selectResult = selectEvalResult<SelectRecommendation | null>("card_select");
const selectLoading = selectEvalIsLoading("card_select");

export function CardSelectEvalView({ state }: CardSelectEvalViewProps) {
  const recommendation = useAppSelector(selectResult);
  const isLoading = useAppSelector(selectLoading);
  const prompt = state.card_select.prompt;
  const cards = state.card_select.cards;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-zinc-100">Choose a Card</h2>
        {isLoading && (
          <span className="text-xs text-zinc-500 animate-pulse">Evaluating...</span>
        )}
      </div>

      <p className="text-xs text-zinc-400">{prompt}</p>

      {recommendation && (
        <p className="text-sm text-emerald-300 font-medium">
          {recommendation.cardName}
          {recommendation.reasoning && (
            <span className="text-zinc-400 font-normal"> — {recommendation.reasoning}</span>
          )}
        </p>
      )}

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
                  "rounded border px-2.5 py-1.5 text-xs",
                  isRecommended
                    ? "border-emerald-500/60 bg-emerald-500/10 text-emerald-300"
                    : "border-zinc-800 bg-zinc-900/50 text-zinc-400"
                )}
              >
                <span className={cn("font-medium", isRecommended ? "text-emerald-200" : "text-zinc-200")}>
                  {card.name}
                </span>
              </div>
            );
          });
        })()}
      </div>
    </div>
  );
}
