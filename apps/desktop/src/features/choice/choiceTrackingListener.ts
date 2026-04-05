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
  getPlayer,
  type GameState,
  type CombatCard,
} from "@sts2/shared/types/game-state";
import { getUserId } from "@sts2/shared/lib/get-user-id";
import { detectCardRewardOutcome } from "@sts2/shared/choice-detection/detect-card-reward-outcome";
import { detectShopOutcome } from "@sts2/shared/choice-detection/detect-shop-outcome";
import { detectRestSiteOutcome } from "@sts2/shared/choice-detection/detect-rest-site-outcome";
import { registerPendingChoice } from "@sts2/shared/choice-detection/pending-choice-registry";
import type { GameContextSnapshot, OfferedCard } from "@sts2/shared/choice-detection/types";
import { selectEvalIsLoading } from "../evaluation/evaluationSelectors";

/** Minimal state the listener needs to track between polls. */
interface PendingCardReward {
  offeredCards: OfferedCard[];
  previousDeckNames: Set<string>;
  floor: number;
  act: number;
}

interface PendingShop {
  offeredItemIds: string[];
  previousDeckNames: Set<string>;
  previousDeckSize: number;
  floor: number;
  act: number;
}

interface PendingRestSite {
  previousDeckNames: Set<string>;
  floor: number;
  act: number;
}

function buildGameContext(
  gameState: GameState,
  deckSize: number,
  run: { character: string; ascension: number; act: number }
): GameContextSnapshot {
  const player = getPlayer(gameState);
  return {
    hpPercent: player?.max_hp ? (player.hp ?? 0) / player.max_hp : 1,
    gold: player?.gold ?? 0,
    deckSize,
    ascension: run.ascension,
    act: run.act,
    character: run.character,
  };
}

/**
 * Tracks player choices by watching game state transitions.
 * When the state changes from a decision screen to the next state,
 * uses pure detection functions to identify what was chosen and logs to Supabase.
 * Also appends decisions to the run narrative for evaluation context.
 */
