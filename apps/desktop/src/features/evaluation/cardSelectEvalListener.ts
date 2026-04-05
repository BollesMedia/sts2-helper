import { startAppListening } from "../../store/listenerMiddleware";
import { gameStateReceived, selectCurrentGameState } from "../gameState/gameStateSlice";
import { evaluationApi } from "../../services/evaluationApi";
import { evalStarted, evalSucceeded, evalFailed, evalRetryRequested } from "./evaluationSlice";
import { selectEvalKey } from "./evaluationSelectors";
import { selectActiveDeck, selectActivePlayer } from "../run/runSelectors";
import { buildEvaluationContext } from "@sts2/shared/evaluation/context-builder";
import { getPromptContext, updateFromContext } from "@sts2/shared/evaluation/run-narrative";
import { matchRecommendation } from "../../lib/match-recommendation";
import { computeCardSelectEvalKey, buildCardSelectPrompt } from "../../lib/eval-inputs/card-select";
import { getCardSelectSubType } from "../../lib/eval-inputs/card-select-type";

const EVAL_TYPE = "card_select" as const;

/**
 * Triggers when game state is card_select for enchant/imbue/transform
 * (NOT removal, upgrade, or reward — those have their own listeners).
 */
export function setupCardSelectEvalListener() {
  startAppListening({
    predicate: (action, currentState) => {
      if (evalRetryRequested.match(action) && action.payload === EVAL_TYPE) return true;
      if (!gameStateReceived.match(action)) return false;

      const gs = selectCurrentGameState(currentState);
      if (gs?.state_type !== "card_select") return false;

      const deckCards = currentState.run.runs[currentState.run.activeRunId ?? ""]?.deck ?? [];
      const subType = getCardSelectSubType(
        gs.card_select?.prompt,
        gs.card_select?.cards ?? [],
        deckCards.map((c) => c.name)
      );
      return subType === "card_select";
    },

    effect: async (_action, listenerApi) => {
      listenerApi.cancelActiveListeners();

      const state = listenerApi.getState();
      const gameState = selectCurrentGameState(state);
      if (!gameState || gameState.state_type !== "card_select") return;

      const prompt = gameState.card_select.prompt ?? "";
      const cards = gameState.card_select.cards;
      const evalKey = computeCardSelectEvalKey(prompt, cards);
      const currentKey = selectEvalKey(EVAL_TYPE)(state);
      if (currentKey === evalKey) return;

      const deckCards = selectActiveDeck(state);
      const player = selectActivePlayer(state);
      const ctx = buildEvaluationContext(gameState, deckCards, player);
      if (!ctx) return;

      updateFromContext(ctx);
      listenerApi.dispatch(evalStarted({ evalType: EVAL_TYPE, evalKey }));

      try {
        const mapPrompt = buildCardSelectPrompt({ context: ctx, prompt, cards });
        const raw = await listenerApi
          .dispatch(evaluationApi.endpoints.evaluateGeneric.initiate({
            evalType: "card_select",
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
