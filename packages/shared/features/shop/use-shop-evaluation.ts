"use client";
import { apiFetch } from "../../lib/api-client";

import { useCallback, useRef, useState } from "react";
import type { ShopState, ShopItem, CombatCard } from "../../types/game-state";
import type { TrackedPlayer } from "../connection/use-player-tracker";
import type { EvaluationContext, CardRewardEvaluation } from "../../evaluation/types";
import { buildEvaluationContext } from "../../evaluation/context-builder";
import { getPromptContext, updateFromContext } from "../../evaluation/run-narrative";
import { registerLastEvaluation } from "../../evaluation/last-evaluation-registry";
import { getUserId } from "../../lib/get-user-id";
import { getCached, setCache } from "../../lib/local-cache";

const CACHE_KEY = "sts2-shop-eval-cache";

function getItemId(item: ShopItem): string {
  switch (item.category) {
    case "card": return item.card_id ?? `card_${item.index}`;
    case "relic": return item.relic_id ?? `relic_${item.index}`;
    case "potion": return item.potion_id ?? `potion_${item.index}`;
    case "card_removal": return "CARD_REMOVAL";
  }
}

function getItemName(item: ShopItem): string {
  switch (item.category) {
    case "card": return item.card_name ?? "Unknown Card";
    case "relic": return item.relic_name ?? "Unknown Relic";
    case "potion": return item.potion_name ?? "Unknown Potion";
    case "card_removal": return "Card Removal";
  }
}

function getItemDescription(item: ShopItem): string {
  switch (item.category) {
    case "card": return item.card_description ?? "";
    case "relic": return item.relic_description ?? "";
    case "potion": return item.potion_description ?? "";
    case "card_removal": return "Remove a card from your deck";
  }
}

interface UseShopEvaluationResult {
  evaluation: CardRewardEvaluation | null;
  isLoading: boolean;
  error: string | null;
  retry: () => void;
}

export function useShopEvaluation(
  state: ShopState,
  deckCards: CombatCard[],
  player: TrackedPlayer | null,
  runId: string | null = null
): UseShopEvaluationResult {
  const shopItems = state.shop.items.filter((i) => i.is_stocked);
  const shopKey = shopItems.map((i) => getItemId(i)).sort().join(",");

  const cachedRef = useRef<string | null>(null);
  const initialEval = cachedRef.current !== shopKey ? getCached<CardRewardEvaluation>(CACHE_KEY, shopKey) : null;

  const [evaluation, setEvaluation] = useState<CardRewardEvaluation | null>(initialEval);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const evaluatedKey = useRef<string>(initialEval ? shopKey : "");

  cachedRef.current = shopKey;

  const evaluate = useCallback(async () => {
    if (shopKey === evaluatedKey.current) return;

    const cached = getCached<CardRewardEvaluation>(CACHE_KEY, shopKey);
    if (cached) {
      evaluatedKey.current = shopKey;
      setEvaluation(cached);
      return;
    }

    evaluatedKey.current = shopKey;
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

    updateFromContext(ctx);

    const items = shopItems.map((item) => ({
      id: getItemId(item),
      name: getItemName(item),
      description: getItemDescription(item),
      cost: item.cost,
      type: item.category === "card" ? item.card_type : item.category,
      rarity: item.category === "card" ? item.card_rarity : undefined,
    }));

    try {
      const res = await apiFetch("/api/evaluate", {
        method: "POST",
        body: JSON.stringify({
          type: "shop",
          context: ctx,
          runNarrative: getPromptContext(),
          items,
          runId,
          userId: getUserId(),
          gameVersion: null,
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.detail ?? `Evaluation failed: ${res.status}`);
      }

      const data: CardRewardEvaluation = await res.json();
      setEvaluation(data);
      setCache(CACHE_KEY, shopKey, data);
      registerLastEvaluation("shop", {
        recommendedId: data.rankings?.[0]?.itemId ?? null,
        reasoning: data.rankings?.[0]?.reasoning ?? "",
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Evaluation failed");
    } finally {
      setIsLoading(false);
    }
  }, [state, deckCards, player, shopItems, shopKey, runId]);

  const retry = () => {
    evaluatedKey.current = "";
    setError(null);
    setEvaluation(null);
  };

  if (shopKey !== evaluatedKey.current && !isLoading) {
    evaluate();
  }

  return { evaluation, isLoading, error, retry };
}

export { getItemId, getItemName, getItemDescription };
