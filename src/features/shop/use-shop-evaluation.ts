"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ShopState, CombatCard } from "@/lib/types/game-state";
import type { TrackedPlayer } from "@/features/connection/use-player-tracker";
import type { EvaluationContext, CardRewardEvaluation } from "@/evaluation/types";
import { buildEvaluationContext } from "@/evaluation/context-builder";

interface UseShopEvaluationResult {
  evaluation: CardRewardEvaluation | null;
  isLoading: boolean;
  error: string | null;
}

/**
 * Triggers a holistic shop evaluation — all items + card removal
 * ranked in a single Claude call.
 */
export function useShopEvaluation(
  state: ShopState,
  deckCards: CombatCard[],
  player: TrackedPlayer | null
): UseShopEvaluationResult {
  const [evaluation, setEvaluation] = useState<CardRewardEvaluation | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const evaluatedKey = useRef<string>("");

  const evaluate = useCallback(async () => {
    const shop = state.shop;

    // Build a key from all shop items to avoid re-evaluating same shop
    const allIds = [
      ...shop.cards.map((c) => c.id),
      ...shop.relics.map((r) => r.id),
      ...shop.potions.map((p) => p.id),
      shop.card_removal ? "CARD_REMOVAL" : "",
    ]
      .filter(Boolean)
      .sort()
      .join(",");

    if (allIds === evaluatedKey.current) return;
    evaluatedKey.current = allIds;

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

    // Build items list: cards + relics + potions + card removal
    const items: {
      id: string;
      name: string;
      description: string;
      cost?: number;
      type?: string;
      rarity?: string;
    }[] = [];

    for (const card of shop.cards) {
      items.push({
        id: card.id,
        name: card.name,
        description: card.description,
        cost: card.cost_gold,
        type: card.type,
        rarity: card.rarity,
      });
    }

    for (const relic of shop.relics) {
      items.push({
        id: relic.id,
        name: relic.name,
        description: relic.description,
        cost: relic.cost_gold,
        type: "Relic",
      });
    }

    for (const potion of shop.potions) {
      items.push({
        id: potion.id,
        name: potion.name,
        description: potion.description,
        cost: potion.cost_gold,
        type: "Potion",
      });
    }

    if (shop.card_removal) {
      items.push({
        id: "CARD_REMOVAL",
        name: "Card Removal",
        description: `Remove a card from your deck. Cost: ${shop.card_removal.cost}g`,
        cost: shop.card_removal.cost,
        type: "Service",
      });
    }

    try {
      const res = await fetch("/api/evaluate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "shop",
          context: ctx,
          items,
          runId: null,
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
  }, [state, deckCards, player]);

  useEffect(() => {
    evaluate();
  }, [evaluate]);

  return { evaluation, isLoading, error };
}
