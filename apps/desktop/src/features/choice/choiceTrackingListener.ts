import { startAppListening } from "../../store/listenerMiddleware";
import { gameStateApi } from "../../services/gameStateApi";
import { evaluationApi } from "../../services/evaluationApi";
import { waitForRunCreated } from "../run/runAnalyticsListener";
import {
  appendDecision,
  addMilestone,
} from "@sts2/shared/evaluation/run-narrative";
import { getLastEvaluation } from "@sts2/shared/evaluation/last-evaluation-registry";
import {
  hasRun,
  type GameState,
  type CombatCard,
} from "@sts2/shared/types/game-state";
import { getUserId } from "@sts2/shared/lib/get-user-id";

interface PendingChoice {
  choiceType: string;
  offeredItemIds: string[];
  floor: number;
  act: number;
  previousDeckNames: Set<string>;
}

/**
 * Tracks player choices by watching game state transitions.
 * When the state changes from a decision screen to the next state,
 * diffs the deck to detect what was chosen and logs to Supabase.
 * Also appends decisions to the run narrative for evaluation context.
 *
 * IMPORTANT: This listener must be registered AFTER setupGameStateUpdateListener
 * so that the deck in Redux is already updated when this runs.
 */
export function setupChoiceTrackingListener() {
  let prevStateType: string | null = null;
  let prevDeckSize = 0;
  let pendingChoice: PendingChoice | null = null;
  let deferredCardReward: PendingChoice | null = null;
  let lastRunId: string | null = null;

  startAppListening({
    matcher: gameStateApi.endpoints.getGameState.matchFulfilled,
    effect: (action, listenerApi) => {
      const gameState: GameState = action.payload;
      const state = listenerApi.getState();
      const activeRunId = state.run.activeRunId;
      if (!activeRunId) return;

      // Reset pending state when run changes to prevent stale choices
      // bleeding across runs
      if (activeRunId !== lastRunId) {
        lastRunId = activeRunId;
        pendingChoice = null;
        deferredCardReward = null;
        prevDeckSize = 0;
      }

      const currentType = gameState.state_type;
      const prevType = prevStateType;
      prevStateType = currentType;

      const run = hasRun(gameState) ? gameState.run : null;
      const deckCards = state.run.runs[activeRunId]?.deck ?? [];

      // --- Entering card_reward: record what's offered ---
      if (currentType === "card_reward" && prevType !== "card_reward") {
        pendingChoice = {
          choiceType: "card_reward",
          offeredItemIds: gameState.card_reward.cards.map((c) => c.id),
          floor: run?.floor ?? 0,
          act: run?.act ?? 1,
          previousDeckNames: new Set(deckCards.map((c) => c.name)),
        };
      }

      // --- Leaving card_reward: defer detection until deck updates ---
      if (prevType === "card_reward" && currentType !== "card_reward") {
        if (pendingChoice) {
          deferredCardReward = pendingChoice;
          pendingChoice = null;
        }
      }

      // --- Resolve deferred card_reward when deck changes ---
      if (deferredCardReward && deckCards.length !== prevDeckSize) {
        resolveCardReward(
          deferredCardReward,
          deckCards,
          activeRunId,
          listenerApi.dispatch
        );
        deferredCardReward = null;
      }

      // --- If we leave combat_rewards without deck changing, it was a skip ---
      if (
        deferredCardReward &&
        currentType !== "card_reward" &&
        currentType !== "combat_rewards" &&
        prevType === "combat_rewards"
      ) {
        resolveCardRewardSkip(deferredCardReward, activeRunId, listenerApi.dispatch);
        deferredCardReward = null;
      }

      prevDeckSize = deckCards.length;

      // --- Entering shop: record what's available ---
      if (currentType === "shop" && prevType !== "shop") {
        const shopItems = gameState.shop.items
          .filter((i) => i.is_stocked)
          .map((i) => {
            if (i.category === "card") return i.card_id ?? `card_${i.index}`;
            if (i.category === "relic")
              return i.relic_id ?? `relic_${i.index}`;
            if (i.category === "potion")
              return i.potion_id ?? `potion_${i.index}`;
            return "CARD_REMOVAL";
          });

        pendingChoice = {
          choiceType: "shop",
          offeredItemIds: shopItems,
          floor: run?.floor ?? 0,
          act: run?.act ?? 1,
          previousDeckNames: new Set(deckCards.map((c) => c.name)),
        };
      }

      // --- Leaving shop: detect purchases ---
      if (prevType === "shop" && currentType !== "shop") {
        if (pendingChoice) {
          resolveShop(
            pendingChoice,
            deckCards,
            activeRunId,
            listenerApi.dispatch
          );
          pendingChoice = null;
        }
      }

      // --- Entering rest_site: snapshot deck for upgrade detection ---
      if (currentType === "rest_site" && prevType !== "rest_site") {
        pendingChoice = {
          choiceType: "rest_site",
          offeredItemIds: [],
          floor: run?.floor ?? 0,
          act: run?.act ?? 1,
          previousDeckNames: new Set(deckCards.map((c) => c.name)),
        };
      }

      // --- Leaving rest_site: detect rest vs upgrade ---
      if (prevType === "rest_site" && currentType !== "rest_site") {
        const floor = run?.floor ?? 0;
        const prevNames = pendingChoice?.previousDeckNames;
        if (prevNames) {
          const upgraded = deckCards.find((c) => {
            const base = c.name.replace(/\+$/, "");
            return (
              c.name.endsWith("+") &&
              prevNames.has(base) &&
              !prevNames.has(c.name)
            );
          });

          if (upgraded) {
            const lastEval = getLastEvaluation("rest_site");
            appendDecision({
              floor,
              type: "rest_site",
              chosen: `Upgraded ${upgraded.name}`,
              advise: lastEval?.recommendedId ?? null,
              aligned: lastEval
                ? upgraded.name.replace(/\+$/, "") ===
                  lastEval.recommendedId?.replace(/\+$/, "")
                : true,
            });
            addMilestone(`${upgraded.name} F${floor}`, false);
          } else {
            appendDecision({
              floor,
              type: "rest_site",
              chosen: "Rest",
              advise: null,
              aligned: true,
            });
          }
        }
        pendingChoice = null;
      }

      // --- Leaving event: detect chosen option ---
      if (prevType === "event" && currentType !== "event") {
        const floor = run?.floor ?? 0;
        const lastEval = getLastEvaluation("event");
        appendDecision({
          floor,
          type: "event",
          chosen: "event choice",
          advise: lastEval?.recommendedId ?? null,
          aligned: true,
        });
      }
    },
  });
}

