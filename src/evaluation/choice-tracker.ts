"use client";

import { useEffect, useRef } from "react";
import type { GameState, GameCard } from "@/lib/types/game-state";
import { hasPlayer } from "@/lib/types/game-state";

interface PendingChoice {
  choiceType: string;
  offeredItemIds: string[];
  evaluationIds: string[];
  floor: number;
  act: number;
  previousDeckIds: Set<string>;
}

/**
 * Tracks player choices by diffing game state transitions.
 * When the state changes from a decision screen (card_reward, shop)
 * to the next state, we diff the deck to detect what was chosen.
 */
export function useChoiceTracker(
  gameState: GameState | null,
  deckCards: GameCard[]
) {
  const pendingChoice = useRef<PendingChoice | null>(null);
  const previousStateType = useRef<string | null>(null);

  useEffect(() => {
    if (!gameState) return;

    const currentType = gameState.state_type;
    const prevType = previousStateType.current;
    previousStateType.current = currentType;

    // Entering a decision screen — record what's being offered
    if (currentType === "card_reward" && prevType !== "card_reward") {
      const state = gameState as Extract<GameState, { state_type: "card_reward" }>;
      pendingChoice.current = {
        choiceType: "card_reward",
        offeredItemIds: state.cards.map((c) => c.id),
        evaluationIds: [],
        floor: 0, // TODO: get from context
        act: 1,
        previousDeckIds: new Set(deckCards.map((c) => c.id)),
      };
    }

    // Leaving a decision screen — diff to detect choice
    if (prevType === "card_reward" && currentType !== "card_reward") {
      const pending = pendingChoice.current;
      if (pending) {
        const currentDeckIds = new Set(deckCards.map((c) => c.id));
        const newCards = deckCards.filter(
          (c) => !pending.previousDeckIds.has(c.id)
        );

        const chosenItemId = newCards.length > 0 ? newCards[0].id : null;

        // Log choice async
        logChoice({
          choiceType: chosenItemId ? "card_reward" : "skip",
          offeredItemIds: pending.offeredItemIds,
          chosenItemId,
          floor: pending.floor,
          act: pending.act,
        }).catch(console.error);

        pendingChoice.current = null;
      }
    }
  }, [gameState, deckCards]);
}

async function logChoice(choice: {
  choiceType: string;
  offeredItemIds: string[];
  chosenItemId: string | null;
  floor: number;
  act: number;
}) {
  // TODO: implement Supabase logging via API route
  console.log("[ChoiceTracker]", choice);
}
