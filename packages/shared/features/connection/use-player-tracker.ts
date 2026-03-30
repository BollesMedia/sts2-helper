"use client";

import { useRef } from "react";
import type { GameState } from "../../types/game-state";
import { isCombatState } from "../../types/game-state";

const STORAGE_KEY = "sts2-player";

export interface TrackedPlayer {
  character: string;
  hp: number;
  maxHp: number;
  gold: number;
  maxEnergy: number;
  relics: { id: string; name: string; description: string }[];
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

  if (isCombatState(gameState) && gameState.battle?.player) {
    const p = gameState.battle.player;
    setPlayer(player, {
      character: p.character,
      hp: p.hp,
      maxHp: p.max_hp,
      gold: p.gold,
      maxEnergy: p.max_energy,
      relics: p.relics,
      cardRemovalCost: player.current?.cardRemovalCost ?? null,
    });
  }

  if (gameState.state_type === "combat_rewards") {
    const p = gameState.rewards.player;
    setPlayer(player, {
      character: p.character,
      hp: p.hp,
      maxHp: p.max_hp,
      gold: p.gold,
      maxEnergy: player.current?.maxEnergy ?? 3,
      relics: player.current?.relics ?? [],
      cardRemovalCost: player.current?.cardRemovalCost ?? null,
    });
  }

  if (gameState.state_type === "map") {
    const p = gameState.map.player;
    setPlayer(player, {
      character: p.character,
      hp: p.hp,
      maxHp: p.max_hp,
      gold: p.gold,
      maxEnergy: player.current?.maxEnergy ?? 3,
      relics: player.current?.relics ?? [],
      cardRemovalCost: player.current?.cardRemovalCost ?? null,
    });
  }

  if (gameState.state_type === "shop") {
    const p = gameState.shop.player;
    const removalItem = gameState.shop.items.find(
      (i) => i.category === "card_removal"
    );
    setPlayer(player, {
      character: p.character,
      hp: p.hp,
      maxHp: p.max_hp,
      gold: p.gold,
      maxEnergy: player.current?.maxEnergy ?? 3,
      relics: player.current?.relics ?? [],
      cardRemovalCost: removalItem?.cost ?? player.current?.cardRemovalCost ?? null,
    });
  }

  if (gameState.state_type === "event" && "event" in gameState) {
    const p = gameState.event.player;
    setPlayer(player, {
      character: p.character,
      hp: p.hp,
      maxHp: p.max_hp,
      gold: p.gold,
      maxEnergy: player.current?.maxEnergy ?? 3,
      relics: player.current?.relics ?? [],
      cardRemovalCost: player.current?.cardRemovalCost ?? null,
    });
  }

  if (gameState.state_type === "rest_site" && "rest_site" in gameState) {
    const p = gameState.rest_site.player;
    setPlayer(player, {
      character: p.character,
      hp: p.hp,
      maxHp: p.max_hp,
      gold: p.gold,
      maxEnergy: player.current?.maxEnergy ?? 3,
      relics: player.current?.relics ?? [],
      cardRemovalCost: player.current?.cardRemovalCost ?? null,
    });
  }

  return player.current;
}
