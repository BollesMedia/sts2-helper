"use client";

import { useCallback, useRef, useState } from "react";
import type { CardRewardState, CombatCard } from "@sts2/shared/types/game-state";
import type { TrackedPlayer } from "@sts2/shared/features/connection/use-player-tracker";
import type { EvaluationContext, CardRewardEvaluation } from "@sts2/shared/evaluation/types";
import { buildEvaluationContext } from "@sts2/shared/evaluation/context-builder";
import { getUserId } from "@sts2/shared/lib/get-user-id";
import { getCached, setCache } from "@sts2/shared/lib/local-cache";

const CACHE_KEY = "sts2-eval-cache";

interface UseCardEvaluationResult {
  evaluation: CardRewardEvaluation | null;
  isLoading: boolean;
  error: string | null;
  retry: () => void;
}

/**
 * Triggers a holistic card evaluation when a card_reward state is detected.
 * Caches results so toggling the UI doesn't re-evaluate the same cards.
 */
export function useCardEvaluation(
  state: CardRewardState,
  deckCards: CombatCard[],
  player: TrackedPlayer | null,
  runId: string | null = null,
  exclusive: boolean = true
): UseCardEvaluationResult {
  const cards = state.card_reward.cards;
  const cardKey = cards.map((c) => c.id).sort().join(",");

  // Check cache before initializing state
  const cachedRef = useRef<string | null>(null);
  const initialEval = cachedRef.current !== cardKey
    ? getCached<CardRewardEvaluation>(CACHE_KEY, cardKey)
    : null;

  const [evaluation, setEvaluation] = useState<CardRewardEvaluation | null>(initialEval);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const evaluatedKey = useRef<string>(initialEval ? cardKey : "");

  // Track the current cardKey for cache init
  cachedRef.current = cardKey;

  const evaluate = useCallback(async () => {
    if (cardKey === evaluatedKey.current) return;

    // Check localStorage cache first
    const cached = getCached<CardRewardEvaluation>(CACHE_KEY, cardKey);
    if (cached) {
      evaluatedKey.current = cardKey;
      setEvaluation(cached);
      return;
    }

    evaluatedKey.current = cardKey;
    setIsLoading(true);
    setError(null);

    const ctx: EvaluationContext | null = buildEvaluationContext(
      state,
      deckCards,
      player
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
          exclusive,
          userId: getUserId(),
          context: ctx,
          items: cards.map((card) => ({
            id: card.id,
            name: card.name,
            description: card.description,
            cost: card.cost,
            type: card.type,
            rarity: card.rarity,
          })),
          runId,
          gameVersion: null,
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.detail ?? `Evaluation failed: ${res.status}`);
      }

      const data: CardRewardEvaluation = await res.json();
      setEvaluation(data);
      setCache(CACHE_KEY, cardKey, data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Evaluation failed");
    } finally {
      setIsLoading(false);
    }
  }, [state, deckCards, player, cards, cardKey, runId, exclusive]);

  const retry = () => {
    evaluatedKey.current = "";
    setError(null);
    setEvaluation(null);
  };

  // Trigger evaluation (not in useEffect — runs during render check)
  if (cardKey !== evaluatedKey.current && !isLoading) {
    evaluate();
  }

  return { evaluation, isLoading, error, retry };
}
