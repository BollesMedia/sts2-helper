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
import { selectActiveDeck, selectActivePlayer, selectMapContext } from "../run/runSelectors";
import { selectActiveRunId } from "../run/runSlice";
import { buildEvaluationContext } from "@sts2/shared/evaluation/context-builder";
import { getPlayer, type RestSiteState } from "@sts2/shared/types/game-state";
import { getPromptContext, updateFromContext } from "@sts2/shared/evaluation/run-narrative";
import { registerLastEvaluation } from "@sts2/shared/evaluation/last-evaluation-registry";
import { preEvalRestWeights, applyRestWeights } from "@sts2/shared/evaluation/post-eval-weights";
import { buildRestContext } from "../../lib/build-rest-context";
import {
  computeRestSiteEvalKey,
  buildRestSitePrompt,
  parseRestSiteResponse,
} from "../../lib/eval-inputs/rest-site";
import { logDevEvent, logReduxSnapshot } from "../../lib/dev-logger";

const EVAL_TYPE = "rest_site" as const;

export function setupRestSiteEvalListener() {
  startAppListening({
    predicate: (action, currentState) => {
      if (evalRetryRequested.match(action) && action.payload === EVAL_TYPE) return true;
      if (!gameStateReceived.match(action)) return false;
      return selectCurrentGameState(currentState)?.state_type === "rest_site";
    },

    effect: async (_action, listenerApi) => {
      listenerApi.cancelActiveListeners();

      const state = listenerApi.getState();
      const gameState = selectCurrentGameState(state);
      if (!gameState || gameState.state_type !== "rest_site") return;

      const restState = gameState as RestSiteState;
      const options = restState.rest_site.options.filter((o) => o.is_enabled);
      if (options.length <= 1) return;

      const evalKey = computeRestSiteEvalKey(restState.run.floor, options);
      const currentKey = selectEvalKey(EVAL_TYPE)(state);
      if (currentKey === evalKey) return;

      const restPlayer = getPlayer(restState);
      if (!restPlayer) return;

      const mapCtx = selectMapContext(state);
      const currentFloor = restState.run.floor;
      const bossDistance = mapCtx?.floorsToNextBoss ?? Math.min(
        ...[17, 34, 51].filter((bf) => bf > currentFloor).map((bf) => bf - currentFloor)
      );

      // Pre-eval short-circuit: skip LLM when answer is obvious
      const hpPercent = restPlayer.max_hp > 0 ? restPlayer.hp / restPlayer.max_hp : 1;
      const missing = restPlayer.max_hp - restPlayer.hp;
      const hasEliteAhead = mapCtx?.hasEliteAhead ?? false;
      const hasBossAhead = mapCtx?.hasBossAhead ?? false;
      const hasBossNear = bossDistance <= 3 || hasBossAhead;

      const preResult = preEvalRestWeights(
        hpPercent,
        missing,
        restPlayer.max_hp,
        hasEliteAhead,
        hasBossNear,
        options.map((o) => ({ id: o.id, name: o.name }))
      );

      if (preResult.shortCircuit) {
        listenerApi.dispatch(evalStarted({ evalType: EVAL_TYPE, evalKey }));
        listenerApi.dispatch(evalSucceeded({ evalType: EVAL_TYPE, evalKey, result: preResult.shortCircuit }));
        return;
      }

      const deckCards = selectActiveDeck(state);
      const player = selectActivePlayer(state);
      const runId = selectActiveRunId(state);

      const ctx = buildEvaluationContext(gameState, deckCards, player);
      if (!ctx) {
        listenerApi.dispatch(evalFailed({ evalType: EVAL_TYPE, evalKey, error: "Could not build evaluation context" }));
        return;
      }

      ctx.hpPercent = hpPercent;
      ctx.gold = restPlayer.gold;
      updateFromContext(ctx);
      listenerApi.dispatch(evalStarted({ evalType: EVAL_TYPE, evalKey }));

      try {
        const mapPrompt = buildRestSitePrompt({
          context: ctx,
          hp: restPlayer.hp,
          maxHp: restPlayer.max_hp,
          floorsToNextBoss: bossDistance,
          hasEliteAhead,
          hasBossAhead,
          hasRestAhead: mapCtx?.hasRestAhead ?? false,
          relicDescriptions: (ctx.relics ?? []).map((r) => `${r.name}: ${r.description}`),
          upgradeCandidates: (ctx.deckCards ?? [])
            .filter((c) => !c.name.includes("+"))
            .map((c) => c.name),
          options,
        });

        logDevEvent("eval", "rest_site_api_request", {
          context: ctx,
          mapPrompt,
        });

        const raw = await listenerApi
          .dispatch(
            evaluationApi.endpoints.evaluateRestSite.initiate({
              evalType: "rest_site",
              context: ctx,
              runNarrative: getPromptContext(),
              mapPrompt,
              runId,
              gameVersion: null,
            })
          )
          .unwrap();

        logDevEvent("eval", "rest_site_api_response", raw);

        const evaluation = parseRestSiteResponse(raw, options);

        // Apply post-eval weights (heal override near elite/boss)
        const restCtx = buildRestContext({
          hp: restPlayer.hp,
          maxHp: restPlayer.max_hp,
          floorsToNextBoss: bossDistance,
          hasEliteAhead,
          hasBossAhead,
          hasRestAhead: mapCtx?.hasRestAhead ?? false,
          relicDescriptions: (ctx.relics ?? []).map((r) => `${r.name}: ${r.description}`),
          upgradeCandidates: [],
        });
        applyRestWeights(evaluation, restCtx.hpPercent, restCtx.hasEliteAhead, restCtx.isBossSoon, ctx?.deckMaturity);

        registerLastEvaluation("rest_site", {
          recommendedId: evaluation.rankings?.[0]?.itemId ?? null,
          recommendedTier: evaluation.rankings?.[0]?.tier ?? null,
          reasoning: evaluation.rankings?.[0]?.reasoning ?? "",
          allRankings: evaluation.rankings.map((r) => ({
            itemId: r.itemId,
            itemName: r.itemName,
            tier: r.tier,
            recommendation: r.recommendation,
          })),
          evalType: "rest_site",
        });

        listenerApi.dispatch(evalSucceeded({ evalType: EVAL_TYPE, evalKey, result: evaluation }));
        logReduxSnapshot(listenerApi as unknown as { getState: () => unknown }, "after_rest_site_eval");
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
