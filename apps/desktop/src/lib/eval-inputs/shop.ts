import type { ShopItem } from "@sts2/shared/types/game-state";
import type { EvaluationContext } from "@sts2/shared/evaluation/types";

// --- Shop item helpers (moved from use-shop-evaluation.ts) ---

export function getItemId(item: ShopItem): string {
  switch (item.category) {
    case "card": return item.card_id ?? `card_${item.index}`;
    case "relic": return item.relic_id ?? `relic_${item.index}`;
    case "potion": return item.potion_id ?? `potion_${item.index}`;
    case "card_removal": return "CARD_REMOVAL";
  }
}

export function getItemName(item: ShopItem): string {
  switch (item.category) {
    case "card": return item.card_name ?? "Unknown Card";
    case "relic": return item.relic_name ?? "Unknown Relic";
    case "potion": return item.potion_name ?? "Unknown Potion";
    case "card_removal": return "Card Removal";
  }
}

export function getItemDescription(item: ShopItem): string {
  switch (item.category) {
    case "card": return item.card_description ?? "";
    case "relic": return item.relic_description ?? "";
    case "potion": return item.potion_description ?? "";
    case "card_removal": return "Remove a card from your deck";
  }
}

// --- Eval key + request builder ---

/**
 * Compute stable shop eval key from ALL items + act/floor.
 * Doesn't change when user buys (is_stocked toggles).
 */
export function computeShopEvalKey(
  items: ShopItem[],
  act: number,
  floor: number
): string {
  return `${act}:${floor}:${items.map((i) => getItemId(i)).sort().join(",")}`;
}

/**
 * Build the RTK Query mutation payload for shop evaluation.
 */
export function buildShopRequest(params: {
  context: EvaluationContext;
  items: ShopItem[];
  gold: number;
  runId: string | null;
  userId: string | null;
  runNarrative: string | null;
}) {
  const affordableItems = params.items.filter((i) => i.is_stocked && i.can_afford);
  return {
    context: params.context,
    runNarrative: params.runNarrative,
    items: affordableItems.map((item) => ({
      id: getItemId(item),
      name: getItemName(item),
      description: getItemDescription(item),
      cost: item.cost,
      type: item.category === "card" ? item.card_type : item.category,
      rarity: item.category === "card" ? item.card_rarity : undefined,
      on_sale: item.on_sale ?? false,
    })),
    goldBudget: params.gold,
    runId: params.runId,
    userId: params.userId,
    gameVersion: null,
  };
}
