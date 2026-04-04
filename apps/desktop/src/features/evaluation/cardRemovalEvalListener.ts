import { startAppListening } from "../../store/listenerMiddleware";
import { gameStateReceived, selectCurrentGameState } from "../gameState/gameStateSlice";
import { evaluationApi } from "../../services/evaluationApi";
import { evalStarted, evalSucceeded, evalFailed, evalRetryRequested } from "./evaluationSlice";
import { selectEvalKey } from "./evaluationSelectors";
import { selectActiveDeck, selectActivePlayer } from "../run/runSelectors";
import { buildEvaluationContext } from "@sts2/shared/evaluation/context-builder";
import { getPromptContext, updateFromContext } from "@sts2/shared/evaluation/run-narrative";
import { matchRecommendation } from "../../lib/match-recommendation";
import { computeCardRemovalEvalKey, buildCardRemovalPrompt } from "../../lib/eval-inputs/card-removal";

const EVAL_TYPE = "card_removal" as const;

/**
 * Triggers when game state is card_select with a removal prompt.
 */
export function setupCardRemovalEvalListener() {
  startAppListening({
    predicate: (action, currentState) => {
      if (evalRetryRequested.match(action) && action.payload === EVAL_TYPE) return true;
      if (!gameStateReceived.match(action)) return false;

      const gs = selectCurrentGameState(currentState);
      if (gs?.state_type !== "card_select") return false;
      const prompt = gs.card_select?.prompt?.toLowerCase() ?? "";
      return prompt.includes("remove") || prompt.includes("purge");
    },

    effect: async (_action, listenerApi) => {
      listenerApi.cancelActiveListeners();

      const state = listenerApi.getState();
      const gameState = selectCurrentGameState(state);
      if (!gameState || gameState.state_type !== "card_select") return;

      const cards = gameState.card_select.cards;
      const evalKey = computeCardRemovalEvalKey(cards);
      const currentKey = selectEvalKey(EVAL_TYPE)(state);
      if (currentKey === evalKey) return;

      const deckCards = selectActiveDeck(state);
      const player = selectActivePlayer(state);
      const ctx = buildEvaluationContext(gameState, deckCards, player);
      if (!ctx) return;

      updateFromContext(ctx);
      listenerApi.dispatch(evalStarted({ evalType: EVAL_TYPE, evalKey }));

      try {
        const mapPrompt = buildCardRemovalPrompt({ context: ctx, cards });
        const raw = await listenerApi
          .dispatch(evaluationApi.endpoints.evaluateGeneric.initiate({
            evalType: "card_removal",
            context: ctx,
            runNarrative: getPromptContext(),
            mapPrompt,
            runId: null,
            gameVersion: null,
          }))
          .unwrap();

        const cardName = raw.card_name as string | undefined;
        const eligibleNames = cards.map((c) => c.name);
        const matched = cardName ? matchRecommendation(cardName, eligibleNames) : null;

        listenerApi.dispatch(evalSucceeded({
          evalType: EVAL_TYPE,
          evalKey,
          result: matched ? { cardName: matched, reasoning: (raw.reasoning as string) ?? "" } : null,
        }));
      } catch (err) {
        listenerApi.dispatch(evalFailed({
          evalType: EVAL_TYPE,
          evalKey,
          error: err instanceof Error ? err.message : "Evaluation failed",
        }));
      }
    },
  });
}
