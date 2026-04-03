import { startAppListening } from "../../store/listenerMiddleware";
import { gameStateApi } from "../../services/gameStateApi";
import { evaluationApi } from "../../services/evaluationApi";
import { mapEvalUpdated, type MapEvalState } from "../run/runSlice";
import { selectActiveRun, selectActiveRunId } from "../run/runSlice";
import { selectMapEvalContext, selectRecommendedNodesSet } from "../run/runSelectors";
import type { GameState, MapState } from "@sts2/shared/types/game-state";
import { getPlayer } from "@sts2/shared/types/game-state";
import { traceRecommendedPath } from "@sts2/shared/features/map/map-path-tracer";

/**
 * Map evaluation trigger listener.
 *
 * Watches game state changes for map state and decides whether
 * to dispatch a map evaluation mutation based on:
 * 1. Fork detection (>1 option)
 * 2. No previous eval context (start of act)
 * 3. Act change
 * 4. Deviation from recommended path
 * 5. Significant context change (HP drop >15%, deck grew >1)
 */
export function setupMapEvalListener() {
  startAppListening({
    predicate: (_action, currentState, previousState) => {
      const current = gameStateApi.endpoints.getGameState.select()(currentState);
      const previous = gameStateApi.endpoints.getGameState.select()(previousState);

      // Only fire when game state data changes and we're on the map
      return (
        current.data?.state_type === "map" &&
        current.data !== previous.data
      );
    },
    effect: async (_action, listenerApi) => {
      listenerApi.cancelActiveListeners();

      const state = listenerApi.getState();
      const gameState = gameStateApi.endpoints.getGameState.select()(state).data as GameState | undefined;
      if (!gameState || gameState.state_type !== "map") return;

      const mapState = gameState as MapState;
      const options = mapState.map.next_options;

      // Gate: only 1 option → never evaluate
      if (options.length <= 1) return;

      const run = selectActiveRun(state);
      if (!run) return;

      const prevContext = selectMapEvalContext(state);
      const recommendedNodes = selectRecommendedNodesSet(state);

      // Should we evaluate?
      const shouldEval = shouldEvaluate(mapState, run, prevContext, recommendedNodes);

      if (!shouldEval) {
        // Carry forward existing path — no API call
        return;
      }

      // TODO: Build context and dispatch evaluateMap mutation
      // For now, this listener detects the trigger but doesn't dispatch yet
      // (existing useMapEvaluation hook still handles the actual eval)
      console.log("[MapEvalListener] shouldEvaluate = true, would dispatch eval");
    },
  });
}

function shouldEvaluate(
  mapState: MapState,
  run: { act: number; floor: number; deck: { name: string }[]; player: { hp: number; maxHp: number } | null },
  prevContext: { hpPercent: number; deckSize: number; act: number } | null,
  recommendedNodes: Set<string>
): boolean {
  // No previous context → fresh start, evaluate
  if (!prevContext) return true;

  // Act changed → always re-evaluate
  if (prevContext.act !== run.act) return true;

  // Current position null → re-evaluate
  const currentPos = mapState.map?.current_position;
  if (!currentPos) return true;

  // User deviated from recommended path
  const onPath = recommendedNodes.has(`${currentPos.col},${currentPos.row}`);
  if (!onPath) return true;

  // Significant context change at a fork
  const player = run.player;
  if (player) {
    const hpPercent = player.maxHp > 0 ? player.hp / player.maxHp : 1;
    const hpDrop = prevContext.hpPercent - hpPercent;
    const deckGrew = run.deck.length - prevContext.deckSize;
    if (hpDrop > 0.15 || deckGrew > 1) return true;
  }

  // On recommended path, context similar → don't evaluate
  return false;
}
