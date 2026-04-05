import type { BackfillPayload, PendingChoiceEntry } from "./types";

interface EvalResult {
  recommendedId: string | null;
  recommendedTier: string | null;
  allRankings: { itemId: string; itemName: string; tier: string; recommendation: string }[];
}

export function buildBackfillPayload(
  runId: string,
  evalResult: EvalResult,
  pendingChoice: PendingChoiceEntry
): BackfillPayload {
  const wasFollowed =
    evalResult.recommendedId === pendingChoice.chosenItemId;

  return {
    runId,
    floor: pendingChoice.floor,
    choiceType: pendingChoice.choiceType,
    sequence: pendingChoice.sequence,
    recommendedItemId: evalResult.recommendedId,
    recommendedTier: evalResult.recommendedTier,
    wasFollowed,
    rankingsSnapshot: evalResult.allRankings,
    evalPending: false,
  };
}
