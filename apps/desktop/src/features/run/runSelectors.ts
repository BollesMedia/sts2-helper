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

/** Recommended nodes as a Set (derived from serializable string[]) — all options' paths, for UI highlighting */
export const selectRecommendedNodesSet = createSelector(
  selectActiveRun,
  (run) => new Set(run?.mapEval.recommendedNodes ?? [])
);

/** Best path nodes as a Set — only the recommended option's path, for deviation detection */
export const selectBestPathNodesSet = createSelector(
  selectActiveRun,
  (run) => new Set(run?.mapEval.bestPathNodes ?? [])
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

/** Stored LLM node-type preferences for local re-tracing */
export const selectNodePreferences = createSelector(
  selectActiveRun,
  (run) => run?.mapEval.nodePreferences ?? null
);
