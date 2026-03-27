"use client";

import { useEffect, useRef, useState } from "react";
import type { GameState, CombatCard } from "@/lib/types/game-state";
import { isCombatState } from "@/lib/types/game-state";

interface DeckState {
  cards: CombatCard[];
  /** Whether the deck was sourced from combat (ground truth) or inferred */
  isVerified: boolean;
}

/**
 * Maintains a running deck list that stays accurate between combats.
 *
 * Ground truth: During combat, the mod exposes all piles. This is always
 * authoritative and overwrites any local tracking.
 *
 * Between combats: We track card additions (from card_reward picks) and
 * removals optimistically. On next combat entry, we reconcile against
 * the real deck and log any mismatches.
 */
export function useDeckTracker(gameState: GameState | null): CombatCard[] {
  const [deck, setDeck] = useState<DeckState>({ cards: [], isVerified: false });
  const prevStateType = useRef<string | null>(null);
  const offeredCards = useRef<{ id: string; name: string; description: string }[] | null>(null);

  useEffect(() => {
    if (!gameState) return;

    const currentType = gameState.state_type;
    const prevType = prevStateType.current;

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
        if (deck.cards.length > 0 && !deck.isVerified) {
          const trackedNames = deck.cards.map((c) => c.name).sort();
          const actualNames = combatDeck.map((c) => c.name).sort();

          if (JSON.stringify(trackedNames) !== JSON.stringify(actualNames)) {
            const added = actualNames.filter(
              (n) => !trackedNames.includes(n)
            );
            const removed = trackedNames.filter(
              (n) => !actualNames.includes(n)
            );
            if (added.length > 0 || removed.length > 0) {
              console.log(
                "[DeckTracker] Reconciliation mismatch:",
                { added, removed, tracked: trackedNames.length, actual: actualNames.length }
              );
            }
          }
        }

        setDeck({ cards: combatDeck, isVerified: true });
      }
    }

    // ─── ENTERING card_reward: snapshot offered cards ───
    if (currentType === "card_reward" && prevType !== "card_reward") {
      offeredCards.current = gameState.card_reward.cards.map((c) => ({
        id: c.id,
        name: c.name,
        description: c.description,
      }));
    }

    // ─── LEAVING card_reward: infer what was picked ───
    if (prevType === "card_reward" && currentType !== "card_reward") {
      const offered = offeredCards.current;
      if (offered && deck.cards.length > 0) {
        // If entering combat, it'll sync ground truth — no need to guess.
        // If going to map or another screen, we can't know for certain
        // which card was picked (the mod doesn't tell us).
        // For non-combat transitions, we'll mark deck as unverified
        // so the next combat sync triggers reconciliation.
        if (!isCombatState(gameState)) {
          setDeck((prev) => ({ ...prev, isVerified: false }));
        }
      }
      offeredCards.current = null;
    }

    // ─── ENTERING card_select (transform/upgrade): track changes ───
    if (
      currentType === "card_select" &&
      prevType !== "card_select" &&
      gameState.card_select
    ) {
      // card_select shows the full deck for selection — use it as truth
      const selectCards = gameState.card_select.cards;
      if (selectCards.length > 0) {
        setDeck({
          cards: selectCards.map((c) => ({
            name: c.name,
            description: c.description,
            keywords: c.keywords,
          })),
          isVerified: true,
        });
      }
    }

    prevStateType.current = currentType;
  }, [gameState, deck.cards, deck.isVerified]);

  return deck.cards;
}
