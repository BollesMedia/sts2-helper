import { startAppListening } from "../../store/listenerMiddleware";
import { gameStateApi } from "../../services/gameStateApi";
import { evaluationApi } from "../../services/evaluationApi";
import { selectActiveRun, mapEvalUpdated } from "../run/runSlice";
import { selectMapEvalContext, selectRecommendedNodesSet } from "../run/runSelectors";
import {
  evalStarted,
  evalSucceeded,
  evalFailed,
  evalRetryRequested,
} from "../evaluation/evaluationSlice";
import { selectEvalKey } from "../evaluation/evaluationSelectors";
import { selectActiveDeck, selectActivePlayer } from "../run/runSelectors";
import type { MapState } from "@sts2/shared/types/game-state";
import { buildEvaluationContext } from "@sts2/shared/evaluation/context-builder";
import { getPromptContext, updateFromContext } from "@sts2/shared/evaluation/run-narrative";
import { registerLastEvaluation } from "@sts2/shared/evaluation/last-evaluation-registry";
import { shouldEvaluateMap } from "../../lib/should-evaluate-map";
import { computeMapEvalKey, buildMapPrompt, type MapPathEvaluation } from "../../lib/eval-inputs/map";
import { traceRecommendedPath } from "../../views/map/map-path-tracer";
import { computeDeckMaturity, type DeckMaturityInput } from "@sts2/shared/evaluation/deck-maturity";
import { detectArchetypes, hasScalingSources, getScalingSources } from "@sts2/shared/evaluation/archetype-detector";

const EVAL_TYPE = "map" as const;

/**
 * Map evaluation listener.
 *
 * Watches game state changes on the map. Decides whether to evaluate
 * (via shouldEvaluateMap), then owns the full eval pipeline: API call,
 * path tracing, recommended nodes, and Redux persistence.
 */
