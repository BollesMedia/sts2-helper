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
import { initRelicLookup } from "../../lib/relic-lookup";
import type { EventState } from "@sts2/shared/types/game-state";
import {
  computeEventEvalKey,
  buildEventPrompt,
  parseEventResponse,
} from "../../lib/eval-inputs/event";

const EVAL_TYPE = "event" as const;

export function setupEventEvalListener() {
  let relicInitDone = false;

  startAppListening({
    predicate: (action, currentState, previousState) => {
      if (evalRetryRequested.match(action) && action.payload === EVAL_TYPE) return true;
      const current = gameStateApi.endpoints.getGameState.select()(currentState);
      const previous = gameStateApi.endpoints.getGameState.select()(previousState);
      return current.data?.state_type === "event" && current.data !== previous.data;
    },

    effect: async (_action, listenerApi) => {
      listenerApi.cancelActiveListeners();

      // Lazy init — Supabase may not be ready at store setup time
      if (!relicInitDone) {
        relicInitDone = true;
        initRelicLookup();
      }

      const state = listenerApi.getState();
      const gameState = gameStateApi.endpoints.getGameState.select()(state).data;
      if (!gameState || gameState.state_type !== "event") return;

      const eventState = gameState as EventState;
      const options = eventState.event.options.filter((o) => !o.is_proceed && !o.is_locked);
      if (options.length <= 1) return;

      const evalKey = computeEventEvalKey(eventState.event.event_id, options);
      const currentKey = selectEvalKey(EVAL_TYPE)(state);
      if (currentKey === evalKey) return;

      const deckCards = selectActiveDeck(state);
      const player = selectActivePlayer(state);
      const runId = selectActiveRunId(state);

      const ctx = buildEvaluationContext(gameState, deckCards, player);
      if (!ctx) {
        listenerApi.dispatch(evalFailed({ evalType: EVAL_TYPE, evalKey, error: "Could not build evaluation context" }));
        return;
      }

      updateFromContext(ctx);
      listenerApi.dispatch(evalStarted({ evalType: EVAL_TYPE, evalKey }));

      try {
        const mapPrompt = buildEventPrompt({
          context: ctx,
          eventName: eventState.event.event_name,
          isAncient: eventState.event.is_ancient,
          options,
          runNarrative: getPromptContext(),
        });

        const raw = await listenerApi
          .dispatch(
            evaluationApi.endpoints.evaluateEvent.initiate({
              evalType: "event",
              context: ctx,
              runNarrative: getPromptContext(),
              mapPrompt,
              runId,
              gameVersion: null,
            })
          )
          .unwrap();

        const evaluation = parseEventResponse(raw, options);

        registerLastEvaluation("event", {
          recommendedId: evaluation.rankings?.[0]?.itemId ?? null,
          recommendedTier: evaluation.rankings?.[0]?.tier ?? null,
          reasoning: evaluation.rankings?.[0]?.reasoning ?? "",
          allRankings: evaluation.rankings.map((r) => ({
            itemId: r.itemId,
            itemName: r.itemName,
            tier: r.tier,
            recommendation: r.recommendation,
          })),
          evalType: "event",
        });

        listenerApi.dispatch(evalSucceeded({ evalType: EVAL_TYPE, evalKey, result: evaluation }));
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
