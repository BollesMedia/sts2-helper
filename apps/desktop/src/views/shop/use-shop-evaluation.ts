"use client";

import { useCallback } from "react";
import type { ShopState, ShopItem } from "@sts2/shared/types/game-state";
import { getPlayer } from "@sts2/shared/types/game-state";
import type { EvaluationContext, CardRewardEvaluation } from "@sts2/shared/evaluation/types";
import { buildEvaluationContext } from "@sts2/shared/evaluation/context-builder";
import { getPromptContext, updateFromContext } from "@sts2/shared/evaluation/run-narrative";
import { registerLastEvaluation } from "@sts2/shared/evaluation/last-evaluation-registry";
import { getUserId } from "@sts2/shared/lib/get-user-id";
import { useEvaluation, type UseEvaluationResult } from "@sts2/shared/evaluation/use-evaluation";
import { useEvaluateShopMutation } from "../../services/evaluationApi";
import { useAppSelector } from "../../store/hooks";
import { selectActiveDeck, selectActivePlayer } from "../../features/run/runSelectors";
import { selectActiveRunId } from "../../features/run/runSlice";

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

export function useShopEvaluation(
  state: ShopState,
): UseEvaluationResult<CardRewardEvaluation> {
  const deckCards = useAppSelector(selectActiveDeck);
  const player = useAppSelector(selectActivePlayer);
  const runId = useAppSelector(selectActiveRunId);
  const [trigger] = useEvaluateShopMutation();

  const shopItems = state.shop.items.filter((i) => i.is_stocked);
  const shopKey = shopItems.map((i) => getItemId(i)).sort().join(",");

  const fetcher = useCallback(async (): Promise<CardRewardEvaluation> => {
    const ctx: EvaluationContext | null = buildEvaluationContext(state, deckCards, player);
    if (!ctx) throw new Error("Could not build evaluation context");

    updateFromContext(ctx);

    const shopPlayer = getPlayer(state);
    const gold = shopPlayer?.gold ?? 0;
    ctx.gold = gold;

    const affordableItems = shopItems.filter((i) => i.can_afford);
    const items = affordableItems.map((item) => ({
      id: getItemId(item),
      name: getItemName(item),
      description: getItemDescription(item),
      cost: item.cost,
      type: item.category === "card" ? item.card_type : item.category,
      rarity: item.category === "card" ? item.card_rarity : undefined,
      on_sale: item.on_sale ?? false,
    }));

    const data = await trigger({
      context: ctx,
      runNarrative: getPromptContext(),
      items,
      goldBudget: gold,
      runId,
      userId: getUserId(),
      gameVersion: null,
    }).unwrap();

    registerLastEvaluation("shop", {
      recommendedId: data.rankings?.[0]?.itemId ?? null,
      recommendedTier: data.rankings?.[0]?.tier ?? null,
      reasoning: data.rankings?.[0]?.reasoning ?? "",
      allRankings: (data.rankings ?? []).map((r) => ({
        itemId: r.itemId,
        itemName: r.itemName,
        tier: r.tier,
        recommendation: r.recommendation,
      })),
      evalType: "shop",
    });

    return data;
  }, [state, deckCards, player, shopItems, runId, trigger]);

  return useEvaluation<CardRewardEvaluation>({
    cacheKey: CACHE_KEY,
    evalKey: shopKey,
    enabled: true,
    fetcher,
  });
}

export { getItemId, getItemName, getItemDescription };
