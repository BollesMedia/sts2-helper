import { describe, it, expect } from "vitest";
import { reconcileSkipRecommended } from "@sts2/shared/evaluation/post-eval-weights";
import type { CardRewardEvaluation, CardEvaluation } from "@sts2/shared/evaluation/types";

function makeRanking(overrides: Partial<CardEvaluation>): CardEvaluation {
  return {
    itemId: "test",
    itemName: "Test Card",
    rank: 1,
    tier: "D",
    tierValue: 2,
    synergyScore: 50,
    confidence: 80,
    recommendation: "skip",
    reasoning: "Test",
    source: "claude",
    ...overrides,
  };
}

function makeEvaluation(
  rankings: CardEvaluation[],
  skipRecommended: boolean
): CardRewardEvaluation {
  return {
    rankings,
    skipRecommended,
    skipReasoning: skipRecommended ? "none worth adding" : null,
  };
}

describe("reconcileSkipRecommended", () => {
  it("clears skipRecommended when a ranking is A-tier strong_pick", () => {
    const evaluation = makeEvaluation(
      [
        makeRanking({ itemName: "Bad Card", tier: "D", tierValue: 2, recommendation: "skip" }),
        makeRanking({ itemName: "Expect a Fight", tier: "A", tierValue: 5, recommendation: "strong_pick" }),
      ],
      true
    );

    reconcileSkipRecommended(evaluation);

    expect(evaluation.skipRecommended).toBe(false);
  });

  it("clears skipRecommended when a ranking is B-tier good_pick", () => {
    const evaluation = makeEvaluation(
      [
        makeRanking({ tier: "B", tierValue: 4, recommendation: "good_pick" }),
        makeRanking({ tier: "D", tierValue: 2, recommendation: "skip" }),
      ],
      true
    );

    reconcileSkipRecommended(evaluation);

    expect(evaluation.skipRecommended).toBe(false);
  });

  it("does not clear skipRecommended when all rankings are D/F-tier", () => {
    const evaluation = makeEvaluation(
      [
        makeRanking({ tier: "D", tierValue: 2, recommendation: "skip" }),
        makeRanking({ tier: "F", tierValue: 1, recommendation: "skip" }),
      ],
      true
    );

    reconcileSkipRecommended(evaluation);

    expect(evaluation.skipRecommended).toBe(true);
  });

  it("does not clear skipRecommended when B+ card has skip recommendation", () => {
    // Edge case: card is B-tier but recommendation is still skip
    const evaluation = makeEvaluation(
      [
        makeRanking({ tier: "B", tierValue: 4, recommendation: "skip" }),
      ],
      true
    );

    reconcileSkipRecommended(evaluation);

    expect(evaluation.skipRecommended).toBe(true);
  });

  it("does nothing when skipRecommended is already false", () => {
    const evaluation = makeEvaluation(
      [
        makeRanking({ tier: "A", tierValue: 5, recommendation: "strong_pick" }),
      ],
      false
    );

    reconcileSkipRecommended(evaluation);

    expect(evaluation.skipRecommended).toBe(false);
  });

  it("clears skipRecommended for S-tier situational", () => {
    const evaluation = makeEvaluation(
      [
        makeRanking({ tier: "S", tierValue: 6, recommendation: "situational" }),
      ],
      true
    );

    reconcileSkipRecommended(evaluation);

    expect(evaluation.skipRecommended).toBe(false);
  });

  it("does not clear for C-tier good_pick (below threshold)", () => {
    const evaluation = makeEvaluation(
      [
        makeRanking({ tier: "C", tierValue: 3, recommendation: "good_pick" }),
      ],
      true
    );

    reconcileSkipRecommended(evaluation);

    expect(evaluation.skipRecommended).toBe(true);
  });
});
