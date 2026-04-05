import type { RestSiteOutcome, DetectRestSiteInput } from "./types";

/**
 * Detect whether the player rested or upgraded a card at a rest site.
 * An upgrade is detected when a new card name ending in "+" appears
 * and its base name (without "+") was in the previous deck.
 */
export function detectRestSiteOutcome(
  input: DetectRestSiteInput
): RestSiteOutcome {
  const { previousDeckNames, currentDeckNames } = input;

  for (const name of currentDeckNames) {
    if (previousDeckNames.has(name)) continue;

    if (name.endsWith("+")) {
      const baseName = name.slice(0, -1);
      if (previousDeckNames.has(baseName)) {
        return { type: "upgraded", cardName: name };
      }
    }
  }

  return { type: "rested" };
}
