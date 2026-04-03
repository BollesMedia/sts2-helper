import { createSelector } from "@reduxjs/toolkit";
import { selectEvals, type EvalType, type EvalEntry } from "./evaluationSlice";

/** Select the full eval entry for a specific type */
export function selectEvalEntry(evalType: EvalType) {
  return createSelector(selectEvals, (evals): EvalEntry => evals[evalType]);
}

/** Select just the result for an eval type */
export function selectEvalResult<T = unknown>(evalType: EvalType) {
  return createSelector(selectEvals, (evals): T | null => evals[evalType].result as T | null);
}

/** Select loading state */
export function selectEvalIsLoading(evalType: EvalType) {
  return createSelector(selectEvals, (evals): boolean => evals[evalType].isLoading);
}

/** Select error */
export function selectEvalError(evalType: EvalType) {
  return createSelector(selectEvals, (evals): string | null => evals[evalType].error);
}

/** Select the current eval key (for dedup checks in listeners) */
export function selectEvalKey(evalType: EvalType) {
  return createSelector(selectEvals, (evals): string => evals[evalType].evalKey);
}

/** Is any eval currently loading? */
export const selectAnyEvalLoading = createSelector(
  selectEvals,
  (evals): boolean => Object.values(evals).some((e) => e.isLoading)
);
