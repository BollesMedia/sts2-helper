"use client";

import { useRef } from "react";
import type { GameState } from "@/lib/types/game-state";
import { hasRun } from "@/lib/types/game-state";

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
 * Tracks run lifecycle: detects new run start (menu → in-run),
 * creates a run record in Supabase, and detects run end (back to menu).
 */
export function useRunTracker(gameState: GameState | null): string | null {
  const runId = useRef<string | null>(null);
  const prevStateType = useRef<string | null>(null);
  const initialized = useRef(false);
  const runStarted = useRef(false);

  if (!initialized.current) {
    initialized.current = true;
    runId.current = loadRunId();
    // If we have a saved run ID, the run was in progress
    runStarted.current = runId.current !== null;
  }

  if (!gameState) return runId.current;

  const currentType = gameState.state_type;
  const prevType = prevStateType.current;
  prevStateType.current = currentType;

  const isInRun = currentType !== "menu";
  const wasInMenu = prevType === "menu" || prevType === null;

  // ─── New run detected: was in menu, now in a run ───
  if (isInRun && wasInMenu && !runStarted.current) {
    const newRunId = generateRunId();
    runId.current = newRunId;
    runStarted.current = true;
    saveRunId(newRunId);

    // Get character and ascension from game state
    const character = getCharacter(gameState);
    const ascension = hasRun(gameState) ? gameState.run.ascension : 0;

    // Create run record async
    fetch("/api/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "start",
        runId: newRunId,
        character: character ?? "Unknown",
        ascension,
      }),
    }).catch(console.error);

    // Clear stale deck data from previous run
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
      // We can't easily detect victory vs death from the menu state
      // Log the end with floor info from what we last saw
      fetch("/api/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "end",
          runId: endedRunId,
        }),
      }).catch(console.error);

      console.log("[RunTracker] Run ended:", endedRunId);
    }

    runId.current = null;
    runStarted.current = false;
    saveRunId(null);
  }

  return runId.current;
}

function getCharacter(state: GameState): string | null {
  if ("battle" in state && state.battle?.player) {
    return state.battle.player.character;
  }
  if ("map" in state && "map" in state) {
    const mapState = state as { map: { player: { character: string } } };
    return mapState.map?.player?.character ?? null;
  }
  if ("rewards" in state) {
    const rewardsState = state as { rewards: { player: { character: string } } };
    return rewardsState.rewards?.player?.character ?? null;
  }
  return null;
}
