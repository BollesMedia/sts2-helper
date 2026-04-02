"use client";
import { apiFetch } from "../../lib/api-client";
import { initializeNarrative, clearNarrative, restoreForRun, getNarrative } from "../../evaluation/run-narrative";
import { clearEvaluationRegistry } from "../../evaluation/last-evaluation-registry";

import { useCallback, useRef, useState } from "react";
import type { GameState } from "../../types/game-state";
import { hasRun, isCombatState, getPlayer } from "../../types/game-state";
import type { BattlePlayer } from "../../types/game-state";

const STORAGE_KEY = "sts2-run-id";

/**
 * Promise that resolves when the current run has been persisted to the API.
 * Choice logging awaits this to avoid FK violations.
 */
let runCreatedPromise: Promise<void> = Promise.resolve();

function generateRunId(): string {
  return `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function loadRunId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch (e) {
    if (process.env.NODE_ENV === "development") {
      console.warn("[localStorage]", e);
    }
    return null;
  }
}

function saveRunId(runId: string | null) {
  if (typeof window === "undefined") return;
  try {
    if (runId) {
      localStorage.setItem(STORAGE_KEY, runId);
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  } catch (e) {
    if (process.env.NODE_ENV === "development") {
      console.warn("[localStorage]", e);
    }
  }
}

function inferOutcome(
  lastStateType: string | null,
  lastWasBoss: boolean,
  lastPlayerHp: number,
  lastEnemiesAllDead: boolean
): boolean | null {
  if (!lastStateType) return null;

  // Victory: boss fight ended and we moved to combat_rewards (enemies died)
  if (lastWasBoss && lastEnemiesAllDead) return true;
  if (lastStateType === "combat_rewards" && lastWasBoss) return true;

  // Death: player HP hit 0 in combat
  if (
    ["monster", "elite", "boss"].includes(lastStateType) &&
    lastPlayerHp <= 0
  ) {
    return false;
  }

  // Death: was in combat (but HP might not have updated in time)
  if (["monster", "elite", "boss"].includes(lastStateType)) return false;

  // Quit or unknown
  return null;
}

/**
 * Call this to confirm or override the run outcome.
 */
/**
 * Returns a promise that resolves once the current run has been persisted.
 * Used by choice-tracker to avoid FK violations.
 */
export function waitForRunCreated(): Promise<void> {
  return runCreatedPromise;
}

export function confirmRunOutcome(runId: string, victory: boolean) {
  apiFetch("/api/run", {
    method: "POST",
    body: JSON.stringify({ action: "end", runId, victory }),
  }).catch(console.error);
}

export interface RunState {
  runId: string | null;
  pendingOutcome: boolean;
  endedRunId: string | null;
  inferredOutcome: boolean | null;
  finalFloor: number;
  confirmOutcome: (victory: boolean) => void;
}

export function useRunTracker(gameState: GameState | null, userId: string | null = null, wasDisconnected = false): RunState {
  const runId = useRef<string | null>(null);
  const prevStateType = useRef<string | null>(null);
  const initialized = useRef(false);
  const runStarted = useRef(false);
  const hadDisconnect = useRef(false);

  // Track if we experienced a disconnect during this run
  if (wasDisconnected && runStarted.current) {
    hadDisconnect.current = true;
  }
  const lastFloor = useRef(0);
  const lastAct = useRef(1);
  const lastWasBoss = useRef(false);
  const bossesFought = useRef<Set<string>>(new Set());
  const lastPlayerHp = useRef(0);
  const lastEnemiesAllDead = useRef(false);
  const lastDeckNames = useRef<string[]>([]);
  const lastRelicNames = useRef<string[]>([]);
  const lastCombatEnemyName = useRef<string | null>(null);

  const [pending, setPending] = useState<{
    active: boolean;
    runId: string | null;
    inferred: boolean | null;
  }>({ active: false, runId: null, inferred: null });

  if (!initialized.current) {
    initialized.current = true;
    runId.current = loadRunId();
    runStarted.current = runId.current !== null;

    // Restore narrative for existing run (app restart mid-run)
    // If runId doesn't match stored narrative, stale data is discarded
    if (runId.current) {
      restoreForRun(runId.current);
    }
  }

  const confirmOutcome = useCallback(
    (victory: boolean) => {
      if (pending.runId) {
        confirmRunOutcome(pending.runId, victory);
      }
      setPending({ active: false, runId: null, inferred: null });
    },
    [pending.runId]
  );

  if (!gameState)
    return {
      runId: runId.current,
      pendingOutcome: pending.active,
      endedRunId: pending.runId,
      inferredOutcome: pending.inferred,
      finalFloor: lastFloor.current,
      confirmOutcome,
    };

  const currentType = gameState.state_type;
  const prevType = prevStateType.current;
  prevStateType.current = currentType;

  // ─── Track run state for analytics ───
  if (hasRun(gameState)) {
    lastFloor.current = gameState.run.floor;
    lastAct.current = gameState.run.act;
  }

  // Track player HP and enemy state for outcome detection
  const localCombatPlayer = isCombatState(gameState) ? getPlayer(gameState) : null;
  if (isCombatState(gameState) && localCombatPlayer && gameState.battle) {
    lastPlayerHp.current = localCombatPlayer.hp;
    lastEnemiesAllDead.current = gameState.battle.enemies.every(
      (e) => e.hp <= 0
    );
    // Track combat enemy for cause of death
    if (gameState.battle.enemies.length > 0) {
      const mainEnemy = gameState.battle.enemies.find(
        (e) => !e.status?.some((s) => s.name === "Minion")
      );
      lastCombatEnemyName.current =
        mainEnemy?.name ?? gameState.battle.enemies[0].name;
    }
  }

  // Track deck and relics from any state that has them
  if (localCombatPlayer) {
    const p = localCombatPlayer;
    const deck = [
      ...(p.hand ?? []),
      ...(p.draw_pile ?? []),
      ...(p.discard_pile ?? []),
      ...(p.exhaust_pile ?? []),
    ];
    if (deck.length > 0) {
      lastDeckNames.current = deck.map((c) => c.name);
    }
    if (p.relics.length > 0) {
      lastRelicNames.current = p.relics.map((r) => r.name);
    }
  }

  // Track bosses
  if (
    currentType === "boss" &&
    isCombatState(gameState) &&
    gameState.battle?.enemies
  ) {
    lastWasBoss.current = true;
    for (const enemy of gameState.battle.enemies) {
      const isMinion = enemy.status?.some(
        (s) => s.id === "MINION" || s.name === "Minion"
      );
      if (!isMinion) {
        bossesFought.current.add(enemy.name);
      }
    }
  }

  // Boss victory: moved from boss combat to combat_rewards
  if (prevType === "boss" && currentType === "combat_rewards") {
    lastEnemiesAllDead.current = true;
  }

  const isInRun = currentType !== "menu";
  const wasInMenu = prevType === "menu" || prevType === null;

  // ─── New run detected ───
  if (isInRun && wasInMenu && !runStarted.current) {
    const newRunId = generateRunId();
    runId.current = newRunId;
    runStarted.current = true;
    lastWasBoss.current = false;
    lastFloor.current = 0;
    lastAct.current = 1;
    lastPlayerHp.current = 0;
    lastEnemiesAllDead.current = false;
    lastDeckNames.current = [];
    lastRelicNames.current = [];
    lastCombatEnemyName.current = null;
    bossesFought.current = new Set();
    saveRunId(newRunId);

    const character = getCharacter(gameState);
    const ascension = hasRun(gameState) ? gameState.run.ascension : 0;

    runCreatedPromise = apiFetch("/api/run", {
      method: "POST",
      body: JSON.stringify({
        action: "start",
        runId: newRunId,
        character: character ?? "Unknown",
        ascension,
        gameMode: gameState.game_mode ?? "singleplayer",
        userId,
      }),
    }).then(() => {}).catch(console.error);

    // Initialize run narrative for evaluation context
    initializeNarrative(newRunId, character ?? "unknown", ascension);
    clearEvaluationRegistry();

    if (typeof window !== "undefined") {
      localStorage.removeItem("sts2-deck");
      localStorage.removeItem("sts2-player");
      localStorage.removeItem("sts2-eval-cache");
      localStorage.removeItem("sts2-shop-eval-cache");
      localStorage.removeItem("sts2-map-eval-cache");
      localStorage.removeItem("sts2-event-eval-cache");
      localStorage.removeItem("sts2-rest-eval-cache");
    }

    console.log("[RunTracker] New run started:", newRunId, character);
  }

  // ─── Run ended ───
  if (
    currentType === "menu" &&
    prevType !== "menu" &&
    prevType !== null &&
    runStarted.current
  ) {
    const endedRunId = runId.current;
    if (endedRunId) {
      // If we had a disconnect, this is likely a crash/restart, not a death.
      // Treat as unknown outcome and let the user confirm.
      const wasGameCrash = hadDisconnect.current;
      hadDisconnect.current = false;

      const victory = wasGameCrash
        ? null // unknown — let user confirm
        : inferOutcome(
            prevType,
            lastWasBoss.current,
            lastPlayerHp.current,
            lastEnemiesAllDead.current
          );

      // Determine cause of death
      let causeOfDeath: string | null = null;
      if (victory === false && lastCombatEnemyName.current) {
        causeOfDeath = lastCombatEnemyName.current;
      }

      setPending({ active: true, runId: endedRunId, inferred: victory });

      const bossNames = [...bossesFought.current];

      apiFetch("/api/run", {
        method: "POST",
        body: JSON.stringify({
          action: "end",
          runId: endedRunId,
          victory,
          finalFloor: lastFloor.current,
          bossesFought: bossNames.length > 0 ? bossNames : null,
          finalDeck: lastDeckNames.current.length > 0 ? lastDeckNames.current : null,
          finalRelics: lastRelicNames.current.length > 0 ? lastRelicNames.current : null,
          finalDeckSize: lastDeckNames.current.length || null,
          actReached: lastAct.current,
          causeOfDeath,
          narrative: getNarrative(),
        }),
      }).catch(console.error);

      const outcomeLabel =
        victory === true
          ? "VICTORY"
          : victory === false
            ? "DEATH"
            : "QUIT";
      console.log(
        `[RunTracker] Run ended (${outcomeLabel}):`,
        endedRunId,
        `floor ${lastFloor.current}`,
        causeOfDeath ? `killed by ${causeOfDeath}` : "",
        `deck: ${lastDeckNames.current.length} cards`
      );
    }

    // Clear run narrative and evaluation registry
    clearNarrative();
    clearEvaluationRegistry();

    runId.current = null;
    runStarted.current = false;
    lastWasBoss.current = false;
    bossesFought.current = new Set();
    saveRunId(null);
  }

  // Clear pending when new run starts
  if (isInRun && pending.active) {
    setPending({ active: false, runId: null, inferred: null });
  }

  return {
    runId: runId.current,
    pendingOutcome: pending.active,
    endedRunId: pending.runId,
    inferredOutcome: pending.inferred,
    finalFloor: lastFloor.current,
    confirmOutcome,
  };
}

function getCharacter(state: GameState): string | null {
  return getPlayer(state)?.character ?? null;
}
