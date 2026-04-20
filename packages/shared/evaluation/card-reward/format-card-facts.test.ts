import { describe, it, expect } from "vitest";
import { formatCardFacts } from "./format-card-facts";
import type { DeckState } from "./deck-state";
import type { CardTags } from "./card-tags";

const baseState: DeckState = {
  size: 14,
  act: 1,
  floor: 8,
  ascension: 10,
  composition: { strikes: 4, defends: 3, deadCards: 7, upgraded: 4, upgradeRatio: 0.29 },
  sizeVerdict: "healthy",
  archetypes: {
    viable: [
      { name: "strength", supportCount: 3, hasKeystone: false },
      { name: "block", supportCount: 2, hasKeystone: false },
    ],
    committed: null,
    orphaned: [],
  },
  engine: {
    hasScaling: false,
    hasBlockPayoff: false,
    hasRemovalMomentum: 0,
    hasDrawPower: false,
  },
  hp: { current: 62, max: 80, ratio: 0.775 },
  upcoming: {
    nextNodeType: "rest",
    bossesPossible: ["Guardian", "Ghost Operator"],
    dangerousMatchups: ["Ghost Operator"],
  },
};

interface TaggedOffer {
  index: number;
  name: string;
  rarity: string;
  type: string;
  cost: number | null;
  description: string;
  tags: CardTags;
}

const offers: TaggedOffer[] = [
  {
    index: 1,
    name: "Heavy Blade",
    rarity: "Common",
    type: "Attack",
    cost: 2,
    description: "Deal 14 damage. Deal 3 additional damage for each Strength.",
    tags: {
      role: "power_payoff",
      keystoneFor: null,
      fitsArchetypes: ["strength"],
      deadWithCurrentDeck: false,
      duplicatePenalty: false,
      upgradeLevel: 0,
    },
  },
  {
    index: 2,
    name: "Inflame",
    rarity: "Uncommon",
    type: "Power",
    cost: 1,
    description: "Gain 2 Strength.",
    tags: {
      role: "scaling",
      keystoneFor: "strength",
      fitsArchetypes: ["strength"],
      deadWithCurrentDeck: false,
      duplicatePenalty: false,
      upgradeLevel: 0,
    },
  },
];

describe("formatCardFacts", () => {
  it("renders DECK STATE + OFFERED CARDS sections", () => {
    const out = formatCardFacts(baseState, offers);
    expect(out).toContain("=== DECK STATE ===");
    expect(out).toContain("Deck: 14 cards");
    expect(out).toContain("Size verdict: HEALTHY");
    expect(out).toContain("Archetypes viable:");
    expect(out).toContain("- strength (support: 3, keystone: NO)");
    expect(out).toContain("Committed archetype: none yet");
    expect(out).toContain("Engine status:");
    expect(out).toContain("Upcoming: next node = rest");
    expect(out).toContain("Dangerous matchups (from history): Ghost Operator");
    expect(out).toContain("=== OFFERED CARDS ===");
    expect(out).toContain("1. Heavy Blade");
    expect(out).toContain("Tags: role=power_payoff");
    expect(out).toContain("2. Inflame");
    expect(out).toContain("keystone_for=strength");
  });

  it("reports 'none' for empty archetype state", () => {
    const emptyState: DeckState = {
      ...baseState,
      archetypes: { viable: [], committed: null, orphaned: [] },
    };
    const out = formatCardFacts(emptyState, offers);
    expect(out).toContain("Archetypes viable: none");
    expect(out).toContain("Committed archetype: none yet");
    expect(out).toContain("Orphaned support: none");
  });

  it("handles null upcoming gracefully", () => {
    const state: DeckState = {
      ...baseState,
      upcoming: {
        nextNodeType: null,
        bossesPossible: [],
        dangerousMatchups: [],
      },
    };
    const out = formatCardFacts(state, offers);
    expect(out).toContain("Upcoming: next node = unknown");
    expect(out).not.toContain("Dangerous matchups (from history):");
  });
});
