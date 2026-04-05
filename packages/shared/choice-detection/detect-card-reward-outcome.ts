import type { CardRewardOutcome, DetectCardRewardInput } from "./types";

/**
 * Given a set of offered cards and before/after deck snapshots,
 * determine whether the player picked a card or skipped.
 *
 * Uses name-based set diff. If the deck gained a name that matches
 * one of the offered cards, that card was picked. Otherwise, skip.
 */
export function detectCardRewardOutcome(
  input: DetectCardRewardInput
): CardRewardOutcome {
  const { offeredCards, previousDeckNames, currentDeckNames } = input;

  const offeredNames = new Set(offeredCards.map((c) => c.name));

  for (const name of currentDeckNames) {
    if (!previousDeckNames.has(name) && offeredNames.has(name)) {
      return { type: "picked", chosenName: name };
    }
  }

  return { type: "skipped" };
}
