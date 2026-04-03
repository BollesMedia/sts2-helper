export interface ContextChangeInput {
  prevHpPercent: number;
  currentHpPercent: number;
  prevDeckSize: number;
  currentDeckSize: number;
}

/**
 * Determines whether the player's context has changed significantly
 * since the last map evaluation. Used to decide if re-evaluation is needed.
 *
 * Triggers on:
 * - HP dropped more than 15% (took significant damage)
 * - Deck grew by more than 1 card (picked up multiple cards)
 */
export function hasSignificantContextChange(input: ContextChangeInput): boolean {
  const hpDrop = input.prevHpPercent - input.currentHpPercent;
  const deckGrowth = input.currentDeckSize - input.prevDeckSize;
  return hpDrop > 0.15 || deckGrowth > 1;
}