export function setupMapEvalListener() {
  startAppListening({
    predicate: (action, currentState, previousState) => {
      // Retry
      if (evalRetryRequested.match(action) && action.payload === EVAL_TYPE) return true;

      const current = gameStateApi.endpoints.getGameState.select()(currentState);
      const previous = gameStateApi.endpoints.getGameState.select()(previousState);
      return (
        current.data?.state_type === "map" &&
        current.data !== previous.data
      );
    },

    effect: async (_action, listenerApi) => {
      listenerApi.cancelActiveListeners();

      const state = listenerApi.getState();
      const gameState = gameStateApi.endpoints.getGameState.select()(state).data;
      if (!gameState || gameState.state_type !== "map") return;

      const mapState = gameState as MapState;
      const run = selectActiveRun(state);
      if (!run) return;

      const options = mapState.map.next_options;
      const evalKey = computeMapEvalKey(options);
      const isRetry = evalRetryRequested.match(_action) && _action.payload === EVAL_TYPE;

      // --- Should we evaluate? ---
      if (!isRetry) {
        const prevContext = selectMapEvalContext(state);
        const recommendedNodes = selectRecommendedNodesSet(state);
        const currentPos = mapState.map?.current_position ?? null;

        const isOnPath = currentPos
          ? recommendedNodes.has(`${currentPos.col},${currentPos.row}`)
          : false;

        const input = {
          optionCount: options.length,
          hasPrevContext: !!prevContext,
          actChanged: prevContext ? prevContext.act !== run.act : false,
          currentPosition: currentPos,
          isOnRecommendedPath: isOnPath,
        };

        const shouldEval = shouldEvaluateMap(input);
        if (!shouldEval) return;
      }

      // --- Dedup ---
      const currentKey = selectEvalKey(EVAL_TYPE)(state);
      if (!isRetry && currentKey === evalKey) return;

      // --- Build context ---
      const deckCards = selectActiveDeck(state);
      const player = selectActivePlayer(state);
      const ctx = buildEvaluationContext(gameState, deckCards, player);
      if (!ctx) {
        listenerApi.dispatch(evalFailed({ evalType: EVAL_TYPE, evalKey, error: "Could not build evaluation context" }));
        return;
      }

      const mapPlayer = mapState.player ?? mapState.map?.player;
      if (mapPlayer) {
        ctx.gold = mapPlayer.gold;
        ctx.hpPercent = mapPlayer.max_hp > 0 ? mapPlayer.hp / mapPlayer.max_hp : 1;
      }

      updateFromContext(ctx);
      listenerApi.dispatch(evalStarted({ evalType: EVAL_TYPE, evalKey }));

      try {
        const mapPrompt = buildMapPrompt({
          context: ctx,
          state: mapState,
          cardRemovalCost: player?.cardRemovalCost ?? null,
        });

        const parsed = await listenerApi
          .dispatch(
            evaluationApi.endpoints.evaluateMap.initiate({
              context: ctx,
              runNarrative: getPromptContext(),
              mapPrompt,
              runId: null,
              gameVersion: null,
            })
          )
          .unwrap();

        // --- Path tracing ---
        const mp = mapState.player ?? mapState.map?.player;
        const hpPct = mp && mp.max_hp > 0 ? mp.hp / mp.max_hp : 1;
        const allNodes = mapState.map?.nodes ?? [];
        const bossPos = mapState.map.boss;
        const act = mapState.run?.act ?? 1;
        const floor = mapState.run?.floor ?? 1;

        const relics = player?.relics ?? [];
        const archetypes = detectArchetypes(deckCards, relics);
        const maturityCtx: DeckMaturityInput = {
          archetypes,
          deckSize: deckCards.length,
          deckCards: deckCards.map((c) => ({ name: c.name })),
          hasScaling: hasScalingSources(deckCards),
          scalingSources: getScalingSources(deckCards),
          upgradeCount: deckCards.filter((c) => c.name.includes("+")).length,
        };
        const deckMaturity = computeDeckMaturity(maturityCtx);
        const relicCount = relics.length;

        // Find best option for primary path trace
        const tierOrder = ["S", "A", "B", "C", "D", "F"];
        const bestRanking = parsed.rankings.length > 0
          ? parsed.rankings.reduce((a, b) => {
              const aTier = tierOrder.indexOf(a.tier);
              const bTier = tierOrder.indexOf(b.tier);
              if (aTier !== bTier) return aTier < bTier ? a : b;
              return (a.confidence ?? 0) >= (b.confidence ?? 0) ? a : b;
            })
          : null;
        const bestOpt = bestRanking
          ? options.find((_, i) => i + 1 === bestRanking.optionIndex)
          : null;

        const tracedPath = bestOpt
          ? traceRecommendedPath(
              bestOpt.col, bestOpt.row, allNodes, bossPos,
              hpPct, mp?.gold ?? 0, act, deckMaturity, relicCount, floor
            )
          : parsed.recommendedPath;

        // Build recommendedNodes from ALL options
        const recommendedNodes = new Set<string>();
        for (const opt of options) {
          recommendedNodes.add(`${opt.col},${opt.row}`);
          const fullPath = traceRecommendedPath(
            opt.col, opt.row, allNodes, bossPos,
            hpPct, mp?.gold ?? 0, act, deckMaturity, relicCount, floor
          );
          for (const p of fullPath) {
            recommendedNodes.add(`${p.col},${p.row}`);
          }
        }
        for (const p of parsed.recommendedPath) {
          recommendedNodes.add(`${p.col},${p.row}`);
        }
        for (const p of tracedPath) {
          recommendedNodes.add(`${p.col},${p.row}`);
        }

        // Persist path + context to Redux for shouldEvaluate + map view
        listenerApi.dispatch(mapEvalUpdated({
          recommendedPath: tracedPath,
          recommendedNodes: [...recommendedNodes],
          lastEvalContext: {
            hpPercent: hpPct,
            deckSize: deckCards.length,
            act,
          },
        }));

        registerLastEvaluation("map", {
          recommendedId: parsed.rankings?.[0]?.nodeType ?? null,
          recommendedTier: parsed.rankings?.[0]?.tier ?? null,
          reasoning: parsed.rankings?.[0]?.reasoning ?? parsed.overallAdvice ?? "",
          allRankings: (parsed.rankings ?? []).map((r) => ({
            itemId: r.nodeType,
            itemName: r.nodeType,
            tier: r.tier,
            recommendation: r.recommendation,
          })),
          evalType: "map",
        });

        listenerApi.dispatch(evalSucceeded({ evalType: EVAL_TYPE, evalKey, result: parsed }));
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
