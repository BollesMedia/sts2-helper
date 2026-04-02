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
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-display font-bold text-spire-text uppercase tracking-wide">
          Upgrade a Card
        </h2>
        {isLoading && (
          <span className="text-[10px] font-mono text-zinc-500 bg-zinc-900/80 px-2 py-0.5 rounded border border-zinc-800 animate-pulse">
            Evaluating...
          </span>
        )}
      </div>

      {/* Recommendation banner */}
      {recommendation && !isLoading && (
        <div className="rounded border border-blue-500/30 bg-blue-950/20 px-3 py-2 flex items-center gap-2">
          <span className="text-[9px] font-bold uppercase tracking-widest text-blue-400 bg-blue-500/15 px-1.5 py-0.5 rounded border border-blue-500/25 shrink-0">
            Upgrade
          </span>
          <span className="text-xs font-semibold text-blue-300">{recommendation.cardName}</span>
          {recommendation.reasoning && (
            <span className="text-[10px] text-zinc-500 truncate">{recommendation.reasoning}</span>
          )}
        </div>
      )}

      {/* Card grid */}
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
                  "rounded-lg border px-2.5 py-2 relative overflow-hidden transition-all duration-150",
                  isRecommended
                    ? "border-blue-500/50 bg-blue-950/20 shadow-[0_0_10px_rgba(59,130,246,0.12)]"
                    : "border-zinc-800 bg-zinc-900/60 hover:bg-zinc-800/60"
                )}
                title={card.description}
              >
                {isRecommended && (
                  <div className="absolute left-0 top-0 bottom-0 w-0.5 bg-gradient-to-b from-blue-500 to-transparent" />
                )}
                <span className={cn(
                  "font-medium text-[11px] truncate block",
                  isRecommended ? "text-blue-200" : "text-zinc-300"
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

      {recommendation && (
        <RefineInput
          originalContext={`Card upgrade. Deck: ${cards.map((c) => c.name).join(", ")}`}
          originalResponse={`Upgrade ${recommendation.cardName}: ${recommendation.reasoning}`}
        />
      )}
    </div>
  );
}