// --- Helpers ---

function resolveCardReward(
  pending: PendingChoice,
  deckCards: CombatCard[],
  runId: string,
  dispatch: (action: unknown) => unknown
) {
  const newCards = deckCards.filter(
    (c) => !pending.previousDeckNames.has(c.name)
  );
  const chosenItemId = newCards.length > 0 ? newCards[0].name : null;
  const lastEval = getLastEvaluation("card_reward");

  fireChoiceLog(dispatch, {
    runId,
    choiceType: chosenItemId ? "card_reward" : "skip",
    floor: pending.floor,
    act: pending.act,
    offeredItemIds: pending.offeredItemIds,
    chosenItemId,
    recommendedItemId: lastEval?.recommendedId ?? null,
    recommendedTier: lastEval?.recommendedTier ?? null,
    wasFollowed: lastEval
      ? chosenItemId === lastEval.recommendedId
      : undefined,
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

  // Milestone: power/rare cards define the build
  if (chosenItemId && newCards[0]) {
    const kwNames = (newCards[0].keywords ?? []).map((k) =>
      k.name.toLowerCase()
    );
    if (kwNames.includes("power") || kwNames.includes("rare")) {
      addMilestone(`${chosenItemId} F${pending.floor}`, false);
    }
  }
}

function resolveCardRewardSkip(
  pending: PendingChoice,
  runId: string,
  dispatch: (action: unknown) => unknown
) {
  const lastEval = getLastEvaluation("card_reward");

  fireChoiceLog(dispatch, {
    runId,
    choiceType: "skip",
    floor: pending.floor,
    act: pending.act,
    offeredItemIds: pending.offeredItemIds,
    chosenItemId: null,
    recommendedItemId: lastEval?.recommendedId ?? null,
    recommendedTier: lastEval?.recommendedTier ?? null,
    wasFollowed: lastEval
      ? lastEval.recommendedId === null
      : undefined,
    rankingsSnapshot: lastEval?.allRankings ?? null,
  });

  appendDecision({
    floor: pending.floor,
    type: "card_reward",
    chosen: null,
    advise: lastEval?.recommendedId ?? null,
    aligned: lastEval ? lastEval.recommendedId === null : true,
  });
}

function resolveShop(
  pending: PendingChoice,
  deckCards: CombatCard[],
  runId: string,
  dispatch: (action: unknown) => unknown
) {
  const newCards = deckCards.filter(
    (c) => !pending.previousDeckNames.has(c.name)
  );
  const previousSize = pending.previousDeckNames.size;
  const currentSize = deckCards.length;

  // Detect card removals (deck got smaller)
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
      fireChoiceLog(dispatch, {
        runId,
        choiceType: "shop_purchase",
        floor: pending.floor,
        act: pending.act,
        offeredItemIds: pending.offeredItemIds,
        chosenItemId: card.name,
        recommendedItemId: lastEval?.recommendedId ?? null,
        recommendedTier: lastEval?.recommendedTier ?? null,
        wasFollowed: lastEval
          ? card.name === lastEval.recommendedId
          : undefined,
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
    const lastEval = getLastEvaluation("shop");
    fireChoiceLog(dispatch, {
      runId,
      choiceType: "shop_browse",
      floor: pending.floor,
      act: pending.act,
      offeredItemIds: pending.offeredItemIds,
      chosenItemId: null,
      recommendedItemId: lastEval?.recommendedId ?? null,
      recommendedTier: lastEval?.recommendedTier ?? null,
      wasFollowed: lastEval
        ? lastEval.recommendedId === null
        : undefined,
      rankingsSnapshot: lastEval?.allRankings ?? null,
    });
  }
}

/**
 * Fire-and-forget choice log via RTK Query mutation.
 * Waits for run creation to avoid FK violations.
 */
function fireChoiceLog(
  dispatch: (action: unknown) => unknown,
  choice: {
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
  }
) {
  console.log(
    "[ChoiceTracker]",
    choice.choiceType,
    choice.chosenItemId ?? "skip"
  );

  waitForRunCreated()
    .then(() => {
      dispatch(
        evaluationApi.endpoints.logChoice.initiate({
          ...choice,
          userId: getUserId(),
        })
      );
    })
    .catch(console.error);
}
