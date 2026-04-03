import { startAppListening } from "../../store/listenerMiddleware";
import { gameStateApi } from "../../services/gameStateApi";
import { evaluationApi } from "../../services/evaluationApi";
import { runStarted, runEnded } from "./runSlice";
import {
  isCombatState,
  getPlayer,
  hasRun,
  type GameState,
  type BattlePlayer,
} from "@sts2/shared/types/game-state";
import {
  initializeNarrative,
  clearNarrative,
  getNarrative,
} from "@sts2/shared/evaluation/run-narrative";
import { clearEvaluationRegistry } from "@sts2/shared/evaluation/last-evaluation-registry";
import { getUserId } from "@sts2/shared/lib/get-user-id";

function generateRunId(): string {
  return `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function inferOutcome(
  lastStateType: string | null,
  wasBoss: boolean,
  lastHp: number,
  enemiesAllDead: boolean
): boolean | null {
  if (wasBoss && enemiesAllDead) return true;
  if (
    lastHp <= 0 &&
    lastStateType &&
    ["monster", "elite", "boss"].includes(lastStateType)
  )
    return false;
  return null;
}

/**
 * Promise that resolves when the current run has been persisted to the API.
 * Choice logging awaits this to avoid FK violations.
 */
let runCreatedPromise: Promise<void> = Promise.resolve();

export function waitForRunCreated(): Promise<void> {
  return runCreatedPromise;
}

/**
 * Watches game state transitions to detect run start/end.
 * Uses closure-scoped variables for ephemeral tracking
 * (these never enter Redux state).
 *
 * This is the SOLE source of truth for run lifecycle — handles
 * run ID generation, API persistence, narrative, and eval registry.
 */
export function setupRunAnalyticsListener() {
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
        lastEnemiesAllDead = gameState.battle.enemies.every(
          (e) => e.hp <= 0
        );
        if (gameState.battle.enemies.length > 0) {
          const mainEnemy = gameState.battle.enemies.find(
            (e) => !e.status?.some((s) => s.name === "Minion")
          );
          lastCombatEnemyName =
            mainEnemy?.name ?? gameState.battle.enemies[0].name;
        }

        if (p) {
          const deck = [
            ...(p.hand ?? []),
            ...(p.draw_pile ?? []),
            ...(p.discard_pile ?? []),
            ...(p.exhaust_pile ?? []),
          ];
          if (deck.length > 0) lastDeckNames = deck.map((c) => c.name);
          if (p.relics?.length)
            lastRelicNames = p.relics.map((r) => r.name);
        }
      }

      // Boss tracking
      if (
        currentType === "boss" &&
        isCombatState(gameState) &&
        gameState.battle?.enemies
      ) {
        lastWasBoss = true;
        for (const enemy of gameState.battle.enemies) {
          const isMinion = enemy.status?.some(
            (s) => s.id === "MINION" || s.name === "Minion"
          );
          if (!isMinion) bossesFought.add(enemy.name);
        }
      }

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

        // Persist to API
        runCreatedPromise = listenerApi
          .dispatch(
            evaluationApi.endpoints.startRun.initiate({
              runId: newRunId,
              character,
              ascension,
              gameMode,
              userId: getUserId(),
            })
          )
          .unwrap()
          .then(
            () => {},
            () => {}
          );

        // Initialize narrative + clear stale eval data
        initializeNarrative(newRunId, character, ascension);
        clearEvaluationRegistry();

        // Clear stale caches
        if (typeof window !== "undefined") {
          localStorage.removeItem("sts2-deck");
          localStorage.removeItem("sts2-player");
          localStorage.removeItem("sts2-eval-cache");
          localStorage.removeItem("sts2-shop-eval-cache");
          localStorage.removeItem("sts2-map-eval-cache");
          localStorage.removeItem("sts2-map-eval-state");
          localStorage.removeItem("sts2-event-eval-cache");
          localStorage.removeItem("sts2-rest-eval-cache");
        }

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

        console.log("[RunAnalytics] New run started:", newRunId, character);
      }

      // --- Detect run end ---

      if (
        currentType === "menu" &&
        prevStateType !== "menu" &&
        prevStateType !== null &&
        runActive
      ) {
        const victory = inferOutcome(
          prevStateType,
          lastWasBoss,
          lastPlayerHp,
          lastEnemiesAllDead
        );
        const endRunId = activeRunId;

        if (endRunId) {
          listenerApi.dispatch(
            runEnded({
              runId: endRunId,
              inferred: victory,
              finalFloor: lastFloor,
            })
          );

          // Persist to API
          listenerApi.dispatch(
            evaluationApi.endpoints.endRun.initiate({
              runId: endRunId,
              victory: victory ?? undefined,
              finalFloor: lastFloor,
              actReached: lastAct,
              causeOfDeath: victory === false ? lastCombatEnemyName : null,
              bossesFought:
                bossesFought.size > 0 ? [...bossesFought] : null,
              finalDeck:
                lastDeckNames.length > 0 ? lastDeckNames : null,
              finalRelics:
                lastRelicNames.length > 0 ? lastRelicNames : null,
              finalDeckSize: lastDeckNames.length || null,
              narrative: getNarrative(),
            })
          );

          const outcomeLabel =
            victory === true
              ? "VICTORY"
              : victory === false
                ? "DEATH"
                : "QUIT";
          console.log(
            `[RunAnalytics] Run ended (${outcomeLabel}):`,
            endRunId,
            `floor ${lastFloor}`,
            lastCombatEnemyName ? `killed by ${lastCombatEnemyName}` : "",
            `deck: ${lastDeckNames.length} cards`
          );
        }

        clearNarrative();
        clearEvaluationRegistry();
        runActive = false;
      }

      prevStateType = currentType;
    },
  });
}
