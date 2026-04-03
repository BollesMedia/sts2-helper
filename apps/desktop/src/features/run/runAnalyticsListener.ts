import { startAppListening } from "../../store/listenerMiddleware";
import { gameStateApi } from "../../services/gameStateApi";
import { evaluationApi } from "../../services/evaluationApi";
import { runStarted, runEnded, selectActiveRunId } from "./runSlice";
import {
  isCombatState,
  getPlayer,
  hasRun,
  type GameState,
  type BattlePlayer,
} from "@sts2/shared/types/game-state";

function generateRunId(): string {
  return `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function inferOutcome(
  lastStateType: string | null,
  wasBoss: boolean,
  lastHp: number,
  enemiesAllDead: boolean
): boolean | null {
  // Boss victory: all enemies dead after boss combat
  if (wasBoss && enemiesAllDead) return true;
  // Death: HP <= 0 during combat
  if (lastHp <= 0 && lastStateType && ["monster", "elite", "boss"].includes(lastStateType)) return false;
  // Quit or unclear
  return null;
}

/**
 * Watches game state transitions to detect run start/end.
 * Uses closure-scoped variables for ephemeral tracking
 * (these never enter Redux state).
 */
export function setupRunAnalyticsListener() {
  // Closure-scoped ephemeral tracking
  let prevStateType: string | null = null;
  let runActive = false;
  let lastWasBoss = false;
  let lastPlayerHp = 0;
  let lastEnemiesAllDead = false;
  let lastCombatEnemyName: string | null = null;
  let lastFloor = 0;
  let lastAct = 1;
  let lastDeckNames: string[] = [];
  let lastRelicNames: string[] = [];
  let bossesFought = new Set<string>();

  startAppListening({
    matcher: gameStateApi.endpoints.getGameState.matchFulfilled,
    effect: (action, listenerApi) => {
      const gameState: GameState = action.payload;
      const currentType = gameState.state_type;
      const state = listenerApi.getState();
      const activeRunId = state.run.activeRunId;

      // --- Track analytics data ---

      if (hasRun(gameState)) {
        lastFloor = gameState.run.floor;
        lastAct = gameState.run.act;
      }

      // Combat tracking
      if (isCombatState(gameState) && gameState.battle) {
        const p = getPlayer(gameState);
        if (p) lastPlayerHp = p.hp;
        lastEnemiesAllDead = gameState.battle.enemies.every((e) => e.hp <= 0);
        if (gameState.battle.enemies.length > 0) {
          const mainEnemy = gameState.battle.enemies.find(
            (e) => !e.status?.some((s) => s.name === "Minion")
          );
          lastCombatEnemyName = mainEnemy?.name ?? gameState.battle.enemies[0].name;
        }

        // Deck/relic snapshot from combat
        const bp = p as BattlePlayer | undefined;
        if (bp) {
          const deck = [
            ...(bp.hand ?? []),
            ...(bp.draw_pile ?? []),
            ...(bp.discard_pile ?? []),
            ...(bp.exhaust_pile ?? []),
          ];
          if (deck.length > 0) lastDeckNames = deck.map((c) => c.name);
          if (bp.relics?.length) lastRelicNames = bp.relics.map((r) => r.name);
        }
      }

      // Boss tracking
      if (currentType === "boss" && isCombatState(gameState) && gameState.battle?.enemies) {
        lastWasBoss = true;
        for (const enemy of gameState.battle.enemies) {
          const isMinion = enemy.status?.some((s) => s.id === "MINION" || s.name === "Minion");
          if (!isMinion) bossesFought.add(enemy.name);
        }
      }

      // Boss victory: moved from boss combat to combat_rewards
      if (prevStateType === "boss" && currentType === "combat_rewards") {
        lastEnemiesAllDead = true;
      }

      // --- Detect new run ---

      const isInRun = currentType !== "menu";
      const wasInMenu = prevStateType === "menu" || prevStateType === null;

      if (isInRun && wasInMenu && !runActive) {
        const newRunId = generateRunId();
        const character = getPlayer(gameState)?.character ?? "Unknown";
        const ascension = hasRun(gameState) ? gameState.run.ascension : 0;
        const gameMode = gameState.game_mode ?? "singleplayer";

        listenerApi.dispatch(
          runStarted({ runId: newRunId, character, ascension, gameMode })
        );

        // Reset closure tracking
        runActive = true;
        lastWasBoss = false;
        lastFloor = 0;
        lastAct = 1;
        lastPlayerHp = 0;
        lastEnemiesAllDead = false;
        lastDeckNames = [];
        lastRelicNames = [];
        lastCombatEnemyName = null;
        bossesFought = new Set();
      }

      // --- Detect run end ---
      // Note: menu does NOT mean run ended (save & quit is valid).
      // We detect run end from victory/defeat screens.

      // Victory: boss combat_rewards (all enemies dead after boss)
      if (prevStateType === "boss" && currentType === "combat_rewards" && runActive) {
        // Boss victory confirmed
      }

      // Death or quit: menu after combat
      if (currentType === "menu" && prevStateType !== "menu" && prevStateType !== null && runActive) {
        const victory = inferOutcome(prevStateType, lastWasBoss, lastPlayerHp, lastEnemiesAllDead);
        const endRunId = activeRunId;

        if (endRunId) {
          listenerApi.dispatch(runEnded({ runId: endRunId, inferred: victory }));

          // NOTE: API calls for run end are handled by the OLD useRunTracker
          // hook during the parallel-running period. When Phase 6 removes the
          // old hooks, uncomment and complete the dispatch below:
          //
          // listenerApi.dispatch(evaluationApi.endpoints.endRun.initiate({
          //   runId: endRunId,
          //   finalFloor: lastFloor,
          //   actReached: lastAct,
          //   victory: victory ?? undefined,
          //   causeOfDeath: lastCombatEnemyName,
          //   bossesFought: [...bossesFought],
          //   finalDeck: lastDeckNames,
          //   finalRelics: lastRelicNames,
          //   finalDeckSize: lastDeckNames.length,
          //   narrative: null, // TODO: migrate narrative to run slice
          // }));
        }

        runActive = false;
      }

      prevStateType = currentType;
    },
  });
}
