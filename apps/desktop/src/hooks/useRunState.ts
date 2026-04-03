import { useCallback } from "react";
import { useAppSelector, useAppDispatch } from "../store/hooks";
import {
  selectActiveRunId,
  selectPendingOutcome,
  outcomeConfirmed,
} from "../features/run/runSlice";
import { evaluationApi } from "../services/evaluationApi";

/**
 * Run state hook that reads from Redux.
 * Replaces the return interface of the old useRunTracker.
 */
export function useRunState() {
  const dispatch = useAppDispatch();
  const runId = useAppSelector(selectActiveRunId);
  const pending = useAppSelector(selectPendingOutcome);

  const confirmOutcome = useCallback(
    (victory: boolean) => {
      if (!pending) return;
      dispatch(outcomeConfirmed({ runId: pending.runId, victory }));

      // Fire the confirmation API call
      dispatch(
        evaluationApi.endpoints.endRun.initiate({
          runId: pending.runId,
          victory,
        })
      );
    },
    [dispatch, pending]
  );

  return {
    runId,
    pendingOutcome: pending?.inferred != null,
    endedRunId: pending?.runId ?? null,
    inferredOutcome: pending?.inferred ?? null,
    finalFloor: 0, // TODO: track in slice
    confirmOutcome,
  };
}
