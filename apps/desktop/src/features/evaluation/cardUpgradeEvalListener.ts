import { startAppListening } from "../../store/listenerMiddleware";
import { gameStateApi } from "../../services/gameStateApi";
import { evaluationApi } from "../../services/evaluationApi";
import { evalStarted, evalSucceeded, evalFailed, evalRetryRequested } from "./evaluationSlice";
import { selectEvalKey } from "./evaluationSelectors";
import { selectActiveDeck, selectActivePlayer } from "../run/runSelectors";
import { buildEvaluationContext } from "@sts2/shared/evaluation/context-builder";
import { getPromptContext, updateFromContext } from "@sts2/shared/evaluation/run-narrative";
import { matchRecommendation } from "../../lib/match-recommendation";
import { computeCardUpgradeEvalKey, buildCardUpgradePrompt } from "../../lib/eval-inputs/card-upgrade";

const EVAL_TYPE = "card_upgrade" as const;

export function setupCardUpgradeEvalListener() {
  startAppListening({
    predicate: (action, currentState, previousState) => {
      if (evalRetryRequested.match(action) && action.payload === EVAL_TYPE) return true;
      const current = gameStateApi.endpoints.getGameState.select()(currentState);
      const previous = gameStateApi.endpoints.getGameState.select()(previousState);
      if (current.data?.state_type !== "card_select" || current.data === previous.data) return false;
      const prompt = current.data.card_select?.prompt?.toLowerCase() ?? "";
      return prompt.includes("upgrade") || prompt.includes("smith") || prompt.includes("enhance");
    },

    effect: async (_action, listenerApi) => {
      listenerApi.cancelActiveListeners();

      const state = listenerApi.getState();
      const gameState = gameStateApi.endpoints.getGameState.select()(state).data;
      if (!gameState || gameState.state_type !== "card_select") return;

      const allCards = gameState.card_select.cards;
      const eligible = allCards.filter((c) => !c.name.endsWith("+"));
      const alreadyUpgraded = allCards.filter((c) => c.name.endsWith("+")).map((c) => c.name);
      const evalKey = computeCardUpgradeEvalKey(eligible);
      const currentKey = selectEvalKey(EVAL_TYPE)(state);
      if (currentKey === evalKey) return;

      const deckCards = selectActiveDeck(state);
      const player = selectActivePlayer(state);
      const ctx = buildEvaluationContext(gameState, deckCards, player);
      if (!ctx) return;

      updateFromContext(ctx);
      listenerApi.dispatch(evalStarted({ evalType: EVAL_TYPE, evalKey }));

      try {
        const mapPrompt = buildCardUpgradePrompt({
          context: ctx,
          eligibleCards: eligible,
          alreadyUpgraded,
        });
        const raw = await listenerApi
          .dispatch(evaluationApi.endpoints.evaluateGeneric.initiate({
            evalType: "card_upgrade",
            context: ctx,
            runNarrative: getPromptContext(),
            mapPrompt,
            runId: null,
            gameVersion: null,
          }))
          .unwrap();

        const cardName = raw.card_name as string | undefined;
        const eligibleNames = eligible.map((c) => c.name);
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
