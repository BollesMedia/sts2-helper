import { startAppListening } from "../../store/listenerMiddleware";
import { runStarted } from "./runSlice";

/**
 * Fires API calls when runs start/end.
 *
 * NOTE: During the parallel-running period (Phase 0-5), the OLD
 * useRunTracker hook still handles API calls. This listener is
 * scaffolded but does NOT dispatch API calls yet to avoid double
 * API calls. Uncomment in Phase 6 when old hooks are removed.
 */
export function setupRunApiListener() {
  startAppListening({
    actionCreator: runStarted,
    effect: (_action, _listenerApi) => {
      // const { runId, character, ascension, gameMode } = action.payload;
      //
      // Phase 6: uncomment to fire start-run API call
      // listenerApi.dispatch(
      //   evaluationApi.endpoints.startRun.initiate({
      //     runId, character, ascension, gameMode, userId: null,
      //   })
      // );
    },
  });
}
