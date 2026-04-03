import { startAppListening } from "../../store/listenerMiddleware";
import { gameStateApi } from "../../services/gameStateApi";
import {
  floorUpdated,
  playerUpdated,
  deckUpdated,
  mapContextUpdated,
  type TrackedPlayer,
} from "./runSlice";
import {
  isCombatState,
  getPlayer,
  hasRun,
  type GameState,
  type BattlePlayer,
  type ShopState,
  type MapState,
} from "@sts2/shared/types/game-state";
import { filterPlayerCards, initValidCardNames } from "../../lib/card-filter";
import { logPoll } from "../../lib/poll-log";
import { initStarterDecks, getStarterDeck } from "@sts2/shared/supabase/starter-decks";

/**
 * Watches game state changes and updates the active run's
 * floor, player, and deck data in Redux.
 *
 * Replaces useDeckTracker + usePlayerTracker hooks.
 */
export function setupGameStateUpdateListener() {
  let combatSynced = false;
  let lastRunId: string | null = null;

  // Kick off async card validation + starter deck loading
  initValidCardNames();
  initStarterDecks();

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
      logPoll(gameState);
      const currentDeck = state.run.runs[activeRunId]?.deck ?? [];

      // --- Update floor/act ---

      if (hasRun(gameState)) {
        const run = state.run.runs[activeRunId];
        if (
          run &&
          (run.act !== gameState.run.act || run.floor !== gameState.run.floor)
        ) {
          listenerApi.dispatch(
            floorUpdated({ act: gameState.run.act, floor: gameState.run.floor })
          );
        }
      }

      // --- Update player ---

      const p = getPlayer(gameState);
      if (p && gameState.state_type !== "menu") {
        const energy = "max_energy" in p ? p.max_energy ?? 3 : 3;
        const relics =
          "relics" in p && Array.isArray(p.relics)
            ? p.relics.map((r) => ({
                id: "id" in r ? r.id : "",
                name: r.name,
                description: r.description,
              }))
            : [];
        const potions =
          "potions" in p && Array.isArray(p.potions)
            ? p.potions.map((pot) => ({
                name: pot.name,
                description: pot.description,
              }))
            : [];

        const tracked: TrackedPlayer = {
          character: p.character,
          hp: p.hp,
          maxHp: p.max_hp,
          gold: p.gold,
          maxEnergy: energy,
          relics,
          potions,
          cardRemovalCost:
            state.run.runs[activeRunId]?.player?.cardRemovalCost ?? null,
        };

        // Shop: extract removal cost
        if (gameState.state_type === "shop" && "shop" in gameState) {
          const shopState = gameState as ShopState;
          const removalItem = shopState.shop?.items?.find(
            (i) => i.category === "card_removal"
          );
          if (removalItem) {
            tracked.cardRemovalCost = removalItem.cost;
          }
        }

        listenerApi.dispatch(playerUpdated(tracked));
      }

      // --- Deck sync ---

      // Reset combatSynced when leaving combat
      if (!isCombatState(gameState)) {
        combatSynced = false;
      }

      // Primary: combat round 1 — cleanest snapshot (no exhaust, no enemy cards yet)
      if (
        isCombatState(gameState) &&
        !combatSynced &&
        gameState.battle?.round <= 1
      ) {
        const bp = getPlayer(gameState);
        if (bp) {
          const allPiles = [
            ...(bp.hand ?? []),
            ...(bp.draw_pile ?? []),
            ...(bp.discard_pile ?? []),
            ...(bp.exhaust_pile ?? []),
          ];
          const filtered = filterPlayerCards(allPiles);
          if (filtered.length > 0) {
            combatSynced = true;
            listenerApi.dispatch(deckUpdated(filtered));
          }
        }
      }

      // Fallback: any combat round if deck is empty (app started mid-run)
      if (currentDeck.length === 0 && isCombatState(gameState)) {
        const bp = getPlayer(gameState);
        if (bp) {
          const allPiles = [
            ...(bp.hand ?? []),
            ...(bp.draw_pile ?? []),
            ...(bp.discard_pile ?? []),
            ...(bp.exhaust_pile ?? []),
          ];
          const filtered = filterPlayerCards(allPiles);
          if (filtered.length > 0) {
            combatSynced = true;
            listenerApi.dispatch(deckUpdated(filtered));
          }
        }
      }

      // card_select: can show real deck cards (enchant, upgrade, transform screens)
      if (
        gameState.state_type === "card_select" &&
        "card_select" in gameState
      ) {
        const selectCards = gameState.card_select.cards;
        if (selectCards.length > currentDeck.length) {
          const mapped = selectCards.map((c) => ({
            name: c.name,
            description: c.description,
            keywords: c.keywords,
          }));
          listenerApi.dispatch(deckUpdated(mapped));
        }
      }

      // Starter deck injection: new run, no deck yet, act 1 floor ≤ 1
      if (currentDeck.length === 0 && hasRun(gameState)) {
        const { act, floor } = gameState.run;
        if (act === 1 && floor <= 1) {
          const character = getPlayer(gameState)?.character;
          if (character) {
            const starter = getStarterDeck(character);
            if (starter.length > 0) {
              listenerApi.dispatch(deckUpdated(starter));
            }
          }
        }
      }

      // --- Update map context (boss distance, next nodes) ---
      // Other evals (rest site, events) read this from Redux
      if (gameState.state_type === "map" && "map" in gameState) {
        const mapState = gameState as MapState;
        const currentRow = mapState.map.current_position?.row ?? 0;
        const bossRow = mapState.map.boss.row;
        const nextNodeTypes = mapState.map.next_options.map((o) => o.type);
        listenerApi.dispatch(mapContextUpdated({
          floorsToNextBoss: bossRow - currentRow,
          nextNodeTypes,
          hasEliteAhead: nextNodeTypes.includes("Elite"),
          hasRestAhead: nextNodeTypes.includes("RestSite"),
          hasShopAhead: nextNodeTypes.includes("Shop"),
        }));
      }
    },
  });
}
