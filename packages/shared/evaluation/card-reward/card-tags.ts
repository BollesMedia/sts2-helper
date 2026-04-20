import type { CombatCard } from "../../types/game-state";
import type { DeckState } from "./deck-state";
import cardRolesData from "./card-roles.json";

interface CardRoleEntry {
  name: string;
  character: string;
  role: "damage" | "block" | "scaling" | "draw" | "removal" | "utility" | "power_payoff" | "unknown";
  keystoneFor: string | null;
  fitsArchetypes: string[];
  maxCopies: number;
}

const CARD_ROLES: Record<string, CardRoleEntry> =
  (cardRolesData as { cards: Record<string, CardRoleEntry> }).cards;

export type CardRole = CardRoleEntry["role"];

export interface CardTags {
  role: CardRole;
  keystoneFor: string | null;
  fitsArchetypes: string[];
  deadWithCurrentDeck: boolean;
  duplicatePenalty: boolean;
  upgradeLevel: 0 | 1;
}

function baseName(name: string): string {
  return name.replace(/\+$/, "").toLowerCase();
}

function isUpgraded(name: string): boolean {
  return /\+$/.test(name);
}

const SCALING_SOURCES = [
  "inflame", "demon form", "rupture", "limit break",
  "noxious fumes", "envenom",
  "biased cognition", "creative ai",
];

function hasScalingSourceIn(names: string[]): boolean {
  return names.some((n) => SCALING_SOURCES.includes(baseName(n)));
}

export function tagCard(
  card: Pick<CombatCard, "name">,
  deckState: DeckState,
  siblings: Pick<CombatCard, "name">[] = [],
  deckCards: Pick<CombatCard, "name">[] = [],
): CardTags {
  const key = baseName(card.name);
  const entry = CARD_ROLES[key];

  const role: CardRole = entry?.role ?? "unknown";
  const keystoneFor = entry?.keystoneFor ?? null;
  const fitsArchetypes = entry?.fitsArchetypes ?? [];
  const maxCopies = entry?.maxCopies ?? 2;
  const upgradeLevel: 0 | 1 = isUpgraded(card.name) ? 1 : 0;

  // deadWithCurrentDeck — tight scoping per spec.
  let deadWithCurrentDeck = false;

  const isScaling = role === "scaling";

  if (isScaling) {
    // Dead only when committed to a different archetype the scaling doesn't fit.
    // Uncommitted decks: never dead (scaling is the pick that unlocks an archetype).
    if (
      deckState.archetypes.committed &&
      !fitsArchetypes.includes(deckState.archetypes.committed)
    ) {
      deadWithCurrentDeck = true;
    }
  } else if (role === "power_payoff") {
    // Dead when no scaling in deck AND no scaling sibling AND no scaling in deckCards.
    const siblingNames = siblings.map((s) => s.name);
    const deckNames = deckCards.map((d) => d.name);
    const scalingAvailable =
      deckState.engine.hasScaling ||
      hasScalingSourceIn(siblingNames) ||
      hasScalingSourceIn(deckNames);
    if (!scalingAvailable) {
      deadWithCurrentDeck = true;
    }
  }

  // duplicatePenalty — deck already has >= maxCopies.
  const existingCount = deckCards.filter((d) => baseName(d.name) === key).length;
  const duplicatePenalty = existingCount >= maxCopies;

  return {
    role,
    keystoneFor,
    fitsArchetypes,
    deadWithCurrentDeck,
    duplicatePenalty,
    upgradeLevel,
  };
}
