/**
 * Determine which eval type a card_select screen should use.
 * Card select screens can be: removal, upgrade, deck-pick (enchant/imbue),
 * or reward-style (new cards offered, treated like card_reward).
 */
export type CardSelectSubType = "card_removal" | "card_upgrade" | "card_select" | "card_reward";

export function getCardSelectSubType(
  prompt: string | null | undefined,
  offeredCards: { name: string }[],
  deckCardNames: string[]
): CardSelectSubType {
  const promptLower = prompt?.toLowerCase() ?? "";

  if (promptLower.includes("remove") || promptLower.includes("purge")) {
    return "card_removal";
  }

  if (promptLower.includes("upgrade") || promptLower.includes("smith") || promptLower.includes("enhance")) {
    return "card_upgrade";
  }

  // Detect if cards are from the player's deck (buff/enchant/transform)
  // vs new cards being offered (reward). If most offered cards are already
  // in the deck, this is a "pick from your deck" screen.
  const deckSet = new Set(deckCardNames.map((n) => n.toLowerCase()));
  const fromDeckCount = offeredCards.filter((c) => deckSet.has(c.name.toLowerCase())).length;
  const isFromDeck = offeredCards.length > 0 && fromDeckCount / offeredCards.length > 0.5;

  if (isFromDeck) {
    return "card_select";
  }

  // New cards being offered — treat like card_reward
  return "card_reward";
}
