import { startAppListening } from "../../store/listenerMiddleware";
import { gameStateReceived, selectCurrentGameState } from "../gameState/gameStateSlice";
import { evaluationApi } from "../../services/evaluationApi";
import { evalStarted, evalSucceeded, evalFailed, evalRetryRequested } from "./evaluationSlice";
import { selectEvalKey } from "./evaluationSelectors";
import { selectActiveDeck, selectActivePlayer } from "../run/runSelectors";
import { buildEvaluationContext } from "@sts2/shared/evaluation/context-builder";
import { genericEvalSchema } from "@sts2/shared/evaluation/eval-schemas";
import { getPromptContext, updateFromContext } from "@sts2/shared/evaluation/run-narrative";
import { registerLastEvaluation } from "@sts2/shared/evaluation/last-evaluation-registry";
import type { RelicSelectState } from "@sts2/shared/types/game-state";
import {
  computeRelicSelectEvalKey,
  buildRelicSelectPrompt,
  parseRelicSelectResponse,
} from "../../lib/eval-inputs/relic-select";
import { logDevEvent, logReduxSnapshot } from "../../lib/dev-logger";

const EVAL_TYPE = "relic_select" as const;

export function setupRelicSelectEvalListener() {
  startAppListening({
    predicate: (action, currentState) => {
      if (evalRetryRequested.match(action) && action.payload === EVAL_TYPE) return true;
      if (!gameStateReceived.match(action)) return false;
      return selectCurrentGameState(currentState)?.state_type === "relic_select";
    },

    effect: async (_action, listenerApi) => {
      listenerApi.cancelActiveListeners();

      const state = listenerApi.getState();
      const gameState = selectCurrentGameState(state);
      if (!gameState || gameState.state_type !== "relic_select") return;

      const relicState = gameState as RelicSelectState;
      const relics = relicState.relic_select.relics;
      const evalKey = computeRelicSelectEvalKey(relics);
      const currentKey = selectEvalKey(EVAL_TYPE)(state);
      if (currentKey === evalKey) return;

      const deckCards = selectActiveDeck(state);
      const player = selectActivePlayer(state);
      const ctx = buildEvaluationContext(gameState, deckCards, player);
      if (!ctx) return;

      updateFromContext(ctx);
      listenerApi.dispatch(evalStarted({ evalType: EVAL_TYPE, evalKey }));

      try {
        const mapPrompt = buildRelicSelectPrompt({
          context: ctx,
          relicSelectPrompt: relicState.relic_select.prompt ?? "",
          relics,
        });

        logDevEvent("eval", "relic_select_api_request", {
          context: ctx,
          mapPrompt,
        });

        const raw = await listenerApi
          .dispatch(evaluationApi.endpoints.evaluateGeneric.initiate({
            evalType: "relic_select",
            context: ctx,
            runNarrative: getPromptContext(),
            mapPrompt,
            runId: null,
            gameVersion: null,
          }))
          .unwrap();

        logDevEvent("eval", "relic_select_api_response", raw);

        const evaluation = parseRelicSelectResponse(genericEvalSchema.parse(raw), relics);

        const topPick = evaluation.rankings.find((r) => r.rank === 1);
        if (topPick) {
          registerLastEvaluation("boss_relic", {
            recommendedId: topPick.itemName,
            recommendedTier: topPick.tier,
            reasoning: topPick.reasoning,
            allRankings: evaluation.rankings.map((r) => ({
              itemId: r.itemId,
              itemName: r.itemName,
              tier: r.tier,
              recommendation: r.recommendation,
            })),
            evalType: "boss_relic",
            raw: evaluation, // #98
          });
        }

        listenerApi.dispatch(evalSucceeded({ evalType: EVAL_TYPE, evalKey, result: evaluation }));
        logReduxSnapshot(listenerApi as unknown as { getState: () => unknown }, "after_relic_select_eval");
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
