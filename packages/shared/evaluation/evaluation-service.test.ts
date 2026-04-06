import { describe, it, expect } from "vitest";
import { toCardRewardEvaluation } from "./parse-tool-response";
import type { CardRewardEvalRaw } from "./eval-schemas";

describe("toCardRewardEvaluation", () => {
  const items = [
    { id: "OFFERING", name: "Offering" },
    { id: "STRIKE", name: "Strike" },
    { id: "DEFEND", name: "Defend" },
  ];

  it("maps a happy-path response into the canonical CardRewardEvaluation", () => {
    const parsed: CardRewardEvalRaw = {
      rankings: [
        { position: 1, tier: "S", confidence: 95, reasoning: "Best card" },
        { position: 2, tier: "B", confidence: 70, reasoning: "Filler" },
        { position: 3, tier: "C", confidence: 50, reasoning: "Mediocre" },
      ],
      skip_recommended: false,
      skip_reasoning: null,
    };

    const result = toCardRewardEvaluation(parsed, items);

    expect(result.rankings).toHaveLength(3);
    expect(result.rankings[0]).toMatchObject({
      itemId: "OFFERING",
      itemName: "Offering",
      itemIndex: 0,
      tier: "S",
      tierValue: 6,
      confidence: 95,
      reasoning: "Best card",
      recommendation: "strong_pick",
      source: "claude",
    });
    expect(result.skipRecommended).toBe(false);
    expect(result.skipReasoning).toBe(null);
    expect(result.spendingPlan).toBe(null);
  });

  it("derives recommendation from tier when missing (S/A → strong_pick, B → good_pick, C → situational, D/F → skip)", () => {
    const parsed: CardRewardEvalRaw = {
      rankings: [
        { position: 1, tier: "S", confidence: 90, reasoning: "x" },
        { position: 2, tier: "A", confidence: 80, reasoning: "x" },
        { position: 3, tier: "B", confidence: 70, reasoning: "x" },
      ],
      skip_recommended: false,
    };
    const result = toCardRewardEvaluation(parsed, items);
    expect(result.rankings.map((r) => r.recommendation)).toEqual([
      "strong_pick",
      "strong_pick",
      "good_pick",
    ]);
  });

  it("derives skip recommendation for D and F tiers", () => {
    const parsed: CardRewardEvalRaw = {
      rankings: [
        { position: 1, tier: "C", confidence: 50, reasoning: "x" },
        { position: 2, tier: "D", confidence: 30, reasoning: "x" },
        { position: 3, tier: "F", confidence: 10, reasoning: "x" },
      ],
      skip_recommended: false,
    };
    const result = toCardRewardEvaluation(parsed, items);
    expect(result.rankings.map((r) => r.recommendation)).toEqual([
      "situational",
      "skip",
      "skip",
    ]);
  });

  it("computes itemIndex from 1-indexed position", () => {
    const parsed: CardRewardEvalRaw = {
      rankings: [
        { position: 2, tier: "A", confidence: 80, reasoning: "x" },
        { position: 1, tier: "B", confidence: 70, reasoning: "x" },
        { position: 3, tier: "C", confidence: 50, reasoning: "x" },
      ],
      skip_recommended: false,
    };
    const result = toCardRewardEvaluation(parsed, items);
    // itemIndex matches the position - 1 lookup, not the array order
    expect(result.rankings[0].itemIndex).toBe(1);
    expect(result.rankings[0].itemId).toBe("STRIKE");
    expect(result.rankings[1].itemIndex).toBe(0);
    expect(result.rankings[1].itemId).toBe("OFFERING");
  });

  it("includes spending_plan for shop responses", () => {
    const parsed: CardRewardEvalRaw = {
      rankings: [
        { position: 1, tier: "B", confidence: 70, reasoning: "x" },
        { position: 2, tier: "C", confidence: 50, reasoning: "x" },
        { position: 3, tier: "D", confidence: 30, reasoning: "x" },
      ],
      skip_recommended: false,
      // The shop schema's spending_plan is optional/nullish
      spending_plan: "Buy card removal (75g)",
    } as CardRewardEvalRaw;
    const result = toCardRewardEvaluation(parsed, items);
    expect(result.spendingPlan).toBe("Buy card removal (75g)");
  });

  it("propagates skipReasoning when present", () => {
    const parsed: CardRewardEvalRaw = {
      rankings: [
        { position: 1, tier: "F", confidence: 20, reasoning: "x" },
        { position: 2, tier: "F", confidence: 20, reasoning: "x" },
        { position: 3, tier: "F", confidence: 20, reasoning: "x" },
      ],
      skip_recommended: true,
      skip_reasoning: "All cards are bad",
    };
    const result = toCardRewardEvaluation(parsed, items);
    expect(result.skipRecommended).toBe(true);
    expect(result.skipReasoning).toBe("All cards are bad");
  });
});
