import type { TierLetter } from "../tier-utils";
import { tierToValue } from "../tier-utils";

export type ShopItemKind = "card_removal" | "relic" | "potion" | "other";

export interface ShopNonCardItem {
  itemId: string;
  itemName: string;
  itemIndex: number;
  cost: number;
  description: string;
}

export interface ScoredShopNonCardItem extends ShopNonCardItem {
  kind: ShopItemKind;
  tier: TierLetter;
  tierValue: number;
  reasoning: string;
  affordable: boolean;
}

export interface ScoreShopNonCardsInput {
  items: ShopNonCardItem[];
  act: 1 | 2 | 3;
  goldBudget: number;
  potionCount: number;
}

function classifyItem(item: ShopNonCardItem): ShopItemKind {
  const name = item.itemName.toLowerCase();
  if (name.includes("remove") || name.includes("card removal")) return "card_removal";
  if (
    name.includes("potion") ||
    name.includes("elixir") ||
    name.includes("flask") ||
    name.includes("brew")
  )
    return "potion";
  return "relic";
}

function baseTier(
  kind: ShopItemKind,
  act: 1 | 2 | 3,
  potionCount: number,
): TierLetter {
  switch (kind) {
    case "card_removal":
      return act === 3 ? "A" : "S";
    case "relic":
      return act === 1 ? "A" : "S";
    case "potion":
      return potionCount >= 3 ? "F" : "B";
    case "other":
      return "C";
  }
}

function kindRank(kind: ShopItemKind): number {
  switch (kind) {
    case "card_removal":
      return 0;
    case "relic":
      return 1;
    case "potion":
      return 2;
    case "other":
      return 3;
  }
}

function kindReason(
  kind: ShopItemKind,
  act: 1 | 2 | 3,
  potionCount: number,
): string {
  switch (kind) {
    case "card_removal":
      return act === 3 ? "removal still useful" : "deck-trim priority";
    case "relic":
      return act === 1 ? "permanent power early" : "relic in peak window";
    case "potion":
      return potionCount >= 3 ? "no open potion slot" : "situational tool";
    case "other":
      return "";
  }
}

export function scoreShopNonCards(
  input: ScoreShopNonCardsInput,
): ScoredShopNonCardItem[] {
  const scored = input.items.map<ScoredShopNonCardItem>((item) => {
    const kind = classifyItem(item);
    const affordable = item.cost <= input.goldBudget;
    const tier: TierLetter = affordable
      ? baseTier(kind, input.act, input.potionCount)
      : "F";
    const tv = tierToValue(tier);
    const reasoning = affordable
      ? `${tier}-tier · ${kindReason(kind, input.act, input.potionCount)}`
      : "F-tier · not affordable";
    return {
      ...item,
      kind,
      tier,
      tierValue: tv,
      reasoning,
      affordable,
    };
  });

  scored.sort((a, b) => {
    if (a.tierValue !== b.tierValue) return b.tierValue - a.tierValue;
    const kd = kindRank(a.kind) - kindRank(b.kind);
    if (kd !== 0) return kd;
    return a.itemIndex - b.itemIndex;
  });

  return scored;
}
