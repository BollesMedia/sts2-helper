import { createSelector } from "@reduxjs/toolkit";
import { selectActiveRun } from "./runSlice";

/** Active run's deck — returns stable empty array if no run */
const EMPTY_DECK: never[] = [];
export const selectActiveDeck = createSelector(
  selectActiveRun,
  (run) => run?.deck ?? EMPTY_DECK
);

/** Active run's player — null if no run */
export const selectActivePlayer = createSelector(
  selectActiveRun,
  (run) => run?.player ?? null
);

/** Active run's character — null if no run */
export const selectActiveCharacter = createSelector(
  selectActiveRun,
  (run) => run?.character ?? null
);

/** Active run's map eval recommended path */
const EMPTY_PATH: never[] = [];
export const selectRecommendedPath = createSelector(
  selectActiveRun,
  (run) => run?.mapEval.recommendedPath ?? EMPTY_PATH
);

/** Recommended nodes as a Set (derived from serializable string[]) */
export const selectRecommendedNodesSet = createSelector(
  selectActiveRun,
  (run) => new Set(run?.mapEval.recommendedNodes ?? [])
);

/** Map eval context for shouldEvaluate checks */
export const selectMapEvalContext = createSelector(
  selectActiveRun,
  (run) => run?.mapEval.lastEvalContext ?? null
);

/** Map context (boss distance, elite ahead, etc.) for rest/event evals */
export const selectMapContext = createSelector(
  selectActiveRun,
  (run) => run?.mapContext ?? null
);
