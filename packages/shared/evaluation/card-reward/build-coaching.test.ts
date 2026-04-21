import { describe, it, expect } from "vitest";
import { buildCoaching } from "./build-coaching";
import type { ScoredOffer, ScoreOffersResult } from "./score-offers";
import type { ModifierBreakdown } from "./modifier-stack";

function breakdown(
  baseTier: ModifierBreakdown["baseTier"],
  adjustedTier: ModifierBreakdown["adjustedTier"],
  tierValue: number,
  topReason: string,
  modifiers: ModifierBreakdown["modifiers"] = [],
): ModifierBreakdown {
  return { baseTier, modifiers, adjustedTier, tierValue, topReason };
}

function scoredOffer(overrides: Partial<ScoredOffer>): ScoredOffer {
  return {
    itemId: "1",
    itemName: "Card",
    itemIndex: 1,
    rank: 1,
    tier: "B",
    tierValue: 4,
    reasoning: "B-tier · test",
    breakdown: breakdown("B", "B", 4, "test"),
    ...overrides,
  };
}

describe("buildCoaching", () => {
  it("produces a pick headline when skipRecommended is false", () => {
    const top = scoredOffer({
      itemName: "Inflame",
      breakdown: breakdown("A", "S", 6, "keystone for strength", [
        { kind: "keystoneOverride", delta: 2, reason: "keystone for strength" },
      ]),
    });
    const result: ScoreOffersResult = {
      offers: [top],
      skipRecommended: false,
      skipReason: null,
      topOffer: top,
    };
    const coach = buildCoaching(result, { act: 1, floor: 3, deckSize: 12, committed: "strength" });
    expect(coach.headline).toBe("Pick Inflame — keystone for strength");
  });

  it("produces a skip headline when skipRecommended is true", () => {
    const result: ScoreOffersResult = {
      offers: [scoredOffer({ tier: "C", tierValue: 3 })],
      skipRecommended: true,
      skipReason: "Act 1: no offer cleared the B-tier threshold",
      topOffer: null,
    };
    const coach = buildCoaching(result, { act: 1, floor: 3, deckSize: 12, committed: null });
    expect(coach.headline.toLowerCase()).toContain("skip all");
    expect(coach.headline).toContain("Act 1");
  });

  it("produces a teaching callout per active modifier on the top offer", () => {
    const top = scoredOffer({
      breakdown: breakdown("B", "A", 5, "keystone for strength", [
        { kind: "keystoneOverride", delta: 2, reason: "keystone for strength" },
        { kind: "deckGap", delta: 1, reason: "fills scaling gap" },
      ]),
    });
    const result: ScoreOffersResult = {
      offers: [top],
      skipRecommended: false,
      skipReason: null,
      topOffer: top,
    };
    const coach = buildCoaching(result, { act: 1, floor: 3, deckSize: 12, committed: "strength" });
    const patterns = coach.teachingCallouts.map((c) => c.pattern);
    expect(patterns).toContain("keystoneOverride");
    expect(patterns).toContain("deckGap");
  });

  it("produces key tradeoffs comparing top offer vs runner-up", () => {
    const top = scoredOffer({
      itemIndex: 1,
      breakdown: breakdown("B", "A", 5, "keystone for strength", [
        { kind: "keystoneOverride", delta: 2, reason: "keystone for strength" },
      ]),
    });
    const runnerUp = scoredOffer({
      itemId: "2",
      itemIndex: 2,
      itemName: "Defend",
      rank: 2,
      tier: "C",
      tierValue: 3,
      breakdown: breakdown("C", "C", 3, "base tier", []),
    });
    const result: ScoreOffersResult = {
      offers: [top, runnerUp],
      skipRecommended: false,
      skipReason: null,
      topOffer: top,
    };
    const coach = buildCoaching(result, { act: 1, floor: 3, deckSize: 12, committed: "strength" });
    expect(coach.keyTradeoffs.length).toBeGreaterThan(0);
    expect(coach.keyTradeoffs[0].position).toBe(2);
  });

  it("returns empty tradeoffs + callouts when the top offer has no active modifiers", () => {
    const top = scoredOffer({
      breakdown: breakdown("C", "C", 3, "base tier", []),
    });
    const result: ScoreOffersResult = {
      offers: [top],
      skipRecommended: false,
      skipReason: null,
      topOffer: top,
    };
    const coach = buildCoaching(result, { act: 1, floor: 3, deckSize: 12, committed: null });
    expect(coach.teachingCallouts).toEqual([]);
    expect(coach.keyTradeoffs).toEqual([]);
  });

  it("sets confidence from the top offer's tier", () => {
    const makeTop = (tier: "S" | "A" | "B" | "C" | "D" | "F", tv: number) =>
      scoredOffer({ tier, tierValue: tv, breakdown: breakdown("C", tier, tv, "test") });
    const ctx = { act: 1 as const, floor: 3, deckSize: 12, committed: null };
    const s = buildCoaching({ offers: [makeTop("S", 6)], skipRecommended: false, skipReason: null, topOffer: makeTop("S", 6) }, ctx);
    const c = buildCoaching({ offers: [makeTop("C", 3)], skipRecommended: false, skipReason: null, topOffer: makeTop("C", 3) }, ctx);
    expect(s.confidence).toBe(0.95);
    expect(c.confidence).toBe(0.65);
  });
});
