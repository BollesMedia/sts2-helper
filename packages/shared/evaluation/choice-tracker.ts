"use client";
import { apiFetch } from "../lib/api-client";
import { waitForRunCreated } from "../features/connection/use-run-tracker";

import { useRef } from "react";
import type { GameState, CombatCard } from "../types/game-state";
import { hasRun } from "../types/game-state";
import { getUserId } from "../lib/get-user-id";

interface PendingChoice {
  choiceType: string;
  offeredItemIds: string[];
  floor: number;
  act: number;
  previousDeckNames: Set<string>;
}

/**
 * Tracks player choices by diffing game state transitions.
 * When the state changes from a decision screen to the next state,
 * diffs the deck to detect what was chosen and logs to Supabase.
 */
export function useChoiceTracker(
  gameState: GameState | null,
  deckCards: CombatCard[],
  runId: string | null
) {
  const pendingChoice = useRef<PendingChoice | null>(null);
  const prevStateType = useRef<string | null>(null);

  if (!gameState) return;

  const currentType = gameState.state_type;
  const prevType = prevStateType.current;
  prevStateType.current = currentType;

  const run = hasRun(gameState) ? gameState.run : null;

  // ─── Entering card_reward: record what's offered ───
  if (currentType === "card_reward" && prevType !== "card_reward") {
    pendingChoice.current = {
      choiceType: "card_reward",
      offeredItemIds: gameState.card_reward.cards.map((c) => c.id),
      floor: run?.floor ?? 0,
      act: run?.act ?? 1,
      previousDeckNames: new Set(deckCards.map((c) => c.name)),
    };
  }

  // ─── Leaving card_reward: detect choice ───
  if (prevType === "card_reward" && currentType !== "card_reward") {
    const pending = pendingChoice.current;
    if (pending) {
      const newCards = deckCards.filter(
        (c) => !pending.previousDeckNames.has(c.name)
      );
      const chosenItemId = newCards.length > 0 ? newCards[0].name : null;

      logChoice({
        runId,
        choiceType: chosenItemId ? "card_reward" : "skip",
        floor: pending.floor,
        act: pending.act,
        offeredItemIds: pending.offeredItemIds,
        chosenItemId,
      });

      pendingChoice.current = null;
    }
  }

  // ─── Entering shop: record what's available ───
  if (currentType === "shop" && prevType !== "shop") {
    const shopItems = gameState.shop.items
      .filter((i) => i.is_stocked)
      .map((i) => {
        if (i.category === "card") return i.card_id ?? `card_${i.index}`;
        if (i.category === "relic") return i.relic_id ?? `relic_${i.index}`;
        if (i.category === "potion") return i.potion_id ?? `potion_${i.index}`;
        return "CARD_REMOVAL";
      });

    pendingChoice.current = {
      choiceType: "shop",
      offeredItemIds: shopItems,
      floor: run?.floor ?? 0,
      act: run?.act ?? 1,
      previousDeckNames: new Set(deckCards.map((c) => c.name)),
    };
  }

  // ─── Leaving shop: detect purchases ───
  if (prevType === "shop" && currentType !== "shop") {
    const pending = pendingChoice.current;
    if (pending) {
      const newCards = deckCards.filter(
        (c) => !pending.previousDeckNames.has(c.name)
      );

      // Log each new card as a separate purchase choice
      if (newCards.length > 0) {
        for (const card of newCards) {
          logChoice({
            runId,
            choiceType: "shop_purchase",
            floor: pending.floor,
            act: pending.act,
            offeredItemIds: pending.offeredItemIds,
            chosenItemId: card.name,
          });
        }
      } else {
        // Left shop without buying cards (might have bought relics/potions)
        logChoice({
          runId,
          choiceType: "shop_browse",
          floor: pending.floor,
          act: pending.act,
          offeredItemIds: pending.offeredItemIds,
          chosenItemId: null,
        });
      }

      pendingChoice.current = null;
    }
  }
}

function logChoice(choice: {
  runId: string | null;
  choiceType: string;
  floor: number;
  act: number;
  offeredItemIds: string[];
  chosenItemId: string | null;
}) {
  console.log("[ChoiceTracker]", choice.choiceType, choice.chosenItemId ?? "skip");

  // Wait for the run to be persisted before logging choices (FK constraint)
  waitForRunCreated()
    .then(() =>
      apiFetch("/api/choice", {
        method: "POST",
        body: JSON.stringify({ ...choice, userId: getUserId() }),
      })
    )
    .catch(console.error);
}
