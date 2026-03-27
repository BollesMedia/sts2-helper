"use client";

import { useCallback, useRef, useState } from "react";
import type { GameState } from "@/lib/types/game-state";
import { hasRun, isCombatState } from "@/lib/types/game-state";

const STORAGE_KEY = "sts2-run-id";

function generateRunId(): string {
  return `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function loadRunId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
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
  } catch {}
}

/**
 * Infer run outcome from the last known state before returning to menu.
 *
 * - Death: last state was combat (monster/elite/boss)
 * - Victory: last state was boss combat or combat_rewards after a boss
 * - Quit: anything else (map, shop, event, etc.)
 */
function inferOutcome(
  lastStateType: string | null,
  lastWasBoss: boolean
): boolean | null {
  if (!lastStateType) return null;

  // Victory: was in boss fight or collecting boss rewards
  if (lastWasBoss) return true;
  if (lastStateType === "combat_rewards" && lastWasBoss) return true;

  // Death: was in any combat
  if (["monster", "elite", "boss"].includes(lastStateType)) return false;

  // Quit or unknown
  return null;
}

export interface RunState {
  runId: string | null;
  /** True when the run just ended and we're waiting for user to confirm outcome */
  pendingOutcome: boolean;
  /** The run ID of the ended run (for confirming outcome) */
  endedRunId: string | null;
  inferredOutcome: boolean | null;
  finalFloor: number;
  /** Call to confirm the outcome and dismiss the buttons */
  confirmOutcome: (victory: boolean) => void;
}

/**
 * Tracks run lifecycle: detects new run start (menu → in-run),
 * creates a run record in Supabase, and detects run end (back to menu).
 * Infers victory/death from the last known game state.
 */
export function useRunTracker(gameState: GameState | null): RunState {
  const runId = useRef<string | null>(null);
  const prevStateType = useRef<string | null>(null);
  const initialized = useRef(false);
  const runStarted = useRef(false);
  const lastFloor = useRef(0);
  const lastWasBoss = useRef(false);
  const [pending, setPending] = useState<{
    active: boolean;
    runId: string | null;
    inferred: boolean | null;
  }>({ active: false, runId: null, inferred: null });

  if (!initialized.current) {
    initialized.current = true;
    runId.current = loadRunId();
    runStarted.current = runId.current !== null;
  }

  const confirmOutcome = useCallback((victory: boolean) => {
    if (pending.runId) {
      confirmRunOutcome(pending.runId, victory);
    }
    setPending({ active: false, runId: null, inferred: null });
  }, [pending.runId]);

  if (!gameState) return {
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

  // Track floor and boss state for outcome inference
  if (hasRun(gameState)) {
    lastFloor.current = gameState.run.floor;
  }
  if (currentType === "boss") {
    lastWasBoss.current = true;
  }
  // Reset boss flag when moving to non-combat after boss rewards
  if (
    prevType === "combat_rewards" &&
    !["monster", "elite", "boss"].includes(currentType)
  ) {
    // Keep lastWasBoss if we just beat a boss and are collecting rewards
  }

  const isInRun = currentType !== "menu";
  const wasInMenu = prevType === "menu" || prevType === null;

  // ─── New run detected: was in menu, now in a run ───
  if (isInRun && wasInMenu && !runStarted.current) {
    const newRunId = generateRunId();
    runId.current = newRunId;
    runStarted.current = true;
    lastWasBoss.current = false;
    lastFloor.current = 0;
    saveRunId(newRunId);

    const character = getCharacter(gameState);
    const ascension = hasRun(gameState) ? gameState.run.ascension : 0;

    fetch("/api/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "start",
        runId: newRunId,
        character: character ?? "Unknown",
        ascension,
        gameMode: "singleplayer",
      }),
    }).catch(console.error);

    // Clear stale data from previous run
    if (typeof window !== "undefined") {
      localStorage.removeItem("sts2-deck");
      localStorage.removeItem("sts2-eval-cache");
      localStorage.removeItem("sts2-shop-eval-cache");
      localStorage.removeItem("sts2-map-eval-cache");
      localStorage.removeItem("sts2-event-eval-cache");
    }

    console.log("[RunTracker] New run started:", newRunId, character);
  }

  // ─── Run ended: was in a run, now in menu ───
  if (currentType === "menu" && prevType !== "menu" && prevType !== null && runStarted.current) {
    const endedRunId = runId.current;
    if (endedRunId) {
      const victory = inferOutcome(prevType, lastWasBoss.current);

      // Set pending outcome for UI buttons
      setPending({ active: true, runId: endedRunId, inferred: victory });

      // Log end with inferred outcome (user can override via buttons)
      fetch("/api/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "end",
          runId: endedRunId,
          victory,
          finalFloor: lastFloor.current,
        }),
      }).catch(console.error);

      const outcomeLabel = victory === true ? "VICTORY" : victory === false ? "DEATH" : "QUIT";
      console.log(`[RunTracker] Run ended (${outcomeLabel}):`, endedRunId, `floor ${lastFloor.current}`);
    }

    runId.current = null;
    runStarted.current = false;
    lastWasBoss.current = false;
    saveRunId(null);
  }

  // ─── Clear pending when new run starts ───
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

/**
 * Call this to confirm or override the run outcome.
 */
export function confirmRunOutcome(runId: string, victory: boolean) {
  fetch("/api/run", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "end",
      runId,
      victory,
    }),
  }).catch(console.error);
}

function getCharacter(state: GameState): string | null {
  if (isCombatState(state) && state.battle?.player) {
    return state.battle.player.character;
  }
  if (state.state_type === "map") {
    return state.map.player.character;
  }
  if (state.state_type === "combat_rewards") {
    return state.rewards.player.character;
  }
  if (state.state_type === "event") {
    return state.event.player.character;
  }
  return null;
}
