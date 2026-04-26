import type { TierLetter } from "../tier-utils";
import { tierToValue } from "../tier-utils";

export type ShopItemKind = "card_removal" | "relic" | "potion" | "other";

export interface ShopNonCardItem {
  itemId: string;
  itemName: string;
  itemIndex: number;
  cost: number;
  description: string;
  kind?: ShopItemKind;
  /**
   * Whether the item is on sale. Used as a tie-break boost in sort order so
   * a discounted item with the same tier as a full-price one rises above
   * it. Does not change the tier itself — sales are a small signal, not a
   * major one. Defaults to false.
   */
  onSale?: boolean;
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
  /**
   * Total potion-slot cap. Defaults to STS2 baseline of 2 if not provided.
   * Expansion relics raise this; respecting it prevents tiering potions at
   * B when the player can't actually pick them up.
   */
  potionSlotCap?: number;
}

function classifyItem(item: ShopNonCardItem): ShopItemKind {
  if (item.kind && item.kind !== "other") return item.kind;
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
  potionSlotCap: number,
): TierLetter {
  switch (kind) {
    case "card_removal":
      return act === 3 ? "A" : "S";
    case "relic":
      return act === 1 ? "A" : "S";
    case "potion":
      return potionCount >= potionSlotCap ? "F" : "B";
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
  potionSlotCap: number,
): string {
  switch (kind) {
    case "card_removal":
      return act === 3 ? "removal still useful" : "deck-trim priority";
    case "relic":
      return act === 1 ? "permanent power early" : "relic in peak window";
    case "potion":
      return potionCount >= potionSlotCap
        ? "no open potion slot"
        : "situational tool";
    case "other":
      return "";
  }
}

export function scoreShopNonCards(
  input: ScoreShopNonCardsInput,
): ScoredShopNonCardItem[] {
  const potionSlotCap = input.potionSlotCap ?? 2;

  const scored = input.items.map<ScoredShopNonCardItem>((item) => {
    const kind = classifyItem(item);
    const affordable = item.cost <= input.goldBudget;
    const tier: TierLetter = affordable
      ? baseTier(kind, input.act, input.potionCount, potionSlotCap)
      : "F";
    const tv = tierToValue(tier);
    const baseReasoning = affordable
      ? `${tier}-tier · ${kindReason(kind, input.act, input.potionCount, potionSlotCap)}`
      : "F-tier · not affordable";
    const reasoning =
      affordable && item.onSale ? `${baseReasoning} · on sale` : baseReasoning;
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
    // Tie-break by sale: discounted items rank above same-tier full-price.
    const sd = (b.onSale ? 1 : 0) - (a.onSale ? 1 : 0);
    if (sd !== 0) return sd;
    return a.itemIndex - b.itemIndex;
  });

  return scored;
}
