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
import { getPlayer, type ShopState } from "@sts2/shared/types/game-state";
import { getPromptContext, updateFromContext } from "@sts2/shared/evaluation/run-narrative";
import { registerLastEvaluation } from "@sts2/shared/evaluation/last-evaluation-registry";
import { getUserId } from "@sts2/shared/lib/get-user-id";
import { computeShopEvalKey, buildShopRequest } from "../../lib/eval-inputs/shop";
import { logDevEvent, logReduxSnapshot } from "../../lib/dev-logger";

const EVAL_TYPE = "shop" as const;

export function setupShopEvalListener() {
  startAppListening({
    predicate: (action, currentState) => {
      if (evalRetryRequested.match(action) && action.payload === EVAL_TYPE) return true;
      if (!gameStateReceived.match(action)) return false;
      return selectCurrentGameState(currentState)?.state_type === "shop";
    },

    effect: async (_action, listenerApi) => {
      listenerApi.cancelActiveListeners();

      const state = listenerApi.getState();
      const gameState = selectCurrentGameState(state);
      if (!gameState || gameState.state_type !== "shop") return;

      const shopState = gameState as ShopState;
      const evalKey = computeShopEvalKey(
        shopState.shop.items,
        shopState.run.act,
        shopState.run.floor
      );

      const currentKey = selectEvalKey(EVAL_TYPE)(state);
      if (currentKey === evalKey) return;

      const deckCards = selectActiveDeck(state);
      const player = selectActivePlayer(state);
      const runId = selectActiveRunId(state);

      const ctx = buildEvaluationContext(gameState, deckCards, player);
      if (!ctx) {
        listenerApi.dispatch(evalFailed({ evalType: EVAL_TYPE, evalKey, error: "Could not build evaluation context — see console for validation errors" }));
        return;
      }

      console.log(`[ShopEval] context: ${ctx.character} Act${ctx.act} F${ctx.floor} deck=${ctx.deckSize} hp=${Math.round(ctx.hpPercent * 100)}% relics=${ctx.relics.length}`);

      const shopPlayer = getPlayer(shopState);
      const gold = shopPlayer?.gold ?? 0;
      ctx.gold = gold;

      // Skip if nothing is affordable
      const affordableCount = shopState.shop.items.filter((i) => i.is_stocked && i.can_afford).length;
      if (affordableCount === 0) return;

      updateFromContext(ctx);
      listenerApi.dispatch(evalStarted({ evalType: EVAL_TYPE, evalKey }));

      try {
        const shopRequest = buildShopRequest({
          context: ctx,
          items: shopState.shop.items,
          gold,
          runId,
          userId: getUserId(),
          runNarrative: getPromptContext(),
        });

        logDevEvent("eval", "shop_api_request", {
          context: ctx,
          mapPrompt: shopRequest,
        });

        const data = await listenerApi
          .dispatch(
            evaluationApi.endpoints.evaluateShop.initiate(shopRequest)
          )
          .unwrap();

        logDevEvent("eval", "shop_api_response", data);

        registerLastEvaluation("shop", {
          recommendedId: data.rankings?.[0]?.itemId ?? null,
          recommendedTier: data.rankings?.[0]?.tier ?? null,
          reasoning: data.rankings?.[0]?.reasoning ?? "",
          allRankings: (data.rankings ?? []).map((r) => ({
            itemId: r.itemId,
            itemName: r.itemName,
            tier: r.tier,
            recommendation: r.recommendation,
          })),
          evalType: "shop",
          raw: data, // #98
        });

        listenerApi.dispatch(evalSucceeded({ evalType: EVAL_TYPE, evalKey, result: data }));
        logReduxSnapshot(listenerApi as unknown as { getState: () => unknown }, "after_shop_eval");
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
