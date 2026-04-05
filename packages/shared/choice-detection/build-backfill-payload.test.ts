import { describe, it, expect } from "vitest";
import { buildBackfillPayload } from "./build-backfill-payload";
import type { PendingChoiceEntry } from "./types";

const rankings = [
  { itemId: "Carnage", itemName: "Carnage", tier: "S", recommendation: "Take" },
  { itemId: "Uppercut", itemName: "Uppercut", tier: "B", recommendation: "Consider" },
];

const evalResult = {
  recommendedId: "Carnage",
  recommendedTier: "S",
  allRankings: rankings,
};

const pendingChoice: PendingChoiceEntry = {
  chosenItemId: "Carnage",
  floor: 3,
  choiceType: "card_reward",
  sequence: 0,
};

describe("buildBackfillPayload", () => {
  it("returns payload with wasFollowed=true when user picked the recommended card", () => {
    const result = buildBackfillPayload("run_123", evalResult, pendingChoice);
    expect(result).toEqual({
      runId: "run_123",
      floor: 3,
      choiceType: "card_reward",
      sequence: 0,
      recommendedItemId: "Carnage",
      recommendedTier: "S",
      wasFollowed: true,
      rankingsSnapshot: rankings,
      evalPending: false,
    });
  });

  it("returns wasFollowed=false when user picked a different card", () => {
    const different: PendingChoiceEntry = { ...pendingChoice, chosenItemId: "Uppercut" };
    const result = buildBackfillPayload("run_123", evalResult, different);
    expect(result.wasFollowed).toBe(false);
  });

  it("returns wasFollowed=false when user skipped but system recommended a card", () => {
    const skipped: PendingChoiceEntry = { ...pendingChoice, chosenItemId: null };
    const result = buildBackfillPayload("run_123", evalResult, skipped);
    expect(result.wasFollowed).toBe(false);
  });

  it("returns wasFollowed=true when both user and system chose skip", () => {
    const skipEval = { ...evalResult, recommendedId: null, recommendedTier: null };
    const skipped: PendingChoiceEntry = { ...pendingChoice, chosenItemId: null };
    const result = buildBackfillPayload("run_123", skipEval, skipped);
    expect(result.wasFollowed).toBe(true);
  });

  it("includes full rankings snapshot", () => {
    const result = buildBackfillPayload("run_123", evalResult, pendingChoice);
    expect(result.rankingsSnapshot).toEqual(rankings);
  });
});
