import { describe, it, expect } from "vitest";
import {
  computeModifiers,
  MODIFIER_DELTAS,
  WIN_RATE_MIN_N,
  WIN_RATE_DELTA_THRESHOLD,
} from "./modifier-stack";
import type { DeckState } from "./deck-state";
import type { TaggedOffer } from "./format-card-facts";

function emptyDeckState(overrides: Partial<DeckState> = {}): DeckState {
  return {
    size: 10,
    act: 1,
    floor: 3,
    ascension: 10,
    composition: { strikes: 4, defends: 4, deadCards: 8, upgraded: 0, upgradeRatio: 0 },
    sizeVerdict: "too_thin",
    archetypes: { viable: [], committed: null, orphaned: [] },
    engine: { hasScaling: false, hasBlockPayoff: false, hasRemovalMomentum: 0, hasDrawPower: false },
    hp: { current: 70, max: 80, ratio: 0.875 },
    upcoming: { nextNodeType: null, bossesPossible: [], dangerousMatchups: [] },
    ...overrides,
  };
}

function offer(overrides: Partial<TaggedOffer> = {}): TaggedOffer {
  return {
    index: 1,
    name: "Test Card",
    rarity: "common",
    type: "Attack",
    cost: 1,
    description: "Deal 8 damage.",
    tags: {
      role: "damage",
      keystoneFor: null,
      fitsArchetypes: [],
      deadWithCurrentDeck: false,
      duplicatePenalty: false,
      upgradeLevel: 0,
    },
    ...overrides,
  };
}

describe("modifier-stack constants", () => {
  it("exports the documented modifier deltas", () => {
    expect(MODIFIER_DELTAS.archetypeFitOn).toBe(1);
    expect(MODIFIER_DELTAS.archetypeFitOff).toBe(-1);
    expect(MODIFIER_DELTAS.archetypeFitKeystone).toBe(2);
    expect(MODIFIER_DELTAS.deckGapFilled).toBe(1);
    expect(MODIFIER_DELTAS.duplicateNonCore).toBe(-1);
    expect(MODIFIER_DELTAS.winRatePickStrong).toBe(1);
    expect(MODIFIER_DELTAS.winRateSkipStrong).toBe(-1);
    expect(MODIFIER_DELTAS.actThreeOffArchetype).toBe(-1);
  });

  it("exports win-rate thresholds", () => {
    expect(WIN_RATE_MIN_N).toBe(20);
    expect(WIN_RATE_DELTA_THRESHOLD).toBe(0.15);
  });
});

describe("computeModifiers — smoke", () => {
  it("returns a breakdown with base tier C when no community tier signal is provided", () => {
    const result = computeModifiers({
      offer: offer(),
      deckState: emptyDeckState(),
      communityTier: null,
      winRate: null,
    });
    expect(result.baseTier).toBe("C");
    expect(result.adjustedTier).toBeDefined();
    expect(Array.isArray(result.modifiers)).toBe(true);
  });
});
