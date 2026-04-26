import { startAppListening } from "../../store/listenerMiddleware";
import { gameStateReceived, selectCurrentGameState } from "../gameState/gameStateSlice";
import { evaluationApi } from "../../services/evaluationApi";
import {
  evalStarted,
  evalSucceeded,
  evalFailed,
  evalRetryRequested,
} from "./evaluationSlice";
import { selectEvalKey } from "./evaluationSelectors";
import { selectActiveDeck, selectActivePlayer } from "../run/runSelectors";
import { selectActiveRunId } from "../run/runSlice";
import { buildEvaluationContext } from "@sts2/shared/evaluation/context-builder";
import { getPromptContext, updateFromContext } from "@sts2/shared/evaluation/run-narrative";
import { registerLastEvaluation } from "@sts2/shared/evaluation/last-evaluation-registry";
import { getUserId } from "@sts2/shared/lib/get-user-id";
import { getPendingChoice, clearPendingChoice } from "@sts2/shared/choice-detection/pending-choice-registry";
import { buildBackfillPayload } from "@sts2/shared/choice-detection/build-backfill-payload";
import {
  computeCardRewardEvalKey,
  buildCardRewardRequest,
} from "../../lib/eval-inputs/card-reward";
import { getCardSelectSubType } from "../../lib/eval-inputs/card-select-type";
import { logDevEvent, logReduxSnapshot } from "../../lib/dev-logger";

const EVAL_TYPE = "card_reward" as const;

/**
 * Listens for card_reward game state and triggers evaluation.
 *
 * Fires when:
 * - Game state transitions to card_reward (new data)
 * - User requests retry via evalRetryRequested
 *
 * Deduplicates by evalKey (sorted card IDs).
 */
export function setupCardRewardEvalListener() {
  startAppListening({
    predicate: (action, currentState) => {
      if (evalRetryRequested.match(action) && action.payload === EVAL_TYPE) return true;
      if (!gameStateReceived.match(action)) return false;

      const gs = selectCurrentGameState(currentState);
      if (gs?.state_type === "card_reward") return true;

      if (gs?.state_type === "card_select") {
        const deckCards = currentState.run.runs[currentState.run.activeRunId ?? ""]?.deck ?? [];
        const subType = getCardSelectSubType(
          gs.card_select?.prompt,
          gs.card_select?.cards ?? [],
          deckCards.map((c) => c.name)
        );
        return subType === "card_reward";
      }

      return false;
    },

    effect: async (_action, listenerApi) => {
      listenerApi.cancelActiveListeners();

      const state = listenerApi.getState();
      const gameState = selectCurrentGameState(state);
      if (!gameState) return;

      // Get cards from either card_reward or card_select
      let cards;
      if (gameState.state_type === "card_reward") {
        cards = gameState.card_reward.cards;
      } else if (gameState.state_type === "card_select") {
        cards = gameState.card_select.cards;
      } else {
        return;
      }
      const evalKey = computeCardRewardEvalKey(cards);

      // Dedup: skip if already evaluated for this key
      const currentKey = selectEvalKey(EVAL_TYPE)(state);
      if (currentKey === evalKey) return;

      const deckCards = selectActiveDeck(state);
      const player = selectActivePlayer(state);
      const runId = selectActiveRunId(state);

      // Build evaluation context
      const ctx = buildEvaluationContext(gameState, deckCards, player);
      if (!ctx) {
        listenerApi.dispatch(
          evalFailed({ evalType: EVAL_TYPE, evalKey, error: "Could not build evaluation context — see console for validation errors" })
        );
        return;
      }

      console.log(`[CardRewardEval] context: ${ctx.character} Act${ctx.act} F${ctx.floor} deck=${ctx.deckSize} hp=${Math.round(ctx.hpPercent * 100)}% relics=${ctx.relics.length}`);

      // Side effect: update run narrative
      updateFromContext(ctx);

      listenerApi.dispatch(evalStarted({ evalType: EVAL_TYPE, evalKey }));

      try {
        const cardRewardRequest = buildCardRewardRequest({
          context: ctx,
          cards,
          exclusive: true,
          runId,
          userId: getUserId(),
          runNarrative: getPromptContext(),
        });

        logDevEvent("eval", "card_reward_api_request", {
          context: ctx,
          mapPrompt: cardRewardRequest,
        });

        const data = await listenerApi
          .dispatch(
            evaluationApi.endpoints.evaluateCardReward.initiate(cardRewardRequest)
          )
          .unwrap();

        logDevEvent("eval", "card_reward_api_response", data);

        // Side effect: register for choice tracker
        const firstRanking = data.rankings?.[0];
        registerLastEvaluation("card_reward", {
          recommendedId: firstRanking?.itemId ?? null,
          recommendedTier: firstRanking?.tier ?? null,
          reasoning: firstRanking?.reasoning ?? "",
          allRankings: (data.rankings ?? []).map((r) => ({
            itemId: r.itemId,
            itemName: r.itemName,
            tier: r.tier,
            recommendation: r.recommendation,
          })),
          evalType: "card_reward",
          // #98: preserve the full coaching block for phase-2 calibration.
          // `allRankings` is the reduced shape the choice tracker needs;
          // `raw` carries reasoning / headline / tradeoffs / callouts.
          raw: data,
        });

        // Backfill: if user acted before eval completed, upsert recommendation data
        const pending = getPendingChoice(ctx.floor, "card_reward");
        if (pending && runId) {
          const backfill = buildBackfillPayload(
            runId,
            {
              recommendedId: firstRanking?.itemId ?? null,
              recommendedTier: firstRanking?.tier ?? null,
              allRankings: (data.rankings ?? []).map((r) => ({
                itemId: r.itemId,
                itemName: r.itemName,
                tier: r.tier,
                recommendation: r.recommendation,
              })),
            },
            pending
          );

          listenerApi.dispatch(
            evaluationApi.endpoints.logChoice.initiate({
              ...backfill,
              chosenItemId: pending.chosenItemId,
              offeredItemIds: [],
              userId: getUserId(),
            })
          );

          clearPendingChoice(ctx.floor, "card_reward");
        }

        listenerApi.dispatch(
          evalSucceeded({ evalType: EVAL_TYPE, evalKey, result: data })
        );
        logReduxSnapshot(listenerApi as unknown as { getState: () => unknown }, "after_card_reward_eval");
      } catch (err) {
        listenerApi.dispatch(
          evalFailed({
            evalType: EVAL_TYPE,
            evalKey,
            error: err instanceof Error ? err.message : "Evaluation failed",
          })
        );
      }
    },
  });
}
