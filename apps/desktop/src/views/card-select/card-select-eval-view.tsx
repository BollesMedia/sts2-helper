"use client";

import { useCallback, useRef, useState } from "react";
import { cn } from "@sts2/shared/lib/cn";
import { useAppSelector } from "../../store/hooks";
import { selectActiveDeck, selectActivePlayer } from "../../features/run/runSelectors";
import type { EvaluationContext } from "@sts2/shared/evaluation/types";
import { buildEvaluationContext } from "@sts2/shared/evaluation/context-builder";
import { buildCompactContext } from "@sts2/shared/evaluation/prompt-builder";
import { getPromptContext, updateFromContext } from "@sts2/shared/evaluation/run-narrative";
import { apiFetch } from "@sts2/shared/lib/api-client";
import type { GameState } from "@sts2/shared/types/game-state";

interface CardSelectEvalViewProps {
  state: GameState & { state_type: "card_select" };
}

interface SelectRecommendation {
  cardName: string;
  reasoning: string;
}

/**
 * Generic card select evaluation for any card_select screen that isn't
 * a reward, removal, or upgrade. Passes the game's prompt text through
 * to Claude so it understands the context (enchant, transform, etc.).
 */
export function CardSelectEvalView({ state }: CardSelectEvalViewProps) {
  const deckCards = useAppSelector(selectActiveDeck);
  const player = useAppSelector(selectActivePlayer);
  const [recommendation, setRecommendation] = useState<SelectRecommendation | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const evaluatedKey = useRef("");

  const prompt = state.card_select.prompt;
  const cards = state.card_select.cards;
  const cardKey = `${prompt}:${cards.map((c) => c.name).sort().join(",")}`;

  const evaluate = useCallback(async () => {
    if (cardKey === evaluatedKey.current) return;
    evaluatedKey.current = cardKey;
    setIsLoading(true);

    const ctx: EvaluationContext | null = buildEvaluationContext(state, deckCards, player);
    if (!ctx) {
      setIsLoading(false);
      return;
    }

    updateFromContext(ctx);
    const contextStr = buildCompactContext(ctx);
    const narrative = getPromptContext();
    const cardList = cards
      .map((c) => `- ${c.name}: ${c.description}`)
      .join("\n");

    try {
      const res = await apiFetch("/api/evaluate", {
        method: "POST",
        body: JSON.stringify({
          type: "map",
          evalType: "card_reward",
          context: ctx,
          runNarrative: narrative,
          mapPrompt: `${contextStr}

CARD SELECT: "${prompt}"
You must choose ONE card from your deck for this effect.
Cards available:
${cardList}

Choose the card that benefits MOST from this effect given the current archetype and win condition.
Prioritize: key engine cards > most-played cards > highest-impact cards.

Respond as JSON:
{
  "card_name": "exact card name",
  "reasoning": "under 20 words",
  "overall_advice": null,
  "rankings": []
}`,
          runId: null,
          gameVersion: null,
        }),
      });

      if (!res.ok) throw new Error("Eval failed");

      const data = await res.json();
      if (data.card_name) {
        setRecommendation({
          cardName: data.card_name,
          reasoning: data.reasoning ?? "",
        });
      }
    } catch {
      // Silent fail
    } finally {
      setIsLoading(false);
    }
  }, [state, deckCards, player, cards, cardKey, prompt]);

  if (cardKey !== evaluatedKey.current && !isLoading) {
    evaluate();
  }

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