export function setupChoiceTrackingListener() {
  let prevStateType: string | null = null;
  let pendingCardReward: PendingCardReward | null = null;
  let deferredCardReward: PendingCardReward | null = null;
  let pendingShop: PendingShop | null = null;
  let pendingRestSite: PendingRestSite | null = null;
  let lastRunId: string | null = null;

  startAppListening({
    matcher: gameStateApi.endpoints.getGameState.matchFulfilled,
    effect: (action, listenerApi) => {
      const gameState: GameState = action.payload;
      const state = listenerApi.getState();
      const activeRunId = state.run.activeRunId;
      if (!activeRunId) return;

      // Reset pending state when run changes
      if (activeRunId !== lastRunId) {
        lastRunId = activeRunId;
        pendingCardReward = null;
        deferredCardReward = null;
        pendingShop = null;
        pendingRestSite = null;
      }

      const currentType = gameState.state_type;
      const prevType = prevStateType;
      prevStateType = currentType;

      const runData = state.run.runs[activeRunId];
      if (!runData) return;
      const run = hasRun(gameState) ? gameState.run : null;
      const deckCards = runData.deck;
      const currentDeckNames = new Set(deckCards.map((c) => c.name));
      const currentDeckSize = deckCards.length;
      const floor = run?.floor ?? runData.floor;
      const act = run?.act ?? runData.act;

      // --- Card Reward: Enter ---
      if (currentType === "card_reward" && prevType !== "card_reward") {
        const cards = gameState.card_reward.cards;
        pendingCardReward = {
          offeredCards: cards.map((c) => ({ id: c.id, name: c.name })),
          previousDeckNames: new Set(currentDeckNames),
          floor,
          act,
        };
      }

      // --- Card Reward: Leave (defer detection) ---
      if (prevType === "card_reward" && currentType !== "card_reward") {
        if (pendingCardReward) {
          deferredCardReward = pendingCardReward;
          pendingCardReward = null;
        }
      }

      // --- Card Reward: Resolve ---
      if (deferredCardReward) {
        const outcome = detectCardRewardOutcome({
          offeredCards: deferredCardReward.offeredCards,
          previousDeckNames: deferredCardReward.previousDeckNames,
          currentDeckNames,
        });

        // Wait until we've left combat_rewards to confirm a skip
        const stillInRewards =
          currentType === "combat_rewards" || currentType === "card_reward";

        if (outcome.type === "picked" || !stillInRewards) {
          const lastEval = getLastEvaluation("card_reward");
          const isEvalPending = !lastEval && selectEvalIsLoading("card_reward")(state);
          const chosenItemId = outcome.type === "picked" ? outcome.chosenName : null;
          const gameContext = buildGameContext(gameState, currentDeckSize, runData);

          fireChoiceLog(listenerApi.dispatch, {
            runId: activeRunId,
            choiceType: outcome.type === "picked" ? "card_reward" : "skip",
            floor: deferredCardReward.floor,
            act: deferredCardReward.act,
            sequence: 0,
            offeredItemIds: deferredCardReward.offeredCards.map((c) => c.id),
            chosenItemId,
            recommendedItemId: lastEval?.recommendedId ?? null,
            recommendedTier: lastEval?.recommendedTier ?? null,
            wasFollowed: lastEval
              ? chosenItemId === lastEval.recommendedId
              : undefined,
            rankingsSnapshot: lastEval?.allRankings ?? null,
            gameContext,
            evalPending: isEvalPending || false,
          });

          if (isEvalPending) {
            registerPendingChoice(
              deferredCardReward.floor,
              "card_reward",
              chosenItemId,
              0
            );
          }

          appendDecision({
            floor: deferredCardReward.floor,
            type: "card_reward",
            chosen: chosenItemId,
            advise: lastEval?.recommendedId ?? null,
            aligned: lastEval
              ? chosenItemId === lastEval.recommendedId ||
                (chosenItemId === null && lastEval.recommendedId === null)
              : true,
          });

          // Milestone for power/rare
          if (outcome.type === "picked") {
            const pickedCard = deckCards.find((c) => c.name === outcome.chosenName);
            if (pickedCard) {
              const kwNames = (pickedCard.keywords ?? []).map((k) =>
                k.name.toLowerCase()
              );
              if (kwNames.includes("power") || kwNames.includes("rare")) {
                addMilestone(`${outcome.chosenName} F${deferredCardReward.floor}`, false);
              }
            }
          }

          deferredCardReward = null;
        }
      }

      // --- Shop: Enter ---
      if (currentType === "shop" && prevType !== "shop") {
        const shopItems = gameState.shop.items
          .filter((i) => i.is_stocked)
          .map((i) => {
            if (i.category === "card") return i.card_id ?? `card_${i.index}`;
            if (i.category === "relic") return i.relic_id ?? `relic_${i.index}`;
            if (i.category === "potion") return i.potion_id ?? `potion_${i.index}`;
            return "CARD_REMOVAL";
          });

        pendingShop = {
          offeredItemIds: shopItems,
          previousDeckNames: new Set(currentDeckNames),
          previousDeckSize: currentDeckSize,
          floor,
          act,
        };
      }

      // --- Shop: Leave ---
      if (prevType === "shop" && currentType !== "shop" && pendingShop) {
        const shopOutcome = detectShopOutcome({
          previousDeckNames: pendingShop.previousDeckNames,
          currentDeckNames,
          previousDeckSize: pendingShop.previousDeckSize,
          currentDeckSize,
        });

        const lastEval = getLastEvaluation("shop");
        const gameContext = buildGameContext(gameState, currentDeckSize, runData);

        if (shopOutcome.purchases.length > 0) {
          shopOutcome.purchases.forEach((cardName, idx) => {
            fireChoiceLog(listenerApi.dispatch, {
              runId: activeRunId,
              choiceType: "shop_purchase",
              floor: pendingShop!.floor,
              act: pendingShop!.act,
              sequence: idx,
              offeredItemIds: pendingShop!.offeredItemIds,
              chosenItemId: cardName,
              recommendedItemId: lastEval?.recommendedId ?? null,
              recommendedTier: lastEval?.recommendedTier ?? null,
              wasFollowed: lastEval ? cardName === lastEval.recommendedId : undefined,
              rankingsSnapshot: lastEval?.allRankings ?? null,
              gameContext,
              evalPending: false,
            });

            appendDecision({
              floor: pendingShop!.floor,
              type: "shop",
              chosen: cardName,
              advise: lastEval?.recommendedId ?? null,
              aligned: lastEval ? cardName === lastEval.recommendedId : true,
            });
          });
        }

        for (let i = 0; i < shopOutcome.removals; i++) {
          appendDecision({
            floor: pendingShop.floor,
            type: "shop_removal",
            chosen: "card removal",
            advise: null,
            aligned: true,
          });
          addMilestone(`Card removal F${pendingShop.floor}`, false);
        }

        if (shopOutcome.browsedOnly) {
          fireChoiceLog(listenerApi.dispatch, {
            runId: activeRunId,
            choiceType: "shop_browse",
            floor: pendingShop.floor,
            act: pendingShop.act,
            sequence: 0,
            offeredItemIds: pendingShop.offeredItemIds,
            chosenItemId: null,
            recommendedItemId: lastEval?.recommendedId ?? null,
            recommendedTier: lastEval?.recommendedTier ?? null,
            wasFollowed: lastEval ? lastEval.recommendedId === null : undefined,
            rankingsSnapshot: lastEval?.allRankings ?? null,
            gameContext,
            evalPending: false,
          });
        }

        pendingShop = null;
      }

      // --- Rest Site: Enter ---
      if (currentType === "rest_site" && prevType !== "rest_site") {
        pendingRestSite = {
          previousDeckNames: new Set(currentDeckNames),
          floor,
          act,
        };
      }

      // --- Rest Site: Leave ---
      if (prevType === "rest_site" && currentType !== "rest_site" && pendingRestSite) {
        const restOutcome = detectRestSiteOutcome({
          previousDeckNames: pendingRestSite.previousDeckNames,
          currentDeckNames,
        });

        const lastEval = getLastEvaluation("rest_site");

        if (restOutcome.type === "upgraded") {
          appendDecision({
            floor: pendingRestSite.floor,
            type: "rest_site",
            chosen: `Upgraded ${restOutcome.cardName}`,
            advise: lastEval?.recommendedId ?? null,
            aligned: lastEval
              ? restOutcome.cardName.replace(/\+$/, "") ===
                lastEval.recommendedId?.replace(/\+$/, "")
              : true,
          });
          addMilestone(`${restOutcome.cardName} F${pendingRestSite.floor}`, false);
        } else {
          appendDecision({
            floor: pendingRestSite.floor,
            type: "rest_site",
            chosen: "Rest",
            advise: null,
            aligned: true,
          });
        }

        pendingRestSite = null;
      }

      // --- Event: Leave ---
      if (prevType === "event" && currentType !== "event") {
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

function fireChoiceLog(
  dispatch: (action: unknown) => unknown,
  choice: {
    runId: string | null;
    choiceType: string;
    floor: number;
    act: number;
    sequence: number;
    offeredItemIds: string[];
    chosenItemId: string | null;
    recommendedItemId?: string | null;
    recommendedTier?: string | null;
    wasFollowed?: boolean;
    rankingsSnapshot?: unknown;
    gameContext?: unknown;
    evalPending?: boolean;
  }
) {
  console.log(
    "[ChoiceTracker]",
    choice.choiceType,
    choice.chosenItemId ?? "skip",
    choice.evalPending ? "(eval pending)" : ""
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
