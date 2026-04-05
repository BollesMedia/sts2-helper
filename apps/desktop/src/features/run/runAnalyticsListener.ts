import { startAppListening } from "../../store/listenerMiddleware";
import { gameStateApi } from "../../services/gameStateApi";
import { evaluationApi } from "../../services/evaluationApi";
import { runStarted, runEnded, outcomeConfirmed } from "./runSlice";
import { allEvalsCleared } from "../evaluation/evaluationSlice";
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
import { inferRunOutcome } from "../../lib/infer-run-outcome";
import { getActPath, clearAllActPaths } from "@sts2/shared/choice-detection/act-path-tracker";
import { buildActPathRecord } from "@sts2/shared/choice-detection/build-act-path-record";
import { clearAllPendingChoices } from "@sts2/shared/choice-detection/pending-choice-registry";
import type { MapEvalState, RunData } from "./runSlice";

function generateRunId(): string {
  return `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
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
  let prevAct: number | null = null;

  function flushActPath(
    actNumber: number,
    runId: string,
    runData: RunData,
    dispatch: (action: unknown) => unknown
  ) {
    const actualPath = getActPath(actNumber);
    if (actualPath.length === 0) return;

    const recommendedPath = runData.mapEval.recommendedPath.map((p) => ({
      ...p,
      nodeType: "unknown",
    }));

    const record = buildActPathRecord(actNumber, recommendedPath, actualPath);

    waitForRunCreated()
      .then(() => {
        dispatch(
          evaluationApi.endpoints.logActPath.initiate({
            runId,
            act: record.act,
            recommendedPath: record.recommendedPath,
            actualPath: record.actualPath,
            nodePreferences: runData.mapEval.nodePreferences,
            deviationCount: record.deviationCount,
            deviationNodes: record.deviationNodes,
            contextAtStart: {
              hpPercent: runData.player?.maxHp ? runData.player.hp / runData.player.maxHp : 1,
              gold: runData.player?.gold ?? 0,
              deckSize: runData.deck.length,
              character: runData.character,
              ascension: runData.ascension,
            },
          })
        );
      })
      .catch(console.error);
  }

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
        const currentAct = gameState.run.act;

        // Flush previous act's path on act change
        if (prevAct !== null && currentAct !== prevAct && activeRunId) {
          const runData = state.run.runs[activeRunId];
          if (runData) {
            flushActPath(prevAct, activeRunId, runData, listenerApi.dispatch);
          }
        }
        prevAct = currentAct;
        lastAct = currentAct;
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

      // --- Check for victory or defeat mid-run ---
      if (runActive && activeRunId) {
        const eventData = currentType === "event" && "event" in gameState
          ? (gameState as { event: { event_id?: string; event_name?: string } }).event
          : null;

        const overlayData = currentType === "overlay" && "overlay" in gameState
          ? (gameState as { overlay: { screen_type?: string } }).overlay
          : null;

        const outcomeResult = inferRunOutcome({
          currentStateType: currentType,
          lastWasBoss,
          lastEnemiesAllDead,
          lastAct,
          eventId: eventData?.event_id ?? null,
          eventName: eventData?.event_name ?? null,
          overlayScreenType: overlayData?.screen_type ?? null,
        });

        if (outcomeResult === "victory") {
          listenerApi.dispatch(
            runEnded({ runId: activeRunId, inferred: true, finalFloor: lastFloor })
          );
          listenerApi.dispatch(
            outcomeConfirmed({ runId: activeRunId, victory: true })
          );
          listenerApi.dispatch(
            evaluationApi.endpoints.endRun.initiate({
              runId: activeRunId,
              victory: true,
              finalFloor: lastFloor,
              actReached: lastAct,
              bossesFought: bossesFought.size > 0 ? [...bossesFought] : null,
              finalDeck: lastDeckNames.length > 0 ? lastDeckNames : null,
              finalRelics: lastRelicNames.length > 0 ? lastRelicNames : null,
              finalDeckSize: lastDeckNames.length || null,
              narrative: getNarrative(),
            })
          );

          console.log("[RunAnalytics] Victory:", activeRunId, `floor ${lastFloor}`);
          if (prevAct !== null) {
            const runData = state.run.runs[activeRunId];
            if (runData) flushActPath(prevAct, activeRunId, runData, listenerApi.dispatch);
          }
          clearAllActPaths();
          clearAllPendingChoices();
          clearNarrative();
          clearEvaluationRegistry();
          runActive = false;
          prevAct = null;
        }

        if (outcomeResult === "defeat") {
          listenerApi.dispatch(
            runEnded({ runId: activeRunId, inferred: false, finalFloor: lastFloor })
          );
          listenerApi.dispatch(
            outcomeConfirmed({ runId: activeRunId, victory: false })
          );
          listenerApi.dispatch(
            evaluationApi.endpoints.endRun.initiate({
              runId: activeRunId,
              victory: false,
              finalFloor: lastFloor,
              actReached: lastAct,
              causeOfDeath: lastCombatEnemyName,
              bossesFought: bossesFought.size > 0 ? [...bossesFought] : null,
              finalDeck: lastDeckNames.length > 0 ? lastDeckNames : null,
              finalRelics: lastRelicNames.length > 0 ? lastRelicNames : null,
              finalDeckSize: lastDeckNames.length || null,
              narrative: getNarrative(),
            })
          );

          console.log("[RunAnalytics] Defeat:", activeRunId, `floor ${lastFloor}`, lastCombatEnemyName ? `killed by ${lastCombatEnemyName}` : "");
          if (prevAct !== null) {
            const runData = state.run.runs[activeRunId];
            if (runData) flushActPath(prevAct, activeRunId, runData, listenerApi.dispatch);
          }
          clearAllActPaths();
          clearAllPendingChoices();
          clearNarrative();
          clearEvaluationRegistry();
          runActive = false;
          prevAct = null;
        }
      }

      // --- Detect new run ---

      const isInRun = currentType !== "menu";
      const wasInMenu = prevStateType === "menu" || prevStateType === null;

      if (isInRun && wasInMenu && !runActive) {
        // On app restart (prevStateType === null), check if we have a persisted
        // active run that matches the current game. Resume it instead of creating
        // a new one — a fresh run would have an empty deck and fail validation.
        const existingRunId = state.run.activeRunId;
        const existingRun = existingRunId ? state.run.runs[existingRunId] : null;
        const character = getPlayer(gameState)?.character ?? "Unknown";
        const ascension = hasRun(gameState) ? gameState.run.ascension : 0;

        if (
          prevStateType === null &&
          existingRun &&
          existingRun.character === character &&
          existingRun.deck.length > 0
        ) {
          // Resume persisted run — restore closure state from persisted data
          runActive = true;
          lastFloor = existingRun.floor;
          lastAct = existingRun.act;
          lastPlayerHp = existingRun.player?.hp ?? 0;
          lastDeckNames = existingRun.deck.map((c) => c.name);
          lastRelicNames = existingRun.player?.relics?.map((r) => r.name) ?? [];
          initializeNarrative(existingRunId!, character, ascension);
          console.log("[RunAnalytics] Resumed persisted run:", existingRunId);
        } else {
          const newRunId = generateRunId();
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

          // Clear all evaluation state for the new run
          listenerApi.dispatch(allEvalsCleared());

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
          clearAllActPaths();
          clearAllPendingChoices();
          prevAct = null;

          console.log("[RunAnalytics] New run started:", newRunId, character);
        }
      }

      // --- Detect run end ---

      if (
        currentType === "menu" &&
        prevStateType !== "menu" &&
        prevStateType !== null &&
        runActive
      ) {
        // Menu transition: check if this was a victory we missed
        const menuOutcome = inferRunOutcome({
          currentStateType: "menu",
          lastWasBoss,
          lastEnemiesAllDead,
          lastAct,
          eventId: null,
          eventName: null,
          overlayScreenType: null,
        });
        const victory = menuOutcome === "victory" ? true : null;
        const endRunId = activeRunId;

        if (endRunId) {
          listenerApi.dispatch(
            runEnded({
              runId: endRunId,
              inferred: victory,
              finalFloor: lastFloor,
            })
          );

          if (victory === true) {
            listenerApi.dispatch(
              outcomeConfirmed({ runId: endRunId, victory: true })
            );
          }

          listenerApi.dispatch(
            evaluationApi.endpoints.endRun.initiate({
              runId: endRunId,
              victory: victory ?? undefined,
              finalFloor: lastFloor,
              actReached: lastAct,
              causeOfDeath: null,
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

        if (prevAct !== null && endRunId) {
          const runData = state.run.runs[endRunId];
          if (runData) flushActPath(prevAct, endRunId, runData, listenerApi.dispatch);
        }
        clearAllActPaths();
        clearAllPendingChoices();
        clearNarrative();
        clearEvaluationRegistry();
        runActive = false;
        prevAct = null;
      }

      prevStateType = currentType;
    },
  });
}
