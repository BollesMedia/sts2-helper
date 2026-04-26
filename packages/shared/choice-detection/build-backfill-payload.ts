import type { BackfillPayload, PendingChoiceEntry } from "./types";

interface EvalResult {
  recommendedId: string | null;
  recommendedTier: string | null;
  /**
   * Per-item rankings persisted to `choices.rankings_snapshot`. The
   * optional `breakdown` carries the modifier stack from the phase-5
   * scorer (#108) so phase-6 calibration can learn modifier weights from
   * win-rate patterns. Other eval types (event, rest_site) omit it.
   */
  allRankings: {
    itemId: string;
    itemName: string;
    tier: string;
    recommendation: string;
    breakdown?: {
      baseTier: string;
      modifiers: { kind: string; delta: number; reason: string }[];
      adjustedTier: string;
      tierValue: number;
      topReason: string;
    } | null;
  }[];
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
