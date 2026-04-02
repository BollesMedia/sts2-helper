"use client";

import { useRef } from "react";
import type { GameState } from "../../types/game-state";
import { isCombatState, getPlayer } from "../../types/game-state";

const STORAGE_KEY = "sts2-player";

export interface TrackedPlayer {
  character: string;
  hp: number;
  maxHp: number;
  gold: number;
  maxEnergy: number;
  relics: { id: string; name: string; description: string }[];
  potions: { name: string; description: string }[];
  cardRemovalCost: number | null;
}

function loadFromStorage(): TrackedPlayer | null {
  if (typeof window === "undefined") return null;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) : null;
  } catch {
    return null;
  }
}

function saveToStorage(player: TrackedPlayer) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(player));
  } catch {
    // storage full or unavailable
  }
}

function setPlayer(ref: React.RefObject<TrackedPlayer | null>, value: TrackedPlayer) {
  ref.current = value;
  saveToStorage(value);
}

/**
 * Persists the last known player info across state transitions and page reloads.
 * Updates from any state that includes player data.
 */
export function usePlayerTracker(gameState: GameState | null): TrackedPlayer | null {
  const player = useRef<TrackedPlayer | null>(null);
  const initialized = useRef(false);

  // Load from localStorage on first render
  if (!initialized.current) {
    initialized.current = true;
    player.current = loadFromStorage();
  }

  if (!gameState) return player.current;

  // Unified player extraction — works with v0.3.2 (top-level) and v0.3.0 (nested)
  const p = getPlayer(gameState);
  if (p && gameState.state_type !== "menu") {
    const isCombat = isCombatState(gameState);
    const bp = p as { energy?: number; max_energy?: number; potions?: { name: string; description: string }[]; relics?: { name: string; description: string }[] };

    // Shop: extract removal cost
    const removalItem = gameState.state_type === "shop" && "shop" in gameState
      ? (gameState as { shop: { items?: { category: string; cost: number }[] } }).shop?.items?.find((i) => i.category === "card_removal")
      : null;

    setPlayer(player, {
      character: p.character,
      hp: p.hp,
      maxHp: p.max_hp,
      gold: p.gold,
      maxEnergy: (isCombat ? bp.max_energy : undefined) ?? player.current?.maxEnergy ?? 3,
      relics: bp.relics?.map((r) => ({ id: (r as { id?: string }).id ?? "", name: r.name, description: r.description })) ?? player.current?.relics ?? [],
      potions: (bp.potions ?? player.current?.potions ?? []).map((pot) => ({ name: pot.name, description: pot.description })),
      cardRemovalCost: removalItem?.cost ?? player.current?.cardRemovalCost ?? null,
    });
  }

  return player.current;
}
