import { startAppListening } from "../../store/listenerMiddleware";
import { gameStateApi } from "../../services/gameStateApi";
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
    predicate: (action, currentState, previousState) => {
      // Retry requested
      if (
        evalRetryRequested.match(action) &&
        action.payload === EVAL_TYPE
      ) {
        return true;
      }

      // Game state changed to card_reward
      const current = gameStateApi.endpoints.getGameState.select()(currentState);
      const previous = gameStateApi.endpoints.getGameState.select()(previousState);
      return (
        current.data?.state_type === "card_reward" &&
        current.data !== previous.data
      );
    },

    effect: async (_action, listenerApi) => {
      listenerApi.cancelActiveListeners();

      const state = listenerApi.getState();
      const gameState = gameStateApi.endpoints.getGameState.select()(state).data;
      if (!gameState || gameState.state_type !== "card_reward") return;

      const cards = gameState.card_reward.cards;
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
