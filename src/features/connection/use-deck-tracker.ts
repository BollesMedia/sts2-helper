"use client";

import { useEffect, useRef } from "react";
import type { GameState, CombatCard } from "@/lib/types/game-state";
import { isCombatState } from "@/lib/types/game-state";

/**
 * Maintains a running deck list that stays accurate between combats.
 *
 * Ground truth: During combat, the mod exposes all piles. This is always
 * authoritative and overwrites any local tracking.
 *
 * Between combats: Deck is marked unverified. On next combat entry,
 * we reconcile against the real deck and log any mismatches.
 */
export function useDeckTracker(gameState: GameState | null): CombatCard[] {
  const deckCards = useRef<CombatCard[]>([]);
  const isVerified = useRef(false);
  const prevStateType = useRef<string | null>(null);

  if (!gameState) return deckCards.current;

  const currentType = gameState.state_type;
  const prevType = prevStateType.current;
  prevStateType.current = currentType;

  // ─── COMBAT: Ground truth sync ───
  if (isCombatState(gameState) && gameState.battle?.player) {
    const p = gameState.battle.player;
    const combatDeck = [
      ...(p.hand ?? []),
      ...(p.draw_pile ?? []),
      ...(p.discard_pile ?? []),
      ...(p.exhaust_pile ?? []),
    ];

    if (combatDeck.length > 0) {
      // Reconcile: check if our tracked deck matches combat reality
      if (deckCards.current.length > 0 && !isVerified.current) {
        const trackedNames = deckCards.current.map((c) => c.name).sort();
        const actualNames = combatDeck.map((c) => c.name).sort();

        if (JSON.stringify(trackedNames) !== JSON.stringify(actualNames)) {
          const added = actualNames.filter((n) => !trackedNames.includes(n));
          const removed = trackedNames.filter((n) => !actualNames.includes(n));
          if (added.length > 0 || removed.length > 0) {
            console.log("[DeckTracker] Reconciliation mismatch:", {
              added,
              removed,
              tracked: trackedNames.length,
              actual: actualNames.length,
            });
          }
        }
      }

      deckCards.current = combatDeck;
      isVerified.current = true;
    }
  }

  // ─── LEAVING card_reward: mark unverified ───
  if (prevType === "card_reward" && currentType !== "card_reward") {
    isVerified.current = false;
  }

  // ─── card_select: use as truth source (shows full deck) ───
  if (
    currentType === "card_select" &&
    prevType !== "card_select" &&
    "card_select" in gameState
  ) {
    const selectCards = gameState.card_select.cards;
    if (selectCards.length > 0) {
      deckCards.current = selectCards.map((c) => ({
        name: c.name,
        description: c.description,
        keywords: c.keywords,
      }));
      isVerified.current = true;
    }
  }

  return deckCards.current;
}
