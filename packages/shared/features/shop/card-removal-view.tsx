"use client";

import { useCallback, useRef, useState } from "react";
import { cn } from "../../lib/cn";
import type { CombatCard } from "../../types/game-state";
import type { TrackedPlayer } from "../connection/use-player-tracker";
import type { EvaluationContext } from "../../evaluation/types";
import { buildEvaluationContext, buildPromptContext } from "../../evaluation/context-builder";
import { getPromptContext, updateFromContext } from "../../evaluation/run-narrative";
import { apiFetch } from "../../lib/api-client";
import { RefineInput } from "../../components/refine-input";
import type { GameState } from "../../types/game-state";

interface CardRemovalViewProps {
  state: GameState & { state_type: "card_select" };
  deckCards: CombatCard[];
  player: TrackedPlayer | null;
}

interface RemovalRecommendation {
  cardName: string;
  reasoning: string;
}

export function CardRemovalView({ state, deckCards, player }: CardRemovalViewProps) {
  const [recommendation, setRecommendation] = useState<RemovalRecommendation | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const evaluatedKey = useRef("");

  const cards = state.card_select.cards;
  const cardKey = cards.map((c) => c.name).sort().join(",");

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
    const contextStr = buildPromptContext(ctx);
    const narrative = getPromptContext();
    const cardList = cards.map((c) => `- ${c.name}: ${c.description}`).join("\n");

    try {
      const res = await apiFetch("/api/evaluate", {
        method: "POST",
        body: JSON.stringify({
          type: "map",
          context: ctx,
          runNarrative: narrative,
          mapPrompt: `${contextStr}

CARD REMOVAL: Recommend exactly ONE card to remove.
Removable cards:
${cardList}

Priority: Strikes first (worst damage per card), then Defends, then off-archetype cards. If equal Strikes/Defends, remove Strike. Cards marked ETERNAL cannot be removed — do not recommend them.

Respond as JSON (one card_name, not an array):
{
  "card_name": "exact card name",
  "reasoning": "max 8 words",
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
      // Silent fail — removal still works without recommendation
    } finally {
      setIsLoading(false);
    }
  }, [state, deckCards, player, cards, cardKey]);

  if (cardKey !== evaluatedKey.current && !isLoading) {
    evaluate();
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-zinc-100">Remove a Card</h2>
        {isLoading && (
          <span className="text-xs text-zinc-500 animate-pulse">Evaluating...</span>
        )}
      </div>

      {recommendation && (
        <p className="text-sm text-emerald-300 font-medium">
          Remove {recommendation.cardName}
          {recommendation.reasoning && (
            <span className="text-zinc-400 font-normal"> — {recommendation.reasoning}</span>
          )}
        </p>
      )}

      <div className="grid grid-cols-4 gap-1.5">
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
                {isRecommended && (
                  <span className="ml-1.5 text-[10px] text-emerald-400 uppercase font-bold">remove</span>
                )}
              </div>
            );
          });
        })()}
      </div>

      {recommendation && (
        <RefineInput
          originalContext={`Card removal. Deck: ${cards.map((c) => c.name).join(", ")}`}
          originalResponse={`Remove ${recommendation.cardName}: ${recommendation.reasoning}`}
        />
      )}
    </div>
  );
}
