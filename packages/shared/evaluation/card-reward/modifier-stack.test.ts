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
    expect(MODIFIER_DELTAS.deadCard).toBe(-2);
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
    const mod = result.modifiers.find((m) => m.kind === "keystoneOverride");
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
    const mod = result.modifiers.find((m) => m.kind === "keystoneOverride");
    expect(mod?.delta).toBe(2);
    expect(mod?.reason.toLowerCase()).toContain("poison");
  });

  it("adds +1 for non-keystone offer that fits a viable archetype when uncommitted", () => {
    const result = computeModifiers({
      offer: offer({
        tags: { role: "damage", keystoneFor: null, fitsArchetypes: ["exhaust"], deadWithCurrentDeck: false, duplicatePenalty: false, upgradeLevel: 0 },
      }),
      deckState: emptyDeckState({
        archetypes: { viable: [{ name: "exhaust", supportCount: 2, hasKeystone: false }], committed: null, orphaned: [] },
      }),
      communityTier: null,
      winRate: null,
    });
    const mod = result.modifiers.find((m) => m.kind === "archetypeFit");
    expect(mod?.delta).toBe(1);
    expect(mod?.reason.toLowerCase()).toContain("exhaust");
    expect(mod?.reason.toLowerCase()).toContain("uncommitted");
  });

  it("does not fire the uncommitted-on-archetype branch when no viable archetype matches", () => {
    const result = computeModifiers({
      offer: offer({
        tags: { role: "damage", keystoneFor: null, fitsArchetypes: ["poison"], deadWithCurrentDeck: false, duplicatePenalty: false, upgradeLevel: 0 },
      }),
      deckState: emptyDeckState({
        archetypes: { viable: [{ name: "exhaust", supportCount: 2, hasKeystone: false }], committed: null, orphaned: [] },
      }),
      communityTier: null,
      winRate: null,
    });
    const mod = result.modifiers.find((m) => m.kind === "archetypeFit");
    expect(mod).toBeUndefined();
  });
});

