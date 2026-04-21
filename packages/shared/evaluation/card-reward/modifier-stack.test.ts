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

describe("computeModifiers — archetype fit", () => {
  it("adds +2 and marks keystone for the committed archetype", () => {
    const result = computeModifiers({
      offer: offer({
        tags: { role: "scaling", keystoneFor: "exhaust", fitsArchetypes: ["exhaust"], deadWithCurrentDeck: false, duplicatePenalty: false, upgradeLevel: 0 },
      }),
      deckState: emptyDeckState({
        archetypes: { viable: [{ name: "exhaust", supportCount: 3, hasKeystone: false }], committed: "exhaust", orphaned: [] },
      }),
      communityTier: null,
      winRate: null,
    });
    const mod = result.modifiers.find((m) => m.kind === "archetypeFit");
    expect(mod?.delta).toBe(2);
    expect(mod?.reason).toContain("exhaust");
  });

  it("adds +1 for on-archetype fit without keystone", () => {
    const result = computeModifiers({
      offer: offer({
        tags: { role: "damage", keystoneFor: null, fitsArchetypes: ["exhaust"], deadWithCurrentDeck: false, duplicatePenalty: false, upgradeLevel: 0 },
      }),
      deckState: emptyDeckState({
        archetypes: { viable: [{ name: "exhaust", supportCount: 3, hasKeystone: true }], committed: "exhaust", orphaned: [] },
      }),
      communityTier: null,
      winRate: null,
    });
    const mod = result.modifiers.find((m) => m.kind === "archetypeFit");
    expect(mod?.delta).toBe(1);
  });

  it("subtracts 1 for off-archetype when deck is committed", () => {
    const result = computeModifiers({
      offer: offer({
        tags: { role: "damage", keystoneFor: null, fitsArchetypes: ["poison"], deadWithCurrentDeck: false, duplicatePenalty: false, upgradeLevel: 0 },
      }),
      deckState: emptyDeckState({
        archetypes: { viable: [{ name: "exhaust", supportCount: 3, hasKeystone: true }], committed: "exhaust", orphaned: [] },
      }),
      communityTier: null,
      winRate: null,
    });
    const mod = result.modifiers.find((m) => m.kind === "archetypeFit");
    expect(mod?.delta).toBe(-1);
  });

  it("does not penalize off-archetype when deck is uncommitted", () => {
    const result = computeModifiers({
      offer: offer({
        tags: { role: "damage", keystoneFor: null, fitsArchetypes: ["poison"], deadWithCurrentDeck: false, duplicatePenalty: false, upgradeLevel: 0 },
      }),
      deckState: emptyDeckState(),
      communityTier: null,
      winRate: null,
    });
    const mod = result.modifiers.find((m) => m.kind === "archetypeFit");
    expect(mod).toBeUndefined();
  });

  it("adds +2 keystone bonus when deck is uncommitted and offer unlocks a viable archetype", () => {
    const result = computeModifiers({
      offer: offer({
        tags: { role: "scaling", keystoneFor: "poison", fitsArchetypes: ["poison"], deadWithCurrentDeck: false, duplicatePenalty: false, upgradeLevel: 0 },
      }),
      deckState: emptyDeckState({
        archetypes: { viable: [{ name: "poison", supportCount: 2, hasKeystone: false }], committed: null, orphaned: [] },
      }),
      communityTier: null,
      winRate: null,
    });
    const mod = result.modifiers.find((m) => m.kind === "archetypeFit");
    expect(mod?.delta).toBe(2);
    expect(mod?.reason.toLowerCase()).toContain("poison");
  });
});

describe("computeModifiers — duplicate", () => {
  it("subtracts 1 when duplicatePenalty is set", () => {
    const result = computeModifiers({
      offer: offer({
        tags: { role: "damage", keystoneFor: null, fitsArchetypes: [], deadWithCurrentDeck: false, duplicatePenalty: true, upgradeLevel: 0 },
      }),
      deckState: emptyDeckState(),
      communityTier: null,
      winRate: null,
    });
    const mod = result.modifiers.find((m) => m.kind === "duplicate");
    expect(mod?.delta).toBe(-1);
  });

  it("does not fire when duplicatePenalty is false", () => {
    const result = computeModifiers({
      offer: offer(),
      deckState: emptyDeckState(),
      communityTier: null,
      winRate: null,
    });
    const mod = result.modifiers.find((m) => m.kind === "duplicate");
    expect(mod).toBeUndefined();
  });
});

describe("computeModifiers — deck gap", () => {
  it("adds +1 for block role when deck lacks block payoff", () => {
    const result = computeModifiers({
      offer: offer({
        tags: { role: "block", keystoneFor: null, fitsArchetypes: [], deadWithCurrentDeck: false, duplicatePenalty: false, upgradeLevel: 0 },
      }),
      deckState: emptyDeckState({
        engine: { hasScaling: false, hasBlockPayoff: false, hasRemovalMomentum: 0, hasDrawPower: false },
      }),
      communityTier: null,
      winRate: null,
    });
    const mod = result.modifiers.find((m) => m.kind === "deckGap");
    expect(mod?.delta).toBe(1);
    expect(mod?.reason.toLowerCase()).toContain("block");
  });

  it("does not fire when the gap is already covered", () => {
    const result = computeModifiers({
      offer: offer({
        tags: { role: "block", keystoneFor: null, fitsArchetypes: [], deadWithCurrentDeck: false, duplicatePenalty: false, upgradeLevel: 0 },
      }),
      deckState: emptyDeckState({
        engine: { hasScaling: false, hasBlockPayoff: true, hasRemovalMomentum: 0, hasDrawPower: false },
      }),
      communityTier: null,
      winRate: null,
    });
    const mod = result.modifiers.find((m) => m.kind === "deckGap");
    expect(mod).toBeUndefined();
  });

  it("adds +1 for scaling role when deck lacks scaling", () => {
    const result = computeModifiers({
      offer: offer({
        tags: { role: "scaling", keystoneFor: null, fitsArchetypes: [], deadWithCurrentDeck: false, duplicatePenalty: false, upgradeLevel: 0 },
      }),
      deckState: emptyDeckState({
        engine: { hasScaling: false, hasBlockPayoff: false, hasRemovalMomentum: 0, hasDrawPower: false },
      }),
      communityTier: null,
      winRate: null,
    });
    const mod = result.modifiers.find((m) => m.kind === "deckGap");
    expect(mod?.delta).toBe(1);
  });
});
