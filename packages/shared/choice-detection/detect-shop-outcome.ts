import type { ShopOutcome, DetectShopInput } from "./types";

/**
 * Detect what happened during a shop visit by diffing deck snapshots.
 * Purchases are detected by new names in the deck.
 * Removals are detected by deck size decrease not explained by purchases.
 */
export function detectShopOutcome(input: DetectShopInput): ShopOutcome {
  const {
    previousDeckNames,
    currentDeckNames,
    previousDeckSize,
    currentDeckSize,
  } = input;

  const purchases: string[] = [];
  for (const name of currentDeckNames) {
    if (!previousDeckNames.has(name)) {
      purchases.push(name);
    }
  }

  // When purchases happened, removals are detected by names that disappeared.
  // When no purchases happened, names-based diff is unreliable for duplicates,
  // so fall back to size delta.
  let removals: number;
  if (purchases.length > 0) {
    removals = 0;
    for (const name of previousDeckNames) {
      if (!currentDeckNames.has(name)) {
        removals++;
      }
    }
  } else {
    removals = Math.max(0, previousDeckSize - currentDeckSize);
  }

  const browsedOnly = purchases.length === 0 && removals === 0;

  return { purchases, removals, browsedOnly };
}
