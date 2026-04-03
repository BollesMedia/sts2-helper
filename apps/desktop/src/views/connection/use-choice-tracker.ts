"use client";
import { apiFetch } from "@sts2/shared/lib/api-client";
import { waitForRunCreated } from "./use-run-tracker";
import { appendDecision, addMilestone } from "@sts2/shared/evaluation/run-narrative";
import { getLastEvaluation } from "@sts2/shared/evaluation/last-evaluation-registry";
import type { DecisionType } from "@sts2/shared/evaluation/run-narrative";

import { useRef } from "react";
import type { GameState, CombatCard } from "@sts2/shared/types/game-state";
import { hasRun } from "@sts2/shared/types/game-state";
import { getUserId } from "@sts2/shared/lib/get-user-id";

interface PendingChoice {
  choiceType: string;
  offeredItemIds: string[];
  floor: number;
  act: number;
  previousDeckNames: Set<string>;
  previousHp?: number;
}

/**
 * Tracks player choices by diffing game state transitions.
 * When the state changes from a decision screen to the next state,
 * diffs the deck to detect what was chosen and logs to Supabase.
 * Also appends decisions to the run narrative for evaluation context.
 */
export function useChoiceTracker(
  gameState: GameState | null,
  deckCards: CombatCard[],
  runId: string | null
) {
  const pendingChoice = useRef<PendingChoice | null>(null);
  const deferredCardReward = useRef<PendingChoice | null>(null);
  const prevStateType = useRef<string | null>(null);
  const prevDeckSize = useRef(deckCards.length);

  if (!gameState) return;

  const currentType = gameState.state_type;
  const prevType = prevStateType.current;
  prevStateType.current = currentType;

  const run = hasRun(gameState) ? gameState.run : null;

  // --- Entering card_reward: record what's offered ---
  if (currentType === "card_reward" && prevType !== "card_reward") {
    pendingChoice.current = {
      choiceType: "card_reward",
      offeredItemIds: gameState.card_reward.cards.map((c) => c.id),
      floor: run?.floor ?? 0,
      act: run?.act ?? 1,
      previousDeckNames: new Set(deckCards.map((c) => c.name)),
    };
  }

  // --- Leaving card_reward: defer detection until deck updates ---
  // The deck tracker only updates on next combat round 1, so we can't
  // diff immediately. Store the pending choice and resolve it later.
  if (prevType === "card_reward" && currentType !== "card_reward") {
    if (pendingChoice.current) {
      deferredCardReward.current = pendingChoice.current;
      pendingChoice.current = null;
    }
  }

  // --- Resolve deferred card_reward when deck changes ---
  if (deferredCardReward.current && deckCards.length !== prevDeckSize.current) {
    const pending = deferredCardReward.current;
    const newCards = deckCards.filter(
      (c) => !pending.previousDeckNames.has(c.name)
    );
    const chosenItemId = newCards.length > 0 ? newCards[0].name : null;

    // Append to run narrative
    const lastEval = getLastEvaluation("card_reward");

    logChoice({
      runId,
      choiceType: chosenItemId ? "card_reward" : "skip",
      floor: pending.floor,
      act: pending.act,
      offeredItemIds: pending.offeredItemIds,
      chosenItemId,
      recommendedItemId: lastEval?.recommendedId ?? null,
      recommendedTier: lastEval?.recommendedTier ?? null,
      wasFollowed: lastEval ? chosenItemId === lastEval.recommendedId : undefined,
      rankingsSnapshot: lastEval?.allRankings ?? null,
    });
    appendDecision({
      floor: pending.floor,
      type: "card_reward",
      chosen: chosenItemId,
      advise: lastEval?.recommendedId ?? null,
      aligned: lastEval
        ? chosenItemId === lastEval.recommendedId ||
          (chosenItemId === null && lastEval.recommendedId === null)
        : true,
    });

    // Milestone: power cards define the build
    if (chosenItemId) {
      const pickedCard = newCards[0];
      const kwNames = (pickedCard?.keywords ?? []).map((k) =>
        k.name.toLowerCase()
      );
      if (kwNames.includes("power") || kwNames.includes("rare")) {
        addMilestone(`${chosenItemId} F${pending.floor}`, false);
      }
    }

    deferredCardReward.current = null;
  }

  // --- If we leave combat_rewards without deck changing, it was a skip ---
  if (
    deferredCardReward.current &&
    currentType !== "card_reward" &&
    currentType !== "combat_rewards" &&
    prevType === "combat_rewards"
  ) {
    const pending = deferredCardReward.current;
    const lastEval = getLastEvaluation("card_reward");
    logChoice({
      runId,
      choiceType: "skip",
      floor: pending.floor,
      act: pending.act,
      offeredItemIds: pending.offeredItemIds,
      chosenItemId: null,
      recommendedItemId: lastEval?.recommendedId ?? null,
      recommendedTier: lastEval?.recommendedTier ?? null,
      wasFollowed: lastEval ? lastEval.recommendedId === null : undefined,
      rankingsSnapshot: lastEval?.allRankings ?? null,
    });
    appendDecision({
      floor: pending.floor,
      type: "card_reward",
      chosen: null,
      advise: lastEval?.recommendedId ?? null,
      aligned: lastEval
        ? lastEval.recommendedId === null
        : true,
    });

    deferredCardReward.current = null;
  }

  prevDeckSize.current = deckCards.length;

  // --- Entering shop: record what's available ---
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

  // --- Leaving shop: detect purchases ---
  if (prevType === "shop" && currentType !== "shop") {
    const pending = pendingChoice.current;
    if (pending) {
      const newCards = deckCards.filter(
        (c) => !pending.previousDeckNames.has(c.name)
      );

      // Detect card removals (deck got smaller)
      const previousSize = pending.previousDeckNames.size;
      const currentSize = deckCards.length;
      if (currentSize < previousSize) {
        const removedCount = previousSize - currentSize + newCards.length;
        for (let i = 0; i < removedCount; i++) {
          appendDecision({
            floor: pending.floor,
            type: "shop_removal",
            chosen: "card removal",
            advise: null,
            aligned: true,
          });
          addMilestone(`Card removal F${pending.floor}`, false);
        }
      }

      // Log each new card as a separate purchase choice
      if (newCards.length > 0) {
        const lastEval = getLastEvaluation("shop");
        for (const card of newCards) {
          logChoice({
            runId,
            choiceType: "shop_purchase",
            floor: pending.floor,
            act: pending.act,
            offeredItemIds: pending.offeredItemIds,
            chosenItemId: card.name,
            recommendedItemId: lastEval?.recommendedId ?? null,
            recommendedTier: lastEval?.recommendedTier ?? null,
            wasFollowed: lastEval ? card.name === lastEval.recommendedId : undefined,
            rankingsSnapshot: lastEval?.allRankings ?? null,
          });

          appendDecision({
            floor: pending.floor,
            type: "shop",
            chosen: card.name,
            advise: lastEval?.recommendedId ?? null,
            aligned: lastEval
              ? card.name === lastEval.recommendedId
              : true,
          });
        }
      } else if (currentSize >= previousSize) {
        // Left shop without buying cards or removing
        const shopLastEval = getLastEvaluation("shop");
        logChoice({
          runId,
          choiceType: "shop_browse",
          floor: pending.floor,
          act: pending.act,
          offeredItemIds: pending.offeredItemIds,
          chosenItemId: null,
          recommendedItemId: shopLastEval?.recommendedId ?? null,
          recommendedTier: shopLastEval?.recommendedTier ?? null,
          wasFollowed: shopLastEval ? shopLastEval.recommendedId === null : undefined,
          rankingsSnapshot: shopLastEval?.allRankings ?? null,
        });
      }

      pendingChoice.current = null;
    }
  }

  // --- Leaving rest_site: detect rest vs upgrade ---
  if (prevType === "rest_site" && currentType !== "rest_site") {
    const floor = run?.floor ?? 0;

    // Detect upgrade by checking if any card gained a "+" suffix
    const prevNames = pendingChoice.current?.previousDeckNames;
    if (prevNames) {
      const upgraded = deckCards.find((c) => {
        const base = c.name.replace(/\+$/, "");
        return c.name.endsWith("+") && prevNames.has(base) && !prevNames.has(c.name);
      });

      if (upgraded) {
        const lastEval = getLastEvaluation("rest_site");
        appendDecision({
          floor,
          type: "rest_site",
          chosen: `Upgraded ${upgraded.name}`,
          advise: lastEval?.recommendedId ?? null,
          aligned: lastEval
            ? upgraded.name.replace(/\+$/, "") === lastEval.recommendedId?.replace(/\+$/, "")
            : true,
        });
        addMilestone(`${upgraded.name} F${floor}`, false);
      } else {
        // Assume rest (healed)
        appendDecision({
          floor,
          type: "rest_site",
          chosen: "Rest",
          advise: null,
          aligned: true,
        });
      }
    }
  }

  // --- Entering rest_site: snapshot deck for upgrade detection ---
  if (currentType === "rest_site" && prevType !== "rest_site") {
    pendingChoice.current = {
      choiceType: "rest_site",
      offeredItemIds: [],
      floor: run?.floor ?? 0,
      act: run?.act ?? 1,
      previousDeckNames: new Set(deckCards.map((c) => c.name)),
    };
  }

  // --- Leaving event: detect chosen option ---
  if (prevType === "event" && currentType !== "event") {
    const floor = run?.floor ?? 0;
    const lastEval = getLastEvaluation("event");

    // We can't easily detect which option was chosen from game state alone,
    // but we can log that an event decision was made
    appendDecision({
      floor,
      type: "event",
      chosen: "event choice",
      advise: lastEval?.recommendedId ?? null,
      aligned: true, // can't determine without more state
    });
  }
}

function logChoice(choice: {
  runId: string | null;
  choiceType: string;
  floor: number;
  act: number;
  offeredItemIds: string[];
  chosenItemId: string | null;
  recommendedItemId?: string | null;
  recommendedTier?: string | null;
  wasFollowed?: boolean;
  rankingsSnapshot?: unknown;
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