describe("computeModifiers — dead card", () => {
  it("subtracts 2 when deadWithCurrentDeck is set", () => {
    const result = computeModifiers({
      offer: offer({
        tags: {
          role: "scaling",
          keystoneFor: null,
          fitsArchetypes: ["strength"],
          deadWithCurrentDeck: true,
          duplicatePenalty: false,
          upgradeLevel: 0,
        },
      }),
      deckState: emptyDeckState(),
      communityTier: null,
      winRate: null,
    });
    const mod = result.modifiers.find((m) => m.kind === "deadCard");
    expect(mod?.delta).toBe(-2);
  });

  it("does not fire when deadWithCurrentDeck is false", () => {
    const result = computeModifiers({
      offer: offer(),
      deckState: emptyDeckState(),
      communityTier: null,
      winRate: null,
    });
    const mod = result.modifiers.find((m) => m.kind === "deadCard");
    expect(mod).toBeUndefined();
  });

  it("tiers a dead scaling card below a neutral off-archetype card at the same base tier", () => {
    const baseTier = {
      consensusTier: 4,
      consensusTierLetter: "B" as const,
      sourceCount: 5,
      stddev: 0.3,
      agreement: "strong" as const,
      staleness: "fresh" as const,
      mostRecentPublished: null,
    };
    const committedDeck = emptyDeckState({
      archetypes: { viable: [], committed: "exhaust", orphaned: [] },
    });

    // Dead scaling card off-archetype: -1 (off-archetype committed) + -2 (deadCard) = -3 → B (4) → F (1)
    const dead = computeModifiers({
      offer: offer({
        tags: {
          role: "scaling",
          keystoneFor: null,
          fitsArchetypes: [],
          deadWithCurrentDeck: true,
          duplicatePenalty: false,
          upgradeLevel: 0,
        },
      }),
      deckState: committedDeck,
      communityTier: baseTier,
      winRate: null,
    });

    // Neutral off-archetype card: -1 (off-archetype committed) → B (4) → C (3)
    const neutral = computeModifiers({
      offer: offer({
        tags: {
          role: "damage",
          keystoneFor: null,
          fitsArchetypes: [],
          deadWithCurrentDeck: false,
          duplicatePenalty: false,
          upgradeLevel: 0,
        },
      }),
      deckState: committedDeck,
      communityTier: baseTier,
      winRate: null,
    });

    expect(dead.tierValue).toBeLessThan(neutral.tierValue);
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

describe("computeModifiers — win rate", () => {
  it("adds +1 when pick WR beats skip WR by >15% with n>=20", () => {
    const result = computeModifiers({
      offer: offer(),
      deckState: emptyDeckState(),
      communityTier: null,
      winRate: { pickWinRate: 0.55, skipWinRate: 0.35, timesPicked: 30, timesSkipped: 40 },
    });
    const mod = result.modifiers.find((m) => m.kind === "winRateDelta");
    expect(mod?.delta).toBe(1);
  });

  it("subtracts 1 when skip WR beats pick WR by >15% with n>=20", () => {
    const result = computeModifiers({
      offer: offer(),
      deckState: emptyDeckState(),
      communityTier: null,
      winRate: { pickWinRate: 0.30, skipWinRate: 0.55, timesPicked: 40, timesSkipped: 30 },
    });
    const mod = result.modifiers.find((m) => m.kind === "winRateDelta");
    expect(mod?.delta).toBe(-1);
  });

  it("does not fire when sample size is below the threshold", () => {
    const result = computeModifiers({
      offer: offer(),
      deckState: emptyDeckState(),
      communityTier: null,
      winRate: { pickWinRate: 0.60, skipWinRate: 0.30, timesPicked: 10, timesSkipped: 20 },
    });
    const mod = result.modifiers.find((m) => m.kind === "winRateDelta");
    expect(mod).toBeUndefined();
  });

  it("does not fire when the delta is below 15%", () => {
    const result = computeModifiers({
      offer: offer(),
      deckState: emptyDeckState(),
      communityTier: null,
      winRate: { pickWinRate: 0.50, skipWinRate: 0.42, timesPicked: 30, timesSkipped: 30 },
    });
    const mod = result.modifiers.find((m) => m.kind === "winRateDelta");
    expect(mod).toBeUndefined();
  });
});

describe("computeModifiers — act timing", () => {
  it("subtracts 1 for off-archetype picks in Act 3", () => {
    const result = computeModifiers({
      offer: offer({
        tags: { role: "damage", keystoneFor: null, fitsArchetypes: ["poison"], deadWithCurrentDeck: false, duplicatePenalty: false, upgradeLevel: 0 },
      }),
      deckState: emptyDeckState({
        act: 3,
        archetypes: { viable: [{ name: "exhaust", supportCount: 4, hasKeystone: true }], committed: "exhaust", orphaned: [] },
      }),
      communityTier: null,
      winRate: null,
    });
    const mod = result.modifiers.find((m) => m.kind === "actTiming");
    expect(mod?.delta).toBe(-1);
  });

  it("does not fire when the offer fits the committed archetype", () => {
    const result = computeModifiers({
      offer: offer({
        tags: { role: "damage", keystoneFor: null, fitsArchetypes: ["exhaust"], deadWithCurrentDeck: false, duplicatePenalty: false, upgradeLevel: 0 },
      }),
      deckState: emptyDeckState({
        act: 3,
        archetypes: { viable: [{ name: "exhaust", supportCount: 4, hasKeystone: true }], committed: "exhaust", orphaned: [] },
      }),
      communityTier: null,
      winRate: null,
    });
    const mod = result.modifiers.find((m) => m.kind === "actTiming");
    expect(mod).toBeUndefined();
  });

  it("does not fire outside Act 3", () => {
    const result = computeModifiers({
      offer: offer({
        tags: { role: "damage", keystoneFor: null, fitsArchetypes: ["poison"], deadWithCurrentDeck: false, duplicatePenalty: false, upgradeLevel: 0 },
      }),
      deckState: emptyDeckState({
        act: 2,
        archetypes: { viable: [{ name: "exhaust", supportCount: 4, hasKeystone: true }], committed: "exhaust", orphaned: [] },
      }),
      communityTier: null,
      winRate: null,
    });
    const mod = result.modifiers.find((m) => m.kind === "actTiming");
    expect(mod).toBeUndefined();
  });
});

describe("computeModifiers — composition", () => {
  it("stacks archetype + gap + win-rate deltas", () => {
    const result = computeModifiers({
      offer: offer({
        tags: { role: "scaling", keystoneFor: "exhaust", fitsArchetypes: ["exhaust"], deadWithCurrentDeck: false, duplicatePenalty: false, upgradeLevel: 0 },
      }),
      deckState: emptyDeckState({
        archetypes: { viable: [{ name: "exhaust", supportCount: 3, hasKeystone: false }], committed: "exhaust", orphaned: [] },
        engine: { hasScaling: false, hasBlockPayoff: false, hasRemovalMomentum: 0, hasDrawPower: false },
      }),
      communityTier: { consensusTier: 4, consensusTierLetter: "B", sourceCount: 3, stddev: 0.3, agreement: "strong", staleness: "fresh", mostRecentPublished: null },
      winRate: { pickWinRate: 0.60, skipWinRate: 0.30, timesPicked: 30, timesSkipped: 20 },
    });
    // B(4) + archetype keystone(+2) + deck gap scaling(+1) + win rate(+1) = 8 → clamped to S(6).
    expect(result.adjustedTier).toBe("S");
    expect(result.modifiers.map((m) => m.kind).sort()).toEqual(["deckGap", "keystoneOverride", "winRateDelta"]);
  });

  it("clamps to F when combined negative modifiers would go below 1", () => {
    const result = computeModifiers({
      offer: offer({
        tags: { role: "damage", keystoneFor: null, fitsArchetypes: ["poison"], deadWithCurrentDeck: false, duplicatePenalty: true, upgradeLevel: 0 },
      }),
      deckState: emptyDeckState({
        act: 3,
        archetypes: { viable: [{ name: "exhaust", supportCount: 4, hasKeystone: true }], committed: "exhaust", orphaned: [] },
      }),
      communityTier: { consensusTier: 2, consensusTierLetter: "D", sourceCount: 3, stddev: 0.3, agreement: "strong", staleness: "fresh", mostRecentPublished: null },
      winRate: { pickWinRate: 0.20, skipWinRate: 0.55, timesPicked: 30, timesSkipped: 40 },
    });
    // D(2) + archetype off(-1) + duplicate(-1) + win rate(-1) + act 3(-1) = -2 → clamped to F(1).
    expect(result.adjustedTier).toBe("F");
  });
});
