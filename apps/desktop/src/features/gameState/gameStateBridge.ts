import { startAppListening } from "../../store/listenerMiddleware";
import { gameStateApi } from "../../services/gameStateApi";
import { gameStateReceived } from "./gameStateSlice";

/**
 * Bridge listener: mirrors RTK Query game state results into gameStateSlice.
 *
 * Must be registered BEFORE all eval listeners so the slice is up-to-date
 * when their predicates fire. The slice reducer handles content-based dedup.
 */
export function setupGameStateBridge() {
  startAppListening({
    matcher: gameStateApi.endpoints.getGameState.matchFulfilled,
    effect: (action, listenerApi) => {
      listenerApi.dispatch(gameStateReceived(action.payload));
    },
  });
}
