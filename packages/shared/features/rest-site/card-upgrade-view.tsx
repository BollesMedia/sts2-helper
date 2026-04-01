"use client";

import { useCallback, useRef, useState } from "react";
import { cn } from "../../lib/cn";
import type { CombatCard } from "../../types/game-state";
import type { TrackedPlayer } from "../connection/use-player-tracker";
import type { EvaluationContext } from "../../evaluation/types";
import { buildEvaluationContext } from "../../evaluation/context-builder";
import { buildCompactContext } from "../../evaluation/prompt-builder";
import { getPromptContext, updateFromContext } from "../../evaluation/run-narrative";
import { apiFetch } from "../../lib/api-client";
import { RefineInput } from "../../components/refine-input";
import type { GameState } from "../../types/game-state";

interface CardUpgradeViewProps {
  state: GameState & { state_type: "card_select" };
  deckCards: CombatCard[];
  player: TrackedPlayer | null;
}

interface UpgradeRecommendation {
  cardName: string;
  reasoning: string;
}

export function CardUpgradeView({ state, deckCards, player }: CardUpgradeViewProps) {
  const [recommendation, setRecommendation] = useState<UpgradeRecommendation | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const evaluatedKey = useRef("");

  // Only show upgradeable cards (not already upgraded)
  const cards = state.card_select.cards.filter((c) => !c.name.endsWith("+"));
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
    const contextStr = buildCompactContext(ctx);
    const narrative = getPromptContext();
    const cardList = cards.map((c) => `- ${c.name}: ${c.description}`).join("\n");

    try {
      const res = await apiFetch("/api/evaluate", {
        method: "POST",
        body: JSON.stringify({
          type: "map",
          evalType: "card_upgrade",
          context: ctx,
          runNarrative: narrative,
          mapPrompt: `${contextStr}

CARD UPGRADE: Choose ONE card to upgrade from this list ONLY:
${cardList}

Prioritize: key engine card > most-played card > scaling card.
Cards with + cannot be upgraded again.`,
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
  }, [state, deckCards, player, cards, cardKey]);

  if (cardKey !== evaluatedKey.current && !isLoading) {
    evaluate();
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-zinc-100">Upgrade a Card</h2>
        {isLoading && (
          <span className="text-xs text-zinc-500 animate-pulse">Evaluating...</span>
        )}
      </div>

      {recommendation && (
        <p className="text-sm text-emerald-300 font-medium">
          Upgrade {recommendation.cardName}
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
                {isRecommended && (
                  <span className="ml-1.5 text-[10px] text-emerald-400 uppercase font-bold">upgrade</span>
                )}
              </div>
            );
          });
        })()}
      </div>

      {recommendation && (
        <RefineInput
          originalContext={`Card upgrade. Deck: ${cards.map((c) => c.name).join(", ")}`}
          originalResponse={`Upgrade ${recommendation.cardName}: ${recommendation.reasoning}`}
        />
      )}
    </div>
  );
}
