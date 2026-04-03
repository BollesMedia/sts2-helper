import { startAppListening } from "../../store/listenerMiddleware";
import { gameStateApi } from "../../services/gameStateApi";
import {
  floorUpdated,
  playerUpdated,
  deckUpdated,
  type TrackedPlayer,
} from "./runSlice";
import {
  isCombatState,
  getPlayer,
  hasRun,
  type GameState,
  type BattlePlayer,
  type ShopState,
} from "@sts2/shared/types/game-state";

/**
 * Watches game state changes and updates the active run's
 * floor, player, and deck data in Redux.
 *
 * Replaces useDeckTracker + usePlayerTracker hooks.
 */
export function setupGameStateUpdateListener() {
  let combatSynced = false;
  let lastRunId: string | null = null;

  startAppListening({
    matcher: gameStateApi.endpoints.getGameState.matchFulfilled,
    effect: (action, listenerApi) => {
      const state = listenerApi.getState();
      const activeRunId = state.run.activeRunId;
      if (!activeRunId) return;

      // Reset closure state when run changes
      if (activeRunId !== lastRunId) {
        lastRunId = activeRunId;
        combatSynced = false;
      }

      const gameState: GameState = action.payload;

      // Update floor/act
      if (hasRun(gameState)) {
        const run = state.run.runs[activeRunId];
        if (run && (run.act !== gameState.run.act || run.floor !== gameState.run.floor)) {
          listenerApi.dispatch(floorUpdated({ act: gameState.run.act, floor: gameState.run.floor }));
        }
      }

      // Update player
      const p = getPlayer(gameState);
      if (p && gameState.state_type !== "menu") {
        const energy = "max_energy" in p ? p.max_energy ?? 3 : 3;
        const relics = "relics" in p && Array.isArray(p.relics)
          ? p.relics.map((r) => ({ id: "id" in r ? r.id : "", name: r.name, description: r.description }))
          : [];
        const potions = "potions" in p && Array.isArray(p.potions)
          ? p.potions.map((pot) => ({ name: pot.name, description: pot.description }))
          : [];

        const tracked: TrackedPlayer = {
          character: p.character,
          hp: p.hp,
          maxHp: p.max_hp,
          gold: p.gold,
          maxEnergy: energy,
          relics,
          potions,
          cardRemovalCost: state.run.runs[activeRunId]?.player?.cardRemovalCost ?? null,
        };

        // Shop: extract removal cost
        if (gameState.state_type === "shop" && "shop" in gameState) {
          const shopState = gameState as ShopState;
          const removalItem = shopState.shop?.items?.find((i) => i.category === "card_removal");
          if (removalItem) {
            tracked.cardRemovalCost = removalItem.cost;
          }
        }

        listenerApi.dispatch(playerUpdated(tracked));
      }

      // Deck sync: once per combat entry at round 1
      if (!isCombatState(gameState)) {
        combatSynced = false;
      }
      if (isCombatState(gameState) && !combatSynced && gameState.battle?.round <= 1) {
        const bp = getPlayer(gameState) as BattlePlayer | undefined;
        if (bp) {
          const allPiles = [
            ...(bp.hand ?? []),
            ...(bp.draw_pile ?? []),
            ...(bp.discard_pile ?? []),
            ...(bp.exhaust_pile ?? []),
          ];
          if (allPiles.length > 0) {
            combatSynced = true;
            listenerApi.dispatch(deckUpdated(allPiles));
          }
        }
      }
    },
  });
}
