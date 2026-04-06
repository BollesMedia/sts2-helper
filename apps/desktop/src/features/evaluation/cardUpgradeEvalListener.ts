import { startAppListening } from "../../store/listenerMiddleware";
import { gameStateReceived, selectCurrentGameState } from "../gameState/gameStateSlice";
import { evaluationApi } from "../../services/evaluationApi";
import { evalStarted, evalSucceeded, evalFailed, evalRetryRequested } from "./evaluationSlice";
import { selectEvalKey } from "./evaluationSelectors";
import { selectActiveDeck, selectActivePlayer } from "../run/runSelectors";
import { buildEvaluationContext } from "@sts2/shared/evaluation/context-builder";
import { simpleEvalSchema } from "@sts2/shared/evaluation/eval-schemas";
import { getPromptContext, updateFromContext } from "@sts2/shared/evaluation/run-narrative";
import { matchRecommendation } from "../../lib/match-recommendation";
import { computeCardUpgradeEvalKey, buildCardUpgradePrompt } from "../../lib/eval-inputs/card-upgrade";
import { fetchUpgradeData } from "../../lib/upgrade-lookup";
import { logDevEvent, logReduxSnapshot } from "../../lib/dev-logger";

const EVAL_TYPE = "card_upgrade" as const;

export function setupCardUpgradeEvalListener() {
  startAppListening({
    predicate: (action, currentState) => {
      if (evalRetryRequested.match(action) && action.payload === EVAL_TYPE) return true;
      if (!gameStateReceived.match(action)) return false;

      const gs = selectCurrentGameState(currentState);
      if (gs?.state_type !== "card_select") return false;
      const prompt = gs.card_select?.prompt?.toLowerCase() ?? "";
      return prompt.includes("upgrade") || prompt.includes("smith") || prompt.includes("enhance");
    },

    effect: async (_action, listenerApi) => {
      listenerApi.cancelActiveListeners();

      const state = listenerApi.getState();
      const gameState = selectCurrentGameState(state);
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
        // Fetch upgrade deltas for eligible cards (cached after first fetch)
        await fetchUpgradeData(eligible.map((c) => c.name));

        const mapPrompt = buildCardUpgradePrompt({
          context: ctx,
          eligibleCards: eligible,
          alreadyUpgraded,
        });

        logDevEvent("eval", "card_upgrade_api_request", {
          context: ctx,
          mapPrompt,
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

        logDevEvent("eval", "card_upgrade_api_response", raw);

        const parsed = simpleEvalSchema.parse(raw);
        const eligibleNames = eligible.map((c) => c.name);
        const matched = matchRecommendation(parsed.card_name, eligibleNames);

        listenerApi.dispatch(evalSucceeded({
          evalType: EVAL_TYPE,
          evalKey,
          result: matched ? { cardName: matched, reasoning: parsed.reasoning } : null,
        }));
        logReduxSnapshot(listenerApi as unknown as { getState: () => unknown }, "after_card_upgrade_eval");
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
