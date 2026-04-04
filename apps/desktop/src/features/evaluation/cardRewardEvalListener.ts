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
import {
  computeCardRewardEvalKey,
  buildCardRewardRequest,
} from "../../lib/eval-inputs/card-reward";
import { getCardSelectSubType } from "../../lib/eval-inputs/card-select-type";
import type { CardRewardEvaluation } from "@sts2/shared/evaluation/types";

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
          evalFailed({ evalType: EVAL_TYPE, evalKey, error: "Could not build evaluation context" })
        );
        return;
      }

      // Side effect: update run narrative
      updateFromContext(ctx);

      listenerApi.dispatch(evalStarted({ evalType: EVAL_TYPE, evalKey }));

      try {
        const data = await listenerApi
          .dispatch(
            evaluationApi.endpoints.evaluateCardReward.initiate(
              buildCardRewardRequest({
                context: ctx,
                cards,
                exclusive: true,
                runId,
                userId: getUserId(),
                runNarrative: getPromptContext(),
              })
            )
          )
          .unwrap();

        // Side effect: register for choice tracker
        registerLastEvaluation("card_reward", {
          recommendedId: data.rankings?.[0]?.itemId ?? null,
          recommendedTier: data.rankings?.[0]?.tier ?? null,
          reasoning: data.rankings?.[0]?.reasoning ?? "",
          allRankings: (data.rankings ?? []).map((r) => ({
            itemId: r.itemId,
            itemName: r.itemName,
            tier: r.tier,
            recommendation: r.recommendation,
          })),
          evalType: "card_reward",
        });

        listenerApi.dispatch(
          evalSucceeded({ evalType: EVAL_TYPE, evalKey, result: data })
        );
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
