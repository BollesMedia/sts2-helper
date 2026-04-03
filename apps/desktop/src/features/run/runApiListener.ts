import { startAppListening } from "../../store/listenerMiddleware";
import { evaluationApi } from "../../services/evaluationApi";
import { runStarted } from "./runSlice";

/**
 * Fires API calls when runs start.
 * Run end API calls are handled by runAnalyticsListener
 * (it has the closure-scoped data needed for the end payload).
 */
export function setupRunApiListener() {
  startAppListening({
    actionCreator: runStarted,
    effect: (action, listenerApi) => {
      const { runId, character, ascension, gameMode } = action.payload;

      // TODO: Get userId from auth state when available
      const userId: string | null = null;

      listenerApi.dispatch(
        evaluationApi.endpoints.startRun.initiate({
          runId,
          character,
          ascension,
          gameMode,
          userId,
        })
      );
    },
  });
}
