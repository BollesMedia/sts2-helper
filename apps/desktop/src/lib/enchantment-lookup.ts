/**
 * STS2 enchantment descriptions.
 * Source: Spire Codex API /enchantments
 * Used to enrich ancient event option descriptions.
 */

const ENCHANTMENTS: Record<string, string> = {
  "adroit": "Gain X Block.",
  "clone": "This card can be duplicated at Rest Sites.",
  "corrupted": "Deal 50% more damage, but lose 2 HP.",
  "favored": "This card's attack damage is doubled.",
  "glam": "This card has Replay once per combat.",
  "goopy": "This card gains Exhaust. When played, permanently increase this card's Block by 1.",
  "imbued": "This card is played automatically at the start of each combat.",
  "instinct": "Decrease the cost of this card by 1.",
  "momentum": "Increase this card's attack damage by X this combat when played.",
  "nimble": "Increases Block gained from this card by X.",
  "perfect fit": "Whenever this would be shuffled into your Draw Pile, place it on the top instead.",
  "royally approved": "This card has Innate and Retain.",
  "sharp": "Increases damage on this card by X.",
  "slither": "When you draw this card, randomize its cost from 0 to 3.",
  "slumbering essence": "If this card is in your hand at the end of turn, reduce its cost by 1 until it is played.",
  "soul's power": "This card loses Exhaust.",
  "sown": "The first time you play this card each combat, gain X energy.",
  "spiral": "This card gains Replay 1.",
  "steady": "This card gains Retain.",
  "swift": "The first time you play this card, draw X cards.",
  "tezcatara's ember": "Costs 0 and gains Eternal (cannot be removed or transformed).",
  "vigorous": "The first time this card is played, it deals X additional damage.",
};

/**
 * Look up an enchantment description by name.
 * Matches against known STS2 enchantments (case-insensitive, fuzzy).
 */
export function getEnchantmentDescription(text: string): string | null {
  const lower = text.toLowerCase();

  // Direct match
  const direct = ENCHANTMENTS[lower];
  if (direct) return direct;

  // Check if text contains an enchantment name
  for (const [name, desc] of Object.entries(ENCHANTMENTS)) {
    if (lower.includes(name)) return `${name}: ${desc}`;
  }

  return null;
}
