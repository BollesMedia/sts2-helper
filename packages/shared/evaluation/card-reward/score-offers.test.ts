import { describe, it, expect } from "vitest";
import { scoreCardOffers } from "./score-offers";
import type { DeckState } from "./deck-state";
import type { TaggedOffer } from "./format-card-facts";
import type { CommunityTierSignal } from "../community-tier";

function deckState(overrides: Partial<DeckState> = {}): DeckState {
  return {
    size: 12,
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

function offer(index: number, name: string, tagsOverrides: Partial<TaggedOffer["tags"]> = {}): TaggedOffer {
  return {
    index,
    name,
    rarity: "common",
    type: "Attack",
    cost: 1,
    description: "",
    tags: {
      role: "damage",
      keystoneFor: null,
      fitsArchetypes: [],
      deadWithCurrentDeck: false,
      duplicatePenalty: false,
      upgradeLevel: 0,
      ...tagsOverrides,
    },
  };
}

function tier(letter: "S" | "A" | "B" | "C" | "D" | "F"): CommunityTierSignal {
  const values = { S: 6, A: 5, B: 4, C: 3, D: 2, F: 1 } as const;
  return {
    consensusTier: values[letter],
    consensusTierLetter: letter,
    sourceCount: 3,
    stddev: 0.3,
    agreement: "strong",
    staleness: "fresh",
    mostRecentPublished: null,
  };
}

describe("scoreCardOffers", () => {
  it("returns offers sorted by tier desc with stable order on ties", () => {
    const offers = [offer(1, "low"), offer(2, "mid"), offer(3, "also_mid")];
    const result = scoreCardOffers({
      offers,
      deckState: deckState(),
      communityTierById: new Map([
        ["1", tier("D")],
        ["2", tier("B")],
        ["3", tier("B")],
      ]),
      winRatesById: new Map(),
      itemIdsByIndex: new Map([[1, "1"], [2, "2"], [3, "3"]]),
    });
    expect(result.offers.map((o) => o.itemName)).toEqual(["mid", "also_mid", "low"]);
    expect(result.offers.map((o) => o.rank)).toEqual([1, 2, 3]);
  });

  it("builds reasoning string with tier + top reason", () => {
    const result = scoreCardOffers({
      offers: [offer(1, "scaler", { role: "scaling", keystoneFor: "exhaust", fitsArchetypes: ["exhaust"] })],
      deckState: deckState({
        archetypes: { viable: [{ name: "exhaust", supportCount: 3, hasKeystone: false }], committed: "exhaust", orphaned: [] },
        engine: { hasScaling: false, hasBlockPayoff: false, hasRemovalMomentum: 0, hasDrawPower: false },
      }),
      communityTierById: new Map([["1", tier("B")]]),
      winRatesById: new Map(),
      itemIdsByIndex: new Map([[1, "1"]]),
    });
    expect(result.offers[0].reasoning).toMatch(/S-tier · keystone for exhaust/);
  });

  it("recommends skip in Act 1 when no offer clears B-tier", () => {
    const result = scoreCardOffers({
      offers: [offer(1, "weak"), offer(2, "also_weak")],
      deckState: deckState({ act: 1 }),
      communityTierById: new Map([
        ["1", tier("C")],
        ["2", tier("D")],
      ]),
      winRatesById: new Map(),
      itemIdsByIndex: new Map([[1, "1"], [2, "2"]]),
    });
    expect(result.skipRecommended).toBe(true);
    expect(result.skipReason).toContain("Act 1");
  });

  it("does not recommend skip when at least one offer clears the threshold", () => {
    const result = scoreCardOffers({
      offers: [offer(1, "solid")],
      deckState: deckState({ act: 1 }),
      communityTierById: new Map([["1", tier("B")]]),
      winRatesById: new Map(),
      itemIdsByIndex: new Map([[1, "1"]]),
    });
    expect(result.skipRecommended).toBe(false);
  });

  it("handles an empty offer list without crashing", () => {
    const result = scoreCardOffers({
      offers: [],
      deckState: deckState(),
      communityTierById: new Map(),
      winRatesById: new Map(),
      itemIdsByIndex: new Map(),
    });
    expect(result.offers).toEqual([]);
    expect(result.topOffer).toBeNull();
    expect(result.skipRecommended).toBe(false);
  });

  it("exposes breakdown per offer for telemetry", () => {
    const result = scoreCardOffers({
      offers: [offer(1, "card")],
      deckState: deckState(),
      communityTierById: new Map([["1", tier("C")]]),
      winRatesById: new Map(),
      itemIdsByIndex: new Map([[1, "1"]]),
    });
    expect(result.offers[0].breakdown).toBeDefined();
    expect(result.offers[0].breakdown.baseTier).toBe("C");
  });
});
