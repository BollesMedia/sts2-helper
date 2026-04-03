import { startAppListening } from "../../store/listenerMiddleware";
import { gameStateApi } from "../../services/gameStateApi";
import { statusChanged, gameModeDetected } from "./connectionSlice";

/**
 * Watches RTK Query game state results and syncs connection status
 * + game mode to the connection slice. Replaces the useEffect
 * dispatches in useGameState hook.
 */
export function setupConnectionListeners() {
  // Connected: query fulfilled
  startAppListening({
    matcher: gameStateApi.endpoints.getGameState.matchFulfilled,
    effect: (action, listenerApi) => {
      const data = action.payload;
      listenerApi.dispatch(statusChanged("connected"));
      if (data.game_mode) {
        listenerApi.dispatch(gameModeDetected(data.game_mode));
      }
    },
  });

  // Disconnected: query rejected
  startAppListening({
    matcher: gameStateApi.endpoints.getGameState.matchRejected,
    effect: (_action, listenerApi) => {
      listenerApi.dispatch(statusChanged("disconnected"));
    },
  });
}
