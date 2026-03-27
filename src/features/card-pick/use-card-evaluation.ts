"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { CardRewardState, GameCard } from "@/lib/types/game-state";
import type { EvaluationContext, CardRewardEvaluation } from "@/evaluation/types";
import { buildEvaluationContext } from "@/evaluation/context-builder";

interface UseCardEvaluationResult {
  evaluation: CardRewardEvaluation | null;
  isLoading: boolean;
  error: string | null;
}

/**
 * Triggers a holistic card evaluation when a card_reward state is detected.
 * Sends all offered cards to /api/evaluate in a single call.
 */
export function useCardEvaluation(
  state: CardRewardState,
  deckCards: GameCard[]
): UseCardEvaluationResult {
  const [evaluation, setEvaluation] = useState<CardRewardEvaluation | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Track which card set we've already evaluated to avoid re-fetching
  const evaluatedKey = useRef<string>("");

  const evaluate = useCallback(async () => {
    const cardKey = state.cards.map((c) => c.id).sort().join(",");
    if (cardKey === evaluatedKey.current) return;

    evaluatedKey.current = cardKey;
    setIsLoading(true);
    setError(null);

    const ctx: EvaluationContext | null = buildEvaluationContext(
      // card_reward doesn't have player, so we need deck cards passed in
      // We'll build a minimal context
      state,
      deckCards
    );

    if (!ctx) {
      setError("Could not build evaluation context");
      setIsLoading(false);
      return;
    }

    try {
      const res = await fetch("/api/evaluate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "card_reward",
          context: ctx,
          items: state.cards.map((card) => ({
            id: card.id,
            name: card.name,
            description: card.description,
            cost: card.cost,
            type: card.type,
            rarity: card.rarity,
          })),
          runId: null, // TODO: wire up run tracking
          gameVersion: null,
        }),
      });

      if (!res.ok) {
        throw new Error(`Evaluation failed: ${res.status}`);
      }

      const data: CardRewardEvaluation = await res.json();
      setEvaluation(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Evaluation failed");
    } finally {
      setIsLoading(false);
    }
  }, [state, deckCards]);

  useEffect(() => {
    evaluate();
  }, [evaluate]);

  return { evaluation, isLoading, error };
}
