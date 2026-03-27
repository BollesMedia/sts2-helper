"use client";

import { useRef } from "react";
import type { GameState } from "@/lib/types/game-state";
import { isCombatState } from "@/lib/types/game-state";

export interface TrackedPlayer {
  character: string;
  hp: number;
  maxHp: number;
  gold: number;
  maxEnergy: number;
  relics: { id: string; name: string; description: string }[];
}

/**
 * Persists the last known player info across state transitions.
 * Updates from any state that includes player data (combat, map,
 * combat_rewards, shop, event, rest_site, etc).
 */
export function usePlayerTracker(gameState: GameState | null): TrackedPlayer | null {
  const player = useRef<TrackedPlayer | null>(null);

  if (!gameState) return player.current;

  if (isCombatState(gameState) && gameState.battle?.player) {
    const p = gameState.battle.player;
    player.current = {
      character: p.character,
      hp: p.hp,
      maxHp: p.max_hp,
      gold: p.gold,
      maxEnergy: p.max_energy,
      relics: p.relics,
    };
  }

  if (gameState.state_type === "combat_rewards") {
    const p = gameState.rewards.player;
    player.current = {
      character: p.character,
      hp: p.hp,
      maxHp: p.max_hp,
      gold: p.gold,
      maxEnergy: player.current?.maxEnergy ?? 3,
      relics: player.current?.relics ?? [],
    };
  }

  if (gameState.state_type === "map") {
    const p = gameState.map.player;
    player.current = {
      character: p.character,
      hp: p.hp,
      maxHp: p.max_hp,
      gold: p.gold,
      maxEnergy: player.current?.maxEnergy ?? 3,
      relics: player.current?.relics ?? [],
    };
  }

  if (gameState.state_type === "shop" && "shop" in gameState) {
    const p = gameState.shop.player;
    player.current = {
      character: p.character,
      hp: p.hp,
      maxHp: p.max_hp,
      gold: p.gold,
      maxEnergy: player.current?.maxEnergy ?? 3,
      relics: player.current?.relics ?? [],
    };
  }

  if (gameState.state_type === "event" && "event" in gameState) {
    const p = gameState.event.player;
    player.current = {
      character: p.character,
      hp: p.hp,
      maxHp: p.max_hp,
      gold: p.gold,
      maxEnergy: player.current?.maxEnergy ?? 3,
      relics: player.current?.relics ?? [],
    };
  }

  if (gameState.state_type === "rest_site" && "rest_site" in gameState) {
    const p = gameState.rest_site.player;
    player.current = {
      character: p.character,
      hp: p.hp,
      maxHp: p.max_hp,
      gold: p.gold,
      maxEnergy: player.current?.maxEnergy ?? 3,
      relics: player.current?.relics ?? [],
    };
  }

  return player.current;
}
