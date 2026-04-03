import { startAppListening } from "../../store/listenerMiddleware";
import { gameStateApi } from "../../services/gameStateApi";
import { selectActiveRun, mapEvalRequested } from "../run/runSlice";
import { selectMapEvalContext, selectRecommendedNodesSet } from "../run/runSelectors";
import type { MapState } from "@sts2/shared/types/game-state";
import { shouldEvaluateMap } from "../../lib/should-evaluate-map";
import { hasSignificantContextChange } from "../../lib/has-significant-context-change";

/**
 * Map evaluation trigger listener.
 *
 * Watches game state changes for map state and decides whether
 * a map evaluation should be triggered. Currently validates the
 * trigger condition only — the useMapEvaluation hook handles the
 * actual API call.
 */
export function setupMapEvalListener() {
  startAppListening({
    predicate: (_action, currentState, previousState) => {
      const current = gameStateApi.endpoints.getGameState.select()(currentState);
      const previous = gameStateApi.endpoints.getGameState.select()(previousState);

      return (
        current.data?.state_type === "map" &&
        current.data !== previous.data
      );
    },
    effect: async (_action, listenerApi) => {
      listenerApi.cancelActiveListeners();

      const state = listenerApi.getState();
      const gameState = gameStateApi.endpoints.getGameState.select()(state).data;
      if (!gameState || gameState.state_type !== "map") return;

      const mapState = gameState as MapState;
      const run = selectActiveRun(state);
      if (!run) return;

      const prevContext = selectMapEvalContext(state);
      const recommendedNodes = selectRecommendedNodesSet(state);
      const currentPos = mapState.map?.current_position ?? null;

      const hpPercent = run.player && run.player.maxHp > 0
        ? run.player.hp / run.player.maxHp
        : 1;

      const shouldEval = shouldEvaluateMap({
        optionCount: mapState.map.next_options.length,
        hasPrevContext: !!prevContext,
        actChanged: prevContext ? prevContext.act !== run.act : false,
        currentPosition: currentPos,
        isOnRecommendedPath: currentPos
          ? recommendedNodes.has(`${currentPos.col},${currentPos.row}`)
          : false,
        hasSignificantContextChange: prevContext
          ? hasSignificantContextChange({
              prevHpPercent: prevContext.hpPercent,
              currentHpPercent: hpPercent,
              prevDeckSize: prevContext.deckSize,
              currentDeckSize: run.deck.length,
            })
          : false,
      });

      if (!shouldEval) return;

      // Signal the hook to fire the eval API call
      listenerApi.dispatch(mapEvalRequested());
    },
  });
}
