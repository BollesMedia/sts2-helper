"use client";

import { useRef } from "react";
import type { GameState, ShopState } from "../../types/game-state";
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
    // In combat, getPlayer returns BattlePlayer (has energy, max_energy, full relics/potions)
    // In non-combat v0.3.2, PlayerSummary now also has relics/potions/status
    const maxEnergy = "max_energy" in p ? (p.max_energy ?? 3) : (player.current?.maxEnergy ?? 3);
    const relics = "relics" in p && p.relics
      ? p.relics.map((r) => ({ id: "id" in r ? r.id : "", name: r.name, description: r.description }))
      : (player.current?.relics ?? []);
    const potions = "potions" in p && p.potions
      ? p.potions.map((pot) => ({ name: pot.name, description: pot.description }))
      : (player.current?.potions ?? []);

    // Shop: extract removal cost
    const removalItem = gameState.state_type === "shop" && "shop" in gameState
      ? (gameState as ShopState).shop?.items?.find((i) => i.category === "card_removal")
      : null;

    setPlayer(player, {
      character: p.character,
      hp: p.hp,
      maxHp: p.max_hp,
      gold: p.gold,
      maxEnergy,
      relics,
      potions,
      cardRemovalCost: removalItem?.cost ?? player.current?.cardRemovalCost ?? null,
    });
  }

  return player.current;
}
